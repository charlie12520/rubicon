import { describe, expect, it } from "vitest";
import { buildWarmedCheatOverlays, ema, maLine, movingAverage, sma } from "./movingAverages";

describe("sma", () => {
  it("emits null until enough history, then the rolling mean", () => {
    expect(sma([1, 2, 3, 4, 5], 2)).toEqual([null, 1.5, 2.5, 3.5, 4.5]);
    expect(sma([2, 4, 6], 3)).toEqual([null, null, 4]);
  });

  it("is entirely null when the period exceeds the data length", () => {
    expect(sma([1, 2], 3)).toEqual([null, null]);
  });

  it("can warm up before the full window by averaging available history", () => {
    expect(sma([1, 2, 3, 4, 5], 5, { minPeriods: 3 })).toEqual([null, null, 2, 2.5, 3]);
  });
});

describe("ema", () => {
  it("seeds at the first value and emits one value per point", () => {
    const out = ema([2, 4, 6, 8], 2);
    expect(out).toHaveLength(4);
    expect(out[0]).toBe(2);
    // k = 2/3
    expect(out[1] as number).toBeCloseTo(3.3333, 4);
    expect(out[2] as number).toBeCloseTo(5.1111, 4);
    expect(out[3] as number).toBeCloseTo(7.037, 3);
  });

  it("returns [] for empty input", () => {
    expect(ema([], 50)).toEqual([]);
  });

  it("can hide warmup points while preserving recursive EMA state", () => {
    const out = ema([2, 4, 6, 8], 2, { minPeriods: 3 });
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2] as number).toBeCloseTo(5.1111, 4);
    expect(out[3] as number).toBeCloseTo(7.037, 3);
  });
});

describe("movingAverage", () => {
  it("dispatches to ema or sma by kind", () => {
    expect(movingAverage([1, 2, 3], "sma", 2)).toEqual(sma([1, 2, 3], 2));
    expect(movingAverage([1, 2, 3], "ema", 2)).toEqual(ema([1, 2, 3], 2));
  });
});

describe("maLine", () => {
  it("drops undefined leading points and keeps time alignment", () => {
    const points = [
      { time: 100, value: 10 },
      { time: 160, value: 20 },
      { time: 220, value: 30 },
    ];
    const line = maLine(points, "sma", 2);
    expect(line).toEqual([
      { time: 160, value: 15 },
      { time: 220, value: 25 },
    ]);
  });

  it("returns an empty line when no average is defined", () => {
    expect(maLine([{ time: 1, value: 5 }], "sma", 200)).toEqual([]);
  });

  it("keeps chart time alignment when using a partial warmup", () => {
    const points = [
      { time: 100, value: 10 },
      { time: 160, value: 20 },
      { time: 220, value: 30 },
    ];
    expect(maLine(points, "sma", 50, { minPeriods: 2 })).toEqual([
      { time: 160, value: 15 },
      { time: 220, value: 20 },
    ]);
  });
});

describe("buildWarmedCheatOverlays (multi-day cheat code)", () => {
  // 250 prior-session closes (values 0..249) warm a 3-bar session — enough for a
  // TRUE 200-period MA on a session that has only 3 of its own bars.
  const warmupCloses = Array.from({ length: 250 }, (_, i) => i);
  const sessionBars = [
    { time: 10000, close: 1000 },
    { time: 10060, close: 1001 },
    { time: 10120, close: 1002 },
  ];

  it("emits all four MAs, each fully defined across the whole session", () => {
    const overlays = buildWarmedCheatOverlays(sessionBars, warmupCloses);
    expect(overlays.map((overlay) => overlay.id)).toEqual(["ema50", "sma50", "ema200", "sma200"]);
    for (const overlay of overlays) {
      expect(overlay.data).toHaveLength(sessionBars.length); // no blank/partial gaps
      expect(overlay.data.map((point) => point.time)).toEqual([10000, 10060, 10120]);
    }
    expect(overlays.find((o) => o.id === "sma200")?.dashed).toBe(true);
    expect(overlays.find((o) => o.id === "ema200")?.color).toBe("#f97316");
  });

  it("computes a TRUE 200-period SMA from the trailing 200 closes (impossible single-session)", () => {
    const sma200 = buildWarmedCheatOverlays(sessionBars, warmupCloses).find((o) => o.id === "sma200");
    // Each value is the mean of the 200 closes ending at that session bar.
    expect(sma200?.data).toEqual([
      { time: 10000, value: 154.25 },
      { time: 10060, value: 159 },
      { time: 10120, value: 163.75 },
    ]);
    const sma50 = buildWarmedCheatOverlays(sessionBars, warmupCloses).find((o) => o.id === "sma50");
    expect(sma50?.data[0]).toEqual({ time: 10000, value: 240.5 });
  });

  it("matches the recursive EMA over the concatenated warmup+session series", () => {
    const closes = [...warmupCloses, ...sessionBars.map((bar) => bar.close)];
    const reference = ema(closes, 200);
    const ema200 = buildWarmedCheatOverlays(sessionBars, warmupCloses).find((o) => o.id === "ema200");
    expect(ema200?.data.map((point) => point.value)).toEqual([
      reference[250] as number,
      reference[251] as number,
      reference[252] as number,
    ]);
  });

  it("degrades honestly: no fake 200 line when warmup is missing", () => {
    // Empty warmup + a 3-bar session cannot support a real 50/200 MA, so those
    // overlays are dropped rather than drawn as a misleading partial.
    const overlays = buildWarmedCheatOverlays(sessionBars, []);
    expect(overlays).toEqual([]);
    expect(buildWarmedCheatOverlays([], warmupCloses)).toEqual([]);
  });
});
