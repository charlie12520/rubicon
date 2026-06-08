// Normalize a daily % move by a stock's own implied volatility: how many 1-day
// standard deviations today's move is. A stock's 1-day expected move (1σ) is its
// annualized IV / sqrt(252); the σ-move is just today's % move over that.
//
//   iv   — annualized implied vol as a fraction (0.25 = 25%)
//   pct  — the day's move in percent (e.g. 3.15 for +3.15%)
//   → e.g. sigmaMove(3.15, 0.25) ≈ +2 (a 2-standard-deviation day)
//
// Returns null when either input is missing/invalid so callers can fall back to a
// neutral tint instead of rendering a bogus number.
export function sigmaMove(pct: number | null, iv: number | null, tradingDays = 252): number | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  if (iv === null || !Number.isFinite(iv) || iv <= 0) return null;
  const dailySigmaPct = (iv * 100) / Math.sqrt(tradingDays);
  if (!(dailySigmaPct > 0)) return null;
  return pct / dailySigmaPct;
}

// A full regular-trading-hours session is 390 minutes (09:30–16:00 ET).
export const RTH_MINUTES = 390;

// σ-move normalized to a trailing WINDOW instead of the whole day. Intraday
// variance accrues ~linearly with time, so a w-minute move's expected 1σ is the
// daily 1σ scaled by √(w/390); the move's σ over that window is therefore the daily
// σ scaled by √(390/w). windowMinutes 0 (Day) means the whole session → the daily σ.
// This lets the heatmap's σ view answer "how unusual is this move *for this window*"
// (a +0.3% jump is a yawn on the day but can be a multi-σ event over 5 minutes).
export function windowSigma(
  pct: number | null,
  iv: number | null,
  windowMinutes: number,
  tradingDays = 252,
): number | null {
  const daily = sigmaMove(pct, iv, tradingDays);
  if (daily === null) return null;
  const minutes = windowMinutes > 0 ? Math.min(windowMinutes, RTH_MINUTES) : RTH_MINUTES;
  return daily * Math.sqrt(RTH_MINUTES / minutes);
}
