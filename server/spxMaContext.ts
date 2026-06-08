import type { SpxBar, SpxMaContextPayload } from "../shared/types.ts";
import { resampleBars } from "../shared/resampleBars.ts";
import { loadSafeSpxBars, tradeDates } from "./dataImporter.ts";

// Timeframes the charts offer (Daily Review: 1/2/5/15/30m; Replay: 2/5m).
const DEFAULT_INTERVALS = [1, 2, 5, 15, 30];
// 700 closes warms a true 200 SMA (needs 200) and converges a 200 EMA to <1% seed
// influence (k = 2/201 ⇒ ~460 bars). At 30m (~13 bars/session) that's ~54 prior
// sessions; at 1m only ~2.
const DEFAULT_WARMUP_BARS = 700;
// Hard cap on how many prior session folders to read, so a sparse coarse timeframe
// can't walk the entire history.
const MAX_SESSIONS = 150;

type LoadOptions = {
  intervals?: number[];
  warmupBars?: number;
  maxSessions?: number;
  // Injectable for tests; default to the on-disk trade-date folders.
  listDates?: () => Promise<string[]>;
  loadBars?: (date: string) => Promise<SpxBar[]>;
};

const cache = new Map<string, SpxMaContextPayload>();

export function clearSpxMaContextCache(): void {
  cache.clear();
}

/**
 * Assemble a trailing window of SPX closes resampled to each chart timeframe from
 * the sessions strictly BEFORE `date` (newest→oldest until the coarsest timeframe
 * has enough warmup, then stop). Excluding `date` itself avoids look-ahead. Result
 * is cached in-memory per date. Returns oldest→newest closes per interval.
 */
export async function loadSpxMaContext(date: string, options: LoadOptions = {}): Promise<SpxMaContextPayload> {
  const listDates = options.listDates ?? tradeDates;
  // Use the SAME loader the Daily Review / Replay charts display from
  // (loadSafeSpxBars → SPX sidecar CSVs), not loadSpxBars (payload-JSON tab), so the
  // MA warmup is computed from the exact SPX series drawn on the chart and never
  // misses a session the chart has (the two sources can diverge for recent days).
  const loadBars = options.loadBars ?? loadSafeSpxBars;
  const useCache = !options.listDates && !options.loadBars;

  const cached = useCache ? cache.get(date) : undefined;
  if (cached) {
    return cached;
  }

  const intervals = options.intervals ?? DEFAULT_INTERVALS;
  const warmupBars = options.warmupBars ?? DEFAULT_WARMUP_BARS;
  const maxSessions = options.maxSessions ?? MAX_SESSIONS;
  const coarsest = Math.max(...intervals);

  const priorDates = (await listDates())
    .filter((candidate) => candidate < date)
    .sort((a, b) => (a < b ? 1 : -1)); // newest first

  const sessionBars: SpxBar[][] = []; // newest-first while collecting
  let throughDate: string | null = null;
  let coarseCount = 0;

  for (const priorDate of priorDates) {
    if (sessionBars.length >= maxSessions || coarseCount >= warmupBars) {
      break;
    }
    let bars: SpxBar[] = [];
    try {
      bars = await loadBars(priorDate);
    } catch {
      bars = [];
    }
    if (!bars.length) {
      continue;
    }
    sessionBars.push(bars);
    throughDate = throughDate ?? priorDate; // newest session actually used
    coarseCount += resampleBars(bars, coarsest).length;
  }

  sessionBars.reverse(); // oldest-first → chronological closes

  const byInterval: Record<string, number[]> = {};
  for (const interval of intervals) {
    const closes = sessionBars.flatMap((bars) => resampleBars(bars, interval).map((bar) => bar.close));
    byInterval[String(interval)] = closes.length > warmupBars ? closes.slice(closes.length - warmupBars) : closes;
  }

  const payload: SpxMaContextPayload = { date, throughDate, byInterval };
  if (useCache) {
    cache.set(date, payload);
  }
  return payload;
}
