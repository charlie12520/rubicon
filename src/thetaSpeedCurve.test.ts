import { describe, expect, it } from "vitest";
import { buildThetaSpeedCurve, resolveMoveScale } from "./thetaSpeedCurve";
import { priorRate } from "./expectedMoveCone";

describe("buildThetaSpeedCurve", () => {
  const c = buildThetaSpeedCurve({ spot: 6000, minutesToClose: 120, moveScale: 30 });

  it("produces a non-trivial curve of finite, positive points", () => {
    expect(c.points.length).toBeGreaterThan(10);
    for (const p of c.points) {
      expect(Number.isFinite(p.thetaPerSpeed)).toBe(true);
      expect(p.delta).toBeGreaterThanOrEqual(0.01 - 1e-9);
      expect(p.delta).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(p.thetaPerSpeed).toBeGreaterThan(0);
    }
  });

  it("edge ratio is U-shaped: furthest OTM > nearest ATM", () => {
    const sorted = [...c.points].sort((a, b) => a.distOtm - b.distOtm);
    expect(sorted[sorted.length - 1].thetaPerSpeed).toBeGreaterThan(sorted[0].thetaPerSpeed);
  });

  it("covers both call (above spot) and put (below spot) strikes", () => {
    expect(c.points.some((p) => p.side === "call_credit" && p.strike > 6000)).toBe(true);
    expect(c.points.some((p) => p.side === "put_credit" && p.strike < 6000)).toBe(true);
  });
});

describe("resolveMoveScale", () => {
  it("returns the implied scale at its source time and rolls it by sqrt-time", () => {
    expect(resolveMoveScale({ kind: "implied", s0: 20, sourceMinutesToClose: 120 }, 120)).toBeCloseTo(20, 6);
    expect(resolveMoveScale({ kind: "implied", s0: 20, sourceMinutesToClose: 120 }, 30)).toBeCloseTo(20 * Math.sqrt(30 / 120), 6);
  });

  it("falls back to the time-of-day prior when no implied scale", () => {
    const m = 120;
    expect(resolveMoveScale({ kind: "prior" }, m)).toBeCloseTo(priorRate(m) * Math.sqrt(m), 6);
  });
});
