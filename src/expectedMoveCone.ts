// SPX intraday expected-move cone.
//
// Model (validated offline on 745 RTH days 2023-2026, see
// `AI STUFF/analysis/expected_move_cone/`): forward SPX move over `elapsed` minutes
// ~ Normal(0, s^2) with s = r * sqrt(elapsed) (the same sqrt-time diffusion the
// estimator's Bachelier engine uses). So the cone half-width at a forward time is
//     half(k, elapsed) = k * r * sqrt(elapsed)   [SPX index points]
// opening from the anchor spot and widening toward 16:00 ET.
//
// `r` (points per sqrt-minute) is best taken PER DAY from the live 0DTE spreads'
// implied move-scale (kind:"implied") — the backtest showed per-day scaling pulls the
// 1.645σ / 2σ bands to ~nominal coverage, while a flat constant does not. When no live
// spreads exist we fall back to a time-of-day prior (kind:"prior") MEASURED in the
// backtest (NOT spreadResponse's stale A_PRIOR=1.21 — that's the P/L inversion fallback).
//
// Levels: 1σ, 1.645σ (= the ~0.05Δ short-strike "frontier" a credit seller targets;
// ~5% one-sided tail to 16:00, validated), 2σ. Residual fat tails + downside skew mean
// the 2σ band is breached a little more than nominal on jump days — surface that in copy.

import { DEFAULT_WIDTH, impliedScale, signedDistanceToLoss, type SpreadSide } from "./spreadResponse";

export const CONE_DEFAULT_LEVELS = [1, 1.645, 2] as const;
// Measured global diffusion coefficient (pts/sqrt-min), 745 days 2023-05 .. 2026-05.
export const CONE_PRIOR_A = 2.1;
// Per-time-of-day A keyed by minutes-to-close (16:00 ET). The open is the hottest part of
// the session; the prior interpolates this curve. From backtest_cone.py [1].
const PRIOR_A_BY_MTC: ReadonlyArray<readonly [number, number]> = [
  [60, 1.87], // 15:00
  [120, 1.75], // 14:00
  [180, 2.14], // 13:00
  [240, 1.94], // 12:00
  [300, 2.02], // 11:00
  [360, 2.19], // 10:00
  [390, 2.38], // 09:30
];

export type ConeScale =
  | { kind: "implied"; s0: number; sourceMinutesToClose: number } // day move-scale at the anchor (index pts)
  | { kind: "prior"; a?: number }; // a defaults to the time-of-day prior

export type ConeLevelPoint = {
  minutesToClose: number;
  elapsedMinutes: number;
  upper: number;
  lower: number;
  half: number;
};

export type ConeLevel = { k: number; points: ConeLevelPoint[] };

export type ExpectedMoveCone = {
  anchorSpot: number;
  anchorMinutesToClose: number;
  rate: number; // r, pts per sqrt-minute
  scaleKind: "implied" | "prior";
  sAtClose: number; // 1σ half-width at 16:00
  closeRange: { upper: number; lower: number; half: number }; // k=1 band at the close
  levels: ConeLevel[];
};

/** Time-of-day prior rate r (pts/sqrt-min) by minutes-to-close, interpolated + clamped. */
export function priorRate(minutesToClose: number): number {
  const mtc = Math.max(minutesToClose, 0);
  const t = PRIOR_A_BY_MTC;
  if (mtc <= t[0][0]) return t[0][1];
  if (mtc >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 1; i < t.length; i++) {
    if (mtc <= t[i][0]) {
      const [m0, a0] = t[i - 1];
      const [m1, a1] = t[i];
      return a0 + ((a1 - a0) * (mtc - m0)) / (m1 - m0);
    }
  }
  return CONE_PRIOR_A;
}

function rateFromScale(scale: ConeScale, anchorMinutesToClose: number): number {
  if (scale.kind === "implied") {
    const src = Math.max(scale.sourceMinutesToClose, 0.5);
    const r = scale.s0 / Math.sqrt(src);
    return Number.isFinite(r) && r > 0 ? r : priorRate(anchorMinutesToClose);
  }
  return scale.a != null && scale.a > 0 ? scale.a : priorRate(anchorMinutesToClose);
}

/**
 * Build the expected-move cone from an anchor (spot + minutes-to-close) and a scale.
 * Points run from the anchor (elapsed 0, half 0) forward to 16:00 ET on a `stepMinutes`
 * grid. Pure / time-agnostic — the chart layer maps each point's elapsed to a bar epoch.
 */
export function expectedMoveCone(input: {
  anchorSpot: number;
  anchorMinutesToClose: number;
  scale: ConeScale;
  levels?: number[];
  stepMinutes?: number;
}): ExpectedMoveCone {
  const mtc = Math.max(input.anchorMinutesToClose, 0);
  const step = Math.max(input.stepMinutes ?? 2, 0.5);
  const levels = (input.levels ?? [...CONE_DEFAULT_LEVELS]).slice().sort((a, b) => a - b);
  const r = rateFromScale(input.scale, mtc);

  // Forward elapsed grid: 0, step, 2*step, …, mtc (always include the close endpoint).
  const elapsedGrid: number[] = [];
  for (let e = 0; e < mtc; e += step) elapsedGrid.push(e);
  elapsedGrid.push(mtc);

  const coneLevels: ConeLevel[] = levels.map((k) => ({
    k,
    points: elapsedGrid.map((elapsed) => {
      const half = k * r * Math.sqrt(elapsed);
      return {
        elapsedMinutes: elapsed,
        minutesToClose: mtc - elapsed,
        half,
        upper: input.anchorSpot + half,
        lower: input.anchorSpot - half,
      };
    }),
  }));

  const sAtClose = r * Math.sqrt(mtc);
  return {
    anchorSpot: input.anchorSpot,
    anchorMinutesToClose: mtc,
    rate: r,
    scaleKind: input.scale.kind,
    sAtClose,
    closeRange: { half: sAtClose, upper: input.anchorSpot + sAtClose, lower: input.anchorSpot - sAtClose },
    levels: coneLevels,
  };
}

// --- Phase 2: derive ONE day move-scale from the live spreads (the per-day cone width) ---

export type ConeSpreadInput = {
  side: SpreadSide;
  shortStrike: number;
  width?: number;
  creditNow?: number | null;
};

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

/**
 * Collapse the on-screen 0DTE spreads to one `ConeScale`: the median of each spread's
 * implied move-scale (reuses spreadResponse.impliedScale — the same vol that drives the
 * P/L curve). Median is robust to one mismarked / deep-ITM leg whose inversion falls back.
 * Returns a `prior` scale when there are no usable live credits.
 */
export function coneScaleFromSpreads(
  spreads: ConeSpreadInput[],
  spot: number,
  minutesToClose: number,
): ConeScale {
  const s0s = spreads
    .filter((s) => s.creditNow != null && Number.isFinite(s.creditNow))
    .map((s) =>
      impliedScale(
        s.creditNow as number,
        signedDistanceToLoss(s.side, spot, s.shortStrike),
        s.width ?? DEFAULT_WIDTH,
        minutesToClose,
      ),
    )
    .filter((x) => Number.isFinite(x) && x > 0);
  if (!s0s.length) return { kind: "prior" };
  return { kind: "implied", s0: median(s0s), sourceMinutesToClose: Math.max(minutesToClose, 0.5) };
}
