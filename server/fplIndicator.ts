import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type {
  FplIndicatorBar,
  FplIndicatorManifest,
  FplIndicatorPayload,
  FplStructuralState,
} from "../shared/types.ts";

const PREDICTIONS_ROOT =
  process.env.FPL_PREDICTIONS_ROOT ??
  path.resolve(
    process.cwd(),
    "..",
    "analysis",
    "fpl_perbar_indicator",
    "stage6_production",
    "predictions_by_date",
  );

type CsvRow = Record<string, string>;

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value ?? "").trim();
  if (!cleaned || cleaned.toLowerCase() === "nan") return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function csvUnixTime(timestamp: string): number {
  // lightweight-charts always renders in UTC. We want the chart's axis to
  // show ET wall-clock (09:30 → 16:00), so shift the parsed UTC unix time
  // back by the source's UTC offset. The bar_ts string carries the offset,
  // e.g. '2024-01-02 09:30:00-05:00' (EST) or '...-04:00' (EDT).
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 0;
  const m = timestamp.match(/([+-])(\d{2}):(\d{2})$/);
  let offsetSec = 0;
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    offsetSec = sign * (parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60);
  }
  return Math.floor(parsed / 1000) + offsetSec;
}

function csvLabel(timestamp: string): string {
  // CSV bar_ts comes as e.g. '2026-04-21 09:30:00-04:00'
  const m = timestamp.match(/(\d{2}):(\d{2}):\d{2}/);
  return m ? `${m[1]}:${m[2]}` : timestamp.slice(11, 16);
}

function rowToBar(row: CsvRow): FplIndicatorBar {
  const timestamp = row.bar_ts;
  const structural: FplStructuralState = {
    isInOpenPosition: toNumber(row.is_in_open_position),
    nOpenPositions: toNumber(row.n_open_positions),
    minutesSinceOpen: toNumber(row.minutes_since_earliest_open),
    pnlPctProxy: toNumber(row.pnl_pct_proxy),
    prevClose: toNumber(row.prev_close),
    prevHigh: toNumber(row.prev_high),
    prevLow: toNumber(row.prev_low),
    distPdcPct: toNumber(row.dist_pdc_pct),
    distPdhPct: toNumber(row.dist_pdh_pct),
    distPdlPct: toNumber(row.dist_pdl_pct),
    gapToPdcPct: toNumber(row.gap_to_pdc_pct),
    cheatCode50Ema2m: toNumber(row.cc_50ema_2m),
    cheatCode50Sma2m: toNumber(row.cc_50sma_2m),
    cheatCode200Ema2m: toNumber(row.cc_200ema_2m),
    cheatCode200Sma2m: toNumber(row.cc_200sma_2m),
    distCc50Ema2m: toNumber(row.dist_cc_50ema_2m_pct),
    distCc200Ema2m: toNumber(row.dist_cc_200ema_2m_pct),
    hvCallPeak: toNumber(row.hv_call_peak_strike),
    hvCallLow: toNumber(row.hv_call_lo_strike),
    hvCallHigh: toNumber(row.hv_call_hi_strike),
    hvPutPeak: toNumber(row.hv_put_peak_strike),
    hvPutLow: toNumber(row.hv_put_lo_strike),
    hvPutHigh: toNumber(row.hv_put_hi_strike),
    insideHvContainment: toNumber(row.inside_hv_containment),
    oiCallPeak: toNumber(row.oi_call_peak_strike),
    oiCallLow: toNumber(row.oi_call_lo_strike),
    oiCallHigh: toNumber(row.oi_call_hi_strike),
    oiPutPeak: toNumber(row.oi_put_peak_strike),
    oiPutLow: toNumber(row.oi_put_lo_strike),
    oiPutHigh: toNumber(row.oi_put_hi_strike),
  };

  return {
    time: csvUnixTime(timestamp),
    label: csvLabel(timestamp),
    timestampEt: timestamp,
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    close: toNumber(row.close),
    pHold: toNumber(row.p_hold),
    pEnter: toNumber(row.p_enter),
    pScaleIn: toNumber(row.p_scale_in),
    pScaleOut: toNumber(row.p_scale_out),
    pExit: toNumber(row.p_exit),
    pSideBullish: toNumber(row.p_side_bullish_put_credit),
    pSideBearish: toNumber(row.p_side_bearish_call_credit),
    structural,
  };
}

async function loadCsvPayload(date: string): Promise<FplIndicatorPayload | null> {
  const csvPath = path.join(PREDICTIONS_ROOT, `predictions_${date}.csv`);
  if (!(await fileExists(csvPath))) return null;
  const raw = await fs.readFile(csvPath, "utf8");
  if (!raw.trim()) return null;
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as CsvRow[];
  const bars = rows.map(rowToBar).filter((bar) => bar.time > 0);
  bars.sort((a, b) => a.time - b.time);
  return {
    date,
    barsCount: bars.length,
    bars,
    isLive: false,
    fetchedAt: new Date().toISOString(),
  };
}

export async function loadFplIndicator(date: string, live: boolean): Promise<FplIndicatorPayload> {
  // Live predictions are produced out-of-band by analysis/fpl_perbar_indicator/
  // fpl_live_predict.py (streams IBKR SPX bars, appends to predictions_<date>.csv
  // + refreshes the manifest). The server just serves the latest CSV; in live
  // mode the client polls, and since we don't cache here each poll picks up the
  // newly appended bars.
  const payload = await loadCsvPayload(date);
  if (!payload) {
    throw new Error(`No predictions available for ${date}`);
  }
  payload.isLive = live;
  return payload;
}

export async function loadFplManifest(): Promise<FplIndicatorManifest> {
  const manifestPath = path.join(PREDICTIONS_ROOT, "_manifest.csv");
  let dates: string[] = [];
  if (await fileExists(manifestPath)) {
    const raw = await fs.readFile(manifestPath, "utf8");
    const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[];
    dates = rows.map((row) => row.date).filter(Boolean);
  } else if (await fileExists(PREDICTIONS_ROOT)) {
    const files = await fs.readdir(PREDICTIONS_ROOT);
    dates = files
      .filter((name) => name.startsWith("predictions_") && name.endsWith(".csv"))
      .map((name) => name.replace(/^predictions_/, "").replace(/\.csv$/, ""))
      .sort();
  }
  return { dates, count: dates.length, root: PREDICTIONS_ROOT };
}
