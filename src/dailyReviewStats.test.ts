import { describe, expect, it } from "vitest";
import type { SpxBar, TradeRecord } from "../shared/types";
import { buildDailyReviewStatItems, closestStrikeApproach, realizedSessionRate } from "./dailyReviewStats";

function bar(minute: number, close: number, spread = 1): SpxBar {
  const hh = String(9 + Math.floor((30 + minute) / 60)).padStart(2, "0");
  const mm = String((30 + minute) % 60).padStart(2, "0");
  return {
    time: 1_700_000_000 + minute * 60,
    timestampEt: `2026-06-09T${hh}:${mm}:00-04:00`,
    label: `${hh}:${mm}`,
    open: close,
    high: close + spread,
    low: close - spread,
    close,
  } as SpxBar;
}

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    id: "T1",
    side: "Put",
    strategy: "Put Credit Spread",
    entryTime: "2026-06-09T10:00:00-04:00",
    exitTime: "2026-06-09T12:00:00-04:00",
    shortStrike: 7400,
    longStrike: 7395,
    width: 5,
    contracts: 5,
    entryPrice: -0.8,
    exitPrice: -0.2,
    priceType: "Credit",
    pnl: 300,
    winLoss: "Win",
    entryChartDeviationFlag: false,
    ...overrides,
  } as TradeRecord;
}

const FLAT_BARS: SpxBar[] = Array.from({ length: 120 }, (_, i) => bar(i, 7450));

describe("realizedSessionRate", () => {
  it("matches the per-minute RMS of close-to-close moves", () => {
    // alternating +2/-2 closes => every diff is ±2 => rate exactly 2 pts/√min
    const bars = Array.from({ length: 60 }, (_, i) => bar(i, 7450 + (i % 2 === 0 ? 0 : 2)));
    expect(realizedSessionRate(bars)).toBeCloseTo(2, 6);
  });

  it("returns null for too-short sessions", () => {
    expect(realizedSessionRate(FLAT_BARS.slice(0, 10))).toBeNull();
  });

  it("normalizes 5-second replay bars to a per-minute rate", () => {
    // same alternating ±2 closes but at 5s spacing: per-bar RMS 2 pts must
    // scale to 2/sqrt(5/60) = 2*sqrt(12) pts/sqrt-minute
    const fiveSecondBars = Array.from({ length: 200 }, (_, i) => ({
      ...bar(0, 7450 + (i % 2 === 0 ? 0 : 2)),
      time: 1_700_000_000 + i * 5,
    }));
    expect(realizedSessionRate(fiveSecondBars)).toBeCloseTo(2 * Math.sqrt(12), 6);
  });
});

describe("closestStrikeApproach", () => {
  it("measures put-side distance against bar lows during the trade window only", () => {
    const bars = [
      ...Array.from({ length: 40 }, (_, i) => bar(i, 7450)),
      bar(40, 7412, 2), // low 7410 -> 10 pts above the 7400 short
      ...Array.from({ length: 40 }, (_, i) => bar(41 + i, 7440)),
    ];
    const result = closestStrikeApproach([trade({})], bars);
    expect(result).not.toBeNull();
    expect(result!.worstPts).toBeCloseTo(10, 6);
    expect(result!.worstLabel).toBe("Put 7400");
    expect(result!.breachedCount).toBe(0);
  });

  it("flags a breach when SPX trades through the short strike", () => {
    const bars = [
      ...Array.from({ length: 40 }, (_, i) => bar(i, 7450)),
      bar(40, 7396, 2), // low 7394 -> 6 pts THROUGH the 7400 short
      ...Array.from({ length: 40 }, (_, i) => bar(41 + i, 7440)),
    ];
    const result = closestStrikeApproach([trade({})], bars);
    expect(result!.worstPts).toBeCloseTo(-6, 6);
    expect(result!.breachedCount).toBe(1);
  });

  it("ignores bars outside the holding window and call sides measure against highs", () => {
    const bars = [
      bar(0, 7510, 2), // before entry: would breach a 7500 call but must not count
      ...Array.from({ length: 60 }, (_, i) => bar(1 + i, 7450)),
    ];
    const callTrade = trade({ side: "Call", shortStrike: 7500, entryTime: "2026-06-09T10:00:00-04:00", exitTime: null });
    const result = closestStrikeApproach([callTrade], bars);
    expect(result!.worstPts).toBeCloseTo(7500 - 7451, 6);
    expect(result!.breachedCount).toBe(0);
  });
});

describe("buildDailyReviewStatItems", () => {
  it("returns an empty list when there are no trades", () => {
    expect(buildDailyReviewStatItems({ trades: [], spxBars: FLAT_BARS })).toEqual([]);
  });

  it("builds the full stat list with sensible values", () => {
    const trades = [
      trade({ id: "T1", pnl: 300, winLoss: "Win" }),
      trade({ id: "T2", pnl: -150, winLoss: "Loss", entryChartDeviationFlag: true, exitTime: "2026-06-09T11:00:00-04:00" }),
    ];
    const items = buildDailyReviewStatItems({ trades, spxBars: FLAT_BARS });
    const byKey = new Map(items.map((item) => [item.key, item]));

    expect(byKey.get("profit-factor")!.value).toBe("2.00");
    expect(byKey.get("profit-factor")!.tone).toBe("good");
    // capture = 150 / (0.8*5*100 * 2 trades) = 150/800 = 18.75%
    expect(byKey.get("credit-capture")!.value).toBe("+19%");
    expect(byKey.get("avg-credit")!.value).toBe("0.80 pts");
    expect(byKey.get("avg-hold")!.value).toBe("1h 30m");
    expect(byKey.get("entry-slippage")!.value).toBe("1");
    expect(byKey.get("entry-slippage")!.tone).toBe("bad");
    expect(byKey.get("session-move")).toBeDefined();
    expect(byKey.get("session-range")).toBeDefined();
    expect(byKey.get("strike-approach")).toBeDefined();
  });

  it("shows an infinite profit factor on an all-win day", () => {
    const items = buildDailyReviewStatItems({ trades: [trade({})], spxBars: FLAT_BARS });
    const pf = items.find((item) => item.key === "profit-factor")!;
    expect(pf.value).toBe("∞");
    expect(pf.tone).toBe("good");
  });

  it("marks a hot session as elevated vol", () => {
    // alternating ±4 pts per minute => rate 4 pts/√min => ~1.9x typical (2.1)
    const hotBars = Array.from({ length: 120 }, (_, i) => bar(i, 7450 + (i % 2 === 0 ? 0 : 4)));
    const items = buildDailyReviewStatItems({ trades: [trade({})], spxBars: hotBars });
    const vol = items.find((item) => item.key === "session-vol")!;
    expect(vol.tone).toBe("bad");
    expect(vol.value).toMatch(/^1\.9[0-9]?×$/);
  });
});
