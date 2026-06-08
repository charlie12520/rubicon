// Spread-response equation for intraday 0DTE SPX vertical credit spreads.
//
// Model (validated on 1s NBBO, 530 spread-days 2024-2026; see
// `AI STUFF/analysis/spread_response/`): terminal SPX ~ Normal(spot, s^2),
// so a width-W vertical's cost-to-close (net credit, bounded [0,W]) is the
// Bachelier vertical value V(d, s). Self-calibrate the move-scale `s` from the
// LIVE credit, then roll the same curve to a target level. Per-year R^2 0.96-0.98,
// MAE ~$10-16/contract on slightly-OTM bases — beats constant-delta and global-sigma.

export type SpreadSide = "call_credit" | "put_credit";

export const DEFAULT_WIDTH = 5;
// s ~= A_PRIOR * sqrt(minutes_to_close); used for time-projection and as the
// fallback when the live credit is ~0 / ~W (inversion ill-conditioned).
export const SPREAD_RESPONSE_A_PRIOR = 1.21;
export const SESSION_CLOSE_MINUTE_ET = 16 * 60; // 16:00 ET

const INV_SQRT_2PI = 0.3989422804014327;

export function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

// Normal CDF via Abramowitz & Stegun 7.1.26 (abs error < 7.5e-8).
export function normCdf(x: number): number {
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937, b4 = -1.821255978, b5 = 1.330274429, p = 0.2316419;
  const ax = Math.abs(x);
  const t = 1 / (1 + p * ax);
  const poly = t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  const tail = normPdf(ax) * poly;
  return x >= 0 ? 1 - tail : tail;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Bachelier vertical value: E[min(max(d + e, 0), W)] for e ~ Normal(0, s^2).
 * `d` = signed distance toward max loss (see signedDistanceToLoss). Bounded [0, W].
 */
export function bachelierVertical(d: number, s: number, width = DEFAULT_WIDTH): number {
  if (!(s > 1e-6)) return clamp(d, 0, width); // s -> 0: step payoff
  const z = d / s;
  const zW = (d - width) / s;
  const v = (d * normCdf(z) + s * normPdf(z)) - ((d - width) * normCdf(zW) + s * normPdf(zW));
  return clamp(v, 0, width);
}

/** Spread delta in the loss direction: dV/dd in [0,1]. $ per 1pt SPX = delta * 100 / contract. */
export function spreadDelta(d: number, s: number, width = DEFAULT_WIDTH): number {
  if (!(s > 1e-6)) return d >= 0 && d <= width ? 1 : 0;
  return clamp(normCdf(d / s) - normCdf((d - width) / s), 0, 1);
}

/**
 * Bachelier vertical vega: dV/ds = φ(d/s) − φ((d−W)/s). >0 for an OTM credit
 * spread (d<0), → 0 far OTM and far ITM. The chain rule factor for theta, since
 * the move-scale s carries all the time dependence (s = a·√minutesToClose).
 */
export function spreadVega(d: number, s: number, width = DEFAULT_WIDTH): number {
  if (!(s > 1e-6)) return 0;
  return normPdf(d / s) - normPdf((d - width) / s);
}

/** Signed distance from spot to the short strike, oriented so larger = closer to max loss. */
export function signedDistanceToLoss(side: SpreadSide, spot: number, shortStrike: number): number {
  return side === "call_credit" ? spot - shortStrike : shortStrike - spot;
}

/**
 * Back out the day's move-scale `s` from the live credit V0 at signed distance d0.
 * Monotone in s for d0 < W/2; falls back to the time-of-day prior when ill-conditioned.
 */
export function impliedScale(
  v0: number,
  d0: number,
  width = DEFAULT_WIDTH,
  minutesToClose = 120,
  aPrior = SPREAD_RESPONSE_A_PRIOR,
): number {
  const prior = aPrior * Math.sqrt(Math.max(minutesToClose, 0.5));
  if (!Number.isFinite(v0) || v0 <= 0.02 || v0 >= width - 0.02 || d0 >= width / 2) return prior;
  const f = (s: number) => bachelierVertical(d0, s, width) - v0;
  let lo = 0.3, hi = 800;
  const flo = f(lo), fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) return prior; // not bracketed (e.g. v0 > W/2 with d0<W/2)
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (Math.abs(fm) < 1e-5 || hi - lo < 1e-3) return mid;
    if ((fm > 0) === (fhi > 0)) hi = mid; else lo = mid;
  }
  return 0.5 * (lo + hi);
}

export type SpreadThetaPoint = {
  thetaDollarsPerHourNow: number;  // instantaneous decay rate, $/hr per contract
  decayNextHourDollars: number;    // $/contract decayed over the next trading hour (reprice, clamps at close)
  dollarsPerPoint: number;         // speed: $ per 1pt SPX move toward the short strike, per contract
  thetaPerSpeed: number;           // decayNextHourDollars / dollarsPerPoint (edge ratio)
};

/**
 * Theta (time decay) of a width-W vertical at signed distance `d`, move-scale `s`,
 * with `minutesToClose` left. The move-scale carries all the time dependence
 * (s = a·√m), so ds/dt = −s/(2m) and the instantaneous value-decay rate is −vega·ds/dt.
 * `decayNextHourDollars` reprices one trading hour ahead (clamped at the close) — the
 * realized-style figure validated in journal_spread_theta_rate.md; display that one.
 * All dollar figures are per 1 contract; >0 = credit bleeding in the seller's favor.
 */
export function spreadThetaAt(d: number, s: number, minutesToClose: number, width = DEFAULT_WIDTH): SpreadThetaPoint {
  const m = Math.max(minutesToClose, 0.5);
  const dollarsPerPoint = spreadDelta(d, s, width) * 100;
  const dsdtPerMin = -s / (2 * m);
  const thetaDollarsPerHourNow = -spreadVega(d, s, width) * dsdtPerMin * 60 * 100;
  const sNextHour = s * Math.sqrt(Math.max(m - 60, 0) / m);
  const decayNextHourDollars = (bachelierVertical(d, s, width) - bachelierVertical(d, sNextHour, width)) * 100;
  const thetaPerSpeed = dollarsPerPoint > 1e-9 ? decayNextHourDollars / dollarsPerPoint : 0;
  return { thetaDollarsPerHourNow, decayNextHourDollars, dollarsPerPoint, thetaPerSpeed };
}

export type SpreadResponseInput = {
  side: SpreadSide;
  shortStrike: number;
  width?: number;
  spot: number;        // current SPX
  credit: number;      // current net credit (cost to close), in index points
  minutesToClose: number;
  level: number;       // target SPX level
  minutesToCloseAtLevel?: number; // when the level is reached (default: same as now)
};

export type SpreadResponseResult = {
  scaleNow: number;        // s0 (index points of expected remaining move)
  scaleAtLevel: number;    // s rolled to the arrival time
  distanceNow: number;     // d0
  distanceAtLevel: number; // d_L
  creditAtLevel: number;   // predicted net credit at the level
  deltaCredit: number;     // creditAtLevel - credit  (per spread, index points)
  deltaDollarsPerContract: number; // deltaCredit * 100
  dollarsPerPointNow: number;      // current speed: $ per 1pt SPX move, per contract
  // Time decay (theta), spot held at the current level. >0 = credit bleeds in the
  // credit seller's favor. See journal_spread_theta_rate.md (DepthHistory) — the
  // realized decay tracks decayNextHourDollars; display that, not the instantaneous rate.
  thetaDollarsPerHourNow: number;  // instantaneous decay rate, $/hr per contract
  decayNextHourDollars: number;    // $/contract decayed over the next trading hour (reprice, clamps at close)
  thetaPerSpeed: number;           // decayNextHourDollars / dollarsPerPointNow — $-to-time per $-at-risk/pt (edge ratio)
};

/** The headline equation: predict the spread's net credit (and change) at a target level. */
export function predictSpreadResponse(input: SpreadResponseInput): SpreadResponseResult {
  const width = input.width ?? DEFAULT_WIDTH;
  const mcNow = Math.max(input.minutesToClose, 0.5);
  const mcAt = Math.max(input.minutesToCloseAtLevel ?? input.minutesToClose, 0.5);
  const d0 = signedDistanceToLoss(input.side, input.spot, input.shortStrike);
  const dL = signedDistanceToLoss(input.side, input.level, input.shortStrike);
  const s0 = impliedScale(input.credit, d0, width, mcNow);
  const sL = s0 * Math.sqrt(mcAt / mcNow);
  const creditAtLevel = bachelierVertical(dL, sL, width);
  const deltaCredit = creditAtLevel - input.credit;
  // Time decay at the current spot (see spreadThetaAt). Held at the current level.
  const theta = spreadThetaAt(d0, s0, mcNow, width);

  return {
    scaleNow: s0,
    scaleAtLevel: sL,
    distanceNow: d0,
    distanceAtLevel: dL,
    creditAtLevel,
    deltaCredit,
    deltaDollarsPerContract: deltaCredit * 100,
    dollarsPerPointNow: theta.dollarsPerPoint,
    thetaDollarsPerHourNow: theta.thetaDollarsPerHourNow,
    decayNextHourDollars: theta.decayNextHourDollars,
    thetaPerSpeed: theta.thetaPerSpeed,
  };
}

/** Credit-vs-level curve for charting. Returns [{ level, credit }] over a price grid. */
export function creditCurve(
  base: Omit<SpreadResponseInput, "level">,
  levelMin: number,
  levelMax: number,
  steps = 81,
): Array<{ level: number; credit: number }> {
  const width = base.width ?? DEFAULT_WIDTH;
  const mcNow = Math.max(base.minutesToClose, 0.5);
  const mcAt = Math.max(base.minutesToCloseAtLevel ?? base.minutesToClose, 0.5);
  const d0 = signedDistanceToLoss(base.side, base.spot, base.shortStrike);
  const s0 = impliedScale(base.credit, d0, width, mcNow);
  const sL = s0 * Math.sqrt(mcAt / mcNow);
  const out: Array<{ level: number; credit: number }> = [];
  for (let i = 0; i < steps; i++) {
    const level = levelMin + ((levelMax - levelMin) * i) / (steps - 1);
    const dL = signedDistanceToLoss(base.side, level, base.shortStrike);
    out.push({ level, credit: bachelierVertical(dL, sL, width) });
  }
  return out;
}

/** Parse an ET "HH:MM" label to minutes-to-close (16:00 ET). Returns null if unparseable. */
export function minutesToCloseFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  if (!Number.isFinite(mins)) return null;
  return Math.max(SESSION_CLOSE_MINUTE_ET - mins, 0.5);
}
