import { describe, expect, it } from "vitest";
import { RTH_MINUTES, sigmaMove, windowSigma } from "./sigmaMove";

const oneSigmaPct = 25 / Math.sqrt(252); // a 1σ day for a 25% IV name ≈ 1.575%

describe("sigmaMove", () => {
  it("turns a daily % move into IV-normalized standard deviations", () => {
    expect(sigmaMove(3.15, 0.25)).toBeCloseTo(3.15 / oneSigmaPct, 6);
    expect(sigmaMove(3.15, 0.25)).toBeCloseTo(2, 1); // ~+2σ
  });

  it("is signed, linear, and zero at no move", () => {
    expect(sigmaMove(-oneSigmaPct, 0.25)).toBeCloseTo(-1, 6);
    expect(sigmaMove(2 * oneSigmaPct, 0.25)).toBeCloseTo(2, 6);
    expect(sigmaMove(0, 0.25)).toBe(0);
  });

  it("scales inversely with IV — same move is fewer σ for a higher-vol name", () => {
    const lowVol = sigmaMove(3, 0.15) ?? 0;
    const highVol = sigmaMove(3, 0.6) ?? 0;
    expect(lowVol).toBeGreaterThan(highVol);
    expect(highVol).toBeGreaterThan(0);
  });

  it("returns null when the move or IV is missing/invalid", () => {
    expect(sigmaMove(null, 0.25)).toBeNull();
    expect(sigmaMove(2, null)).toBeNull();
    expect(sigmaMove(2, 0)).toBeNull();
    expect(sigmaMove(2, -0.3)).toBeNull();
    expect(sigmaMove(Number.NaN, 0.25)).toBeNull();
  });
});

describe("windowSigma", () => {
  it("equals the daily σ for the Day window (0 or full session)", () => {
    expect(windowSigma(3.15, 0.25, 0)).toBeCloseTo(sigmaMove(3.15, 0.25) ?? 0, 9);
    expect(windowSigma(3.15, 0.25, RTH_MINUTES)).toBeCloseTo(sigmaMove(3.15, 0.25) ?? 0, 9);
  });

  it("scales the daily σ by √(390/window) for shorter windows", () => {
    const five = windowSigma(0.5, 0.25, 5) ?? 0;
    const daily = sigmaMove(0.5, 0.25) ?? 0;
    expect(five).toBeCloseTo(daily * Math.sqrt(RTH_MINUTES / 5), 6);
    // the same small move is many more σ over 5 min than read as a full-day move
    expect(Math.abs(five)).toBeGreaterThan(Math.abs(daily));
  });

  it("reads a move equal to the window's own 1σ as ±1σ", () => {
    const dailySigmaPct = (0.25 * 100) / Math.sqrt(252);
    const fiveMin1Sigma = dailySigmaPct * Math.sqrt(5 / RTH_MINUTES);
    expect(windowSigma(fiveMin1Sigma, 0.25, 5)).toBeCloseTo(1, 6);
    expect(windowSigma(-fiveMin1Sigma, 0.25, 5)).toBeCloseTo(-1, 6);
  });

  it("is null when the move or IV is invalid", () => {
    expect(windowSigma(null, 0.25, 5)).toBeNull();
    expect(windowSigma(2, null, 5)).toBeNull();
  });
});
