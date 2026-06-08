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
# QQQ (Nasdaq-100) membership + weights. Slickcharts lists every constituent with
# its index weight (clean Symbol/Weight table); Wikipedia is the offline-ish
# fallback (membership + ICB sector, equal-weight approximation).
SLICKCHARTS_NDX_URL = "https://www.slickcharts.com/nasdaq100"
WIKI_NDX_URL = "https://en.wikipedia.org/wiki/Nasdaq-100"
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


def _parse_slickcharts_ndx(html: str) -> list[dict]:
    """Nasdaq-100 constituents from Slickcharts: columns #, Company, Symbol, Weight, …"""
    parser = _TableRowParser()
    parser.feed(html)
    universe: list[dict] = []
    for row in parser.rows:
        if len(row) < 4:
            continue
        symbol = row[2].strip().upper()
        weight = _to_float(row[3])  # "12.90%" -> 12.90
        if not symbol or " " in symbol or not any(ch.isalpha() for ch in symbol):
            continue
        if weight is None or weight <= 0:
            continue
        universe.append({"symbol": symbol, "name": row[1].strip() or symbol, "sector": "Unknown", "weight": weight})
    if len(universe) < 90:
        raise RuntimeError(f"Slickcharts Nasdaq-100 table not found (got {len(universe)})")
    return universe


def _parse_wikipedia_ndx(html: str) -> list[dict]:
    """Fallback: Nasdaq-100 components from Wikipedia (Ticker, Company, ICB sector).
    No weights on the page, so approximate equal weights — the map still renders."""
    parser = _TableRowParser()
    parser.feed(html)
    seen: dict[str, dict] = {}
    for row in parser.rows:
        if len(row) < 2:
            continue
        ticker = row[0].strip().upper()
        if not (1 <= len(ticker) <= 6) or " " in ticker or not ticker.isalpha() or ticker in ("TICKER", "SYMBOL"):
            continue
        name = row[1].strip()
        if not name:
            continue
        sector = row[2].strip() if len(row) > 2 and row[2].strip() else "Unknown"
        seen.setdefault(ticker, {"symbol": ticker, "name": name, "sector": sector, "weight": 0.0})
    out = list(seen.values())
    if len(out) < 90:
        raise RuntimeError(f"Wikipedia Nasdaq-100 table not found (got {len(out)})")
    weight = round(100.0 / len(out), 4)
    for entry in out:
        entry["weight"] = weight
    return out


def load_universe_qqq() -> tuple[list[dict], str]:
    """Nasdaq-100 membership + weights: Slickcharts (weights) → Wikipedia (fallback)."""
    try:
        universe = _parse_slickcharts_ndx(_http_bytes(SLICKCHARTS_NDX_URL).decode("utf-8", "ignore"))
        return universe, "slickcharts-ndx"
    except Exception as exc:  # noqa: BLE001
        print(f"Slickcharts Nasdaq-100 unavailable ({exc!r}); trying Wikipedia.", file=sys.stderr)
    universe = _parse_wikipedia_ndx(_http_bytes(WIKI_NDX_URL).decode("utf-8", "ignore"))
    return universe, "wikipedia-ndx"


# --------------------------------------------------------------------------- #
# Index registry — each index loads its own members/weights; the live + batch
# feeds pull the UNION of all requested indices once and project per index so a
# stock in both (e.g. AAPL in SPY and QQQ) is fetched a single time.
# --------------------------------------------------------------------------- #
def _load_spx_universe(out_path: Path, for_live: bool) -> tuple[list[dict], str, str]:
    if for_live:
        try:
            return load_universe_from_existing(out_path), "existing-payload", "existing-payload"
        except Exception:  # noqa: BLE001
            pass
    try:
        universe = load_universe_from_ssga()
        universe_source = "ssga-holdings"
    except Exception as exc:  # noqa: BLE001
        print(f"SSGA holdings unavailable ({exc}); falling back to equity-history manifest.", file=sys.stderr)
        universe = load_universe_from_manifest()
        universe_source = "manifest-fallback"
    sector_source = apply_sectors(universe)
    return universe, universe_source, sector_source


def _load_qqq_universe(out_path: Path, for_live: bool) -> tuple[list[dict], str, str]:
    if for_live:
        try:
            return load_universe_from_existing(out_path), "existing-payload", "existing-payload"
        except Exception:  # noqa: BLE001
            pass
    universe, universe_source = load_universe_qqq()
    # Re-key shared names to GICS sectors (consistent with SPX); Nasdaq-only names
    # keep their source sector and are covered by the Finviz classification overlay.
    sector_source = apply_sectors(universe)
    return universe, universe_source, sector_source


INDEX_SPECS: dict[str, dict] = {
    "spx": {"label": "S&P 500 (SPY weights)", "out": APP_ROOT / "data" / "spx-heatmap.json", "load": _load_spx_universe},
    "qqq": {"label": "Nasdaq-100 (QQQ weights)", "out": APP_ROOT / "data" / "qqq-heatmap.json", "load": _load_qqq_universe},
}


def build_index_configs(index_ids: list[str], *, for_live: bool) -> tuple[list[dict], list[dict]]:
    """Load each requested index's universe and return (union_universe, [cfg,...]).

    Each cfg carries order/weight/meta/label/out so the shared per-symbol caches can
    be projected per index. A single index's load failure is skipped (never breaks
    the others — e.g. a QQQ source outage must not take down the SPX feed)."""
    cfgs: list[dict] = []
    union: dict[str, dict] = {}
    for index_id in index_ids:
        spec = INDEX_SPECS.get(index_id)
        if not spec:
            print(f"[index {index_id}] unknown index, skipping", file=sys.stderr)
            continue
        try:
            universe, universe_source, sector_source = spec["load"](spec["out"], for_live)
        except Exception as exc:  # noqa: BLE001
            print(f"[index {index_id}] universe load failed ({exc!r}); skipping this index", file=sys.stderr)
            continue
        cfgs.append(
            {
                "id": index_id,
                "label": spec["label"],
                "out": spec["out"],
                "order": [e["symbol"] for e in universe],
                "weight": {e["symbol"]: e["weight"] for e in universe},
                "meta": {e["symbol"]: {"name": e["name"], "sector": e["sector"]} for e in universe},
                "universeSource": universe_source,
                "sectorSource": sector_source,
            }
        )
        for entry in universe:
            union.setdefault(entry["symbol"], entry)
    if not cfgs:
        raise RuntimeError("no index universes could be loaded")
    return list(union.values()), cfgs


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


def pull_bars(universe: list[dict], source: str, axis: list[str], limit: int | None):
    """Pull each symbol's intraday bars ONCE (keyed by symbol) so multiple indices
    can project the same data without re-fetching shared names. Returns
    (bars_by_symbol, session, source_label, delay, note) where each bar is
    {prevClose, last, series}."""
    if limit:
        universe = universe[:limit]

    sector_drift: dict[str, float] = {}
    for entry in universe:
        sector = entry["sector"]
        if sector not in sector_drift:
            sector_drift[sector] = random.Random(abs(hash(sector)) % (2**32)).uniform(-0.0016, 0.0016)

    bars: dict[str, dict] = {}
    session = ""

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
                bars[entry["symbol"]] = {"prevClose": record["prevClose"], "last": last, "series": series}
            else:
                bars[entry["symbol"]] = {"prevClose": None, "last": None, "series": [None] * len(axis)}
    else:  # sample
        for entry in universe:
            bar = sample_series(axis, entry["symbol"], entry["sector"], sector_drift[entry["sector"]])
            session = bar["session"]
            bars[entry["symbol"]] = {"prevClose": bar["prevClose"], "last": bar["last"], "series": bar["pctByTime"]}

    source_label = {"yahoo": "yahoo-1m", "ibkr-disk": "ibkr-1m-disk", "sample": "sample"}.get(source, source)
    delay = {"yahoo": 15, "sample": None, "ibkr-disk": None}.get(source)
    note = "Synthetic sample colours — swap to --source yahoo or the IBKR live feed for real %." if source == "sample" else None
    return bars, session, source_label, delay, note


def build_index_payload(
    bars: dict[str, dict],
    cfg: dict,
    axis: list[str],
    source_label: str,
    *,
    live: bool,
    delay: int | None,
    session: str,
    note: str | None,
) -> dict:
    """Project the shared per-symbol bars onto one index's members + weights + label."""
    tiles: list[dict] = []
    for sym in cfg["order"]:
        bar = bars.get(sym)
        if bar is None:
            continue
        meta = cfg["meta"][sym]
        entry = {"symbol": sym, "name": meta["name"], "sector": meta["sector"], "weight": cfg["weight"][sym]}
        tiles.append(_tile_from(entry, bar["prevClose"], bar["last"], bar["series"]))
    payload = finalize_payload(
        tiles, axis, source_label, live=live, delay=delay, session=session, note=note, label=cfg["label"]
    )
    payload["universeSource"] = cfg.get("universeSource")
    payload["sectorSource"] = cfg.get("sectorSource")
    return payload


def finalize_payload(
    tiles: list[dict],
    axis: list[str],
    source_label: str,
    *,
    live: bool,
    delay: int | None,
    session: str,
    note: str | None = None,
    label: str = "S&P 500 (SPY weights)",
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
        "label": label,
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


def _tile_from(
    entry: dict,
    prev_close: float | None,
    last: float | None,
    series: list[float | None],
    iv: float | None = None,
    earnings: dict | None = None,
) -> dict:
    return {
        "symbol": entry["symbol"],
        "name": entry["name"],
        "sector": entry["sector"],
        "weight": round(entry["weight"], 4),
        "last": last,
        "prevClose": prev_close,
        "pct": latest_pct(series),
        "pctByTime": series,
        "iv": iv,  # annualized ATM IV (IBKR tick 106); null outside the live IV sweep
        "earningsDate": (earnings or {}).get("date"),  # Nasdaq next-earnings date / timing
        "earningsTime": (earnings or {}).get("time"),
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


def _seed_live_state(out_paths: list[Path], universe: list[dict], axis: list[str], today: str):
    """Continue today's session across restarts (and pick up any morning Yahoo fill)
    by seeding pctByTime from each index's existing payload when it's today's. A
    symbol is seeded once (first today-payload that has it) — shared names carry
    identical data across indices."""
    series: dict[str, list] = {e["symbol"]: [None] * len(axis) for e in universe}
    prev_close: dict[str, float] = {}
    last_price: dict[str, float] = {}
    last_pct: dict[str, float] = {}
    seeded_syms: set[str] = set()
    for out_path in out_paths:
        try:
            data = json.loads(out_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if data.get("session") != today:
            continue
        for tile in data.get("tiles", []):
            sym = tile.get("symbol")
            if sym in seeded_syms or sym not in series:
                continue
            arr = tile.get("pctByTime")
            if isinstance(arr, list) and len(arr) == len(axis):
                series[sym] = [float(x) if isinstance(x, (int, float)) else None for x in arr]
                if tile.get("prevClose") is not None:
                    prev_close[sym] = float(tile["prevClose"])
                if tile.get("last") is not None:
                    last_price[sym] = float(tile["last"])
                seeded = latest_pct(series[sym])
                if seeded is not None:
                    last_pct[sym] = seeded
                seeded_syms.add(sym)
    return series, prev_close, last_price, last_pct


def sweep_iv(ib, contracts: dict, batch: int, settle: float) -> dict:
    """Stream IBKR's per-stock ~30-day ATM implied vol (generic tick 106) for the
    whole universe in batches and return {symbol: iv_fraction}. IV moves slowly, so
    the live loop calls this only every few minutes and caches the result. Streaming
    (not snapshot) is required — the IV tick does not reliably arrive in snapshot mode."""
    out: dict[str, float] = {}
    items = list(contracts.items())
    for i in range(0, len(items), batch):
        chunk = items[i : i + batch]
        tickers = [(sym, ib.reqMktData(contract, "106", False, False)) for sym, contract in chunk]
        ib.sleep(settle)
        for sym, ticker in tickers:
            iv = _finite(getattr(ticker, "impliedVolatility", None))
            if iv is not None and iv > 0:
                out[sym] = round(iv, 4)
        for _sym, contract in chunk:
            try:
                ib.cancelMktData(contract)
            except Exception:  # noqa: BLE001
                pass
    return out


def run_ibkr_live(
    universe: list[dict],
    axis: list[str],
    indexes: list[dict],
    *,
    host: str,
    ports: list[int],
    client_id: int,
    batch: int,
    settle: float,
) -> int:
    from ib_insync import IB, Stock  # lazy: only the live feed needs ib_insync

    label_to_idx = {label: i for i, label in enumerate(axis)}
    today = et_now().strftime("%Y-%m-%d")
    series, prev_close, last_price, last_pct = _seed_live_state([cfg["out"] for cfg in indexes], universe, axis, today)
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

    iv_by_symbol: dict[str, float] = {}
    # Sweep per-stock IV in a rolling slice each minute (a cursor through the
    # universe; full cycle ~ len(order)/iv_slice minutes) instead of one big burst
    # every ~10 min. The burst took ~48s and, on top of the ~36s price snapshot,
    # overran the minute boundary — the loop then skipped a whole minute, leaving
    # every tile null (a grey "blank minute"). A small slice keeps each iteration
    # under 60s so no minute is skipped.
    iv_slice = max(batch, int(os.environ.get("IBKR_HEATMAP_IV_SLICE", "64")))
    iv_cursor = 0

    # Earnings-this-week (free Nasdaq calendar, no IBKR). Fetched once at startup —
    # the feed restarts daily, and earnings dates don't move intraday.
    earnings_by_symbol: dict = {}
    try:
        from earnings_nasdaq import week_earnings

        earnings_by_symbol = week_earnings(order, et_now().date())
        print(f"[ibkr-live] earnings: {len(earnings_by_symbol)}/{len(order)} report this week", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[ibkr-live] earnings fetch failed: {exc!r}", flush=True)

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

            # Per-stock IV: sweep one rolling slice this minute (IV moves slowly, so
            # a per-name refresh every ~8 min is plenty); cached values colour the σ
            # view. Slicing keeps the IV cost ~one batch instead of a ~48s burst.
            iv_chunk = {sym: contracts[sym] for sym in order[iv_cursor : iv_cursor + iv_slice] if sym in contracts}
            if iv_chunk:
                fresh_iv = sweep_iv(ib, iv_chunk, batch, max(4.0, settle))
                if fresh_iv:
                    iv_by_symbol.update(fresh_iv)
            prev_cursor = iv_cursor
            iv_cursor = (iv_cursor + iv_slice) % max(1, len(order))
            if iv_cursor <= prev_cursor:  # wrapped → whole universe refreshed once
                print(f"[ibkr-live {hhmm} ET] iv cycle complete {len(iv_by_symbol)}/{len(contracts)}", flush=True)

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

            # Project the shared per-symbol caches onto each index (members + weights
            # + label) and write one payload per index — AAPL etc. are pulled once.
            for cfg in indexes:
                tiles = [
                    _tile_from(
                        {"symbol": sym, "name": cfg["meta"][sym]["name"], "sector": cfg["meta"][sym]["sector"], "weight": cfg["weight"][sym]},
                        prev_close.get(sym),
                        last_price.get(sym),
                        series[sym],
                        iv_by_symbol.get(sym),
                        earnings_by_symbol.get(sym),
                    )
                    for sym in cfg["order"]
                    if sym in series
                ]
                payload = finalize_payload(tiles, axis, "ibkr-live", live=True, delay=0, session=today, note=None, label=cfg["label"])
                payload["universeSource"] = cfg["universeSource"]
                payload["sectorSource"] = cfg["sectorSource"]
                write_json_atomic(cfg["out"], payload)

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
    parser = argparse.ArgumentParser(description="Build Rubicon's intraday index heatmap payload(s).")
    parser.add_argument("--source", choices=["sample", "yahoo", "ibkr-disk", "ibkr-live"], default="sample")
    parser.add_argument("--indexes", default="spx", help="comma list of indices to build (spx,qqq); the union is pulled once")
    parser.add_argument("--out", type=Path, default=None, help="override output path (single index only)")
    parser.add_argument("--limit", type=int, default=None, help="cap the number of constituents (debugging)")
    parser.add_argument("--host", default="127.0.0.1", help="IBKR host (ibkr-live)")
    parser.add_argument("--ports", default="7496,4001", help="IBKR ports to try (ibkr-live)")
    parser.add_argument("--client-id", type=int, default=941, help="IBKR base client id (ibkr-live)")
    parser.add_argument("--batch", type=int, default=45, help="snapshot batch size (ibkr-live)")
    parser.add_argument("--settle", type=float, default=3.0, help="seconds to let each snapshot batch populate (ibkr-live)")
    parser.add_argument("--no-backfill", action="store_true", help="skip the one-shot Yahoo backfill before the ibkr-live loop")
    args = parser.parse_args()

    axis = session_axis()
    index_ids = [s.strip().lower() for s in args.indexes.split(",") if s.strip()] or ["spx"]
    is_live = args.source == "ibkr-live"
    # Load each index's members/weights and build the UNION universe so a stock in
    # more than one index (e.g. AAPL in SPY + QQQ) is pulled a single time.
    union_universe, cfgs = build_index_configs(index_ids, for_live=is_live)
    if args.out is not None and len(cfgs) == 1:
        cfgs[0]["out"] = args.out
    if args.limit:
        union_universe = union_universe[: args.limit]

    if is_live:
        ports = [int(p) for p in args.ports.split(",") if p.strip()]
        # Immediate backfill: pull the whole session from Yahoo up front so each map
        # fills in ~15s (instead of waiting ~50s for IBKR's first sweep) and isn't
        # blank if IBKR can't connect or it's after hours. The live loop seeds from
        # this and overwrites each minute in real time.
        if not args.no_backfill:
            try:
                bars, session, source_label, delay, note = pull_bars(union_universe, "yahoo", axis, None)
                for cfg in cfgs:
                    payload = build_index_payload(bars, cfg, axis, source_label, live=False, delay=delay, session=session, note=note)
                    write_json_atomic(cfg["out"], payload)
                print(f"[ibkr-live] yahoo backfill written for {', '.join(c['id'] for c in cfgs)}", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"[ibkr-live] yahoo backfill skipped ({exc})", file=sys.stderr, flush=True)
        return run_ibkr_live(
            union_universe,
            axis,
            cfgs,
            host=args.host,
            ports=ports,
            client_id=args.client_id,
            batch=args.batch,
            settle=args.settle,
        )

    bars, session, source_label, delay, note = pull_bars(union_universe, args.source, axis, None)
    results = []
    for cfg in cfgs:
        payload = build_index_payload(bars, cfg, axis, source_label, live=False, delay=delay, session=session, note=note)
        write_json_atomic(cfg["out"], payload)
        results.append(
            {
                "index": cfg["id"],
                "outPath": str(cfg["out"]),
                "tiles": len(payload["tiles"]),
                "universeSource": cfg["universeSource"],
                "asOf": payload["asOf"],
            }
        )
    print(json.dumps({"ok": True, "source": source_label, "session": session, "indexes": results}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
