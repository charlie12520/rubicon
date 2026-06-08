#!/usr/bin/env python
"""Live SPXW 0DTE option-chain snapshot feed for Rubicon's Morning Signal Stack.

Connects once to TWS/Gateway (ib_insync), then every few seconds snapshots the
current SPX index level plus a band of SPXW 0DTE call/put marks around the money,
and writes them atomically to ``data/spx-0dte-chain.json``. The server's
``/api/spread-speed/live`` route feeds this into the same spread-speed engine the
EOD path uses (``buildFrame``) so the Signal Stack can show *today's* recommended
credit spreads live — instead of waiting for the post-close daily pull.

Decoupled from the other live loops on purpose: its own process, its own client
id (default 948, distinct from spx-live-bars 947 / heatmap 941 / holdings 884),
its own output file. Stops itself at 16:00 ET.

The strike grid covers ``base-50 … base+50`` step 5 (base = round(spot/5)*5) for
both rights, so every leg the engine samples (OTM rows out to ~45pt plus the ATM
straddle) has a live mark — which is what lets the recommended spread show its
live credit.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parents[1] / "data" / "spx-0dte-chain.json"
CLOSE_HHMM = "16:00"
GRID_HALF_WIDTH = 50  # strikes from base-50..base+50 step 5 (both C and P)
STRIKE_STEP = 5


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


def _finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    # ib_insync uses NaN / -1 for "no data"; treat both as missing.
    if number != number or number <= 0:
        return None
    return number


def _pick_mark(ticker) -> float | None:
    """last -> mid(bid,ask) -> close, matching the engine's use of `close`."""
    last = _finite(getattr(ticker, "last", None))
    if last is not None:
        return last
    bid = _finite(getattr(ticker, "bid", None))
    ask = _finite(getattr(ticker, "ask", None))
    if bid is not None and ask is not None:
        return round((bid + ask) / 2, 4)
    return _finite(getattr(ticker, "close", None))


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(path)


def _spx_spot(ib, spx, et_zone) -> float | None:
    """Current SPX index level via a short market-data snapshot."""
    ticker = ib.reqMktData(spx, snapshot=False)
    ib.sleep(1.5)
    spot = _finite(getattr(ticker, "last", None)) or _finite(getattr(ticker, "close", None))
    if spot is None:
        spot = _finite(ib.marketPrice() if hasattr(ib, "marketPrice") else None)
    try:
        ib.cancelMktData(spx)
    except Exception:  # noqa: BLE001
        pass
    return spot


def _build_contracts(option_cls, base: float, expiry: str) -> list[tuple[float, str, object]]:
    contracts: list[tuple[float, str, object]] = []
    offsets = range(-GRID_HALF_WIDTH, GRID_HALF_WIDTH + 1, STRIKE_STEP)
    for off in offsets:
        strike = round(base + off)
        for right in ("C", "P"):
            contract = option_cls(
                symbol="SPX",
                lastTradeDateOrContractMonth=expiry,
                strike=float(strike),
                right=right,
                exchange="CBOE",
                currency="USD",
                tradingClass="SPXW",
                multiplier="100",
            )
            contracts.append((float(strike), right, contract))
    return contracts


def _snapshot_rows(ib, contracts, wait_s: float) -> list[dict]:
    tickers = []
    for _strike, _right, contract in contracts:
        try:
            ticker = ib.reqMktData(contract, snapshot=False)
            tickers.append(ticker)
        except Exception:  # noqa: BLE001
            tickers.append(None)
    ib.sleep(max(wait_s, 2.0))
    rows: list[dict] = []
    for (strike, right, contract), ticker in zip(contracts, tickers):
        mark = _pick_mark(ticker) if ticker is not None else None
        if mark is not None:
            rows.append({"strike": strike, "right": right, "close": mark})
        try:
            ib.cancelMktData(contract)
        except Exception:  # noqa: BLE001
            pass
    return rows


def run(host: str, ports: list[int], client_id: int, out_path: Path, interval: float, wait_s: float) -> int:
    from ib_insync import IB, Index, Option  # lazy: only this feed needs ib_insync

    et_zone = _et_zone()

    ib = None
    connect_error: object = None
    for offset, port in enumerate(ports):
        for cid in (client_id + offset, client_id + offset + 60, client_id + offset + 211):
            candidate = IB()
            try:
                candidate.connect(host, port, clientId=cid, timeout=12.0, readonly=True)
                ib = candidate
                print(f"[spx-0dte] connected {host}:{port} clientId={cid}", flush=True)
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
        print(f"[spx-0dte] CONNECT FAILED ({connect_error!r}); is TWS/Gateway running on {ports}?", flush=True)
        return 2

    try:
        ib.reqMarketDataType(1)
        spx = Index("SPX", "CBOE", "USD")
        try:
            ib.qualifyContracts(spx)
        except Exception as exc:  # noqa: BLE001
            print(f"[spx-0dte] qualify warning: {exc!r}", flush=True)
        print(f"[spx-0dte] grid base±{GRID_HALF_WIDTH}pt every {interval:.0f}s until {CLOSE_HHMM} ET", flush=True)

        writes = 0
        while True:
            now = et_now()
            if now.strftime("%H:%M") >= CLOSE_HHMM:
                print(f"[spx-0dte] {now:%H:%M} ET >= close; stopping after {writes} writes", flush=True)
                break
            today = now.strftime("%Y-%m-%d")
            expiry = now.strftime("%Y%m%d")
            label = now.strftime("%H:%M")
            rows: list[dict] = []
            spot = None
            try:
                spot = _spx_spot(ib, spx, et_zone)
                if spot is not None:
                    base = round(spot / STRIKE_STEP) * STRIKE_STEP
                    contracts = _build_contracts(Option, base, expiry)
                    rows = _snapshot_rows(ib, contracts, wait_s)
            except Exception as exc:  # noqa: BLE001
                print(f"[spx-0dte] snapshot error: {exc!r}", flush=True)

            payload = {
                "generatedAt": datetime.now(et_zone).isoformat(),
                "session": today,
                "source": "ibkr-live",
                "live": True,
                "spot": spot,
                "label": label,
                "asOf": now.isoformat(),
                "rows": rows,
            }
            write_json_atomic(out_path, payload)
            writes += 1
            if writes == 1 or writes % 10 == 0:
                print(f"[spx-0dte] wrote spot={spot} rows={len(rows)} ({label}) [{writes}]", flush=True)
            ib.sleep(max(interval, 5.0))
        return 0
    finally:
        try:
            ib.disconnect()
        except Exception:  # noqa: BLE001
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Live SPXW 0DTE chain snapshot feed for the Rubicon Signal Stack.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--ports", default="7496,4001")
    parser.add_argument("--client-id", type=int, default=948)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--interval", type=float, default=15.0, help="seconds between chain snapshots")
    parser.add_argument("--wait", type=float, default=3.0, help="seconds to let market-data tickers populate")
    args = parser.parse_args()
    return run(args.host, parse_ports(args.ports), args.client_id, args.out, args.interval, args.wait)


if __name__ == "__main__":
    sys.exit(main())
