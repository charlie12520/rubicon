#!/usr/bin/env python3
"""Build Rubicon's intraday S&P 500 market-map heatmap payload.

Writes data/spx-heatmap.json: one tile per constituent, sized by index weight and
carrying a per-minute % change series (pctByTime) aligned to a shared session axis
so the panel can scrub/animate the whole map through the trading day.

Structure (universe, weights, GICS sectors) comes from State Street's free daily
SPY holdings spreadsheet, with the equity-history manifest as an offline fallback.

Bar sources (pluggable feed):
  --source sample      deterministic synthetic intraday paths (offline, instant) [default]
  --source yahoo       real 1-min bars from Yahoo's chart endpoint (~15-min delayed, no key)
  --source ibkr-disk   reuse 1-min CSVs already pulled under "IBKR Equity History Pull"

This script is intentionally stdlib-only (urllib + a tiny xlsx reader) so it runs on
any Python without extra installs. A live IBKR snapshot-poll feed can be added later.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

APP_ROOT = Path(__file__).resolve().parents[1]
AI_STUFF_ROOT = Path(os.environ.get("AI_STUFF_ROOT", APP_ROOT.parent)).resolve()
IBKR_ROOT = AI_STUFF_ROOT / "IBKR Equity History Pull"
DEFAULT_OUT = APP_ROOT / "data" / "spx-heatmap.json"

SSGA_URLS = [
    "https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx",
    "https://www.ssga.com/us/en/institutional/etfs/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx",
]
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
XLSX_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


# --------------------------------------------------------------------------- #
# Session time axis (regular trading hours, 1-minute buckets)
# --------------------------------------------------------------------------- #
def session_axis() -> list[str]:
    """09:30 .. 16:00 ET inclusive, one label per minute (391 buckets)."""
    return [f"{m // 60:02d}:{m % 60:02d}" for m in range(9 * 60 + 30, 16 * 60 + 1)]


# --------------------------------------------------------------------------- #
# Universe / weights / sectors
# --------------------------------------------------------------------------- #
def _http_bytes(url: str, timeout: float = 30.0) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _col_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch.upper()) - 64)
    return idx - 1


def _read_xlsx_rows(blob: bytes) -> list[list[str]]:
    """Minimal xlsx reader: returns the first worksheet as a list of string rows."""
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:  # type: ignore[name-defined]
        shared: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{XLSX_NS}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{XLSX_NS}t")))
        sheet_path = "xl/worksheets/sheet1.xml"
        if sheet_path not in zf.namelist():
            sheets = sorted(n for n in zf.namelist() if n.startswith("xl/worksheets/") and n.endswith(".xml"))
            if not sheets:
                return []
            sheet_path = sheets[0]
        root = ET.fromstring(zf.read(sheet_path))
        rows: list[list[str]] = []
        for row in root.iter(f"{XLSX_NS}row"):
            cells: dict[int, str] = {}
            max_col = -1
            for cell in row.findall(f"{XLSX_NS}c"):
                cidx = _col_index(cell.get("r", "A1"))
                ctype = cell.get("t")
                value_node = cell.find(f"{XLSX_NS}v")
                inline_node = cell.find(f"{XLSX_NS}is")
                if ctype == "s" and value_node is not None and value_node.text is not None:
                    value = shared[int(value_node.text)] if int(value_node.text) < len(shared) else ""
                elif ctype == "inlineStr" and inline_node is not None:
                    value = "".join(t.text or "" for t in inline_node.iter(f"{XLSX_NS}t"))
                elif value_node is not None and value_node.text is not None:
                    value = value_node.text
                else:
                    value = ""
                cells[cidx] = value
                max_col = max(max_col, cidx)
            rows.append([cells.get(i, "") for i in range(max_col + 1)])
        return rows


def _to_float(text: str) -> float | None:
    try:
        return float(str(text).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def load_universe_from_ssga() -> list[dict]:
    blob: bytes | None = None
    last_error = ""
    for url in SSGA_URLS:
        try:
            blob = _http_bytes(url)
            break
        except Exception as exc:  # noqa: BLE001
            last_error = repr(exc)
    if blob is None:
        raise RuntimeError(f"could not download SSGA SPY holdings ({last_error})")

    rows = _read_xlsx_rows(blob)
    header_idx = None
    cols: dict[str, int] = {}
    for i, row in enumerate(rows):
        lowered = [str(c).strip().lower() for c in row]
        if "ticker" in lowered and "weight" in lowered:
            header_idx = i
            for j, name in enumerate(lowered):
                if name in ("name",) and "name" not in cols:
                    cols["name"] = j
                elif name == "ticker":
                    cols["ticker"] = j
                elif name == "weight":
                    cols["weight"] = j
                elif name == "sector":
                    cols["sector"] = j
            break
    if header_idx is None or "ticker" not in cols or "weight" not in cols:
        raise RuntimeError("SSGA holdings sheet did not contain the expected Ticker/Weight columns")

    universe: list[dict] = []
    for row in rows[header_idx + 1 :]:
        if cols["ticker"] >= len(row):
            continue
        ticker = str(row[cols["ticker"]]).strip().upper()
        if not ticker or ticker in ("-", "CASH", "USD") or " " in ticker:
            continue
        if not any(ch.isalpha() for ch in ticker):
            continue
        weight = _to_float(row[cols["weight"]]) if cols["weight"] < len(row) else None
        if weight is None or weight <= 0:
            continue
        name = str(row[cols["name"]]).strip() if "name" in cols and cols["name"] < len(row) else ticker
        # SSGA ships the Sector column as "-"; GICS sectors are merged in separately.
        universe.append({"symbol": ticker, "name": name or ticker, "sector": "Unknown", "weight": weight})
    if not universe:
        raise RuntimeError("SSGA holdings parsed but no constituents were found")
    return universe


GICS_SECTORS = {
    "Information Technology",
    "Health Care",
    "Financials",
    "Consumer Discretionary",
    "Communication Services",
    "Industrials",
    "Consumer Staples",
    "Energy",
    "Utilities",
    "Real Estate",
    "Materials",
}


class _TableRowParser(HTMLParser):
    """Collects every table row in a page as a list of cell-text lists."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list) -> None:  # noqa: ARG002
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def load_sectors_from_wikipedia() -> dict[str, str]:
    """Ticker -> GICS sector from the S&P 500 constituents table."""
    html = _http_bytes("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies").decode("utf-8", "ignore")
    parser = _TableRowParser()
    parser.feed(html)
    mapping: dict[str, str] = {}
    for row in parser.rows:
        if not row:
            continue
        ticker = row[0].strip().upper().replace("​", "")
        sector = next((cell.strip() for cell in row if cell.strip() in GICS_SECTORS), None)
        if not ticker or not sector or not any(ch.isalpha() for ch in ticker):
            continue
        mapping[ticker] = sector
        mapping[ticker.replace(".", "-")] = sector
        mapping[ticker.replace("-", ".")] = sector
    return mapping


def apply_sectors(universe: list[dict]) -> str:
    """Best-effort: fill each constituent's GICS sector from Wikipedia."""
    try:
        sectors = load_sectors_from_wikipedia()
    except Exception as exc:  # noqa: BLE001
        print(f"Wikipedia sectors unavailable ({exc}); tiles will group under 'Unknown'.", file=sys.stderr)
        return "none"
    matched = 0
    for entry in universe:
        symbol = entry["symbol"]
        sector = sectors.get(symbol) or sectors.get(symbol.replace(".", "-")) or sectors.get(symbol.replace("-", "."))
        if sector:
            entry["sector"] = sector
            matched += 1
    return f"wikipedia ({matched}/{len(universe)} matched)"


def load_universe_from_manifest() -> list[dict]:
    manifest = IBKR_ROOT / "queues" / "spy500_equity_1m_20240429_20260428" / "manifest.csv"
    import csv as _csv

    rows = list(_csv.DictReader(manifest.open(newline="", encoding="utf-8")))
    universe: list[dict] = []
    total = len(rows)
    for i, row in enumerate(rows):
        symbol = str(row.get("symbol", "")).strip().upper()
        if not symbol:
            continue
        # No weights/sectors in the manifest — approximate weight by rank so the
        # map still renders something sensible when SSGA is unreachable.
        weight = round((total - i) / total * 2.0 + 0.05, 4)
        universe.append({"symbol": symbol, "name": str(row.get("name", symbol)).strip() or symbol, "sector": "Unknown", "weight": weight})
    if not universe:
        raise RuntimeError("manifest fallback produced no symbols")
    return universe


# --------------------------------------------------------------------------- #
# Bar sources
# --------------------------------------------------------------------------- #
def build_series(
    axis: list[str],
    prev_close: float | None,
    by_label: dict[str, float],
    frontier_idx: int | None = None,
) -> list[float | None]:
    """Forward-filled % change vs prior close, aligned to the session axis.

    Fills the last known print forward through gaps (a market map shows every
    name's last quote), but never past `frontier_idx` — the latest minute that
    actually has data across the universe — so a live mid-session map doesn't
    pretend the close already happened.
    """
    out: list[float | None] = []
    last_close: float | None = None
    started = False
    limit = frontier_idx if frontier_idx is not None else len(axis) - 1
    for i, label in enumerate(axis):
        if label in by_label:
            last_close = by_label[label]
            started = True
        if i > limit or not started or last_close is None or not prev_close:
            out.append(None)
        else:
            out.append(round((last_close / prev_close - 1.0) * 100.0, 2))
    return out


def fetch_yahoo_1m(symbol: str, axis: list[str], timeout: float = 12.0) -> dict | None:
    ysym = symbol.replace(".", "-")
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}"
        "?interval=1m&range=1d&includePrePost=false"
    )
    for attempt in range(3):
        try:
            blob = _http_bytes(url, timeout=timeout)
            data = json.loads(blob)
            result = (data.get("chart", {}).get("result") or [None])[0]
            if not result:
                return None
            meta = result.get("meta", {})
            prev_close = meta.get("chartPreviousClose") or meta.get("previousClose")
            gmt = int(meta.get("gmtoffset", 0) or 0)
            timestamps = result.get("timestamp") or []
            quote = (result.get("indicators", {}).get("quote") or [{}])[0]
            closes = quote.get("close") or []
            by_label: dict[str, float] = {}
            session_date = ""
            for ts, close in zip(timestamps, closes):
                if close is None:
                    continue
                local = datetime.fromtimestamp(ts + gmt, tz=timezone.utc)
                by_label[f"{local.hour:02d}:{local.minute:02d}"] = float(close)
                session_date = f"{local.year:04d}-{local.month:02d}-{local.day:02d}"
            last = meta.get("regularMarketPrice")
            return {
                "prevClose": float(prev_close) if prev_close else None,
                "last": float(last) if last is not None else None,
                "by_label": by_label,
                "session": session_date,
            }
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
            time.sleep(0.6 * (attempt + 1))
        except Exception:  # noqa: BLE001
            return None
    return None


def sample_series(axis: list[str], symbol: str, sector: str, sector_drift: float) -> dict:
    rng = random.Random(abs(hash((symbol, "rubicon-spx-v1"))) % (2**32))
    drift = sector_drift + rng.uniform(-0.0006, 0.0006)
    vol = rng.uniform(0.0006, 0.0024)
    value = 0.0
    series: list[float | None] = []
    for _ in axis:
        value += drift + rng.gauss(0.0, vol)
        series.append(round(max(-9.0, min(9.0, value * 100.0)), 2))
    prev_close = round(rng.uniform(18.0, 620.0), 2)
    last_pct = series[-1] or 0.0
    return {
        "prevClose": prev_close,
        "last": round(prev_close * (1.0 + last_pct / 100.0), 2),
        "pctByTime": series,
        "session": datetime.now().strftime("%Y-%m-%d"),
    }


def read_ibkr_disk_1m(symbol: str, axis: list[str], target_date: str | None) -> dict | None:
    base = IBKR_ROOT / "data" / "spy500_equity_1m" / f"ibkr_{symbol.lower()}"
    if not base.exists():
        return None
    import csv as _csv

    csv_files = sorted(base.rglob("*.csv"))
    if not csv_files:
        return None
    by_label: dict[str, float] = {}
    chosen_date = target_date or ""
    for path in csv_files:
        try:
            with path.open(newline="", encoding="utf-8") as handle:
                for row in _csv.DictReader(handle):
                    stamp = str(row.get("date") or row.get("timestamp") or row.get("time") or "")
                    close = _to_float(str(row.get("close") or row.get("Close") or ""))
                    if close is None or "T" not in stamp and " " not in stamp:
                        continue
                    date_part = stamp.split("T")[0].split(" ")[0]
                    if not chosen_date:
                        chosen_date = date_part
                    if date_part != chosen_date:
                        continue
                    hhmm = stamp.split("T")[-1].split(" ")[-1][:5]
                    if hhmm:
                        by_label[hhmm] = close
        except Exception:  # noqa: BLE001
            continue
    if not by_label:
        return None
    closes = [by_label[label] for label in axis if label in by_label]
    prev_close = closes[0] if closes else None  # no prior session on disk; use first print
    series = build_series(axis, prev_close, by_label)
    return {"prevClose": prev_close, "last": closes[-1] if closes else None, "pctByTime": series, "session": chosen_date}


# --------------------------------------------------------------------------- #
# Assembly
# --------------------------------------------------------------------------- #
def latest_pct(series: list[float | None]) -> float | None:
    for value in reversed(series):
        if value is not None:
            return value
    return None


def assemble(universe: list[dict], source: str, axis: list[str], limit: int | None) -> dict:
    if limit:
        universe = universe[:limit]

    sector_drift: dict[str, float] = {}
    for entry in universe:
        sector = entry["sector"]
        if sector not in sector_drift:
            sector_drift[sector] = random.Random(abs(hash(sector)) % (2**32)).uniform(-0.0016, 0.0016)

    tiles: list[dict] = []
    session = ""
    frontier_idx = len(axis) - 1

    if source in ("yahoo", "ibkr-disk"):
        raw: dict[str, dict | None] = {}
        if source == "yahoo":
            with ThreadPoolExecutor(max_workers=8) as pool:
                futures = {pool.submit(fetch_yahoo_1m, entry["symbol"], axis): entry["symbol"] for entry in universe}
                done = 0
                for future in as_completed(futures):
                    symbol = futures[future]
                    try:
                        raw[symbol] = future.result()
                    except Exception:  # noqa: BLE001
                        raw[symbol] = None
                    done += 1
                    if done % 50 == 0:
                        print(f"  yahoo {done}/{len(universe)}", file=sys.stderr, flush=True)
        else:
            for entry in universe:
                raw[entry["symbol"]] = read_ibkr_disk_1m(entry["symbol"], axis, None)

        # The session frontier is the latest minute with any real print across the
        # universe — we forward-fill up to it but leave the rest of the day null.
        label_to_idx = {label: i for i, label in enumerate(axis)}
        frontier_idx = -1
        for record in raw.values():
            if not record:
                continue
            if record.get("session"):
                session = record["session"]
            for label in record["by_label"]:
                i = label_to_idx.get(label)
                if i is not None and i > frontier_idx:
                    frontier_idx = i
        if frontier_idx < 0:
            frontier_idx = len(axis) - 1

        for entry in universe:
            record = raw.get(entry["symbol"])
            if record:
                series = build_series(axis, record["prevClose"], record["by_label"], frontier_idx)
                last = record["last"]
                if last is None:
                    last = next(
                        (record["by_label"][axis[i]] for i in range(frontier_idx, -1, -1) if axis[i] in record["by_label"]),
                        None,
                    )
                tiles.append(_tile_from(entry, record["prevClose"], last, series))
            else:
                tiles.append(_tile_from(entry, None, None, [None] * len(axis)))
    else:  # sample
        for entry in universe:
            bar = sample_series(axis, entry["symbol"], entry["sector"], sector_drift[entry["sector"]])
            session = bar["session"]
            tiles.append(_tile_from(entry, bar["prevClose"], bar["last"], bar["pctByTime"]))

    source_label = {"yahoo": "yahoo-1m", "ibkr-disk": "ibkr-1m-disk", "sample": "sample"}.get(source, source)
    delay = {"yahoo": 15, "sample": None, "ibkr-disk": None}.get(source)
    note = "Synthetic sample colours — swap to --source yahoo or the IBKR live feed for real %." if source == "sample" else None
    return finalize_payload(tiles, axis, source_label, live=False, delay=delay, session=session, note=note)


def finalize_payload(
    tiles: list[dict],
    axis: list[str],
    source_label: str,
    *,
    live: bool,
    delay: int | None,
    session: str,
    note: str | None = None,
) -> dict:
    """Compute sector aggregates, index breadth, and asOf, then wrap the payload.
    Shared by the batch builder and the live IBKR loop so both stay consistent."""
    sector_acc: dict[str, dict] = {}
    for tile in tiles:
        acc = sector_acc.setdefault(tile["sector"], {"weight": 0.0, "count": 0, "num": 0.0, "den": 0.0})
        acc["weight"] += tile["weight"]
        acc["count"] += 1
        if tile["pct"] is not None:
            acc["num"] += tile["pct"] * tile["weight"]
            acc["den"] += tile["weight"]
    sectors = [
        {
            "name": name,
            "weight": round(acc["weight"], 4),
            "count": acc["count"],
            "pct": round(acc["num"] / acc["den"], 3) if acc["den"] > 0 else None,
        }
        for name, acc in sorted(sector_acc.items(), key=lambda kv: kv[1]["weight"], reverse=True)
    ]

    num = den = 0.0
    advancers = decliners = unchanged = 0
    for tile in tiles:
        if tile["pct"] is None:
            continue
        num += tile["pct"] * tile["weight"]
        den += tile["weight"]
        if tile["pct"] > 0.02:
            advancers += 1
        elif tile["pct"] < -0.02:
            decliners += 1
        else:
            unchanged += 1
    index = {
        "label": "S&P 500 (SPY weights)",
        "pct": round(num / den, 3) if den > 0 else None,
        "advancers": advancers,
        "decliners": decliners,
        "unchanged": unchanged,
    }

    as_of = next((axis[i] for i in range(len(axis) - 1, -1, -1) if any(t["pctByTime"][i] is not None for t in tiles)), None)

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "session": session or datetime.now().strftime("%Y-%m-%d"),
        "asOf": as_of,
        "source": source_label,
        "live": live,
        "delayMinutes": delay,
        "times": axis,
        "tiles": tiles,
        "sectors": sectors,
        "index": index,
        "note": note,
    }


def _tile_from(entry: dict, prev_close: float | None, last: float | None, series: list[float | None]) -> dict:
    return {
        "symbol": entry["symbol"],
        "name": entry["name"],
        "sector": entry["sector"],
        "weight": round(entry["weight"], 4),
        "last": last,
        "prevClose": prev_close,
        "pct": latest_pct(series),
        "pctByTime": series,
    }


# --------------------------------------------------------------------------- #
# IBKR live feed — snapshot-poll the whole universe once a minute
# --------------------------------------------------------------------------- #
def _finite(value: object) -> float | None:
    try:
        out = float(value)  # type: ignore[arg-type]
        return out if math.isfinite(out) else None
    except (TypeError, ValueError):
        return None


def _first_positive(*values: object) -> float | None:
    for value in values:
        out = _finite(value)
        if out is not None and out > 0:
            return out
    return None


def _mid(bid: object, ask: object) -> float | None:
    b = _finite(bid)
    a = _finite(ask)
    if b and a and b > 0 and a > 0:
        return (a + b) / 2.0
    return None


def _eastern_offset_hours(dt_utc: datetime) -> int:
    # US Eastern DST window: 2nd Sun Mar 07:00 UTC .. 1st Sun Nov 06:00 UTC.
    march = datetime(dt_utc.year, 3, 8, 7, tzinfo=timezone.utc)
    dst_start = march + timedelta(days=(6 - march.weekday()) % 7)
    nov = datetime(dt_utc.year, 11, 1, 6, tzinfo=timezone.utc)
    dst_end = nov + timedelta(days=(6 - nov.weekday()) % 7)
    return -4 if dst_start <= dt_utc < dst_end else -5


def et_now() -> datetime:
    """ET wall clock — zoneinfo if available, else a stdlib DST calc (no tzdata)."""
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("America/New_York")).replace(tzinfo=None)
    except Exception:  # noqa: BLE001
        utc = datetime.now(timezone.utc)
        return (utc + timedelta(hours=_eastern_offset_hours(utc))).replace(tzinfo=None)


def load_universe_from_existing(out_path: Path) -> list[dict]:
    """Reuse the symbols/weights/sectors already in the payload (structure is
    stable intraday) so the live loop needn't re-download SSGA + Wikipedia."""
    data = json.loads(out_path.read_text(encoding="utf-8"))
    rows = [
        {
            "symbol": t["symbol"],
            "name": t.get("name", t["symbol"]),
            "sector": t.get("sector", "Unknown") or "Unknown",
            "weight": float(t.get("weight") or 0.0),
        }
        for t in data.get("tiles", [])
        if t.get("symbol") and float(t.get("weight") or 0.0) > 0
    ]
    if not rows:
        raise RuntimeError("existing payload had no usable tiles")
    return rows


def _seed_live_state(out_path: Path, universe: list[dict], axis: list[str], today: str):
    """Continue today's session across restarts (and pick up any morning Yahoo
    fill) by seeding pctByTime from the existing payload when it's today's."""
    series: dict[str, list] = {e["symbol"]: [None] * len(axis) for e in universe}
    prev_close: dict[str, float] = {}
    last_price: dict[str, float] = {}
    last_pct: dict[str, float] = {}
    try:
        data = json.loads(out_path.read_text(encoding="utf-8"))
        if data.get("session") == today:
            for tile in data.get("tiles", []):
                sym = tile.get("symbol")
                arr = tile.get("pctByTime")
                if sym in series and isinstance(arr, list) and len(arr) == len(axis):
                    series[sym] = [float(x) if isinstance(x, (int, float)) else None for x in arr]
                    if tile.get("prevClose") is not None:
                        prev_close[sym] = float(tile["prevClose"])
                    if tile.get("last") is not None:
                        last_price[sym] = float(tile["last"])
                    seeded = latest_pct(series[sym])
                    if seeded is not None:
                        last_pct[sym] = seeded
    except Exception:  # noqa: BLE001
        pass
    return series, prev_close, last_price, last_pct


def run_ibkr_live(
    universe: list[dict],
    axis: list[str],
    out_path: Path,
    *,
    host: str,
    ports: list[int],
    client_id: int,
    batch: int,
    settle: float,
    universe_source: str,
    sector_source: str,
) -> int:
    from ib_insync import IB, Stock  # lazy: only the live feed needs ib_insync

    label_to_idx = {label: i for i, label in enumerate(axis)}
    today = et_now().strftime("%Y-%m-%d")
    series, prev_close, last_price, last_pct = _seed_live_state(out_path, universe, axis, today)
    by_symbol = {e["symbol"]: e for e in universe}
    order = [e["symbol"] for e in universe]

    ib = None
    connect_error: object = None
    for offset, port in enumerate(ports):
        for cid in (client_id + offset, client_id + offset + 60, client_id + offset + 211):
            candidate = IB()
            try:
                candidate.connect(host, port, clientId=cid, timeout=12.0, readonly=True)
                ib = candidate
                print(f"[ibkr-live] connected {host}:{port} clientId={cid}", flush=True)
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
        print(f"[ibkr-live] CONNECT FAILED ({connect_error!r}); is TWS/Gateway running on {ports}?", flush=True)
        return 2

    errors: Counter = Counter()
    ib.errorEvent += lambda req_id, code, msg, contract: errors.update([code])
    ib.reqMarketDataType(1)

    raw = [Stock(e["symbol"].replace(".", " "), "SMART", "USD") for e in universe]
    for i in range(0, len(raw), 100):
        try:
            ib.qualifyContracts(*raw[i : i + 100])
        except Exception:  # noqa: BLE001
            pass
    contracts = {e["symbol"]: c for e, c in zip(universe, raw) if getattr(c, "conId", 0)}
    print(f"[ibkr-live] qualified {len(contracts)}/{len(universe)}", flush=True)
    if not contracts:
        ib.disconnect()
        print("[ibkr-live] no contracts qualified; aborting", flush=True)
        return 3

    try:
        while True:
            now = et_now()
            hhmm = now.strftime("%H:%M")
            if hhmm < "09:30":
                ib.sleep(20.0)
                continue
            if hhmm > "16:00":
                print("[ibkr-live] session complete (>16:00 ET); exiting", flush=True)
                break
            idx = label_to_idx.get(hhmm, len(axis) - 1)

            started = time.perf_counter()
            items = list(contracts.items())
            covered = 0
            for i in range(0, len(items), batch):
                tickers = [(sym, ib.reqMktData(contract, "", True, False)) for sym, contract in items[i : i + batch]]
                ib.sleep(settle)
                for sym, ticker in tickers:
                    price = _first_positive(ticker.last, ticker.marketPrice(), ticker.close, _mid(ticker.bid, ticker.ask))
                    base = _finite(ticker.close)
                    if price and base and base > 0:
                        series[sym][idx] = round((price / base - 1.0) * 100.0, 2)
                        last_pct[sym] = series[sym][idx]
                        prev_close[sym] = base
                        last_price[sym] = price
                        covered += 1
            # Forward-fill names that missed this sweep so tiles don't flicker grey.
            for sym in contracts:
                if series[sym][idx] is None and sym in last_pct:
                    series[sym][idx] = last_pct[sym]

            tiles = [_tile_from(by_symbol[sym], prev_close.get(sym), last_price.get(sym), series[sym]) for sym in order]
            payload = finalize_payload(tiles, axis, "ibkr-live", live=True, delay=0, session=today, note=None)
            payload["universeSource"] = universe_source
            payload["sectorSource"] = sector_source
            write_json_atomic(out_path, payload)

            duration = time.perf_counter() - started
            top_err = ", ".join(f"{code}x{n}" for code, n in errors.most_common(3)) or "none"
            print(f"[ibkr-live {hhmm} ET] quotes={covered}/{len(contracts)} sweep={duration:.1f}s errs[{top_err}]", flush=True)

            clock = datetime.now()
            ib.sleep(max(2.0, 61.0 - clock.second - clock.microsecond / 1e6))
    finally:
        try:
            ib.disconnect()
        except Exception:  # noqa: BLE001
            pass
    return 0


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Rubicon's intraday S&P 500 heatmap payload.")
    parser.add_argument("--source", choices=["sample", "yahoo", "ibkr-disk", "ibkr-live"], default="sample")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--limit", type=int, default=None, help="cap the number of constituents (debugging)")
    parser.add_argument("--host", default="127.0.0.1", help="IBKR host (ibkr-live)")
    parser.add_argument("--ports", default="7496,4001", help="IBKR ports to try (ibkr-live)")
    parser.add_argument("--client-id", type=int, default=941, help="IBKR base client id (ibkr-live)")
    parser.add_argument("--batch", type=int, default=45, help="snapshot batch size (ibkr-live)")
    parser.add_argument("--settle", type=float, default=3.0, help="seconds to let each snapshot batch populate (ibkr-live)")
    args = parser.parse_args()

    axis = session_axis()

    if args.source == "ibkr-live":
        # Reuse the standing payload's structure if present (no SSGA/Wikipedia hit);
        # otherwise build it fresh once.
        try:
            universe = load_universe_from_existing(args.out)
            universe_source = sector_source = "existing-payload"
        except Exception:  # noqa: BLE001
            try:
                universe = load_universe_from_ssga()
                universe_source = "ssga-holdings"
            except Exception as exc:  # noqa: BLE001
                print(f"SSGA holdings unavailable ({exc}); using manifest.", file=sys.stderr)
                universe = load_universe_from_manifest()
                universe_source = "manifest-fallback"
            sector_source = apply_sectors(universe)
        if args.limit:
            universe = universe[: args.limit]
        ports = [int(p) for p in args.ports.split(",") if p.strip()]
        return run_ibkr_live(
            universe,
            axis,
            args.out,
            host=args.host,
            ports=ports,
            client_id=args.client_id,
            batch=args.batch,
            settle=args.settle,
            universe_source=universe_source,
            sector_source=sector_source,
        )

    try:
        universe = load_universe_from_ssga()
        universe_source = "ssga-holdings"
    except Exception as exc:  # noqa: BLE001
        print(f"SSGA holdings unavailable ({exc}); falling back to equity-history manifest.", file=sys.stderr)
        universe = load_universe_from_manifest()
        universe_source = "manifest-fallback"

    sector_source = apply_sectors(universe)

    payload = assemble(universe, args.source, axis, args.limit)
    payload["universeSource"] = universe_source
    payload["sectorSource"] = sector_source
    write_json_atomic(args.out, payload)
    print(
        json.dumps(
            {
                "ok": True,
                "outPath": str(args.out),
                "source": payload["source"],
                "universeSource": universe_source,
                "tiles": len(payload["tiles"]),
                "sectors": len(payload["sectors"]),
                "session": payload["session"],
                "asOf": payload["asOf"],
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
