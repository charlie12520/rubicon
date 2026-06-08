// Trailing-window % change for the intraday heatmap. The per-minute series
// (pctByTime) is each stock's % vs the PRIOR CLOSE, so the move over a window of w
// minutes ending at minute i is price[i]/price[i-w] - 1 — recoverable from the two
// prior-close readings with no extra data:
//   price[i] / price[j] = (1 + p_i/100) / (1 + p_j/100)   (j = i - w)
// where p_i = pctByTime[i], p_j = pctByTime[j].

export type HeatmapTimeframe = "gap" | "day" | "4h" | "1h" | "30m" | "5m";

export type HeatmapTimeframeDef = {
  key: HeatmapTimeframe;
  label: string;
  minutes: number; // trailing window length; 0 = the whole-day move vs prior close
  cap: number; // heatmapColor saturation (±cap %); tighter for shorter windows
  gap?: boolean; // the opening gap (open vs prior close), fixed for the day — ignores the scrubbed minute
};

// Ordered for the selector: the opening Gap, the full Day, then trailing windows
// (4H → 5M). Caps shrink with the window so a short move (typically a few tenths of
// a %) still spreads across the green↔red scale instead of all reading grey.
export const HEATMAP_TIMEFRAMES: HeatmapTimeframeDef[] = [
  { key: "gap", label: "Gap", minutes: 0, cap: 3, gap: true },
  { key: "day", label: "Day", minutes: 0, cap: 3 },
  { key: "4h", label: "4H", minutes: 240, cap: 2.5 },
  { key: "1h", label: "1H", minutes: 60, cap: 1.5 },
  { key: "30m", label: "30M", minutes: 30, cap: 1 },
  { key: "5m", label: "5M", minutes: 5, cap: 0.5 },
];

export function timeframeDef(key: HeatmapTimeframe): HeatmapTimeframeDef {
  return (
    HEATMAP_TIMEFRAMES.find((t) => t.key === key) ??
    HEATMAP_TIMEFRAMES.find((t) => t.key === "day") ??
    HEATMAP_TIMEFRAMES[0]
  );
}

// % move from the window-start reading to the now reading, both expressed as % vs
// the prior close. Returns null when there's no current reading; when the window
// start has no reading (it predates the stock's first print of the session) it
// degrades to the since-first-print move (pctNow) rather than a gap.
export function windowPct(
  pctNow: number | null | undefined,
  pctStart: number | null | undefined,
): number | null {
  if (pctNow === null || pctNow === undefined || !Number.isFinite(pctNow)) return null;
  if (pctStart === null || pctStart === undefined || !Number.isFinite(pctStart)) return pctNow;
  const denom = 1 + pctStart / 100;
  if (denom === 0) return null;
  return ((1 + pctNow / 100) / denom - 1) * 100;
}

// The opening gap: the first printed minute's % vs the prior close (the overnight
// jump). Fixed for the session — it does not depend on the scrubbed minute. Null if
// the name never printed.
export function openingGapPct(series: (number | null | undefined)[]): number | null {
  for (let i = 0; i < series.length; i += 1) {
    const value = series[i];
    if (value !== null && value !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}
