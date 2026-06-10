#!/usr/bin/env python3
"""Refresh Rubicon TC2000 daily chart bars from IBKR.

The script reads the current TC2000 scanner export CSVs, pulls/cache daily
stock bars through the existing IBKR stairstep helper, and writes a compact
JSON payload used by Morning hover previews.
"""

from __future__ import annotations

import argparse
import csv
import re
import json
import os
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
AI_STUFF_ROOT = Path(os.environ.get("AI_STUFF_ROOT", APP_ROOT.parent)).resolve()
IBKR_ROOT = AI_STUFF_ROOT / "IBKR Equity History Pull"
TC2000_EXPORT_ROOT = IBKR_ROOT / "data" / "tc2000_exports"
DEFAULT_CACHE_DIR = IBKR_ROOT / "data" / "tc2000_daily_bars"
DEFAULT_OUT = APP_ROOT / "data" / "tc2000-daily-bars.json"
DEFAULT_PROFILE_CACHE = DEFAULT_CACHE_DIR / "company_profiles.json"
PROFILE_USER_AGENT = "Mozilla/5.0 Rubicon TC2000 profile refresh/1.0"
DEFAULT_LOCK_STALE_SECONDS = 1800.0


def _pid_alive(pid: int) -> bool:
    """Best-effort liveness check that never terminates the target process."""
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            if kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return exit_code.value == STILL_ACTIVE
            return True
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _read_lock(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _lock_age_seconds(path: Path) -> float:
    try:
        return max(0.0, time.time() - path.stat().st_mtime)
    except OSError:
        return float("inf")


@contextmanager
def single_instance_lock(lock_path: Path, stale_seconds: float):
    """Yield True when the lock is acquired, or the holder's metadata dict when
    another live instance owns it. Keyed per IBKR client id so distinct client
    ids may still run concurrently; same-client-id runs are mutually excluded so
    they cannot deadlock TWS' one-connection-per-client-id rule."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        {
            "pid": os.getpid(),
            "started": datetime.now(timezone.utc).isoformat(),
            "argv": sys.argv[1:],
        }
    ).encode("utf-8")
    for _ in range(2):
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            holder = _read_lock(lock_path)
            holder_pid = int(holder.get("pid", 0) or 0)
            if (
                holder_pid
                and holder_pid != os.getpid()
                and _pid_alive(holder_pid)
                and _lock_age_seconds(lock_path) < stale_seconds
            ):
                yield holder
                return
            try:
                os.unlink(str(lock_path))
            except FileNotFoundError:
                pass
            continue
        else:
            try:
                os.write(fd, payload)
            finally:
                os.close(fd)
            try:
                yield True
            finally:
                try:
                    if int(_read_lock(lock_path).get("pid", 0) or 0) == os.getpid():
                        os.unlink(str(lock_path))
                except FileNotFoundError:
                    pass
            return
    yield _read_lock(lock_path)


def clean_symbol(value: str) -> str:
    return value.strip().upper().replace(" ", "")


def unique_symbols(symbols: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in symbols:
        symbol = clean_symbol(raw)
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        result.append(symbol)
    return result


# The scanner export is an OCR screen-scrape, so a botched read can emit price
# fragments ("346P"), exchange names, OTC tiers, or column headers as symbols.
TICKER_PATTERN = re.compile(r"^[A-Z]{1,5}([.\-][A-Z]{1,2})?$")
NON_TICKER_TOKENS = {
    "AMEX",
    "ARCA",
    "CHANGE",
    "ETF",
    "ETN",
    "GREY",
    "INDEX",
    "LAST",
    "NAME",
    "NASDAQ",
    "NET",
    "NYSE",
    "OTC",
    "OTCBB",
    "PINK",
    "PRICE",
    "SCREEN",
    "SYMBOL",
    "TICKER",
    "VOLUME",
}


def is_plausible_ticker(symbol: str) -> bool:
    if not symbol or symbol in NON_TICKER_TOKENS:
        return False
    return bool(TICKER_PATTERN.match(symbol))


def select_export_files(root: Path, include_all: bool = False) -> list[Path]:
    """Pick which scanner export CSVs feed the symbol universe.

    Default: every ``*_latest.csv`` (one per scanner window). Unioning every
    dated export dragged stale/garbage runs back in long after a clean re-run
    replaced them. Fallback when no ``*_latest.csv`` exists: the single newest
    CSV. ``include_all`` restores the legacy union of every CSV.
    """
    if not root.exists():
        return []
    all_csvs = sorted(root.glob("*.csv"), key=lambda item: item.stat().st_mtime, reverse=True)
    if include_all:
        return all_csvs
    latest = [path for path in all_csvs if path.name.lower().endswith("_latest.csv")]
    if latest:
        return latest
    return all_csvs[:1]


def read_tc2000_export_symbols(root: Path, include_all: bool = False) -> tuple[list[str], list[str], list[str]]:
    symbols: list[str] = []
    sources: list[str] = []
    rejected: list[str] = []
    for path in select_export_files(root, include_all=include_all):
        try:
            with path.open(newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle)
                if not reader.fieldnames:
                    continue
                fields = {name.lower(): name for name in reader.fieldnames}
                symbol_col = fields.get("symbol") or fields.get("ticker") or reader.fieldnames[0]
                file_symbols = [clean_symbol(row.get(symbol_col, "")) for row in reader]
        except Exception as exc:
            print(f"Skipping TC2000 export {path}: {exc}", file=sys.stderr)
            continue
        file_symbols = [symbol for symbol in file_symbols if symbol]
        kept = [symbol for symbol in file_symbols if is_plausible_ticker(symbol)]
        rejected.extend(symbol for symbol in file_symbols if not is_plausible_ticker(symbol))
        if kept:
            symbols.extend(kept)
            sources.append(str(path))
    return unique_symbols(symbols), sources, unique_symbols(rejected)


def dataframe_to_json(df, max_bars: int) -> dict[str, list[dict[str, Any]]]:
    bars_by_symbol: dict[str, list[dict[str, Any]]] = {}
    if df is None or df.empty:
        return bars_by_symbol
    frame = df.copy()
    frame["symbol"] = frame["symbol"].astype(str).map(clean_symbol)
    frame["date"] = frame["date"].astype(str)
    for symbol, group in frame.sort_values(["symbol", "date"]).groupby("symbol"):
        rows: list[dict[str, Any]] = []
        for _, row in group.tail(max_bars).iterrows():
            rows.append(
                {
                    "date": str(row["date"]),
                    "open": safe_float(row.get("open")),
                    "high": safe_float(row.get("high")),
                    "low": safe_float(row.get("low")),
                    "close": safe_float(row.get("close")),
                    "volume": safe_int(row.get("volume")),
                }
            )
        rows = [row for row in rows if all(row[key] is not None for key in ("open", "high", "low", "close"))]
        if rows:
            bars_by_symbol[symbol] = rows
    return bars_by_symbol


def safe_float(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def safe_int(value) -> int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return int(number)


def latest_stockanalysis_industry_file() -> Path | None:
    analysis_root = AI_STUFF_ROOT / "analysis"
    if not analysis_root.exists():
        return None
    candidates = list(analysis_root.glob("**/stockanalysis_all_stocks_with_industry_*.csv"))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.stat().st_mtime)


def read_industry_index() -> tuple[dict[str, dict[str, str]], str | None]:
    path = latest_stockanalysis_industry_file()
    if path is None:
        return {}, None
    index: dict[str, dict[str, str]] = {}
    try:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                symbol = clean_symbol(row.get("symbol", ""))
                if not symbol:
                    continue
                index[symbol] = {
                    "industry": str(row.get("industry", "") or "").strip(),
                    "name": str(row.get("name", "") or "").strip(),
                }
    except Exception as exc:
        print(f"Could not read StockAnalysis industry file {path}: {exc}", file=sys.stderr)
        return {}, str(path)
    return index, str(path)


def read_profile_cache(path: Path) -> dict[str, dict[str, Any]]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if isinstance(parsed, dict) and isinstance(parsed.get("profilesBySymbol"), dict):
        return {clean_symbol(symbol): value for symbol, value in parsed["profilesBySymbol"].items() if isinstance(value, dict)}
    if isinstance(parsed, dict):
        return {clean_symbol(symbol): value for symbol, value in parsed.items() if isinstance(value, dict)}
    return {}


def strip_html(value: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def first_company_sentence(description: str) -> str:
    clean = strip_html(description)
    if not clean:
        return ""
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", clean, maxsplit=1)
    sentence = parts[0].strip()
    if len(sentence) <= 240:
        return sentence
    words = sentence.split()
    trimmed: list[str] = []
    for word in words:
        if sum(len(item) + 1 for item in trimmed) + len(word) > 220:
            break
        trimmed.append(word)
    return " ".join(trimmed).rstrip(" ,;:") + "."


def fetch_stockanalysis_description(symbol: str) -> tuple[str, str] | tuple[None, str]:
    url = f"https://stockanalysis.com/stocks/{symbol.lower()}/company/"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": PROFILE_USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            html = response.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, f"{url} ({exc!r})"
    match = re.search(r"<h1[^>]*>\s*Company Description\s*</h1>[\s\S]*?<p[^>]*>([\s\S]*?)</p>", html, flags=re.I)
    if not match:
        return None, url
    sentence = first_company_sentence(match.group(1))
    return (sentence or None), url


def build_company_profiles(
    symbols: list[str],
    cache_path: Path,
    fetch_gap_s: float,
    refresh: bool,
) -> tuple[dict[str, dict[str, Any]], str | None]:
    industry_index, industry_source = read_industry_index()
    cache = read_profile_cache(cache_path)
    profiles: dict[str, dict[str, Any]] = {}
    now = datetime.now(timezone.utc).isoformat()
    for symbol in symbols:
        cached = cache.get(symbol, {})
        industry_row = industry_index.get(symbol, {})
        description = "" if refresh else str(cached.get("description", "") or "").strip()
        source = str(cached.get("source", "") or "").strip()
        if not description:
            fetched_description, fetched_source = fetch_stockanalysis_description(symbol)
            source = fetched_source
            if fetched_description:
                description = fetched_description
            if fetch_gap_s > 0:
                time.sleep(fetch_gap_s)
        profile = {
            "description": description,
            "industry": str(industry_row.get("industry") or cached.get("industry") or "").strip(),
            "name": str(industry_row.get("name") or cached.get("name") or "").strip(),
            "source": source or "StockAnalysis industry index",
            "updatedAt": now if description or industry_row else str(cached.get("updatedAt", "") or now),
        }
        profiles[symbol] = {key: value for key, value in profile.items() if value}

    write_json_atomic(
        cache_path,
        {
            "generatedAt": now,
            "industrySource": industry_source,
            "profilesBySymbol": profiles,
            "source": "StockAnalysis industry CSV plus company pages",
            "symbols": symbols,
        },
    )
    return profiles, industry_source


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp_path.replace(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", default="", help="optional comma-separated symbols to add")
    parser.add_argument("--symbols-file", type=Path, help="optional newline/CSV symbol file to add")
    parser.add_argument("--duration", default="1 Y", help="IBKR history duration, default 1 Y")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7496)
    parser.add_argument("--client-id", type=int, default=947)
    parser.add_argument("--min-request-gap-s", type=float, default=0.35)
    parser.add_argument("--max-bars", type=int, default=260)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--profile-cache", type=Path, default=DEFAULT_PROFILE_CACHE)
    parser.add_argument("--profile-fetch-gap-s", type=float, default=0.08)
    parser.add_argument("--no-refresh", action="store_true", help="write from cached parquet only")
    parser.add_argument("--refresh-profiles", action="store_true", help="refetch company profile blurbs even if cached")
    parser.add_argument("--skip-profiles", action="store_true", help="skip StockAnalysis company/industry enrichment")
    parser.add_argument(
        "--lock-stale-seconds",
        type=float,
        default=DEFAULT_LOCK_STALE_SECONDS,
        help="treat an existing single-instance lock as stale after this many seconds",
    )
    parser.add_argument("--ignore-lock", action="store_true", help="run even if another instance holds the lock (not recommended)")
    parser.add_argument(
        "--all-exports",
        action="store_true",
        help="legacy behavior: union symbols from every export CSV instead of *_latest.csv only",
    )
    return parser


def read_extra_symbols(args: argparse.Namespace) -> list[str]:
    symbols: list[str] = []
    if args.symbols:
        symbols.extend(args.symbols.split(","))
    if args.symbols_file:
        with args.symbols_file.open(newline="", encoding="utf-8-sig") as handle:
            sample = handle.read(4096)
            handle.seek(0)
            has_header = csv.Sniffer().has_header(sample) if sample.strip() else False
            if args.symbols_file.suffix.lower() == ".csv" or has_header:
                reader = csv.DictReader(handle)
                if reader.fieldnames:
                    fields = {name.lower(): name for name in reader.fieldnames}
                    symbol_col = fields.get("symbol") or fields.get("ticker") or reader.fieldnames[0]
                    symbols.extend(row.get(symbol_col, "") for row in reader)
            else:
                symbols.extend(line.split("#", 1)[0] for line in handle)
    return symbols


def run_refresh(args: argparse.Namespace) -> int:
    export_symbols, sources, rejected_symbols = read_tc2000_export_symbols(
        TC2000_EXPORT_ROOT, include_all=args.all_exports
    )
    if rejected_symbols:
        print(
            f"Rejected non-ticker tokens from TC2000 exports: {', '.join(rejected_symbols)}",
            file=sys.stderr,
        )
    symbols = unique_symbols([*export_symbols, *read_extra_symbols(args)])
    if not symbols:
        payload = {
            "barsBySymbol": {},
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "missingSymbols": [],
            "note": "No TC2000 scanner export symbols were available.",
            "profileIndustrySource": None,
            "profilesBySymbol": {},
            "rejectedSymbols": rejected_symbols,
            "source": str(TC2000_EXPORT_ROOT),
            "sources": sources,
            "symbols": [],
        }
        write_json_atomic(args.out, payload)
        print(f"Wrote empty TC2000 daily bars snapshot to {args.out}")
        return 0

    sys.path.insert(0, str(IBKR_ROOT))
    try:
        from stairstep_screener import SymbolSpec, pull_daily_bars
    except Exception as exc:
        print(f"Could not import stairstep_screener from {IBKR_ROOT}: {exc}", file=sys.stderr)
        return 2

    specs = [SymbolSpec(symbol=symbol) for symbol in symbols]
    bars = pull_daily_bars(
        specs=specs,
        out_dir=args.cache_dir,
        duration=args.duration,
        end_date=None,
        host=args.host,
        port=args.port,
        client_id=args.client_id,
        min_request_gap_s=args.min_request_gap_s,
        refresh=not args.no_refresh,
    )
    bars_by_symbol = dataframe_to_json(bars, max_bars=max(20, args.max_bars))
    missing = [symbol for symbol in symbols if symbol not in bars_by_symbol]
    if args.skip_profiles:
        profiles: dict[str, dict[str, Any]] = {}
        profile_industry_source = None
    else:
        profiles, profile_industry_source = build_company_profiles(
            symbols,
            cache_path=args.profile_cache,
            fetch_gap_s=max(0.0, args.profile_fetch_gap_s),
            refresh=args.refresh_profiles,
        )
    payload = {
        "barsBySymbol": bars_by_symbol,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "missingSymbols": missing,
        "note": f"Daily bars available for {len(bars_by_symbol)} / {len(symbols)} TC2000 symbols.",
        "profileIndustrySource": profile_industry_source,
        "profileSource": "StockAnalysis company pages and local StockAnalysis industry CSV" if profiles else None,
        "profilesBySymbol": profiles,
        "rejectedSymbols": rejected_symbols,
        "source": str(args.cache_dir),
        "sources": sources,
        "symbols": symbols,
    }
    write_json_atomic(args.out, payload)
    print(payload["note"])
    print(f"Wrote {args.out}")
    if missing:
        print(f"Missing symbols: {', '.join(missing)}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.ignore_lock:
        return run_refresh(args)
    lock_path = DEFAULT_CACHE_DIR / f".tc2000-refresh.client{args.client_id}.lock"
    with single_instance_lock(lock_path, args.lock_stale_seconds) as holder:
        if holder is not True:
            holder_pid = holder.get("pid") if isinstance(holder, dict) else None
            print(
                f"Another TC2000 daily-bar refresh holds the lock (pid {holder_pid}, client-id {args.client_id}); "
                "skipping this run to avoid an IBKR connection collision.",
                file=sys.stderr,
            )
            return 0
        return run_refresh(args)


if __name__ == "__main__":
    raise SystemExit(main())
