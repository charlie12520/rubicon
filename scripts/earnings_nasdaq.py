"""Shared free Nasdaq earnings-calendar fetch (no key, no IBKR). Mirrors the
helpers in refresh-ibkr-holdings-snapshot.py so the SPX heatmap can reuse them
without an IBKR connection — the endpoint returns every company per date, so the
whole 500 costs ~5 weekday HTTP calls."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

NASDAQ_EARNINGS_URL = "https://api.nasdaq.com/api/calendar/earnings"
NASDAQ_USER_AGENT = "Mozilla/5.0 Rubicon spx-heatmap earnings refresh/1.0"


def normalize_earnings_time(value: object) -> str:
    text = str(value or "").strip().lower()
    if "after" in text:
        return "after-close"
    if "before" in text or "pre" in text:
        return "before-open"
    return "not-supplied"


def fetch_nasdaq_earnings_day(day: date) -> tuple[list, str | None]:
    url = f"{NASDAQ_EARNINGS_URL}?date={day.isoformat()}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://www.nasdaq.com/market-activity/earnings",
            "User-Agent": NASDAQ_USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
    except (json.JSONDecodeError, urllib.error.URLError, TimeoutError, OSError) as exc:
        return [], f"{day.isoformat()}: {exc!r}"
    data = payload.get("data") if isinstance(payload, dict) else None
    rows = data.get("rows") if isinstance(data, dict) else None
    return (rows if isinstance(rows, list) else []), None


def week_earnings(symbols, today: date, fetch_gap_s: float = 0.05) -> dict:
    """{ SYMBOL: {"date": "YYYY-MM-DD", "time": "before-open"|"after-close"|"not-supplied"} }
    for `symbols` reporting from `today` through ~today+15 — covers the client's ~2-week
    overlay window plus the before-open prior-day mapping. Keeps the soonest report per
    symbol. Pure HTTP; no IBKR. Weekends are skipped; the client filters the window anyway."""
    wanted = {str(s).upper().strip() for s in symbols if s}
    out: dict[str, dict] = {}
    for offset in range(16):
        day = today + timedelta(days=offset)
        if day.weekday() >= 5:  # weekends have no earnings; skip the call
            continue
        rows, _err = fetch_nasdaq_earnings_day(day)
        for row in rows:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol", "") or "").upper().strip()
            if symbol not in wanted or symbol in out:  # ascending days → first hit is soonest
                continue
            out[symbol] = {"date": day.isoformat(), "time": normalize_earnings_time(row.get("time"))}
        if fetch_gap_s > 0:
            time.sleep(fetch_gap_s)
    return out
