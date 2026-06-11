import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { IbkrHoldingEarningsEvent, IbkrHoldingPosition, IbkrHoldingsSnapshot } from "../shared/types.ts";
import { easternClock, shouldFireDailyWindow } from "./easternClock.ts";
import { parseIbkrPorts } from "./ibkrWalletRefresh.ts";
import { asArray, asRecord, firstString, toNullableNumber, toNullablePositiveNumber } from "./normalize.ts";

const execFileAsync = promisify(execFile);

const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..");
const IBKR_ROOT = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull");
const DEFAULT_IBKR_HOST = "127.0.0.1";
const DEFAULT_CLIENT_ID = 884;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 8;
const DEFAULT_REFRESH_TIMEOUT_MS = 60_000;
const AUTO_REFRESH_ENABLED = String(process.env.IBKR_HOLDINGS_AUTO_REFRESH ?? "true").toLowerCase() !== "false";
const AUTO_REFRESH_TIME = process.env.IBKR_HOLDINGS_AUTO_REFRESH_TIME ?? "08:30";
const AUTO_REFRESH_CATCHUP_MINUTES = Number(process.env.IBKR_HOLDINGS_AUTO_REFRESH_CATCHUP_MINUTES ?? "15");
// Intraday live pull: re-pull positions from IBKR every N minutes during market hours
// so the estimator reflects current spreads, not just the 08:30 snapshot.
const INTRADAY_REFRESH_ENABLED = String(process.env.IBKR_HOLDINGS_INTRADAY_REFRESH ?? "true").toLowerCase() !== "false";
const INTRADAY_REFRESH_INTERVAL_MS = Math.max(1, Number(process.env.IBKR_HOLDINGS_INTRADAY_INTERVAL_MIN ?? "5")) * 60_000;
const INTRADAY_WINDOW_START = process.env.IBKR_HOLDINGS_INTRADAY_WINDOW_START ?? "09:30";
const INTRADAY_WINDOW_END = process.env.IBKR_HOLDINGS_INTRADAY_WINDOW_END ?? "16:15";

type PythonHoldingsRefreshResult = {
  account?: string;
  count?: number;
  fetchedAt?: string;
  grossCostBasis?: number | null;
  grossCurrentValue?: number | null;
  manualGreeksSummary?: IbkrHoldingsSnapshot["manualGreeksSummary"];
  ok?: boolean;
  outPath?: string;
  port?: number;
  message?: string;
};

let autoRefreshLastFiredDate: string | null = null;
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let activeRefresh: Promise<PythonHoldingsRefreshResult> | null = null;
let intradayLastFiredMs: number | null = null;

export function ibkrHoldingsSnapshotPath(): string {
  return process.env.IBKR_HOLDINGS_SNAPSHOT_OUT_PATH || path.join(IBKR_ROOT, "data", "ibkr_holdings_snapshot.json");
}

export async function readIbkrHoldingsSnapshot(): Promise<IbkrHoldingsSnapshot> {
  const snapshotPath = ibkrHoldingsSnapshotPath();
  try {
    const parsed = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as unknown;
    return withAutoRefreshState(normalizeHoldingsSnapshotPayload(parsed, snapshotPath));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return withAutoRefreshState({
      count: 0,
      fetchedAt: null,
      grossCostBasis: null,
      message: missing
        ? "No IBKR holdings snapshot has been pulled yet."
        : `Could not read IBKR holdings snapshot: ${error instanceof Error ? error.message : String(error)}`,
      positions: [],
      source: snapshotPath,
      status: missing ? "missing" : "error",
    });
  }
}

export function normalizeHoldingsSnapshotPayload(payload: unknown, source: string): IbkrHoldingsSnapshot {
  const record = asRecord(payload);
  const positions = asArray(record.positions)
    .map(normalizeHoldingPosition)
    .filter((position): position is IbkrHoldingPosition => position !== null && Math.abs(position.position) > 0);
  const grossCostBasis = toNullableNumber(record.grossCostBasis ?? record.gross_cost_basis);
  const grossCurrentValue = toNullableNumber(record.grossCurrentValue ?? record.gross_current_value);
  const earningsEventsBySymbol = normalizeEarningsEventsBySymbol(record.earningsEventsBySymbol ?? record.earnings_events_by_symbol);
  const earningsErrors = asArray(record.earningsErrors ?? record.earnings_errors)
    .map((value) => firstString(value))
    .filter((value): value is string => Boolean(value));
  return {
    account: firstString(record.account, positions[0]?.account),
    count: toNullableNumber(record.count) ?? positions.length,
    earningsErrors,
    earningsEventsBySymbol,
    earningsSource: firstString(record.earningsSource, record.earnings_source),
    fetchedAt: firstString(record.fetchedAt, record.fetched_at, record.updatedAt, record.timestamp) ?? null,
    grossCostBasis,
    grossCurrentValue,
    manualGreeksSummary: normalizeManualGreeksSummary(record.manualGreeksSummary ?? record.manual_greeks_summary),
    marketDataSummary: normalizeMarketDataSummary(record.marketDataSummary ?? record.market_data_summary),
    message: positions.length
      ? `Pulled ${positions.length} live IBKR position${positions.length === 1 ? "" : "s"}.`
      : "IBKR reported no open live positions.",
    positions,
    port: toNullableNumber(record.port) ?? undefined,
    source,
    status: "ok",
  };
}

export async function refreshIbkrHoldingsSnapshot(): Promise<PythonHoldingsRefreshResult> {
  if (activeRefresh) {
    return activeRefresh;
  }

  activeRefresh = runHoldingsRefresh().finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}

export function shouldFireIbkrHoldingsAutoRefresh(
  now = new Date(),
  lastFiredDate: string | null = autoRefreshLastFiredDate,
  configuredTime = AUTO_REFRESH_TIME,
  catchupMinutes = AUTO_REFRESH_CATCHUP_MINUTES,
): { date: string; shouldFire: boolean; time: string } {
  return shouldFireDailyWindow({
    catchupMinutes,
    configuredTime,
    enabled: AUTO_REFRESH_ENABLED,
    lastFiredDate,
    now,
  });
}

/**
 * Decide whether to re-pull positions on the intraday cadence: enabled, a weekday,
 * inside the ET market window, and at least the configured interval since the last pull.
 * Pure + injectable for tests.
 */
export function shouldFireIntradayHoldingsRefresh(
  now: Date = new Date(),
  lastFiredMs: number | null = intradayLastFiredMs,
  options: { enabled?: boolean; intervalMs?: number; windowStart?: string; windowEnd?: string } = {},
): { shouldFire: boolean; time: string; nowMs: number } {
  const enabled = options.enabled ?? INTRADAY_REFRESH_ENABLED;
  const intervalMs = options.intervalMs ?? INTRADAY_REFRESH_INTERVAL_MS;
  const windowStart = options.windowStart ?? INTRADAY_WINDOW_START;
  const windowEnd = options.windowEnd ?? INTRADAY_WINDOW_END;
  const clock = easternClock(now);
  const isWeekday = clock.weekday >= 1 && clock.weekday <= 5;
  const inWindow = clock.time >= windowStart && clock.time <= windowEnd;
  const dueByInterval = lastFiredMs === null || now.getTime() - lastFiredMs >= intervalMs;
  return { shouldFire: enabled && isWeekday && inWindow && dueByInterval, time: clock.time, nowMs: now.getTime() };
}

export function armIbkrHoldingsAutoRefresh(): void {
  if (!AUTO_REFRESH_ENABLED || autoRefreshTimer) {
    return;
  }

  void maybeAutoRefreshIbkrHoldings();
  autoRefreshTimer = setInterval(() => {
    void maybeAutoRefreshIbkrHoldings();
  }, 30_000);
  autoRefreshTimer.unref?.();
}

async function maybeAutoRefreshIbkrHoldings(): Promise<void> {
  const daily = shouldFireIbkrHoldingsAutoRefresh();
  const intraday = shouldFireIntradayHoldingsRefresh();
  if (!daily.shouldFire && !intraday.shouldFire) {
    return;
  }
  if (daily.shouldFire) {
    autoRefreshLastFiredDate = daily.date;
  }
  if (intraday.shouldFire) {
    intradayLastFiredMs = intraday.nowMs;
  }
  try {
    await refreshIbkrHoldingsSnapshot();
  } catch (error) {
    console.warn(`IBKR holdings auto-refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runHoldingsRefresh(): Promise<PythonHoldingsRefreshResult> {
  const scriptPath = path.join(process.cwd(), "scripts", "refresh-ibkr-holdings-snapshot.py");
  const host = process.env.IBKR_HOST ?? DEFAULT_IBKR_HOST;
  const ports = parseIbkrPorts(process.env.IBKR_HOLDINGS_PORTS ?? process.env.IBKR_PORTS);
  const outPath = ibkrHoldingsSnapshotPath();
  const pythonCommand = process.env.IBKR_HOLDINGS_PYTHON || process.env.IBKR_WALLET_PYTHON || process.env.PYTHON || "python";
  const args = [
    scriptPath,
    "--host",
    host,
    "--ports",
    ports.join(","),
    "--client-id",
    String(Number(process.env.IBKR_HOLDINGS_CLIENT_ID ?? DEFAULT_CLIENT_ID)),
    "--timeout",
    String(Number(process.env.IBKR_HOLDINGS_TIMEOUT_SECONDS ?? DEFAULT_CONNECT_TIMEOUT_SECONDS)),
    "--out",
    outPath,
  ];

  if (process.env.IBKR_ACCOUNT) {
    args.push("--account", process.env.IBKR_ACCOUNT);
  }

  try {
    const { stdout } = await execFileAsync(pythonCommand, args, {
      cwd: process.cwd(),
      env: process.env,
      timeout: Number(process.env.IBKR_HOLDINGS_REFRESH_TIMEOUT_MS ?? DEFAULT_REFRESH_TIMEOUT_MS),
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout.trim()) as PythonHoldingsRefreshResult;
    if (!parsed.ok || !parsed.outPath) {
      throw new Error(parsed.message || "IBKR holdings refresh did not return a snapshot path.");
    }
    return parsed;
  } catch (error) {
    const commandError = error as Error & { stdout?: string; stderr?: string };
    const detail = [commandError.stderr?.trim(), commandError.stdout?.trim(), commandError.message]
      .filter(Boolean)
      .join(" ");
    throw new Error(detail || "IBKR holdings refresh failed.", { cause: error });
  }
}

function withAutoRefreshState(snapshot: Omit<IbkrHoldingsSnapshot, "autoRefreshEt" | "autoRefreshLastFiredDate">): IbkrHoldingsSnapshot {
  return {
    ...snapshot,
    autoRefreshEt: AUTO_REFRESH_ENABLED ? AUTO_REFRESH_TIME : null,
    autoRefreshLastFiredDate,
  };
}

function normalizeHoldingPosition(value: unknown): IbkrHoldingPosition | null {
  const record = asRecord(value);
  const position = toNullableNumber(record.position ?? record.quantity ?? record.qty);
  if (position === null) {
    return null;
  }
  return {
    account: firstString(record.account) ?? "",
    ask: toNullablePositiveNumber(record.ask),
    averageCost: toNullableNumber(record.averageCost ?? record.avgCost ?? record.average_cost),
    bid: toNullablePositiveNumber(record.bid),
    conId: toNullableNumber(record.conId ?? record.con_id) ?? undefined,
    costBasis: toNullableNumber(record.costBasis ?? record.cost_basis),
    currency: firstString(record.currency),
    delta: toNullableNumber(record.delta),
    earnings: normalizeHoldingEarnings(record.earnings),
    exchange: firstString(record.exchange),
    expiration: firstString(record.expiration, record.lastTradeDateOrContractMonth),
    gamma: toNullableNumber(record.gamma),
    greeksSource: firstString(record.greeksSource, record.greeks_source),
    impliedVol: toNullableNumber(record.impliedVol ?? record.implied_vol),
    last: toNullablePositiveNumber(record.last),
    localSymbol: firstString(record.localSymbol, record.local_symbol, record.symbol) ?? "",
    currentValue: toNullableNumber(record.currentValue ?? record.current_value ?? record.marketValue ?? record.market_value),
    manualGreeksStatus: firstString(record.manualGreeksStatus, record.manual_greeks_status),
    marketDataStatus: firstString(record.marketDataStatus, record.market_data_status),
    marketPrice: toNullablePositiveNumber(record.marketPrice ?? record.market_price ?? record.markPrice ?? record.mark_price),
    multiplier: firstString(record.multiplier),
    position,
    positionDelta: toNullableNumber(record.positionDelta ?? record.position_delta),
    positionTheta: toNullableNumber(record.positionTheta ?? record.position_theta),
    primaryExchange: firstString(record.primaryExchange, record.primary_exchange),
    right: firstString(record.right),
    realizedPnl: toNullableNumber(record.realizedPnl ?? record.realizedPNL ?? record.realized_pnl),
    securityType: firstString(record.securityType, record.secType, record.sec_type) ?? "",
    strike: toNullableNumber(record.strike),
    symbol: firstString(record.symbol, record.localSymbol, record.local_symbol) ?? "",
    theta: toNullableNumber(record.theta),
    tradingClass: firstString(record.tradingClass, record.trading_class),
    underlyingPrice: toNullablePositiveNumber(record.underlyingPrice ?? record.underlying_price),
    unrealizedPnl: toNullableNumber(record.unrealizedPnl ?? record.unrealizedPNL ?? record.unrealized_pnl),
    vega: toNullableNumber(record.vega),
  };
}

function normalizeManualGreeksSummary(value: unknown): IbkrHoldingsSnapshot["manualGreeksSummary"] {
  const record = asRecord(value);
  const optionCount = toNullableNumber(record.optionCount ?? record.option_count);
  const computed = toNullableNumber(record.computed);
  const ibkr = toNullableNumber(record.ibkr);
  const manual = toNullableNumber(record.manual);
  const missing = toNullableNumber(record.missing);
  if (optionCount === null && computed === null && ibkr === null && manual === null && missing === null) {
    return undefined;
  }
  return {
    computed: computed ?? 0,
    ibkr: ibkr ?? 0,
    manual: manual ?? 0,
    missing: missing ?? 0,
    optionCount: optionCount ?? 0,
    source: firstString(record.source),
  };
}

function normalizeMarketDataSummary(value: unknown): IbkrHoldingsSnapshot["marketDataSummary"] {
  const record = asRecord(value);
  const optionCount = toNullableNumber(record.optionCount ?? record.option_count);
  const withDelta = toNullableNumber(record.withDelta ?? record.with_delta);
  const withMarketPrice = toNullableNumber(record.withMarketPrice ?? record.with_market_price);
  const withTheta = toNullableNumber(record.withTheta ?? record.with_theta);
  if (optionCount === null && withDelta === null && withMarketPrice === null && withTheta === null) {
    return undefined;
  }
  return {
    optionCount: optionCount ?? 0,
    withDelta: withDelta ?? 0,
    withMarketPrice: withMarketPrice ?? 0,
    withTheta: withTheta ?? 0,
  };
}

function normalizeEarningsEventsBySymbol(value: unknown): Record<string, IbkrHoldingEarningsEvent> {
  const record = asRecord(value);
  const result: Record<string, IbkrHoldingEarningsEvent> = {};
  for (const [symbol, rawEvent] of Object.entries(record)) {
    const event = normalizeHoldingEarnings(rawEvent);
    const cleanSymbol = firstString(symbol)?.toUpperCase();
    if (cleanSymbol && event) {
      result[cleanSymbol] = event;
    }
  }
  return result;
}

function normalizeHoldingEarnings(value: unknown): IbkrHoldingEarningsEvent | null {
  const record = asRecord(value);
  const date = firstString(record.date);
  const daysUntil = toNullableNumber(record.daysUntil ?? record.days_until);
  const warning = firstString(record.warning);
  if (!date || daysUntil === null || (warning !== "yellow" && warning !== "red")) {
    return null;
  }
  return {
    date,
    daysUntil,
    epsForecast: firstString(record.epsForecast, record.eps_forecast),
    fiscalQuarterEnding: firstString(record.fiscalQuarterEnding, record.fiscal_quarter_ending),
    name: firstString(record.name),
    source: firstString(record.source),
    time: firstString(record.time),
    warning,
  };
}
