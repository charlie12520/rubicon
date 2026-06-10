import { describe, expect, it } from "vitest";
import { normCdf } from "./spreadResponse";
import {
  CONE_PRIOR_A,
  CONE_SESSION_MINUTES,
  coneScaleFromSpreads,
  expectedMoveCone,
  priorRate,
  varianceShare,
  type ConeSpreadInput,
} from "./expectedMoveCone";

const SPOT = 5000;

describe("varianceShare (intraday variance-time profile)", () => {
  it("runs 0 at the anchor to 1 at the close", () => {
    expect(varianceShare(120, 0)).toBe(0);
    expect(varianceShare(120, 120)).toBeCloseTo(1, 9);
    expect(varianceShare(389, 389)).toBeCloseTo(1, 9);
  });

  it("front-loads variance near the open — the first 30 minutes carry far more than clock share", () => {
    // From the open anchor, 30 elapsed minutes carry ~17% of the day's variance,
    // not the 30/389 ≈ 7.7% a linear clock-time accrual would assign.
    const share30 = varianceShare(389, 30);
    expect(share30).toBeGreaterThan(0.13);
    expect(share30).toBeGreaterThan((30 / 389) * 1.5);
  });

  it("falls back to linear accrual for non-standard session lengths (half-days)", () => {
    expect(varianceShare(100, 25, 210)).toBeCloseTo(0.25, 9);
    expect(varianceShare(100, 25, CONE_SESSION_MINUTES)).not.toBeCloseTo(0.25, 2);
  });

  it("clamps a pre-open anchor to the open (RTH-only: no share accrues before 09:31)", () => {
    // mtc 480 = anchored 91 minutes before the profiled session starts
    expect(varianceShare(480, 50)).toBe(0);
    expect(varianceShare(480, 91 + 30)).toBeCloseTo(varianceShare(389, 30), 9);
    expect(varianceShare(480, 480)).toBeCloseTo(1, 9);
  });
});

describe("CONE_VARIANCE_CUM invariants (the table the whole model rides on)", () => {
  it("is a full-session, monotonically non-decreasing cumulative share from 0 to 1", () => {
    // varianceShare exposes the table indirectly: full coverage + monotone halves
    expect(varianceShare(389, 0)).toBe(0);
    expect(varianceShare(389, 389)).toBeCloseTo(1, 9);
    let prev = 0;
    for (let e = 1; e <= 389; e += 1) {
      const s = varianceShare(389, e);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(CONE_SESSION_MINUTES).toBe(390);
  });
});

describe("expectedMoveCone", () => {
  it("sizes the prior-scale 1σ half-width at the close to a·√(minutes_to_close)", () => {
    const cone = expectedMoveCone({ anchorSpot: SPOT, anchorMinutesToClose: 120, scale: { kind: "prior", a: 2 } });
    expect(cone.rate).toBeCloseTo(2, 9);
    expect(cone.sAtClose).toBeCloseTo(2 * Math.sqrt(120), 6); // ≈21.908
    expect(cone.closeRange.upper).toBeCloseTo(SPOT + 2 * Math.sqrt(120), 6);
    const k2 = cone.levels.find((l) => l.k === 2)!;
    expect(k2.points.at(-1)!.half).toBeCloseTo(2 * 2 * Math.sqrt(120), 6); // close: share = 1
  });

  it("pinches to the anchor and widens monotonically toward the close", () => {
    const cone = expectedMoveCone({ anchorSpot: SPOT, anchorMinutesToClose: 120, scale: { kind: "prior", a: 2 } });
    const k1 = cone.levels.find((l) => l.k === 1)!;
    expect(k1.points[0].elapsedMinutes).toBe(0);
    expect(k1.points[0].half).toBe(0);
    expect(k1.points[0].upper).toBe(SPOT);
    expect(k1.points[0].lower).toBe(SPOT);
    for (let i = 1; i < k1.points.length; i++) {
      expect(k1.points[i].half).toBeGreaterThan(k1.points[i - 1].half);
      expect(k1.points[i].minutesToClose).toBeLessThan(k1.points[i - 1].minutesToClose);
    }
    expect(k1.points.at(-1)!.minutesToClose).toBeCloseTo(0, 9);
  });

  it("accrues variance on the measured intraday profile, not linearly in clock time", () => {
    // Anchored at the open, the half-width at +30 min must exceed the linear-√t width
    // because the open is the hottest stretch of the session.
    const cone = expectedMoveCone({ anchorSpot: SPOT, anchorMinutesToClose: 389, scale: { kind: "prior", a: 2 }, stepMinutes: 10 });
    const pts = cone.levels[0].points;
    const at30 = pts.find((p) => p.elapsedMinutes === 30)!;
    const linearHalf = 2 * Math.sqrt(389) * Math.sqrt(30 / 389);
    expect(at30.half).toBeGreaterThan(linearHalf * 1.2);
    // and the profile law ties half-widths to the variance share exactly
    const at60 = pts.find((p) => p.elapsedMinutes === 60)!;
    const expected = Math.sqrt(varianceShare(389, 60) / varianceShare(389, 30));
    expect(at60.half / at30.half).toBeCloseTo(expected, 9);
  });

  it("applies the calibrated per-side multipliers for an implied scale (VRP + crash skew)", () => {
    const s0 = 20;
    const mtc = 120;
    const implied = expectedMoveCone({
      anchorSpot: SPOT,
      anchorMinutesToClose: mtc,
      scale: { kind: "implied", s0, sourceMinutesToClose: mtc },
    });
    expect(implied.sAtClose).toBeCloseTo(s0, 9);
    const k1 = implied.levels.find((l) => l.k === 1)!.points.at(-1)!;
    expect(k1.halfUp).toBeCloseTo(0.9649 * s0, 6);
    expect(k1.halfDown).toBeCloseTo(0.8454 * s0, 6);
    expect(implied.closeRange.upper).toBeCloseTo(SPOT + 0.9649 * s0, 6);
    expect(implied.closeRange.lower).toBeCloseTo(SPOT - 0.8454 * s0, 6);
    const k1645 = implied.levels.find((l) => l.k === 1.645)!.points.at(-1)!;
    // upper band is tighter than nominal (right tail thin + variance risk premium),
    // lower band is wider than upper (crash skew)
    expect(k1645.halfUp).toBeCloseTo(1.595 * s0, 6);
    expect(k1645.halfDown).toBeCloseTo(1.6868 * s0, 6);
    expect(k1645.upper - SPOT).toBeLessThan(1.645 * s0);
    expect(SPOT - k1645.lower).toBeGreaterThan(k1645.upper - SPOT);
    const k2 = implied.levels.find((l) => l.k === 2)!.points.at(-1)!;
    expect(k2.halfDown).toBeCloseTo(2.1802 * s0, 6);
    expect(k2.halfUp).toBeCloseTo(1.8427 * s0, 6);
    // the prior kind stays symmetric Gaussian
    const prior = expectedMoveCone({ anchorSpot: SPOT, anchorMinutesToClose: mtc, scale: { kind: "prior", a: 2 } });
    const p1645 = prior.levels.find((l) => l.k === 1.645)!.points.at(-1)!;
    expect(p1645.halfUp).toBeCloseTo(p1645.halfDown, 9);
  });

  it("scales the prior-kind half-width linearly in k", () => {
    const cone = expectedMoveCone({
      anchorSpot: SPOT,
      anchorMinutesToClose: 180,
      scale: { kind: "prior", a: 1.8 },
      levels: [1, 1.645, 2],
    });
    const [k1, k1645, k2] = cone.levels;
    const i = Math.floor(k1.points.length / 2);
    expect(k2.points[i].half / k1.points[i].half).toBeCloseTo(2, 9);
    expect(k1645.points[i].half / k1.points[i].half).toBeCloseTo(1.645, 9);
  });

  it("degrades uncalibrated implied levels to symmetric Gaussian k and labels a scale by the math actually used", () => {
    const cone = expectedMoveCone({
      anchorSpot: SPOT,
      anchorMinutesToClose: 120,
      scale: { kind: "implied", s0: 20, sourceMinutesToClose: 120 },
      levels: [1.5, 3],
    });
    for (const level of cone.levels) {
      const last = level.points.at(-1)!;
      expect(last.halfUp).toBeCloseTo(last.halfDown, 9); // no calibrated skew for custom levels
      expect(last.halfUp).toBeCloseTo(level.k * 20, 6);
    }
    // an "implied" scale without a usable s0 resolves to the prior — and says so
    const broken = expectedMoveCone({
      anchorSpot: SPOT,
      anchorMinutesToClose: 120,
      scale: { kind: "implied", s0: Number.NaN, sourceMinutesToClose: 120 },
    });
    expect(broken.scaleKind).toBe("prior");
  });

  it("re-anchors an implied scale quoted at a different horizon through the profile", () => {
    const s0 = 20;
    const cone = expectedMoveCone({
      anchorSpot: SPOT,
      anchorMinutesToClose: 60,
      scale: { kind: "implied", s0, sourceMinutesToClose: 120 },
    });
    // remaining variance at 60-to-close is a sub-share of 120-to-close → scale shrinks
    expect(cone.sAtClose).toBeLessThan(s0);
    expect(cone.sAtClose).toBeGreaterThan(0.5 * s0);
  });

  it("handles a zero-horizon anchor without throwing", () => {
    const cone = expectedMoveCone({ anchorSpot: SPOT, anchorMinutesToClose: 0, scale: { kind: "prior", a: 2 } });
    expect(cone.sAtClose).toBe(0);
    expect(cone.levels[0].points).toHaveLength(1);
    expect(cone.levels[0].points[0].half).toBe(0);
  });
});

describe("priorRate (time-of-day fallback, from the backtest)", () => {
  it("is hottest near the open and clamps outside the table", () => {
    expect(priorRate(390)).toBeCloseTo(2.38, 6); // 09:30
    expect(priorRate(120)).toBeCloseTo(1.75, 6); // 14:00
    expect(priorRate(45)).toBeCloseTo(1.87, 6); // clamp below 60
    expect(priorRate(450)).toBeCloseTo(2.38, 6); // clamp above 390
    expect(priorRate(330)).toBeCloseTo(2.02 + 0.5 * (2.19 - 2.02), 6); // interp 300↔360
    expect(CONE_PRIOR_A).toBeGreaterThan(1.5);
  });
});

describe("coneScaleFromSpreads", () => {
  it("returns an implied scale backed out of the live credits", () => {
    const spreads: ConeSpreadInput[] = [
      { side: "call_credit", shortStrike: 5025, width: 5, creditNow: 0.6 },
      { side: "put_credit", shortStrike: 4975, width: 5, creditNow: 0.55 },
    ];
    const scale = coneScaleFromSpreads(spreads, SPOT, 120);
    expect(scale.kind).toBe("implied");
    if (scale.kind === "implied") {
      expect(scale.s0).toBeGreaterThan(0);
      expect(scale.sourceMinutesToClose).toBe(120);
    }
  });

  it("falls back to the prior when there are no usable live credits", () => {
    expect(coneScaleFromSpreads([], SPOT, 120).kind).toBe("prior");
    expect(
      coneScaleFromSpreads([{ side: "call_credit", shortStrike: 5025, creditNow: null }], SPOT, 120).kind,
    ).toBe("prior");
  });

  it("drops ill-conditioned credits instead of letting the 1.21 fallback masquerade as implied", () => {
    // near-zero credit (deep OTM) and a far-ITM spread both fail the inversion's guards;
    // previously impliedScale's internal prior leaked into the median as a fake "implied".
    const nearZero: ConeSpreadInput[] = [{ side: "call_credit", shortStrike: 5200, width: 5, creditNow: 0.01 }];
    expect(coneScaleFromSpreads(nearZero, SPOT, 120).kind).toBe("prior");
    const farItm: ConeSpreadInput[] = [{ side: "call_credit", shortStrike: 4900, width: 5, creditNow: 4.5 }];
    expect(coneScaleFromSpreads(farItm, SPOT, 120).kind).toBe("prior");
    // a healthy credit alongside junk still yields an implied scale from the healthy one
    const mixed: ConeSpreadInput[] = [
      { side: "call_credit", shortStrike: 5200, width: 5, creditNow: 0.01 },
      { side: "call_credit", shortStrike: 5025, width: 5, creditNow: 0.6 },
    ];
    const scale = coneScaleFromSpreads(mixed, SPOT, 120);
    expect(scale.kind).toBe("implied");
  });
});

describe("frontier identity", () => {
  it("ties the 1.645σ level to the ~0.05Δ one-sided tail", () => {
    expect(1 - normCdf(1.645)).toBeCloseTo(0.05, 3);
  });
});
