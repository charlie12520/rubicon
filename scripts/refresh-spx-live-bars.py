#!/usr/bin/env python
"""Live SPX intraday bar feed for Rubicon's Estimator chart.

Connects once to TWS/Gateway (ib_insync), then every few seconds re-pulls today's
RTH 1-minute SPX index bars via reqHistoricalData and writes them atomically to
``data/spx-live-bars.json``. The Estimator's 2-minute chart reads this file (via
``/api/spx-live-bars``) so the target-level price line has a live SPX backdrop
during the session — instead of waiting for the post-close daily pull.

Decoupled from the heatmap loop on purpose (that file is heavily contended):
its own process, its own client id (default 947, distinct from heatmap 941 /
holdings 884), its own output file. Stops itself at 16:00 ET.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "data" / "spx-live-bars.json"
CLOSE_HHMM = "16:00"


def _et_zone():
    from zoneinfo import ZoneInfo

    return ZoneInfo("America/New_York")


def et_now() -> datetime:
    return datetime.now(_et_zone())


def parse_ports(text: str) -> list[int]:
    ports: list[int] = []
    for piece in str(text).split(","):
        piece = piece.strip()
        if piece.isdigit():
            ports.append(int(piece))
    return ports or [7496, 4001]


def _epoch(value) -> int:
    """Bar date -> UTC epoch seconds. ib_insync returns tz-aware datetimes for
    intraday bars (or an int with formatDate=2); handle both defensively."""
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=_et_zone())
        return int(dt.timestamp())
    # ib_insync may hand back a date for daily bars; not expected for 1-min RTH.
    return int(datetime.fromisoformat(str(value)).timestamp())


def _to_spx_bar(bar, et_zone) -> dict | None:
    try:
        epoch = _epoch(bar.date)
        et = datetime.fromtimestamp(epoch, et_zone)
        return {
            "time": epoch,
            "timestampEt": et.isoformat(),
            "label": et.strftime("%H:%M"),
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
        }
    except Exception:  # noqa: BLE001
        return None


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(path)


def run(host: str, ports: list[int], client_id: int, out_path: Path, interval: float, bar_size: str) -> int:
    from ib_insync import IB, Index  # lazy: only this feed needs ib_insync

    et_zone = _et_zone()

    ib = None
    connect_error: object = None
    for offset, port in enumerate(ports):
        for cid in (client_id + offset, client_id + offset + 60, client_id + offset + 211):
            candidate = IB()
            try:
                candidate.connect(host, port, clientId=cid, timeout=12.0, readonly=True)
                ib = candidate
                print(f"[spx-live] connected {host}:{port} clientId={cid}", flush=True)
                break
            except Exception as exc:  # noqa: BLE001
                connect_error = exc
                try:
                    candidate.disconnect()
                except Exception:  # noqa: BLE001
                    pass
        if ib is not None:
            break
    if ib is None:
        print(f"[spx-live] CONNECT FAILED ({connect_error!r}); is TWS/Gateway running on {ports}?", flush=True)
        return 2

    try:
        ib.reqMarketDataType(1)
        spx = Index("SPX", "CBOE", "USD")
        try:
            ib.qualifyContracts(spx)
        except Exception as exc:  # noqa: BLE001
            print(f"[spx-live] qualify warning: {exc!r}", flush=True)
        print(f"[spx-live] SPX conId={getattr(spx, 'conId', 0)} bar={bar_size} every {interval:.0f}s until {CLOSE_HHMM} ET", flush=True)

        writes = 0
        while True:
            now = et_now()
            if now.strftime("%H:%M") >= CLOSE_HHMM:
                print(f"[spx-live] {now:%H:%M} ET >= close; stopping after {writes} writes", flush=True)
                break
            today = now.strftime("%Y-%m-%d")
            bars: list[dict] = []
            try:
                raw = ib.reqHistoricalData(
                    spx,
                    endDateTime="",
                    durationStr="1 D",
                    barSizeSetting=bar_size,
                    whatToShow="TRADES",
                    useRTH=True,
                    formatDate=1,
                )
                for bar in raw:
                    spx_bar = _to_spx_bar(bar, et_zone)
                    # Keep only today's RTH bars; pre-open IBKR returns the prior
                    # session, which we don't want bleeding onto today's chart.
                    if spx_bar and spx_bar["timestampEt"][:10] == today:
                        bars.append(spx_bar)
            except Exception as exc:  # noqa: BLE001
                print(f"[spx-live] reqHistoricalData error: {exc!r}", flush=True)

            payload = {
                "generatedAt": datetime.now(et_zone).isoformat(),
                "session": today,
                "source": "ibkr-live",
                "live": True,
                "barSize": bar_size,
                "bars": bars,
            }
            write_json_atomic(out_path, payload)
            writes += 1
            if writes == 1 or writes % 20 == 0:
                tail = bars[-1]["label"] if bars else "—"
                print(f"[spx-live] wrote {len(bars)} bars (latest {tail}) [{writes}]", flush=True)
            ib.sleep(max(interval, 2.0))
        return 0
    finally:
        try:
            ib.disconnect()
        except Exception:  # noqa: BLE001
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Live SPX intraday bar feed for the Rubicon Estimator chart.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--ports", default="7496,4001")
    parser.add_argument("--client-id", type=int, default=947)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--interval", type=float, default=15.0, help="seconds between SPX bar pulls")
    parser.add_argument("--bar-size", default="1 min")
    args = parser.parse_args()
    return run(args.host, parse_ports(args.ports), args.client_id, args.out, args.interval, args.bar_size)


if __name__ == "__main__":
    sys.exit(main())
