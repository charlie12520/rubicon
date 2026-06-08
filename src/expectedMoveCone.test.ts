import { describe, expect, it } from "vitest";
import { normCdf } from "./spreadResponse";
import {
  CONE_PRIOR_A,
  coneScaleFromSpreads,
  expectedMoveCone,
  priorRate,
  type ConeSpreadInput,
} from "./expectedMoveCone";

const SPOT = 5000;

describe("expectedMoveCone", () => {
  it("sizes the 1σ half-width at the close to r·√(minutes_to_close)", () => {
    const cone = expectedMoveCone({ anchorSpot: SPOT, anchorMinutesToClose: 120, scale: { kind: "prior", a: 2 } });
    expect(cone.rate).toBe(2);
    expect(cone.sAtClose).toBeCloseTo(2 * Math.sqrt(120), 6); // ≈21.908
    expect(cone.closeRange.upper).toBeCloseTo(SPOT + 2 * Math.sqrt(120), 6);
    const k2 = cone.levels.find((l) => l.k === 2)!;
    expect(k2.points.at(-1)!.half).toBeCloseTo(2 * 2 * Math.sqrt(120), 6); // k·r·√mtc
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

  it("is identical whether the same rate arrives as an implied or prior scale", () => {
    const a = 2.0;
    const mtc = 120;
    const prior = expectedMoveCone({ anchorSpot: SPOT, anchorMinutesToClose: mtc, scale: { kind: "prior", a } });
    const implied = expectedMoveCone({
      anchorSpot: SPOT,
      anchorMinutesToClose: mtc,
      scale: { kind: "implied", s0: a * Math.sqrt(mtc), sourceMinutesToClose: mtc },
    });
    expect(implied.rate).toBeCloseTo(prior.rate, 9);
    const pp = prior.levels[0].points;
    const ip = implied.levels[0].points;
    for (let i = 0; i < pp.length; i++) expect(ip[i].upper).toBeCloseTo(pp[i].upper, 9);
  });

  it("scales the half-width linearly in k", () => {
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

  it("follows the √t law — 4× the elapsed time ⇒ 2× the width", () => {
    const cone = expectedMoveCone({ anchorSpot: SPOT, anchorMinutesToClose: 200, scale: { kind: "prior", a: 2 }, stepMinutes: 10 });
    const pts = cone.levels[0].points;
    const at10 = pts.find((p) => p.elapsedMinutes === 10)!;
    const at40 = pts.find((p) => p.elapsedMinutes === 40)!;
    expect(at40.half / at10.half).toBeCloseTo(2, 9);
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
});

describe("frontier identity", () => {
  it("ties the 1.645σ level to the ~0.05Δ one-sided tail", () => {
    expect(1 - normCdf(1.645)).toBeCloseTo(0.05, 3);
  });
});
