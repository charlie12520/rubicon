import { describe, expect, it } from "vitest";
import {
  bachelierVertical,
  creditCurve,
  impliedScale,
  minutesToCloseFromLabel,
  normCdf,
  predictSpreadResponse,
  signedDistanceToLoss,
  spreadDelta,
  spreadThetaAt,
  spreadVega,
} from "./spreadResponse";

describe("normCdf", () => {
  it("anchors", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normCdf(-1.959964)).toBeCloseTo(0.025, 4);
    expect(normCdf(8)).toBeCloseTo(1, 6);
    expect(normCdf(-8)).toBeCloseTo(0, 6);
  });
});

describe("bachelierVertical", () => {
  it("is bounded in [0, W] and saturates", () => {
    expect(bachelierVertical(-200, 12, 5)).toBeCloseTo(0, 4);
    expect(bachelierVertical(200, 12, 5)).toBeCloseTo(5, 4);
  });
  it("payoff symmetry V(d)+V(W-d)=W", () => {
    for (const d of [-8, -2, 0, 1.5, 3, 7]) {
      expect(bachelierVertical(d, 9, 5) + bachelierVertical(5 - d, 9, 5)).toBeCloseTo(5, 4);
    }
  });
  it("monotone increasing in d", () => {
    let prev = -1;
    for (let d = -30; d <= 30; d += 2) {
      const v = bachelierVertical(d, 10, 5);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it("s -> 0 gives the step payoff", () => {
    expect(bachelierVertical(-3, 1e-9, 5)).toBeCloseTo(0, 6);
    expect(bachelierVertical(2.5, 1e-9, 5)).toBeCloseTo(2.5, 6);
    expect(bachelierVertical(9, 1e-9, 5)).toBeCloseTo(5, 6);
  });
});

describe("spreadDelta", () => {
  it("matches numeric derivative of bachelierVertical", () => {
    const s = 11, W = 5, h = 1e-3;
    for (const d of [-15, -5, 0, 2.5, 6]) {
      const num = (bachelierVertical(d + h, s, W) - bachelierVertical(d - h, s, W)) / (2 * h);
      expect(spreadDelta(d, s, W)).toBeCloseTo(num, 4);
    }
  });
  it("is in [0,1]", () => {
    expect(spreadDelta(0, 10, 5)).toBeGreaterThan(0);
    expect(spreadDelta(0, 10, 5)).toBeLessThanOrEqual(1);
  });
});

describe("signedDistanceToLoss", () => {
  it("orients calls up and puts down", () => {
    expect(signedDistanceToLoss("call_credit", 6010, 6020)).toBeCloseTo(-10);
    expect(signedDistanceToLoss("put_credit", 5990, 5980)).toBeCloseTo(-10);
  });
});

describe("impliedScale", () => {
  it("round-trips a known scale", () => {
    const W = 5, sTrue = 14, d0 = -7;
    const v0 = bachelierVertical(d0, sTrue, W);
    expect(impliedScale(v0, d0, W, 200)).toBeCloseTo(sTrue, 1);
  });
  it("falls back to the prior when credit ~ 0 or ~ W", () => {
    const prior = 1.21 * Math.sqrt(120);
    expect(impliedScale(0, -50, 5, 120)).toBeCloseTo(prior, 3);
    expect(impliedScale(5, 50, 5, 120)).toBeCloseTo(prior, 3);
  });
});

describe("predictSpreadResponse", () => {
  const base = {
    side: "call_credit" as const,
    shortStrike: 6020,
    width: 5,
    spot: 6005,
    credit: 0.6,
    minutesToClose: 180,
  };
  it("returns the current credit when level == spot", () => {
    const r = predictSpreadResponse({ ...base, level: base.spot });
    expect(r.creditAtLevel).toBeCloseTo(base.credit, 2);
    expect(r.deltaCredit).toBeCloseTo(0, 2);
  });
  it("credit rises as a call spread's spot moves toward/through the short strike", () => {
    const up = predictSpreadResponse({ ...base, level: 6020 });
    const down = predictSpreadResponse({ ...base, level: 5990 });
    expect(up.deltaCredit).toBeGreaterThan(0);
    expect(down.deltaCredit).toBeLessThan(0);
    expect(up.creditAtLevel).toBeGreaterThan(base.credit);
  });
  it("put credit spread is symmetric (toward loss = down)", () => {
    const put = { side: "put_credit" as const, shortStrike: 5990, width: 5, spot: 6005, credit: 0.6, minutesToClose: 180 };
    const r = predictSpreadResponse({ ...put, level: 5990 });
    expect(r.deltaCredit).toBeGreaterThan(0);
  });
  it("dollarsPerPointNow is within [0,100]", () => {
    const r = predictSpreadResponse({ ...base, level: base.spot });
    expect(r.dollarsPerPointNow).toBeGreaterThan(0);
    expect(r.dollarsPerPointNow).toBeLessThanOrEqual(100);
  });
  it("time decay: same level later in the day yields a smaller credit when OTM", () => {
    const early = predictSpreadResponse({ ...base, level: 6010, minutesToCloseAtLevel: 180 });
    const late = predictSpreadResponse({ ...base, level: 6010, minutesToCloseAtLevel: 20 });
    expect(late.creditAtLevel).toBeLessThan(early.creditAtLevel);
  });
});

describe("spreadVega", () => {
  it("is >0 for an OTM credit spread and → 0 far from the strikes", () => {
    expect(spreadVega(-8, 12, 5)).toBeGreaterThan(0); // short strike OTM
    expect(spreadVega(-200, 12, 5)).toBeCloseTo(0, 4); // far OTM
    expect(spreadVega(205, 12, 5)).toBeCloseTo(0, 4); // far ITM
  });
  it("is 0 when s → 0", () => {
    expect(spreadVega(-8, 0, 5)).toBe(0);
  });
});

describe("theta (predictSpreadResponse)", () => {
  // OTM call credit spread: short 6020, spot 6005 (15pt OTM), small credit.
  const otm = { side: "call_credit" as const, shortStrike: 6020, width: 5, spot: 6005, credit: 0.6 };

  it("decays in the seller's favor when OTM (>0) and tracks the instantaneous rate", () => {
    const r = predictSpreadResponse({ ...otm, minutesToClose: 180, level: otm.spot });
    expect(r.decayNextHourDollars).toBeGreaterThan(0);
    expect(r.thetaDollarsPerHourNow).toBeGreaterThan(0);
    // never decays more than the whole credit in an hour
    expect(r.decayNextHourDollars).toBeLessThanOrEqual(otm.credit * 100 + 1e-6);
  });

  it("accelerates into the close (same spread bleeds faster later in the day)", () => {
    const early = predictSpreadResponse({ ...otm, minutesToClose: 300, level: otm.spot });
    const late = predictSpreadResponse({ ...otm, minutesToClose: 90, level: otm.spot });
    expect(late.decayNextHourDollars).toBeGreaterThan(early.decayNextHourDollars);
  });

  it("clamps at the close: with <60m left, the next-hour decay is the full remaining credit", () => {
    const r = predictSpreadResponse({ ...otm, minutesToClose: 30, level: otm.spot });
    const vNow = bachelierVertical(signedDistanceToLoss("call_credit", otm.spot, otm.shortStrike), r.scaleNow, 5);
    expect(r.decayNextHourDollars).toBeCloseTo(vNow * 100, 4);
    expect(Number.isFinite(r.thetaDollarsPerHourNow)).toBe(true);
  });

  it("edge ratio θ/speed is higher further OTM than near the money", () => {
    const far = predictSpreadResponse({ side: "call_credit", shortStrike: 6045, width: 5, spot: 6005, credit: 0.15, minutesToClose: 180, level: 6005 });
    const near = predictSpreadResponse({ side: "call_credit", shortStrike: 6010, width: 5, spot: 6005, credit: 1.8, minutesToClose: 180, level: 6005 });
    expect(far.thetaPerSpeed).toBeGreaterThan(near.thetaPerSpeed);
  });

  it("puts behave the same way (OTM PCS decays favorably)", () => {
    const pcs = predictSpreadResponse({ side: "put_credit", shortStrike: 5990, width: 5, spot: 6005, credit: 0.6, minutesToClose: 180, level: 6005 });
    expect(pcs.decayNextHourDollars).toBeGreaterThan(0);
  });

  it("spreadThetaAt is the single source of truth behind predictSpreadResponse", () => {
    const r = predictSpreadResponse({ ...otm, minutesToClose: 180, level: otm.spot });
    const t = spreadThetaAt(r.distanceNow, r.scaleNow, 180, otm.width);
    expect(t.dollarsPerPoint).toBeCloseTo(r.dollarsPerPointNow, 9);
    expect(t.decayNextHourDollars).toBeCloseTo(r.decayNextHourDollars, 9);
    expect(t.thetaDollarsPerHourNow).toBeCloseTo(r.thetaDollarsPerHourNow, 9);
    expect(t.thetaPerSpeed).toBeCloseTo(r.thetaPerSpeed, 9);
  });
});

describe("creditCurve", () => {
  it("is monotone for a call spread across the level grid", () => {
    const pts = creditCurve(
      { side: "call_credit", shortStrike: 6020, width: 5, spot: 6005, credit: 0.6, minutesToClose: 180 },
      5970,
      6050,
      41,
    );
    expect(pts).toHaveLength(41);
    for (let i = 1; i < pts.length; i++) expect(pts[i].credit).toBeGreaterThanOrEqual(pts[i - 1].credit - 1e-9);
    expect(pts[0].credit).toBeLessThan(0.2);
    expect(pts[pts.length - 1].credit).toBeGreaterThan(4.5);
  });
});

describe("minutesToCloseFromLabel", () => {
  it("parses ET labels", () => {
    expect(minutesToCloseFromLabel("09:30")).toBeCloseTo(390);
    expect(minutesToCloseFromLabel("15:00")).toBeCloseTo(60);
    expect(minutesToCloseFromLabel("16:00")).toBeCloseTo(0.5);
  });
  it("returns null for non-time labels", () => {
    expect(minutesToCloseFromLabel("Full day")).toBeNull();
    expect(minutesToCloseFromLabel("--:--")).toBeNull();
    expect(minutesToCloseFromLabel(null)).toBeNull();
  });
});
