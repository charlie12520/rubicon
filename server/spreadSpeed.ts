// Spread-speed engine: applies the net-delta ("speed") rule to a date's SPXW 0DTE chain
// and returns a per-minute series the replay scrubber can read.
//   net_delta = |N(d1_short) - N(d1_long)|  (= dV/dS, the $ moved per index point; x100 per 1-lot)
//   EM = 1.2533 x ATM straddle ;  speed ceiling = ~2/EM (hit at ATM)
//   FAST >= 0.05 ($5/pt) | MED 0.02-0.05 | DEAD < 0.02 ;  recommended = OTM spread nearest 0.05.
import path from "node:path";
import {
  IBKR_TRADES_ROOT,
  loadSafeSpxBars,
  optionLegTradeCsvCandidates,
  readCsv,
  safeSpxCsvCandidates,
  tradeDates,
} from "./dataImporter.ts";
import { firstExistingPath, mtimeMs, readJson, writeJsonAtomic } from "./jsonStore.ts";
import type { SpreadSpeedFrame, SpreadSpeedPayload, SpreadSpeedPick, SpreadSpeedRow, SpxBar } from "../shared/types.ts";

const MIN_PER_YEAR = 252 * 390;
const WIDTH = 5;
export const TARGET_NET_DELTA = 0.05; // the live "frontier" edge a credit seller wants
export const FAST = 0.05;
const MED = 0.02;
const EM_PER_STRADDLE = 1.2533;
const SPREAD_SPEED_STATE_FILE = "rubicon_spread_speed_state.json";
const SPREAD_SPEED_STATE_SCHEMA = "rubicon-spread-speed-state";
const SPREAD_SPEED_STATE_VERSION = 1;

type CsvRow = Record<string, string>;

type SpreadSpeedLoadOptions = {
  refreshSafeState?: boolean;
};

type SpreadSpeedStateSourceFile = {
  path: string | null;
  mtimeMs: number | null;
};

type SpreadSpeedStateSource = Record<"spx" | "optionLegs", SpreadSpeedStateSourceFile>;

type SpreadSpeedStateCache = {
  generatedAt: string;
  payload: SpreadSpeedPayload;
  projection: {
    optionLegs: string;
    spxBars: string;
  };
  schema: typeof SPREAD_SPEED_STATE_SCHEMA;
  source: SpreadSpeedStateSource;
  version: typeof SPREAD_SPEED_STATE_VERSION;
};

function normCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 (|error| < 7.5e-8)
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}
function callNd1(S: number, K: number, T: number, sig: number): number {
  if (T <= 0 || sig <= 0) return S > K ? 1 : 0;
  return normCdf((Math.log(S / K) + 0.5 * sig * sig * T) / (sig * Math.sqrt(T)));
}
function minutesToClose(label: string): number {
  const [h, m] = label.split(":").map(Number);
  return Math.max(960 - (h * 60 + m), 1); // 16:00 = 960 min
}
function regimeOf(nd: number): SpreadSpeedRow["regime"] {
  return nd >= FAST ? "FAST" : nd >= MED ? "MED" : "DEAD";
}
function round(x: number, n = 2): number {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

type ChainSide = Map<number, number>; // strike -> last price

async function firstCsvWithRows(candidates: string[]): Promise<{ path: string | null; rows: CsvRow[] }> {
  for (const candidate of candidates) {
    const rows = await readCsv(candidate);
    if (rows.length) {
      return { path: candidate, rows };
    }
  }
  return { path: null, rows: [] };
}

function spreadSpeedStatePath(date: string): string {
  return path.join(IBKR_TRADES_ROOT, date, SPREAD_SPEED_STATE_FILE);
}

async function spreadSpeedStateSource(date: string): Promise<SpreadSpeedStateSource> {
  const spx = await firstExistingPath(safeSpxCsvCandidates(date));
  const optionLegs = await firstExistingPath(optionLegTradeCsvCandidates(date));
  return {
    optionLegs: { path: optionLegs, mtimeMs: await mtimeMs(optionLegs) },
    spx: { path: spx, mtimeMs: await mtimeMs(spx) },
  };
}

function sameSpreadSpeedStateSource(left: SpreadSpeedStateSource, right: SpreadSpeedStateSource): boolean {
  return (Object.keys(left) as Array<keyof SpreadSpeedStateSource>).every(
    (key) => left[key].path === right[key]?.path && left[key].mtimeMs === right[key]?.mtimeMs,
  );
}

function isSpreadSpeedStateCache(value: SpreadSpeedStateCache | null, source: SpreadSpeedStateSource): value is SpreadSpeedStateCache {
  return Boolean(
    value &&
      value.schema === SPREAD_SPEED_STATE_SCHEMA &&
      value.version === SPREAD_SPEED_STATE_VERSION &&
      value.payload &&
      sameSpreadSpeedStateSource(value.source, source),
  );
}

function pick(rows: SpreadSpeedRow[], wantNearTarget: boolean): SpreadSpeedPick {
  const otm = rows.filter((r) => r.distEm > 0);
  const pool = otm.length ? otm : rows;
  if (!pool.length) return null;
  const chosen = wantNearTarget
    ? pool.reduce((a, b) => (Math.abs(b.netDelta - TARGET_NET_DELTA) < Math.abs(a.netDelta - TARGET_NET_DELTA) ? b : a))
    : pool.reduce((a, b) => (b.netDelta > a.netDelta ? b : a));
  return {
    shortStrike: chosen.shortStrike,
    longStrike: chosen.longStrike,
    netDelta: chosen.netDelta,
    dollarPerPoint: chosen.dollarPerPoint,
    shortDelta: chosen.shortDelta,
    regime: chosen.regime,
    value: chosen.value,
  };
}

function atmStraddle(spot: number, calls: ChainSide, puts: ChainSide): { straddle: number; k: number } | null {
  const base = Math.round(spot / 5) * 5;
  for (const off of [0, 5, -5, 10, -10, 15, -15]) {
    const k = base + off;
    const c = calls.get(k);
    const p = puts.get(k);
    if (c != null && p != null && c > 0 && p > 0) return { straddle: c + p, k };
  }
  return null;
}

export function buildFrame(label: string, spot: number, calls: ChainSide, puts: ChainSide): SpreadSpeedFrame | null {
  const atm = atmStraddle(spot, calls, puts);
  if (!atm) return null;
  const tMin = minutesToClose(label);
  const T = tMin / MIN_PER_YEAR;
  const sig = Math.min(Math.max(atm.straddle / (spot * Math.sqrt((2 * T) / Math.PI)), 0.02), 4);
  const em = EM_PER_STRADDLE * atm.straddle;
  const base = Math.round(spot / 5) * 5;

  const make = (side: "PCS" | "CCS"): SpreadSpeedRow[] => {
    const rows: SpreadSpeedRow[] = [];
    for (let off = 0; off <= 45; off += 5) {
      const Ks = side === "PCS" ? base - off : base + off;
      const Kl = side === "PCS" ? Ks - WIDTH : Ks + WIDTH;
      const Ns = callNd1(spot, Ks, T, sig);
      const Nl = callNd1(spot, Kl, T, sig);
      const netDelta = Math.abs(Ns - Nl);
      const shortDelta = side === "PCS" ? Math.abs(Ns - 1) : Math.abs(Ns);
      const tab = side === "PCS" ? puts : calls;
      const cs = tab.get(Ks);
      const cl = tab.get(Kl);
      const value = cs != null && cl != null ? round(cs - cl) : null;
      rows.push({
        side,
        shortStrike: Ks,
        longStrike: Kl,
        shortDelta: round(shortDelta, 3),
        netDelta: round(netDelta, 4),
        dollarPerPoint: round(netDelta * 100, 1),
        regime: regimeOf(netDelta),
        distEm: round((side === "PCS" ? spot - Ks : Ks - spot) / em, 2),
        value,
      });
    }
    return rows;
  };

  const pcs = make("PCS");
  const ccs = make("CCS");
  const fastK = (rows: SpreadSpeedRow[]) => rows.filter((r) => r.regime === "FAST").map((r) => r.shortStrike);
  const pf = fastK(pcs);
  const cf = fastK(ccs);
  return {
    label,
    minutesToClose: tMin,
    spot: round(spot, 1),
    atmStraddle: round(atm.straddle, 2),
    em: round(em, 1),
    speedCeiling: round(2 / em, 3),
    pcs,
    ccs,
    recommendPcs: pick(pcs, true),
    recommendCcs: pick(ccs, true),
    fastestPcs: pick(pcs, false),
    fastestCcs: pick(ccs, false),
    pcsFastLow: pf.length ? Math.min(...pf) : null,
    pcsFastHigh: pf.length ? Math.max(...pf) : null,
    ccsFastLow: cf.length ? Math.min(...cf) : null,
    ccsFastHigh: cf.length ? Math.max(...cf) : null,
  };
}

function collapseBarsToMinutes(bars: SpxBar[]): SpxBar[] {
  const byLabel = new Map<string, SpxBar>();
  for (const bar of [...bars].sort((a, b) => a.time - b.time)) {
    if (bar.label) {
      byLabel.set(bar.label, bar);
    }
  }
  return [...byLabel.values()];
}

function buildSpreadSpeedPayload(date: string, bars: SpxBar[], legRows: CsvRow[]): SpreadSpeedPayload {
  const generatedAt = new Date().toISOString();
  const meta = { date, generatedAt, targetNetDelta: TARGET_NET_DELTA, fastThreshold: FAST };
  const contractMonth = date.replace(/-/g, "");
  const minuteBars = collapseBarsToMinutes(bars);

  type Leg = { label: string; strike: number; right: string; close: number };
  const legs: Leg[] = [];
  for (const r of legRows) {
    if (String(r.trading_class) !== "SPXW") continue;
    if (String(r.last_trade_date_or_contract_month) !== contractMonth) continue;
    const strike = Number(r.strike);
    const close = Number(r.close);
    const ts = String(r.timestamp_et ?? "");
    if (!Number.isFinite(strike) || !Number.isFinite(close) || close <= 0 || ts.length < 16) continue;
    legs.push({ label: ts.slice(11, 16), strike, right: String(r.right), close });
  }
  if (!minuteBars.length || !legs.length) {
    return { ...meta, available: false, note: minuteBars.length ? "No SPXW 0DTE option-leg data for this date." : "No SPX intraday bars for this date.", frames: [] };
  }
  legs.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  // forward-fill the chain onto each SPX bar (both on the "HH:MM" minute grid)
  const calls: ChainSide = new Map();
  const puts: ChainSide = new Map();
  let li = 0;
  const frames: SpreadSpeedFrame[] = [];
  for (const bar of minuteBars) {
    while (li < legs.length && legs[li].label <= bar.label) {
      const leg = legs[li];
      (leg.right === "C" ? calls : puts).set(leg.strike, leg.close);
      li += 1;
    }
    const frame = buildFrame(bar.label, bar.close, calls, puts);
    if (frame) frames.push(frame);
  }
  return {
    ...meta,
    available: frames.length > 0,
    note: frames.length ? "" : "Could not assemble an ATM straddle for any minute.",
    frames,
  };
}

async function buildSafeSpreadSpeedPayload(date: string): Promise<SpreadSpeedPayload> {
  const [bars, optionLegs] = await Promise.all([
    loadSafeSpxBars(date),
    firstCsvWithRows(optionLegTradeCsvCandidates(date)),
  ]);
  return buildSpreadSpeedPayload(date, bars, optionLegs.rows);
}

async function loadOrBuildSpreadSpeedState(date: string, options: { refresh?: boolean } = {}): Promise<SpreadSpeedPayload> {
  const source = await spreadSpeedStateSource(date);
  const cachePath = spreadSpeedStatePath(date);
  if (!options.refresh) {
    const cached = await readJson<SpreadSpeedStateCache | null>(cachePath, null);
    if (isSpreadSpeedStateCache(cached, source)) {
      return cached.payload;
    }
  }

  const payload = await buildSafeSpreadSpeedPayload(date);
  if (source.spx.path || source.optionLegs.path) {
    const cache: SpreadSpeedStateCache = {
      generatedAt: new Date().toISOString(),
      payload,
      projection: {
        optionLegs: "first available option-leg trade sidecar CSV",
        spxBars: "first available SPX sidecar or IBKR underlying CSV; never falls back to google_sheet_upload_payload.json",
      },
      schema: SPREAD_SPEED_STATE_SCHEMA,
      source,
      version: SPREAD_SPEED_STATE_VERSION,
    };
    await writeJsonAtomic(cachePath, cache);
  }
  return payload;
}

export async function refreshSpreadSpeedState(_ibkrTradesRoot: string, date: string): Promise<SpreadSpeedPayload> {
  return loadOrBuildSpreadSpeedState(date, { refresh: true });
}

export async function loadSpreadSpeed(date: string, options: SpreadSpeedLoadOptions = {}): Promise<SpreadSpeedPayload> {
  return loadOrBuildSpreadSpeedState(date, { refresh: options.refreshSafeState });
}

// How many prior trade-dates to probe when the requested day has no assembled
// frame. Trade-dates are sparse (market days only), so 10 covers ~2 weeks.
const MAX_FALLBACK_LOOKBACK = 10;

// Like loadSpreadSpeed, but when the requested date has no assembled frame (e.g.
// today, before the post-close pull lands its CSV sidecars), walk back to the
// most recent earlier session that does, so the Signal Stack shows the last real
// picks instead of a dead-end. Tags the payload with the originally requested
// date and whether a fallback occurred.
export async function loadSpreadSpeedWithFallback(
  date: string,
  options: SpreadSpeedLoadOptions = {},
): Promise<SpreadSpeedPayload> {
  const primary = await loadSpreadSpeed(date, options);
  if (primary.available) {
    return { ...primary, requestedDate: date, fallback: false };
  }
  const earlier = (await tradeDates()).filter((candidate) => candidate < date).sort((a, b) => (a < b ? 1 : -1));
  for (const candidate of earlier.slice(0, MAX_FALLBACK_LOOKBACK)) {
    const payload = await loadSpreadSpeed(candidate);
    if (payload.available) {
      return { ...payload, requestedDate: date, fallback: true };
    }
  }
  return { ...primary, requestedDate: date, fallback: false };
}
