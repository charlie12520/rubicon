// Relative Rotation Graph (RRG) math — a self-contained, dependency-free core.
//
// An RRG plots a basket of securities against a benchmark on two axes:
//   x = JdK RS-Ratio     (relative-strength trend, centred on 100)
//   y = JdK RS-Momentum  (momentum of that relative strength, centred on 100)
// which carves the plane into four quadrants the securities rotate through,
// usually clockwise: Leading → Weakening → Lagging → Improving → Leading …
//
// The original JdK formulas are proprietary, so this uses the widely-reproduced
// rolling-z-score construction (deterministic and fully tunable):
//   rs[t]          = 100 · close_security[t] / close_benchmark[t]
//   rsRatio[t]     = 100 + zScore(rs, ratioWindow)[t]
//   rsMomentum[t]  = 100 + zScore(Δ rsRatio, momentumWindow)[t]
// Both axes therefore sit at ~100 when a security tracks the benchmark, and the
// window lengths are the user-facing tuning knobs.

export type DailyBar = {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
};

export type Timeframe = "daily" | "weekly";

export type RrgQuadrant = "leading" | "weakening" | "lagging" | "improving";

/** Benchmark: an existing symbol, or a synthetic equal-weight basket of symbols. */
export type BenchmarkSpec =
  | { kind: "symbol"; symbol: string }
  | { kind: "basket"; symbols?: string[]; label?: string };

export type RrgOptions = {
  barsBySymbol: Record<string, DailyBar[]>;
  /** Securities to plot (the benchmark symbol is skipped automatically). */
  symbols: string[];
  benchmark: BenchmarkSpec;
  timeframe?: Timeframe;
  /** Normalisation lookback for RS-Ratio. Default 12 (weekly) / 50 (daily). */
  ratioWindow?: number;
  /** Normalisation lookback for RS-Momentum. Default 10 (weekly) / 20 (daily). */
  momentumWindow?: number;
  /** Optional SMA applied to RS before normalising (1 = off). Default 1. */
  smoothing?: number;
  /** Points kept in each visible tail. Default 8. */
  tailLength?: number;
  /** Analysis end date (inclusive). Default = latest benchmark date. */
  asOf?: string;
};

export type RrgPoint = {
  date: string;
  rsRatio: number;
  rsMomentum: number;
  quadrant: RrgQuadrant;
};

export type RrgSeries = {
  symbol: string;
  /** Chronological tail, length ≤ tailLength; last element is the current head. */
  points: RrgPoint[];
  head: RrgPoint;
  quadrant: RrgQuadrant;
};

export type RrgSkip = { symbol: string; reason: string };

export type RrgResult = {
  series: RrgSeries[];
  /** All benchmark dates available at the chosen timeframe (the scrub axis). */
  dates: string[];
  benchmarkLabel: string;
  timeframe: Timeframe;
  ratioWindow: number;
  momentumWindow: number;
  smoothing: number;
  tailLength: number;
  asOf: string;
  skipped: RrgSkip[];
};

export const RRG_QUADRANT_LABEL: Record<RrgQuadrant, string> = {
  leading: "Leading",
  weakening: "Weakening",
  lagging: "Lagging",
  improving: "Improving",
};

export function quadrantOf(rsRatio: number, rsMomentum: number): RrgQuadrant {
  const strong = rsRatio >= 100;
  const rising = rsMomentum >= 100;
  if (strong && rising) return "leading";
  if (strong && !rising) return "weakening";
  if (!strong && rising) return "improving";
  return "lagging";
}

export function defaultWindows(timeframe: Timeframe): { ratioWindow: number; momentumWindow: number } {
  return timeframe === "daily"
    ? { ratioWindow: 50, momentumWindow: 20 }
    : { ratioWindow: 12, momentumWindow: 10 };
}

// ── numeric helpers ──────────────────────────────────────────────────────────

function sma(values: number[], window: number): Array<number | null> {
  if (window <= 1) return values.slice();
  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

/**
 * Trailing rolling z-score with sample (n-1) std. null during warm-up; 0 when
 * the window is flat (std ≈ 0) so a dead-flat ratio reads as neutral, not NaN.
 */
export function rollingZScore(values: Array<number | null>, window: number): Array<number | null> {
  const win = Math.max(2, Math.floor(window));
  const out: Array<number | null> = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    if (i < win - 1) continue;
    let n = 0;
    let mean = 0;
    let m2 = 0; // Welford
    let valid = true;
    for (let j = i - win + 1; j <= i; j += 1) {
      const v = values[j];
      if (v === null || !Number.isFinite(v)) {
        valid = false;
        break;
      }
      n += 1;
      const delta = v - mean;
      mean += delta / n;
      m2 += delta * (v - mean);
    }
    if (!valid || n < 2) continue;
    const std = Math.sqrt(m2 / (n - 1));
    const current = values[i] as number;
    out[i] = std < 1e-9 ? 0 : (current - mean) / std;
  }
  return out;
}

// ── weekly resampling ────────────────────────────────────────────────────────

/** ISO-week key (e.g. "2026-W05") so weekly buckets are stable across years. */
function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Aggregate daily bars into weekly OHLCV bars dated on the week's last session. */
export function resampleWeekly(bars: DailyBar[]): DailyBar[] {
  const buckets = new Map<string, DailyBar[]>();
  for (const bar of bars) {
    const key = isoWeekKey(bar.date);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(bar);
    else buckets.set(key, [bar]);
  }
  const weekly: DailyBar[] = [];
  for (const bucket of buckets.values()) {
    const ordered = bucket.slice().sort((a, b) => a.date.localeCompare(b.date));
    const last = ordered[ordered.length - 1];
    weekly.push({
      date: last.date,
      open: ordered[0].open,
      high: Math.max(...ordered.map((b) => b.high)),
      low: Math.min(...ordered.map((b) => b.low)),
      close: last.close,
      volume: ordered.reduce((sum, b) => sum + (b.volume ?? 0), 0),
    });
  }
  return weekly.sort((a, b) => a.date.localeCompare(b.date));
}

function framed(bars: DailyBar[], timeframe: Timeframe): DailyBar[] {
  const sorted = bars.slice().sort((a, b) => a.date.localeCompare(b.date));
  return timeframe === "weekly" ? resampleWeekly(sorted) : sorted;
}

function closeMap(bars: DailyBar[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const bar of bars) {
    if (Number.isFinite(bar.close) && bar.close > 0) map.set(bar.date, bar.close);
  }
  return map;
}

// ── benchmark construction ───────────────────────────────────────────────────

/**
 * Equal-weight basket index (rebased to 100 at the first shared date), built
 * from the constituents present on every shared date. Lets users rotate against
 * "the group" when no index symbol is in the dataset.
 */
export function buildBasketCloses(
  barsBySymbol: Record<string, DailyBar[]>,
  symbols: string[],
  timeframe: Timeframe,
): DailyBar[] {
  const framedBySymbol = symbols
    .map((symbol) => ({ symbol, bars: barsBySymbol[symbol] ? framed(barsBySymbol[symbol], timeframe) : [] }))
    .filter((entry) => entry.bars.length > 0);
  if (framedBySymbol.length === 0) return [];

  const maps = framedBySymbol.map((entry) => closeMap(entry.bars));
  let common: string[] | null = null;
  for (const map of maps) {
    const dates = [...map.keys()];
    common = common === null ? dates : common.filter((d) => map.has(d));
  }
  const dates = (common ?? []).sort((a, b) => a.localeCompare(b));
  if (dates.length === 0) return [];

  const first = maps.map((map) => map.get(dates[0]) as number);
  return dates.map((date) => {
    let acc = 0;
    for (let i = 0; i < maps.length; i += 1) {
      acc += (maps[i].get(date) as number) / first[i];
    }
    const value = (acc / maps.length) * 100;
    return { date, open: value, high: value, low: value, close: value, volume: null };
  });
}

function resolveBenchmark(opts: RrgOptions): { closes: Map<string, number>; dates: string[]; label: string } {
  const timeframe = opts.timeframe ?? "weekly";
  if (opts.benchmark.kind === "symbol") {
    const bars = opts.barsBySymbol[opts.benchmark.symbol];
    const framedBars = bars ? framed(bars, timeframe) : [];
    return {
      closes: closeMap(framedBars),
      dates: framedBars.map((b) => b.date),
      label: opts.benchmark.symbol,
    };
  }
  const constituents =
    opts.benchmark.symbols && opts.benchmark.symbols.length > 0 ? opts.benchmark.symbols : opts.symbols;
  const basket = buildBasketCloses(opts.barsBySymbol, constituents, timeframe);
  return {
    closes: closeMap(basket),
    dates: basket.map((b) => b.date),
    label: opts.benchmark.label ?? `Equal-weight (${constituents.length})`,
  };
}

// ── main entry point ─────────────────────────────────────────────────────────

export function computeRrg(opts: RrgOptions): RrgResult {
  const timeframe = opts.timeframe ?? "weekly";
  const fallback = defaultWindows(timeframe);
  const ratioWindow = Math.max(2, Math.floor(opts.ratioWindow ?? fallback.ratioWindow));
  const momentumWindow = Math.max(2, Math.floor(opts.momentumWindow ?? fallback.momentumWindow));
  const smoothing = Math.max(1, Math.floor(opts.smoothing ?? 1));
  const tailLength = Math.max(1, Math.floor(opts.tailLength ?? 8));

  const bench = resolveBenchmark(opts);
  const benchDates = bench.dates.slice().sort((a, b) => a.localeCompare(b));
  const asOf = resolveAsOf(benchDates, opts.asOf);

  const benchSymbol = opts.benchmark.kind === "symbol" ? opts.benchmark.symbol : null;
  const skipped: RrgSkip[] = [];
  const series: RrgSeries[] = [];

  for (const symbol of opts.symbols) {
    if (benchSymbol && symbol === benchSymbol) {
      skipped.push({ symbol, reason: "is benchmark" });
      continue;
    }
    const bars = opts.barsBySymbol[symbol];
    if (!bars || bars.length === 0) {
      skipped.push({ symbol, reason: "no data" });
      continue;
    }

    const symbolCloses = closeMap(framed(bars, timeframe));
    // Align on dates shared with the benchmark, up to the as-of cutoff.
    const dates = [...symbolCloses.keys()]
      .filter((d) => bench.closes.has(d) && d <= asOf)
      .sort((a, b) => a.localeCompare(b));

    const minHistory = ratioWindow + momentumWindow + smoothing;
    if (dates.length < minHistory) {
      skipped.push({ symbol, reason: `needs ${minHistory} ${timeframe} bars, has ${dates.length}` });
      continue;
    }

    const rsRaw = dates.map((d) => 100 * (symbolCloses.get(d) as number) / (bench.closes.get(d) as number));
    const rs = sma(rsRaw, smoothing);
    const ratioZ = rollingZScore(rs, ratioWindow);
    const rsRatio = ratioZ.map((z) => (z === null ? null : 100 + z));

    // Momentum = normalised change in the RS-Ratio line.
    const ratioDelta: Array<number | null> = rsRatio.map((value, i) =>
      i === 0 || value === null || rsRatio[i - 1] === null ? null : value - (rsRatio[i - 1] as number),
    );
    const momentumZ = rollingZScore(ratioDelta, momentumWindow);
    const rsMomentum = momentumZ.map((z) => (z === null ? null : 100 + z));

    const points: RrgPoint[] = [];
    for (let i = 0; i < dates.length; i += 1) {
      const ratio = rsRatio[i];
      const momentum = rsMomentum[i];
      if (ratio === null || momentum === null) continue;
      points.push({ date: dates[i], rsRatio: ratio, rsMomentum: momentum, quadrant: quadrantOf(ratio, momentum) });
    }
    if (points.length === 0) {
      skipped.push({ symbol, reason: "no normalised points" });
      continue;
    }

    const tail = points.slice(-tailLength);
    const head = tail[tail.length - 1];
    series.push({ symbol, points: tail, head, quadrant: head.quadrant });
  }

  series.sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    series,
    dates: benchDates,
    benchmarkLabel: bench.label,
    timeframe,
    ratioWindow,
    momentumWindow,
    smoothing,
    tailLength,
    asOf,
    skipped,
  };
}

function resolveAsOf(benchDates: string[], requested?: string): string {
  if (benchDates.length === 0) return requested ?? "";
  const last = benchDates[benchDates.length - 1];
  if (!requested) return last;
  // Snap to the latest benchmark date at or before the request.
  let resolved = benchDates[0];
  for (const date of benchDates) {
    if (date <= requested) resolved = date;
    else break;
  }
  return resolved;
}

/** Axis bounds padded around the data, always symmetric about 100. */
export function rrgBounds(series: RrgSeries[], pad = 0.4): { min: number; max: number } {
  let maxAbs = 1;
  for (const s of series) {
    for (const p of s.points) {
      maxAbs = Math.max(maxAbs, Math.abs(p.rsRatio - 100), Math.abs(p.rsMomentum - 100));
    }
  }
  const span = maxAbs * (1 + pad);
  return { min: 100 - span, max: 100 + span };
}
