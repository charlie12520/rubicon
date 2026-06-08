#!/usr/bin/env python3
"""Build Rubicon's default sector-rotation RRG dataset.

Writes data/sector-rrg-bars.json: ~2 years of daily OHLCV bars for the 11 SPDR
sector ETFs plus SPY (the benchmark), in the exact shape server/rrgBars.ts already
consumes for the Relative Rotation Graph. This is the canonical "SPY sectors vs SPY"
RRG and is the default view of the Rotation tab.

Bars come from Yahoo's free chart endpoint (no key, ~15-min delayed close, but for a
daily-bar RRG the prior-session close is all that matters). The pull has no TWS/IBKR
dependency, so it runs unattended inside the daily sync.

Stdlib-only (urllib + json) so it runs on any Python without installs — same posture
as scripts/refresh-spx-heatmap.py.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = APP_ROOT / "data" / "sector-rrg-bars.json"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Benchmark first, then the 11 SPDR Select Sector ETFs (GICS sectors).
BENCHMARK = "SPY"
SECTOR_ETFS = [
    "XLB",   # Materials
    "XLC",   # Communication Services
    "XLE",   # Energy
    "XLF",   # Financials
    "XLI",   # Industrials
    "XLK",   # Technology
    "XLP",   # Consumer Staples
    "XLRE",  # Real Estate
    "XLU",   # Utilities
    "XLV",   # Health Care
    "XLY",   # Consumer Discretionary
]
UNIVERSE = [BENCHMARK, *SECTOR_ETFS]


def _http_bytes(url: str, timeout: float = 20.0) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _finite(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def fetch_yahoo_daily(symbol: str, rng: str = "2y", timeout: float = 20.0) -> list[dict] | None:
    """Fetch daily OHLCV bars for one symbol. Returns rows sorted ascending by date."""
    ysym = symbol.replace(".", "-")
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}"
        f"?interval=1d&range={rng}&includePrePost=false"
    )
    for attempt in range(3):
        try:
            blob = _http_bytes(url, timeout=timeout)
            data = json.loads(blob)
            result = (data.get("chart", {}).get("result") or [None])[0]
            if not result:
                return None
            timestamps = result.get("timestamp") or []
            quote = (result.get("indicators", {}).get("quote") or [{}])[0]
            opens = quote.get("open") or []
            highs = quote.get("high") or []
            lows = quote.get("low") or []
            closes = quote.get("close") or []
            volumes = quote.get("volume") or []
            rows: list[dict] = []
            for i, ts in enumerate(timestamps):
                close = _finite(closes[i]) if i < len(closes) else None
                if close is None:
                    continue  # holiday/partial bar — skip
                # Yahoo daily bars stamp at 09:30 ET; date in UTC is the session date.
                day = datetime.fromtimestamp(ts, tz=timezone.utc)
                open_ = _finite(opens[i]) if i < len(opens) else None
                high = _finite(highs[i]) if i < len(highs) else None
                low = _finite(lows[i]) if i < len(lows) else None
                volume = _finite(volumes[i]) if i < len(volumes) else None
                rows.append(
                    {
                        "date": f"{day.year:04d}-{day.month:02d}-{day.day:02d}",
                        "open": open_ if open_ is not None else close,
                        "high": high if high is not None else close,
                        "low": low if low is not None else close,
                        "close": close,
                        "volume": volume,
                    }
                )
            rows.sort(key=lambda r: r["date"])
            return rows or None
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
            time.sleep(0.6 * (attempt + 1))
        except Exception:  # noqa: BLE001
            return None
    return None


def build_payload(rng: str) -> dict:
    bars_by_symbol: dict[str, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(fetch_yahoo_daily, sym, rng): sym for sym in UNIVERSE}
        for future in as_completed(futures):
            sym = futures[future]
            try:
                rows = future.result()
            except Exception:  # noqa: BLE001
                rows = None
            if rows:
                bars_by_symbol[sym] = rows
            else:
                print(f"  warn: no bars for {sym}", file=sys.stderr, flush=True)

    symbols = [sym for sym in UNIVERSE if sym in bars_by_symbol]
    generated_at = datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "barsBySymbol": bars_by_symbol,
        "symbols": symbols,
        "generatedAt": generated_at,
        "source": "yahoo:chart-1d",
        "note": "SPDR sector ETFs vs SPY (default sector-rotation RRG).",
    }


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Rubicon's default sector-rotation RRG dataset.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--range", default="2y", help="Yahoo history range (e.g. 1y, 2y, 5y)")
    args = parser.parse_args()

    payload = build_payload(args.range)
    if len(payload["symbols"]) < 2:
        print("Refusing to write: fewer than 2 symbols fetched from Yahoo.", file=sys.stderr)
        return 1

    write_json_atomic(args.out, payload)
    print(
        json.dumps(
            {
                "ok": True,
                "outPath": str(args.out),
                "source": payload["source"],
                "symbols": len(payload["symbols"]),
                "missing": [s for s in UNIVERSE if s not in payload["symbols"]],
                "generatedAt": payload["generatedAt"],
            }
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
