import { describe, expect, it } from "vitest";
import type { TradeRecord } from "../shared/types";
import { isSyntheticExpirationExit, tradeClockLabel, tradeExitClockLabel, tradeHeldLabel, tradeTimestamp } from "./tradeTime";

describe("trade time helpers", () => {
  it("formats clock labels from ISO-like trade timestamps", () => {
    expect(tradeClockLabel("2026-05-28T10:15:02-04:00")).toBe("10:15");
    expect(tradeClockLabel("2026-05-28 11:42:00")).toBe("11:42");
    expect(tradeClockLabel("", "Open")).toBe("Open");
  });

  it("normalizes timestamps to epoch milliseconds with an invalid fallback", () => {
    expect(tradeTimestamp("2026-05-28T10:15:02-04:00")).toBe(Date.parse("2026-05-28T10:15:02-04:00"));
    expect(tradeTimestamp("not a date")).toBe(0);
  });

  it("labels open, regular exit, and synthetic expiration exits", () => {
    expect(tradeExitClockLabel(trade({ exitTime: null, status: "Open" }))).toBe("Open");
    expect(tradeExitClockLabel(trade({ exitTime: "2026-05-28T10:45:00-04:00" }))).toBe("10:45");
    const expired = trade({ exitTime: "2026-05-28T16:00:00-04:00", status: "Expired" });
    expect(isSyntheticExpirationExit(expired)).toBe(true);
    expect(tradeExitClockLabel(expired)).toBe("EOD");
  });

  it("formats held time with optional expiration-as-EOD behavior", () => {
    expect(tradeHeldLabel(trade({ exitTime: null, status: "Open" }))).toBe("Open");
    expect(tradeHeldLabel(trade({ entryTime: "2026-05-28T10:15:00-04:00", exitTime: "2026-05-28T10:59:00-04:00" }))).toBe("44m");
    expect(tradeHeldLabel(trade({ entryTime: "2026-05-28T10:15:00-04:00", exitTime: "2026-05-28T12:30:00-04:00" }))).toBe("2h 15m");
    expect(tradeHeldLabel(trade({ entryTime: "bad", exitTime: "2026-05-28T12:30:00-04:00" }))).toBe("-");
    expect(tradeHeldLabel(trade({ exitTime: "2026-05-28T16:00:00-04:00", status: "Expired" }), { expirationAsEod: true })).toBe("EOD");
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
