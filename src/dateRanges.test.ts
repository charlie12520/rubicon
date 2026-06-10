import { describe, expect, it } from "vitest";
import { previousTradingSessionDate, resolveRange, tradesInRange } from "./dateRanges";
import type { TradeRecord } from "../shared/types";

describe("date ranges", () => {
  it("uses Friday as the previous trading session on Monday", () => {
    expect(previousTradingSessionDate("2026-06-08")).toBe("2026-06-05");
    expect(resolveRange("yesterday", "2026-06-08", "")).toEqual({
      end: "2026-06-05",
      label: "2026-06-05",
      start: "2026-06-05",
    });
  });

  it("uses Friday as the previous trading session during the weekend", () => {
    expect(previousTradingSessionDate("2026-06-07")).toBe("2026-06-05");
    expect(previousTradingSessionDate("2026-06-06")).toBe("2026-06-05");
  });

  it("filters yesterday trades to the previous trading session", () => {
    const friday = trade("friday", "2026-06-05");
    const sunday = trade("sunday", "2026-06-07");
    const monday = trade("monday", "2026-06-08");

    expect(tradesInRange([friday, sunday, monday], "yesterday", "2026-06-08", "").map((item) => item.id)).toEqual([
      "friday",
    ]);
  });
});

function trade(id: string, date: string): TradeRecord {
  return {
    account: "test",
    bias: "Bearish",
    contracts: 1,
    date,
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    entryPrice: -1,
    entryTime: `${date}T09:31:00-04:00`,
    expiration: date.replaceAll("-", ""),
    exitPrice: -0.5,
    exitTime: `${date}T10:00:00-04:00`,
    fees: 0,
    id,
    legs: [],
    longStrike: 7470,
    maxProfit: 100,
    maxRisk: 400,
    notes: "",
    pnl: 100,
    positionAfter: 0,
    positionBefore: 1,
    priceType: "Credit",
    returnOnRisk: 0.25,
    shortStrike: 7475,
    side: "Put",
    source: "test",
    spxEntry: null,
    spxExit: null,
    status: "Closed",
    strategy: "Credit",
    width: 5,
    winLoss: "Win",
  };
}
