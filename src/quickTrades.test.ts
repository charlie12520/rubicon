import { describe, expect, it } from "vitest";
import type { TradeRecord } from "../shared/types";
import {
  buildQuickSpreadGroups,
  quickSpreadAriaLabel,
  quickSpreadKey,
  quickSpreadLabel,
  quickTradeAriaLabel,
  quickTradeCountLabel,
  quickTradeLabel,
} from "./quickTrades";

describe("replay quick trade labels", () => {
  it("includes time, side, strikes, and size in compact quick-access labels", () => {
    expect(quickTradeLabel(trade({ entryTime: "2026-05-28T10:15:02-04:00", contracts: 20 }))).toBe("10:15 C 7565/7570 x20");
  });

  it("keeps entry price alerts reachable from quick-access buttons", () => {
    expect(quickTradeAriaLabel(trade({ entryChartDeviationFlag: true }))).toContain("entry price alert");
  });

  it("summarizes every selected-date trade as quick checks", () => {
    expect(quickTradeCountLabel([trade({ id: "one" }), trade({ id: "two" }), trade({ id: "three" })])).toBe("3 quick checks");
  });

  it("groups same-date entries by side and strikes for spread-level replay", () => {
    const groups = buildQuickSpreadGroups([
      trade({ id: "call-a", contracts: 5, pnl: 125 }),
      trade({ id: "put-a", side: "Put", shortStrike: 7555, longStrike: 7550, entryTime: "2026-05-28T09:45:00-04:00", contracts: 10, pnl: -50 }),
      trade({ id: "call-b", entryTime: "2026-05-28T10:15:00-04:00", contracts: 15, pnl: 250 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].trades.map((nextTrade) => nextTrade.id)).toEqual(["call-a", "call-b"]);
    expect(groups[0].contracts).toBe(20);
    expect(groups[0].pnl).toBe(375);
    expect(quickSpreadKey(groups[0].trades[0])).toBe("2026-05-28:Call:7565:7570");
    expect(quickSpreadLabel(groups[0])).toBe("Call 7565/7570 - 2 entries");
    expect(quickSpreadAriaLabel(groups[0])).toContain("20 total contracts");
  });
});

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    account: "test",
    bias: "Neutral",
    contracts: 10,
    date: "2026-05-28",
    entryPrice: -0.3,
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    entryTime: "2026-05-28T09:30:30-04:00",
    expiration: "2026-05-28",
    exitPrice: 0,
    exitTime: "2026-05-28T09:40:00-04:00",
    fees: 0,
    id: "trade",
    legs: [],
    longStrike: 7570,
    maxProfit: 30,
    maxRisk: 470,
    notes: "",
    pnl: 0,
    positionAfter: 0,
    positionBefore: 0,
    priceType: "Credit",
    returnOnRisk: null,
    shortStrike: 7565,
    side: "Call",
    source: "test",
    spxEntry: null,
    spxExit: null,
    status: "Closed",
    strategy: "Call Credit Spread",
    width: 5,
    winLoss: "Flat",
    ...overrides,
  };
}
