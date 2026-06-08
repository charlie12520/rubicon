/**
 * Moving-average helpers for the replay chart overlays ("cheat code": 50/200
 * EMA + SMA). All functions are pure and operate on a plain value series so they
 * can be unit-tested without any chart dependency.
 */

import type { MaOverlay } from "./components/MarketChart";

export type MaKind = "ema" | "sma";

export type MovingAverageOptions = {
  minPeriods?: number;
};

/**
 * Simple moving average. Emits `null` for the first `period - 1` points (not
 * enough history yet) and the rolling mean thereafter. A smaller `minPeriods`
 * matches the FPL cheat-code warmup, averaging available history until the full
 * window exists.
 */
export function sma(values: number[], period: number, options: MovingAverageOptions = {}): Array<number | null> {
  const minPeriods = options.minPeriods ?? period;
  if (period <= 0 || minPeriods <= 0) {
    return values.map(() => null);
  }
  const out: Array<number | null> = [];
  let sum = 0;
  const window: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    window.push(value);
    sum += value;
    if (window.length > period) {
      sum -= window.shift() ?? 0;
    }
    out.push(window.length >= minPeriods ? sum / window.length : null);
  }
  return out;
}

/**
 * Exponential moving average, seeded at the first value so the line is drawn
 * from the start of the visible series (it converges toward a "true" EMA as more
 * bars arrive). `minPeriods` can hide the initial warmup points while preserving
 * the same recursive EMA state, matching pandas `ewm(..., min_periods=N)`.
 */
export function ema(values: number[], period: number, options: MovingAverageOptions = {}): Array<number | null> {
  const minPeriods = options.minPeriods ?? 1;
  if (period <= 0 || values.length === 0) {
    return values.map(() => null);
  }
  const k = 2 / (period + 1);
  const out: Array<number | null> = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i += 1) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(i + 1 >= minPeriods ? prev : null);
  }
  return out;
}

export function movingAverage(values: number[], kind: MaKind, period: number, options: MovingAverageOptions = {}): Array<number | null> {
  return kind === "ema" ? ema(values, period, options) : sma(values, period, options);
}

/**
 * Build a chart-ready line ({ time, value }[]) for one moving average from a
 * time/value series, dropping points where the average is undefined or
 * non-finite so the chart only draws the segment that actually exists.
 */
export function maLine(
  points: Array<{ time: number; value: number }>,
  kind: MaKind,
  period: number,
  options: MovingAverageOptions = {},
): Array<{ time: number; value: number }> {
  const series = movingAverage(
    points.map((point) => point.value),
    kind,
    period,
    options,
  );
  const out: Array<{ time: number; value: number }> = [];
  for (let i = 0; i < points.length; i += 1) {
    const value = series[i];
    if (value !== null && Number.isFinite(value)) {
      out.push({ time: points[i].time, value });
    }
  }
  return out;
}

/**
 * "Cheat code" overlay set: all four moving averages or none. Color encodes the
 * period (50 = amber, 200 = orange), line style encodes the type (EMA solid, SMA
 * dashed). The whole set toggles together — individual MAs are not user-selectable.
 */
export const CHEAT_MA_SPECS = [
  { id: "ema50", label: "50 EMA", kind: "ema", period: 50, color: "#eab308", dashed: false },
  { id: "sma50", label: "50 SMA", kind: "sma", period: 50, color: "#eab308", dashed: true },
  { id: "ema200", label: "200 EMA", kind: "ema", period: 200, color: "#f97316", dashed: false },
  { id: "sma200", label: "200 SMA", kind: "sma", period: 200, color: "#f97316", dashed: true },
] as const satisfies ReadonlyArray<{ id: string; label: string; kind: MaKind; period: number; color: string; dashed: boolean }>;

/**
 * Build the cheat-code MA overlays for one displayed session, warm-started from a
 * trailing window of prior-session closes at the SAME timeframe. The MA is computed
 * over `[...warmupCloses, ...sessionCloses]` with `minPeriods = period`, so each
 * line is a TRUE full-period 50/200 — not a partial average of the short visible
 * session. Only the session slice is returned (the warmup bars are not drawn), and
 * each overlay point reuses the corresponding session bar's `time` so the line
 * aligns exactly with the rendered candles. With insufficient warmup the line is
 * simply shorter or absent rather than a misleading partial.
 */
export function buildWarmedCheatOverlays(
  sessionBars: Array<{ time: number; close: number }>,
  warmupCloses: number[],
): MaOverlay[] {
  if (!sessionBars.length) {
    return [];
  }
  const closes = [...warmupCloses, ...sessionBars.map((bar) => bar.close)];
  const offset = warmupCloses.length;
  return CHEAT_MA_SPECS.map((spec) => {
    const series = movingAverage(closes, spec.kind, spec.period, { minPeriods: spec.period });
    const data: Array<{ time: number; value: number }> = [];
    for (let i = 0; i < sessionBars.length; i += 1) {
      const value = series[offset + i];
      if (value !== null && Number.isFinite(value)) {
        data.push({ time: sessionBars[i].time, value });
      }
    }
    return { id: spec.id, label: spec.label, color: spec.color, dashed: spec.dashed, data };
  }).filter((overlay) => overlay.data.length > 0);
}
