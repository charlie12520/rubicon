import { describe, expect, it } from "vitest";
import type { TradeRecord } from "../shared/types";
import { countTradesByDate, mapTradesById, selectTradeById, selectTradeByIdOrFirst, sortTradesByEntryTime, tradesForDate } from "./tradeSelectors";

describe("trade selectors", () => {
  const trades = [
    trade({ date: "2026-05-29", entryTime: "2026-05-29T10:30:00-04:00", id: "late" }),
    trade({ date: "2026-05-28", entryTime: "2026-05-28T09:45:00-04:00", id: "other-date" }),
    trade({ date: "2026-05-29", entryTime: "2026-05-29T09:35:00-04:00", id: "early" }),
  ];

  it("counts and filters trades by trade date", () => {
    const counts = countTradesByDate(trades);

    expect(counts.get("2026-05-29")).toBe(2);
    expect(counts.get("2026-05-28")).toBe(1);
    expect(tradesForDate(trades, "2026-05-29").map((nextTrade) => nextTrade.id)).toEqual(["late", "early"]);
  });

  it("selects explicit trade IDs with a first-trade fallback when requested", () => {
    expect(selectTradeById(trades, "early")?.id).toBe("early");
    expect(selectTradeById(trades, "missing")).toBeNull();
    expect(selectTradeByIdOrFirst(trades, "missing")?.id).toBe("late");
    expect(selectTradeByIdOrFirst([], "missing")).toBeNull();
  });

  it("sorts trades by parsed entry timestamp and maps trades by ID", () => {
    expect(sortTradesByEntryTime(trades).map((nextTrade) => nextTrade.id)).toEqual(["other-date", "early", "late"]);
    expect(mapTradesById(trades).get("late")?.entryTime).toBe("2026-05-29T10:30:00-04:00");
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
