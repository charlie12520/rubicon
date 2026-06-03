from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, time as datetime_time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from ib_insync import IB, Stock
except ImportError:
    print("ib_insync is required for IBKR holdings refresh. Install it in the Python runtime used by IBKR_HOLDINGS_PYTHON.", file=sys.stderr)
    raise SystemExit(4)


ET = ZoneInfo("America/New_York")
DEFAULT_PORTS = "7496,4001"
NASDAQ_EARNINGS_URL = "https://api.nasdaq.com/api/calendar/earnings"
NASDAQ_USER_AGENT = "Mozilla/5.0 Rubicon holdings earnings refresh/1.0"
MARKET_DATA_TYPES = [(1, "live"), (2, "frozen"), (3, "delayed"), (4, "delayed_frozen")]
SECONDS_PER_YEAR = 365.0 * 24.0 * 60.0 * 60.0
MIN_OPTION_YEARS = 1.0 / (365.0 * 24.0)


def parse_ports(value: str) -> list[int]:
    ports: list[int] = []
    for raw in value.split(","):
        raw = raw.strip()
        if not raw:
            continue
        port = int(raw)
        if port <= 0 or port > 65535:
            raise ValueError(f"invalid port {port}")
        ports.append(port)
    if not ports:
        raise ValueError("at least one IBKR port is required")
    return list(dict.fromkeys(ports))


def default_out_path() -> Path:
    project_root = Path(__file__).resolve().parents[1]
    ai_stuff_root = Path(os.environ.get("AI_STUFF_ROOT", project_root.parent))
    return ai_stuff_root / "IBKR Equity History Pull" / "data" / "ibkr_holdings_snapshot.json"


def clean_float(value: object) -> float | None:
    try:
        parsed = float(str(value).replace(",", ""))
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def contract_value(contract: object, name: str) -> object:
    return getattr(contract, name, None)


def position_to_dict(position: object) -> dict[str, object]:
    contract = getattr(position, "contract", None)
    average_cost = clean_float(getattr(position, "avgCost", None))
    size = clean_float(getattr(position, "position", None)) or 0.0
    strike = clean_float(contract_value(contract, "strike"))
    return {
        "account": str(getattr(position, "account", "") or ""),
        "averageCost": average_cost,
        "conId": contract_value(contract, "conId"),
        "currency": str(contract_value(contract, "currency") or ""),
        "exchange": str(contract_value(contract, "exchange") or ""),
        "expiration": str(contract_value(contract, "lastTradeDateOrContractMonth") or ""),
        "localSymbol": str(contract_value(contract, "localSymbol") or contract_value(contract, "symbol") or ""),
        "multiplier": str(contract_value(contract, "multiplier") or ""),
        "position": size,
        "primaryExchange": str(contract_value(contract, "primaryExchange") or ""),
        "right": str(contract_value(contract, "right") or ""),
        "securityType": str(contract_value(contract, "secType") or ""),
        "strike": strike,
        "symbol": str(contract_value(contract, "symbol") or ""),
        "tradingClass": str(contract_value(contract, "tradingClass") or ""),
    }


def greeks_to_dict(value: object) -> dict[str, object]:
    if not value:
        return {}
    return {
        "delta": clean_float(getattr(value, "delta", None)),
        "gamma": clean_float(getattr(value, "gamma", None)),
        "theta": clean_float(getattr(value, "theta", None)),
        "vega": clean_float(getattr(value, "vega", None)),
        "impliedVol": clean_float(getattr(value, "impliedVol", None)),
        "underlyingPrice": clean_positive_float(getattr(value, "undPrice", None)),
    }


def ticker_market_price(ticker: object) -> float | None:
    try:
        value = ticker.marketPrice()
    except Exception:
        value = None
    return clean_positive_float(value)


def ticker_reference_price(ticker: object) -> float | None:
    market_price = ticker_market_price(ticker)
    if market_price is not None:
        return market_price
    bid = clean_positive_float(getattr(ticker, "bid", None))
    ask = clean_positive_float(getattr(ticker, "ask", None))
    if bid is not None and ask is not None:
        return (bid + ask) / 2
    for name in ["last", "close"]:
        value = clean_positive_float(getattr(ticker, name, None))
        if value is not None:
            return value
    return None


def clean_positive_float(value: object) -> float | None:
    parsed = clean_float(value)
    return parsed if parsed is not None and parsed > 0 else None


def row_multiplier(row: dict[str, object]) -> float:
    multiplier = clean_float(row.get("multiplier"))
    if str(row.get("securityType", "")).upper() == "OPT":
        return multiplier if multiplier and multiplier > 1 else 100.0
    return multiplier if multiplier and multiplier > 0 else 1.0


def contract_key_from_object(contract: object) -> int | None:
    con_id = clean_float(contract_value(contract, "conId"))
    return int(con_id) if con_id is not None else None


def contract_key_from_row(row: dict[str, object]) -> int | None:
    con_id = clean_float(row.get("conId"))
    return int(con_id) if con_id is not None else None


def enrich_with_portfolio_data(ib: IB, rows: list[dict[str, object]], account: str) -> None:
    try:
        portfolio_items = list(ib.portfolio())
    except Exception as exc:
        for row in rows:
            row["portfolioStatus"] = f"portfolio_failed: {exc!r}"
        return
    if account:
        portfolio_items = [item for item in portfolio_items if str(getattr(item, "account", "") or "") == account]
    by_conid: dict[int, object] = {}
    for item in portfolio_items:
        contract = getattr(item, "contract", None)
        key = contract_key_from_object(contract)
        if key is not None:
            by_conid[key] = item

    for row in rows:
        key = contract_key_from_row(row)
        item = by_conid.get(key) if key is not None else None
        if item is None:
            row["portfolioStatus"] = "missing"
            continue
        portfolio_average_cost = clean_float(getattr(item, "averageCost", None))
        portfolio_market_price = clean_positive_float(getattr(item, "marketPrice", None))
        portfolio_market_value = clean_float(getattr(item, "marketValue", None))
        if portfolio_average_cost is not None:
            row["averageCost"] = portfolio_average_cost
        if portfolio_market_price is not None:
            row["marketPrice"] = portfolio_market_price
        if portfolio_market_value is not None:
            row["currentValue"] = portfolio_market_value
        row["unrealizedPnl"] = clean_float(getattr(item, "unrealizedPNL", None))
        row["realizedPnl"] = clean_float(getattr(item, "realizedPNL", None))
        row["portfolioStatus"] = "ok"


def option_row_needs_market_data(row: dict[str, object]) -> bool:
    if str(row.get("securityType", "")).upper() != "OPT":
        return False
    return (
        row.get("marketPrice") is None
        or row.get("delta") is None
        or row.get("theta") is None
        or row.get("gamma") is None
        or row.get("vega") is None
    )


def apply_ticker_market_data(row: dict[str, object], ticker: object, label: str) -> None:
    bid = clean_positive_float(getattr(ticker, "bid", None))
    ask = clean_positive_float(getattr(ticker, "ask", None))
    last = clean_positive_float(getattr(ticker, "last", None))
    market_price = ticker_reference_price(ticker)
    midpoint = (bid + ask) / 2 if bid is not None and ask is not None else None
    row["bid"] = bid if bid is not None else row.get("bid")
    row["ask"] = ask if ask is not None else row.get("ask")
    row["last"] = last if last is not None else row.get("last")
    if row.get("marketPrice") is None:
        row["marketPrice"] = market_price or midpoint or last
    greek_sources = [
        ("model", getattr(ticker, "modelGreeks", None)),
        ("bid", getattr(ticker, "bidGreeks", None)),
        ("ask", getattr(ticker, "askGreeks", None)),
        ("last", getattr(ticker, "lastGreeks", None)),
    ]
    for greek_label, greeks in greek_sources:
        filled = False
        for key, value in greeks_to_dict(greeks).items():
            if value is not None and row.get(key) is None:
                row[key] = value
                if key in {"delta", "gamma", "theta", "vega", "impliedVol"}:
                    filled = True
        if filled and row.get("greeksSource") is None:
            row["greeksSource"] = f"ibkr_{greek_label}"
    has_quote = row.get("marketPrice") is not None or row.get("bid") is not None or row.get("ask") is not None
    has_greeks = row.get("delta") is not None or row.get("theta") is not None
    row["marketDataStatus"] = f"ok:{label}" if has_quote or has_greeks else f"no_ticks:{label}"


def enrich_with_option_market_data(ib: IB, raw_positions: list[object], rows: list[dict[str, object]], wait_seconds: float) -> None:
    raw_by_conid = {
        contract_key_from_object(getattr(raw_position, "contract", None)): raw_position for raw_position in raw_positions
    }
    for market_data_type, label in MARKET_DATA_TYPES:
        targets = [row for row in rows if option_row_needs_market_data(row)]
        if not targets:
            return
        try:
            ib.reqMarketDataType(market_data_type)
        except Exception:
            pass
        option_requests: list[tuple[dict[str, object], object]] = []
        for row in targets:
            raw_position = raw_by_conid.get(contract_key_from_row(row))
            contract = getattr(raw_position, "contract", None) if raw_position is not None else None
            if contract is None:
                row["marketDataStatus"] = "missing_contract"
                continue
            try:
                ib.qualifyContracts(contract)
                ticker = ib.reqMktData(contract, "", True, False)
                option_requests.append((row, ticker))
                row["marketDataStatus"] = f"requested:{label}"
            except Exception as exc:
                row["marketDataStatus"] = f"request_failed:{label}: {exc!r}"

        if not option_requests:
            continue

        ib.sleep(max(0.5, wait_seconds))

        for row, ticker in option_requests:
            apply_ticker_market_data(row, ticker, label)


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def normal_pdf(value: float) -> float:
    return math.exp(-0.5 * value * value) / math.sqrt(2.0 * math.pi)


def option_expiration_day(expiration: object) -> date | None:
    text = str(expiration or "").strip()
    try:
        if len(text) == 8 and text.isdigit():
            return date(int(text[0:4]), int(text[4:6]), int(text[6:8]))
        if len(text) == 6 and text.isdigit():
            year = int(text[0:4])
            month = int(text[4:6])
            if month == 12:
                return date(year, 12, 31)
            return date(year, month + 1, 1) - timedelta(days=1)
    except ValueError:
        return None
    return None


def option_years_to_expiration(expiration: object, now: datetime | None = None) -> float | None:
    day = option_expiration_day(expiration)
    if day is None:
        return None
    current = now or datetime.now(ET)
    expiry = datetime.combine(day, datetime_time(16, 0), tzinfo=ET)
    return max((expiry - current).total_seconds() / SECONDS_PER_YEAR, MIN_OPTION_YEARS)


def black_scholes_components(spot: float, strike: float, years: float, volatility: float, rate: float) -> tuple[float, float] | None:
    if spot <= 0 or strike <= 0 or years <= 0 or volatility <= 0:
        return None
    vol_sqrt = volatility * math.sqrt(years)
    if vol_sqrt <= 0:
        return None
    d1 = (math.log(spot / strike) + (rate + 0.5 * volatility * volatility) * years) / vol_sqrt
    return d1, d1 - vol_sqrt


def black_scholes_price(spot: float, strike: float, years: float, volatility: float, right: str, rate: float) -> float | None:
    components = black_scholes_components(spot, strike, years, volatility, rate)
    if components is None:
        return None
    d1, d2 = components
    discount = math.exp(-rate * years)
    if right.upper().startswith("P"):
        return strike * discount * normal_cdf(-d2) - spot * normal_cdf(-d1)
    return spot * normal_cdf(d1) - strike * discount * normal_cdf(d2)


def black_scholes_delta(spot: float, strike: float, years: float, volatility: float, right: str, rate: float) -> float | None:
    components = black_scholes_components(spot, strike, years, volatility, rate)
    if components is None:
        return None
    d1, _ = components
    if right.upper().startswith("P"):
        return normal_cdf(d1) - 1.0
    return normal_cdf(d1)


def black_scholes_theta(spot: float, strike: float, years: float, volatility: float, right: str, rate: float) -> float | None:
    components = black_scholes_components(spot, strike, years, volatility, rate)
    if components is None:
        return None
    d1, d2 = components
    first_term = -(spot * normal_pdf(d1) * volatility) / (2.0 * math.sqrt(years))
    discount = math.exp(-rate * years)
    if right.upper().startswith("P"):
        annual_theta = first_term + rate * strike * discount * normal_cdf(-d2)
    else:
        annual_theta = first_term - rate * strike * discount * normal_cdf(d2)
    return annual_theta / 365.0


def implied_volatility_from_price(
    target_price: float,
    spot: float,
    strike: float,
    years: float,
    right: str,
    rate: float,
) -> float | None:
    if target_price <= 0 or spot <= 0 or strike <= 0 or years <= 0:
        return None
    low = 0.001
    high = 5.0
    low_price = black_scholes_price(spot, strike, years, low, right, rate)
    high_price = black_scholes_price(spot, strike, years, high, right, rate)
    if low_price is None or high_price is None:
        return None
    if target_price <= low_price:
        return low
    if target_price >= high_price:
        return high
    for _ in range(80):
        mid = (low + high) / 2.0
        mid_price = black_scholes_price(spot, strike, years, mid, right, rate)
        if mid_price is None:
            return None
        if mid_price < target_price:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


def option_row_missing_core_greeks(row: dict[str, object]) -> bool:
    return (
        str(row.get("securityType", "")).upper() == "OPT"
        and (row.get("delta") is None or row.get("theta") is None)
    )


def fetch_underlying_prices(ib: IB, rows: list[dict[str, object]], wait_seconds: float) -> tuple[dict[str, float], dict[str, str]]:
    symbols = sorted({
        str(row.get("symbol", "") or "").upper().strip()
        for row in rows
        if option_row_missing_core_greeks(row) and not clean_positive_float(row.get("underlyingPrice"))
    })
    prices: dict[str, float] = {}
    statuses: dict[str, str] = {}
    for market_data_type, label in MARKET_DATA_TYPES:
        pending = [symbol for symbol in symbols if symbol and symbol not in prices]
        if not pending:
            break
        try:
            ib.reqMarketDataType(market_data_type)
        except Exception:
            pass
        requests: list[tuple[str, object]] = []
        for symbol in pending:
            try:
                stock = Stock(symbol, "SMART", "USD")
                qualified = ib.qualifyContracts(stock)
                contract = qualified[0] if qualified else stock
                ticker = ib.reqMktData(contract, "", True, False)
                requests.append((symbol, ticker))
                statuses[symbol] = f"requested:{label}"
            except Exception as exc:
                statuses[symbol] = f"request_failed:{label}: {exc!r}"
        if not requests:
            continue
        ib.sleep(max(0.5, wait_seconds))
        for symbol, ticker in requests:
            price = ticker_reference_price(ticker)
            if price is not None:
                prices[symbol] = price
                statuses[symbol] = f"ok:{label}"
            elif not statuses.get(symbol, "").startswith("ok:"):
                statuses[symbol] = f"no_ticks:{label}"
    return prices, statuses


def compute_missing_option_greeks(
    ib: IB,
    rows: list[dict[str, object]],
    wait_seconds: float,
    risk_free_rate: float,
) -> dict[str, object]:
    missing_rows = [row for row in rows if option_row_missing_core_greeks(row)]
    if not missing_rows:
        return {"computed": 0, "missing": 0, "source": "ibkr_or_not_options"}
    underlying_prices, underlying_statuses = fetch_underlying_prices(ib, missing_rows, wait_seconds)
    computed = 0
    still_missing = 0
    for row in missing_rows:
        if not option_row_missing_core_greeks(row):
            continue
        symbol = str(row.get("symbol", "") or "").upper().strip()
        spot = clean_positive_float(row.get("underlyingPrice")) or underlying_prices.get(symbol)
        market_price = clean_positive_float(row.get("marketPrice"))
        strike = clean_positive_float(row.get("strike"))
        right = str(row.get("right", "") or "").upper().strip()
        years = option_years_to_expiration(row.get("expiration"))
        if spot is None:
            row["manualGreeksStatus"] = f"missing_underlying_price:{underlying_statuses.get(symbol, 'not_requested')}"
            still_missing += 1
            continue
        row["underlyingPrice"] = spot
        if market_price is None:
            row["manualGreeksStatus"] = "missing_option_mark"
            still_missing += 1
            continue
        if strike is None or years is None or right not in {"C", "P"}:
            row["manualGreeksStatus"] = "missing_contract_terms"
            still_missing += 1
            continue
        volatility = clean_positive_float(row.get("impliedVol"))
        if volatility is None:
            volatility = implied_volatility_from_price(market_price, spot, strike, years, right, risk_free_rate)
        if volatility is None:
            row["manualGreeksStatus"] = "missing_implied_volatility"
            still_missing += 1
            continue
        delta = black_scholes_delta(spot, strike, years, volatility, right, risk_free_rate)
        theta = black_scholes_theta(spot, strike, years, volatility, right, risk_free_rate)
        filled = False
        if delta is not None and row.get("delta") is None:
            row["delta"] = delta
            filled = True
        if theta is not None and row.get("theta") is None:
            row["theta"] = theta
            filled = True
        if row.get("impliedVol") is None:
            row["impliedVol"] = volatility
        if filled:
            row["greeksSource"] = "manual_black_scholes"
            row["manualGreeksStatus"] = "computed"
            computed += 1
        if option_row_missing_core_greeks(row):
            still_missing += 1
    return {"computed": computed, "missing": still_missing, "source": "black_scholes_fallback"}


def finalize_position_values(rows: list[dict[str, object]]) -> tuple[float | None, float | None]:
    gross_cost_values: list[float] = []
    gross_current_values: list[float] = []
    for row in rows:
        position = clean_float(row.get("position")) or 0.0
        average_cost = clean_float(row.get("averageCost"))
        multiplier = row_multiplier(row)
        market_price = clean_float(row.get("marketPrice"))
        current_value = clean_float(row.get("currentValue"))
        if average_cost is not None:
            cost_basis = abs(position * average_cost)
            row["costBasis"] = cost_basis
            gross_cost_values.append(cost_basis)
        if current_value is None and market_price is not None:
            current_value = position * market_price * multiplier
            row["currentValue"] = current_value
        if current_value is not None:
            gross_current_values.append(abs(current_value))
        delta = clean_float(row.get("delta"))
        theta = clean_float(row.get("theta"))
        if delta is not None:
            row["positionDelta"] = delta * position * multiplier
        if theta is not None:
            row["positionTheta"] = theta * position * multiplier
    return (
        sum(gross_cost_values) if gross_cost_values else None,
        sum(gross_current_values) if gross_current_values else None,
    )


def market_data_summary(rows: list[dict[str, object]]) -> dict[str, object]:
    option_rows = [row for row in rows if str(row.get("securityType", "")).upper() == "OPT"]
    return {
        "optionCount": len(option_rows),
        "withMarketPrice": sum(1 for row in option_rows if row.get("marketPrice") is not None),
        "withDelta": sum(1 for row in option_rows if row.get("delta") is not None),
        "withTheta": sum(1 for row in option_rows if row.get("theta") is not None),
    }


def manual_greeks_summary(rows: list[dict[str, object]], fallback_summary: dict[str, object]) -> dict[str, object]:
    option_rows = [row for row in rows if str(row.get("securityType", "")).upper() == "OPT"]
    return {
        **fallback_summary,
        "optionCount": len(option_rows),
        "ibkr": sum(1 for row in option_rows if str(row.get("greeksSource", "")).startswith("ibkr_")),
        "manual": sum(1 for row in option_rows if row.get("greeksSource") == "manual_black_scholes"),
    }


def normalize_earnings_time(value: object) -> str:
    text = str(value or "").strip().lower()
    if "after" in text:
        return "after-close"
    if "before" in text or "pre" in text:
        return "before-open"
    return "not-supplied"


def earnings_warning(days_until: int) -> str | None:
    if days_until < 0:
        return None
    if days_until <= 1:
        return "red"
    if days_until <= 7:
        return "yellow"
    return None


def fetch_nasdaq_earnings_day(day: date) -> tuple[list[dict[str, object]], str | None]:
    day_text = day.isoformat()
    url = f"{NASDAQ_EARNINGS_URL}?date={day_text}"
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
        return [], f"{day_text}: {exc!r}"
    data = payload.get("data") if isinstance(payload, dict) else None
    rows = data.get("rows") if isinstance(data, dict) else None
    return rows if isinstance(rows, list) else [], None


def build_upcoming_earnings(symbols: list[str], days: int, fetch_gap_s: float) -> tuple[dict[str, dict[str, object]], list[str]]:
    today = datetime.now(ET).date()
    wanted = {symbol.upper().strip() for symbol in symbols if symbol}
    events: dict[str, dict[str, object]] = {}
    errors: list[str] = []
    for offset in range(0, max(0, days) + 1):
        day = today + timedelta(days=offset)
        rows, error = fetch_nasdaq_earnings_day(day)
        if error:
            errors.append(error)
        for row in rows:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol", "") or "").upper().strip()
            if symbol not in wanted or symbol in events:
                continue
            warning = earnings_warning(offset)
            if not warning:
                continue
            events[symbol] = {
                "date": day.isoformat(),
                "daysUntil": offset,
                "epsForecast": str(row.get("epsForecast", "") or "").strip(),
                "fiscalQuarterEnding": str(row.get("fiscalQuarterEnding", "") or "").strip(),
                "name": str(row.get("name", "") or "").strip(),
                "source": "Nasdaq earnings calendar",
                "time": normalize_earnings_time(row.get("time")),
                "warning": warning,
            }
        if fetch_gap_s > 0:
            time.sleep(fetch_gap_s)
    return events, errors


def enrich_with_earnings(
    rows: list[dict[str, object]],
    days: int,
    fetch_gap_s: float,
) -> tuple[dict[str, dict[str, object]], list[str]]:
    symbols = sorted({str(row.get("symbol", "") or "").upper().strip() for row in rows if row.get("symbol")})
    events, errors = build_upcoming_earnings(symbols, days=days, fetch_gap_s=fetch_gap_s)
    for row in rows:
        symbol = str(row.get("symbol", "") or "").upper().strip()
        if symbol in events:
            row["earnings"] = events[symbol]
    return events, errors


def write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh an IBKR live holdings snapshot from read-only TWS/Gateway API.")
    parser.add_argument("--host", default=os.environ.get("IBKR_HOST", "127.0.0.1"))
    parser.add_argument("--ports", default=os.environ.get("IBKR_HOLDINGS_PORTS", os.environ.get("IBKR_PORTS", DEFAULT_PORTS)))
    parser.add_argument("--client-id", type=int, default=int(os.environ.get("IBKR_HOLDINGS_CLIENT_ID", "884")))
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("IBKR_HOLDINGS_TIMEOUT_SECONDS", "8")))
    parser.add_argument("--account", default=os.environ.get("IBKR_ACCOUNT", ""))
    parser.add_argument("--out", type=Path, default=Path(os.environ.get("IBKR_HOLDINGS_SNAPSHOT_OUT_PATH", default_out_path())))
    parser.add_argument("--market-data-seconds", type=float, default=float(os.environ.get("IBKR_HOLDINGS_MARKET_DATA_SECONDS", "2.5")))
    parser.add_argument("--skip-market-data", action="store_true", default=os.environ.get("IBKR_HOLDINGS_SKIP_MARKET_DATA", "").lower() == "true")
    parser.add_argument("--manual-greeks-rate", type=float, default=float(os.environ.get("IBKR_HOLDINGS_MANUAL_GREEKS_RATE", "0.04")))
    parser.add_argument("--skip-manual-greeks", action="store_true", default=os.environ.get("IBKR_HOLDINGS_SKIP_MANUAL_GREEKS", "").lower() == "true")
    parser.add_argument("--earnings-days", type=int, default=int(os.environ.get("IBKR_HOLDINGS_EARNINGS_DAYS", "7")))
    parser.add_argument("--earnings-fetch-gap-s", type=float, default=float(os.environ.get("IBKR_HOLDINGS_EARNINGS_FETCH_GAP_SECONDS", "0.05")))
    parser.add_argument("--skip-earnings", action="store_true", default=os.environ.get("IBKR_HOLDINGS_SKIP_EARNINGS", "").lower() == "true")
    args = parser.parse_args()

    ports = parse_ports(args.ports)
    errors: list[dict[str, object]] = []

    for index, port in enumerate(ports):
        ib = IB()
        try:
            ib.connect(args.host, port, clientId=args.client_id + index, timeout=args.timeout, readonly=True)
            raw_positions = list(ib.positions())
            if args.account:
                raw_positions = [position for position in raw_positions if str(getattr(position, "account", "") or "") == args.account]
            raw_positions = [position for position in raw_positions if abs(float(getattr(position, "position", 0) or 0)) > 0]
            positions = [position_to_dict(row) for row in raw_positions]
            enrich_with_portfolio_data(ib, positions, args.account)
            if not args.skip_market_data:
                enrich_with_option_market_data(ib, raw_positions, positions, args.market_data_seconds)
            fallback_summary = (
                {"computed": 0, "missing": 0, "source": "disabled"}
                if args.skip_manual_greeks
                else compute_missing_option_greeks(
                    ib,
                    positions,
                    wait_seconds=args.market_data_seconds,
                    risk_free_rate=max(0.0, args.manual_greeks_rate),
                )
            )
            if args.skip_earnings:
                earnings_events: dict[str, dict[str, object]] = {}
                earnings_errors: list[str] = []
            else:
                earnings_events, earnings_errors = enrich_with_earnings(
                    positions,
                    days=max(1, args.earnings_days),
                    fetch_gap_s=max(0.0, args.earnings_fetch_gap_s),
                )
            positions.sort(key=lambda row: (str(row["securityType"]), str(row["symbol"]), str(row["expiration"]), str(row["localSymbol"])))

            gross_cost_basis, gross_current_value = finalize_position_values(positions)
            fetched_at = datetime.now(ET).isoformat()
            payload: dict[str, object] = {
                "source": "IBKR_TWS_API",
                "host": args.host,
                "port": port,
                "client_id": args.client_id + index,
                "earningsErrors": earnings_errors,
                "earningsEventsBySymbol": earnings_events,
                "earningsSource": "Nasdaq earnings calendar",
                "fetchedAt": fetched_at,
                "account": args.account or (positions[0]["account"] if positions else ""),
                "count": len(positions),
                "grossCostBasis": gross_cost_basis,
                "grossCurrentValue": gross_current_value,
                "manualGreeksSummary": manual_greeks_summary(positions, fallback_summary),
                "marketDataSummary": market_data_summary(positions),
                "positions": positions,
            }
            write_json_atomic(args.out, payload)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "outPath": str(args.out),
                        "account": payload["account"],
                        "count": len(positions),
                        "fetchedAt": fetched_at,
                        "grossCostBasis": payload["grossCostBasis"],
                        "grossCurrentValue": payload["grossCurrentValue"],
                        "manualGreeksSummary": payload["manualGreeksSummary"],
                        "marketDataSummary": payload["marketDataSummary"],
                        "port": port,
                    }
                )
            )
            return 0
        except Exception as exc:
            errors.append({"host": args.host, "port": port, "error": repr(exc)})
        finally:
            try:
                if ib.isConnected():
                    ib.disconnect()
            except Exception:
                pass

    print(
        "Could not refresh IBKR holdings snapshot from read-only TWS/Gateway API. "
        f"Checked {args.host}:{','.join(map(str, ports))}. Errors: {json.dumps(errors)}",
        file=sys.stderr,
    )
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
