// Theta-per-speed across strikes — the "edge ratio" curve for 0DTE SPX verticals.
//
// θ/speed = (credit decaying in your favor per hour) ÷ ($ at risk per 1pt SPX move).
// Validated offline (journal_spread_theta_rate.md): this ratio is U-shaped across the
// chain — lowest near the money (lots of directional risk per $ of decay) and rising
// the further OTM you sit (more time-edge per unit of directional risk). One shared
// move-scale `s` (the day's σ to close) is swept over strikes; each spread's own live
// credit is NOT used here — this is the structural curve the strikes sit on.

import { DEFAULT_WIDTH, signedDistanceToLoss, spreadThetaAt, type SpreadSide } from "./spreadResponse";
import { priorRate, type ConeScale } from "./expectedMoveCone";

export type ThetaSpeedPoint = {
  strike: number;
  distOtm: number; // points OTM of spot (≥0)
  side: SpreadSide; // call_credit above spot, put_credit below
  delta: number; // spread delta (= speed / 100)
  speed: number; // $/pt per contract
  decayPerHour: number; // $/hr per contract (favorable bleed)
  thetaPerSpeed: number; // edge ratio
};

export type ThetaSpeedCurve = {
  spot: number;
  moveScale: number; // 1σ index points of remaining move to the close
  minutesToClose: number;
  points: ThetaSpeedPoint[];
};

/** Resolve one move-scale (1σ pts to close) from a ConeScale at the given minutes-to-close. */
export function resolveMoveScale(scale: ConeScale, minutesToClose: number): number {
  const m = Math.max(minutesToClose, 0.5);
  if (scale.kind === "implied" && scale.s0 > 0) {
    // s0 is the scale at its source time; roll to m via sqrt-time diffusion.
    return scale.s0 * Math.sqrt(m / Math.max(scale.sourceMinutesToClose, 0.5));
  }
  return priorRate(m) * Math.sqrt(m);
}

/**
 * Sweep short strikes around spot (OTM region only) and compute θ/speed at each,
 * using a single shared move-scale. Trims each tail where the short delta falls below
 * `minDelta` (the far-OTM asymptote where speed → 0 makes the ratio explode).
 */
export function buildThetaSpeedCurve(input: {
  spot: number;
  minutesToClose: number;
  moveScale: number;
  width?: number;
  steps?: number;
  minDelta?: number;
}): ThetaSpeedCurve {
  const width = input.width ?? DEFAULT_WIDTH;
  const s = Math.max(input.moveScale, 1e-6);
  const m = Math.max(input.minutesToClose, 0.5);
  const minDelta = input.minDelta ?? 0.01;
  const steps = Math.max(input.steps ?? 161, 5);
  const maxDist = 3.4 * s; // a few σ out — covers the whole credit-spread frontier

  const points: ThetaSpeedPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const strike = input.spot - maxDist + (2 * maxDist * i) / (steps - 1);
    const side: SpreadSide = strike >= input.spot ? "call_credit" : "put_credit";
    const d = signedDistanceToLoss(side, input.spot, strike); // ≤0 in the OTM region
    if (d > 0) continue; // ITM short strike — not credit-spread territory
    const t = spreadThetaAt(d, s, m, width);
    const delta = t.dollarsPerPoint / 100;
    if (delta < minDelta) continue;
    points.push({
      strike,
      distOtm: Math.abs(input.spot - strike),
      side,
      delta,
      speed: t.dollarsPerPoint,
      decayPerHour: t.decayNextHourDollars,
      thetaPerSpeed: t.thetaPerSpeed,
    });
  }
  return { spot: input.spot, moveScale: s, minutesToClose: m, points };
}
