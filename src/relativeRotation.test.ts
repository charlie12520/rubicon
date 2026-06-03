import { describe, expect, it } from "vitest";
import {
  buildBasketCloses,
  computeRrg,
  defaultWindows,
  quadrantOf,
  resampleWeekly,
  rollingZScore,
  rrgBounds,
  type DailyBar,
} from "./relativeRotation";

function addDays(start: string, days: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function makeBars(closes: number[], start = "2026-01-01"): DailyBar[] {
  return closes.map((close, i) => ({
    date: addDays(start, i),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
}

function geometric(rate: number, n: number, base = 100): number[] {
  return Array.from({ length: n }, (_, i) => base * rate ** i);
}

describe("quadrantOf", () => {
  it("maps the four quadrants with the 100/100 origin", () => {
    expect(quadrantOf(101, 101)).toBe("leading");
    expect(quadrantOf(101, 99)).toBe("weakening");
    expect(quadrantOf(99, 99)).toBe("lagging");
    expect(quadrantOf(99, 101)).toBe("improving");
  });

  it("treats the axes (==100) as the strong/rising side", () => {
    expect(quadrantOf(100, 100)).toBe("leading");
  });
});

describe("rollingZScore", () => {
  it("returns nulls during warm-up then the trailing z-score", () => {
    expect(rollingZScore([1, 2, 3, 4, 5], 3)).toEqual([null, null, 1, 1, 1]);
  });

  it("reads a flat window as neutral (0), not NaN", () => {
    expect(rollingZScore([5, 5, 5, 5], 2)).toEqual([null, 0, 0, 0]);
  });

  it("propagates nulls inside the window as warm-up", () => {
    expect(rollingZScore([null, 2, 3, 4], 3)).toEqual([null, null, null, 1]);
  });
});

describe("resampleWeekly", () => {
  it("aggregates daily bars into weekly OHLCV dated on the last session", () => {
    const daily: DailyBar[] = [
      { date: "2026-01-05", open: 10, high: 12, low: 9, close: 11, volume: 100 }, // Mon
      { date: "2026-01-06", open: 11, high: 14, low: 10, close: 13, volume: 120 },
      { date: "2026-01-09", open: 13, high: 15, low: 8, close: 9, volume: 90 }, // Fri
      { date: "2026-01-12", open: 9, high: 11, low: 8, close: 10, volume: 80 }, // next Mon
      { date: "2026-01-16", open: 10, high: 18, low: 10, close: 17, volume: 70 },
    ];
    const weekly = resampleWeekly(daily);
    expect(weekly).toHaveLength(2);
    expect(weekly[0]).toEqual({ date: "2026-01-09", open: 10, high: 15, low: 8, close: 9, volume: 310 });
    expect(weekly[1]).toEqual({ date: "2026-01-16", open: 9, high: 18, low: 8, close: 17, volume: 150 });
  });
});

describe("buildBasketCloses", () => {
  it("builds an equal-weight index rebased to 100 at the first shared date", () => {
    const basket = buildBasketCloses(
      { A: makeBars([100, 110]), B: makeBars([100, 90]) },
      ["A", "B"],
      "daily",
    );
    expect(basket.map((b) => b.close)).toEqual([100, 100]); // +10% and -10% cancel
  });

  it("intersects constituent dates so every weight is present", () => {
    const basket = buildBasketCloses(
      { A: makeBars([100, 102, 104]), B: makeBars([100, 101]) },
      ["A", "B"],
      "daily",
    );
    expect(basket).toHaveLength(2); // only the two shared dates
  });
});

describe("computeRrg", () => {
  const start = "2026-01-01";
  const n = 26;
  const barsBySymbol: Record<string, DailyBar[]> = {
    BENCH: makeBars(geometric(1.005, n), start),
    TRACK: makeBars(geometric(1.005, n), start), // identical to benchmark
    UP: makeBars(geometric(1.02, n), start),
    DOWN: makeBars(geometric(0.98, n), start),
  };
  const base = {
    barsBySymbol,
    symbols: ["TRACK", "UP", "DOWN"],
    benchmark: { kind: "symbol" as const, symbol: "BENCH" },
    timeframe: "daily" as const,
    ratioWindow: 4,
    momentumWindow: 4,
    tailLength: 6,
  };

  it("places a benchmark tracker exactly on the 100/100 origin", () => {
    const track = computeRrg(base).series.find((s) => s.symbol === "TRACK");
    expect(track).toBeDefined();
    expect(track!.head.rsRatio).toBeCloseTo(100, 6);
    expect(track!.head.rsMomentum).toBeCloseTo(100, 6);
  });

  it("ranks a steady out-performer right of an under-performer, around 100", () => {
    const result = computeRrg(base);
    const up = result.series.find((s) => s.symbol === "UP")!;
    const down = result.series.find((s) => s.symbol === "DOWN")!;
    expect(up.head.rsRatio).toBeGreaterThan(100);
    expect(down.head.rsRatio).toBeLessThan(100);
    expect(up.head.rsRatio).toBeGreaterThan(down.head.rsRatio);
  });

  it("skips the benchmark symbol when it appears in the plot list", () => {
    const result = computeRrg({ ...base, symbols: ["BENCH", "UP"] });
    expect(result.series.map((s) => s.symbol)).toEqual(["UP"]);
    expect(result.skipped).toContainEqual({ symbol: "BENCH", reason: "is benchmark" });
  });

  it("skips symbols without enough history and explains why", () => {
    const result = computeRrg({
      ...base,
      barsBySymbol: { ...barsBySymbol, SHORT: makeBars([1, 2, 3], start) },
      symbols: ["UP", "SHORT"],
    });
    expect(result.series.map((s) => s.symbol)).toEqual(["UP"]);
    expect(result.skipped.find((s) => s.symbol === "SHORT")?.reason).toMatch(/needs \d+ daily bars/);
  });

  it("limits each tail to tailLength points", () => {
    for (const s of computeRrg({ ...base, tailLength: 3 }).series) {
      expect(s.points.length).toBeLessThanOrEqual(3);
      expect(s.head).toBe(s.points[s.points.length - 1]);
    }
  });

  it("clamps the analysis to the as-of date", () => {
    const result = computeRrg(base);
    const asOf = result.dates[18];
    const clamped = computeRrg({ ...base, asOf });
    expect(clamped.asOf).toBe(asOf);
    for (const s of clamped.series) {
      expect(s.head.date <= asOf).toBe(true);
    }
  });

  it("exposes the benchmark date axis and a basket label", () => {
    const symbolResult = computeRrg(base);
    expect(symbolResult.dates).toEqual(barsBySymbol.BENCH.map((b) => b.date));
    expect(symbolResult.benchmarkLabel).toBe("BENCH");

    const basketResult = computeRrg({
      ...base,
      symbols: ["UP", "DOWN"],
      benchmark: { kind: "basket", symbols: ["UP", "DOWN"] },
    });
    expect(basketResult.benchmarkLabel).toBe("Equal-weight (2)");
    expect(basketResult.series.length).toBe(2);
  });
});

describe("defaultWindows / rrgBounds", () => {
  it("uses slower windows for daily than weekly", () => {
    expect(defaultWindows("daily")).toEqual({ ratioWindow: 50, momentumWindow: 20 });
    expect(defaultWindows("weekly")).toEqual({ ratioWindow: 12, momentumWindow: 10 });
  });

  it("returns symmetric bounds padded around 100", () => {
    const bounds = rrgBounds([
      {
        symbol: "X",
        points: [{ date: "2026-01-01", rsRatio: 104, rsMomentum: 98, quadrant: "weakening" }],
        head: { date: "2026-01-01", rsRatio: 104, rsMomentum: 98, quadrant: "weakening" },
        quadrant: "weakening",
      },
    ]);
    expect(bounds.min).toBeLessThan(100);
    expect(bounds.max).toBeGreaterThan(100);
    expect(bounds.min + bounds.max).toBeCloseTo(200, 6); // symmetric about 100
  });
});
