// Aggregate the live 0DTE SPX spreads into a portfolio response curve.
//
// Each spread is run through the existing self-calibrated Bachelier model
// (spreadResponse.ts) on a SHARED SPX price ladder, so the per-spread cost-to-
// close curves are sampled at identical levels and can be summed. P/L is framed
// for the credit-spread SELLER: profit when the cost-to-close falls below the
// current ("now") credit. The aggregate is exact regardless of how legs were
// grouped into spreads.

import type { LiveSpread } from "./spreadEstimator";
import { creditCurve, impliedScale, predictSpreadResponse, signedDistanceToLoss } from "./spreadResponse";

export type SpreadCurvePoint = { level: number; credit: number; pnl: number };

export type SpreadResponseRow = {
  spread: LiveSpread;
  creditReference: number; // cost-to-close at spot used as the P/L baseline (index points)
  dollarsPerPointNow: number; // $ per 1pt SPX move toward the short strike, per contract
  curve: SpreadCurvePoint[]; // pnl is total dollars for this spread (× contracts × 100)
};

export type PortfolioResponse = {
  spot: number;
  minutesToClose: number;
  levelMin: number;
  levelMax: number;
  steps: number;
  totalContracts: number;
  rows: SpreadResponseRow[];
  aggregate: Array<{ level: number; pnl: number }>;
};

export type BuildPortfolioOptions = {
  spot: number;
  minutesToClose: number;
  steps?: number;
  levelMin?: number;
  levelMax?: number;
};

function defaultLadder(spreads: LiveSpread[], spot: number, minutesToClose: number): { levelMin: number; levelMax: number } {
  const strikes = spreads.flatMap((spread) => [spread.shortStrike, spread.longStrike]);
  const lo = Math.min(spot, ...strikes);
  const hi = Math.max(spot, ...strikes);
  // Extend just far enough that every spread reaches its full max loss / max profit
  // — its cost-to-close saturates to the width (−$width) / 0 — right at the edges.
  // Framing to the actual risk (≈3σ of the Bachelier move-scale beyond the strikes:
  // ~99.9% of full width, slope ≈ 0) lands the −$width loss on the edge and keeps
  // the SPX range, and the target slider, from being wider / more sensitive than
  // the position warrants — instead of a fixed % of spot, which over-pads flat
  // space past the max loss.
  const scale = Math.max(
    0,
    ...spreads.map((spread) =>
      impliedScale(spread.creditNow ?? 0, signedDistanceToLoss(spread.side, spot, spread.shortStrike), spread.width, minutesToClose),
    ),
  );
  const pad = Math.max(3 * scale, 25);
  return { levelMin: lo - pad, levelMax: hi + pad };
}

/** Build the per-spread and aggregate portfolio P/L curves over a shared SPX ladder. */
export function buildPortfolioResponse(spreads: LiveSpread[], options: BuildPortfolioOptions): PortfolioResponse {
  const steps = Math.max(options.steps ?? 81, 2);
  const spot = options.spot;
  const minutesToClose = Math.max(options.minutesToClose, 0.5);
  const { levelMin, levelMax } =
    options.levelMin != null && options.levelMax != null
      ? { levelMin: options.levelMin, levelMax: options.levelMax }
      : defaultLadder(spreads, spot, minutesToClose);

  const aggregate = Array.from({ length: steps }, (_, i) => ({
    level: levelMin + ((levelMax - levelMin) * i) / (steps - 1),
    pnl: 0,
  }));

  const rows: SpreadResponseRow[] = spreads.map((spread) => {
    const base = {
      side: spread.side,
      shortStrike: spread.shortStrike,
      width: spread.width,
      spot,
      credit: spread.creditNow ?? 0,
      minutesToClose,
    };
    const dollars = spread.contracts * 100;
    // Self-consistent baseline at spot (≈ creditNow when a live mark exists).
    const creditReference = predictSpreadResponse({ ...base, level: spot }).creditAtLevel;
    const rawCurve = creditCurve(base, levelMin, levelMax, steps);
    const curve: SpreadCurvePoint[] = rawCurve.map((point, i) => {
      const pnl = (creditReference - point.credit) * dollars;
      aggregate[i].pnl += pnl;
      return { level: point.level, credit: point.credit, pnl };
    });
    return {
      spread,
      creditReference,
      dollarsPerPointNow: predictSpreadResponse({ ...base, level: spot }).dollarsPerPointNow,
      curve,
    };
  });

  return {
    spot,
    minutesToClose,
    levelMin,
    levelMax,
    steps,
    totalContracts: spreads.reduce((total, spread) => total + spread.contracts, 0),
    rows,
    aggregate,
  };
}

/** Linear-interpolate the aggregate P/L at an arbitrary SPX level. */
export function aggregatePnlAtLevel(response: PortfolioResponse, level: number): number {
  const points = response.aggregate;
  if (points.length === 0) return 0;
  if (level <= points[0].level) return points[0].pnl;
  if (level >= points[points.length - 1].level) return points[points.length - 1].pnl;
  for (let i = 1; i < points.length; i++) {
    if (level <= points[i].level) {
      const a = points[i - 1];
      const b = points[i];
      const t = (level - a.level) / (b.level - a.level || 1);
      return a.pnl + t * (b.pnl - a.pnl);
    }
  }
  return points[points.length - 1].pnl;
}
