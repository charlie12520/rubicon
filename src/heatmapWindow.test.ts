import { describe, expect, it } from "vitest";
import { HEATMAP_TIMEFRAMES, openingGapPct, timeframeDef, windowPct } from "./heatmapWindow";

describe("windowPct", () => {
  it("computes the trailing-window move from two prior-close readings", () => {
    // up 2% now, up 1.5% at the window start → price ratio 1.02/1.015 → ~+0.49%
    expect(windowPct(2, 1.5)).toBeCloseTo((1.02 / 1.015 - 1) * 100, 6);
  });

  it("handles a down move across the window", () => {
    // down 1% now, up 1% at start → 0.99/1.01 → ~-1.98%
    expect(windowPct(-1, 1)).toBeCloseTo((0.99 / 1.01 - 1) * 100, 6);
  });

  it("degrades to the since-first-print move when the window predates the first print", () => {
    expect(windowPct(2, null)).toBe(2);
    expect(windowPct(2, undefined)).toBe(2);
  });

  it("is null when there is no current reading", () => {
    expect(windowPct(null, 0)).toBeNull();
    expect(windowPct(undefined, 1)).toBeNull();
    expect(windowPct(Number.NaN, 1)).toBeNull();
  });

  it("is zero when the two readings are equal (no move over the window)", () => {
    expect(windowPct(1.3, 1.3)).toBeCloseTo(0, 9);
  });
});

describe("HEATMAP_TIMEFRAMES", () => {
  it("orders Gap, Day, then the trailing windows, shrinking the colour cap", () => {
    expect(HEATMAP_TIMEFRAMES.map((t) => t.key)).toEqual(["gap", "day", "4h", "1h", "30m", "5m"]);
    expect(timeframeDef("day").minutes).toBe(0);
    expect(timeframeDef("day").cap).toBe(3);
    expect(timeframeDef("4h").minutes).toBe(240);
    expect(timeframeDef("gap").gap).toBe(true);
    expect(timeframeDef("gap").minutes).toBe(0);
    expect(timeframeDef("5m").minutes).toBe(5);
    expect(timeframeDef("5m").cap).toBeLessThan(timeframeDef("1h").cap);
  });

  it("falls back to Day for an unknown key", () => {
    // @ts-expect-error — exercising the runtime fallback
    expect(timeframeDef("bogus").key).toBe("day");
  });
});

describe("openingGapPct", () => {
  it("returns the first printed minute's % (the opening gap)", () => {
    expect(openingGapPct([1.2, 0.5, -0.3])).toBe(1.2);
  });

  it("uses the first NON-null print when the open is missing", () => {
    expect(openingGapPct([null, null, 2.0, 1.5])).toBe(2.0);
  });

  it("is null when the name never printed", () => {
    expect(openingGapPct([null, null])).toBeNull();
    expect(openingGapPct([])).toBeNull();
  });
});
