import { describe, expect, it } from "vitest";
import type { TradeRecord } from "../shared/types";
import { nearestPoint, pointAtOrBefore, pointValue, tradeBoundaryEvents } from "./tradeChartEvents";

describe("trade chart events", () => {
  it("builds entry and exit boundary events with synthetic expiration control", () => {
    const expired = trade({ exitTime: "2026-05-28T16:00:00-04:00", status: "Expired" });

    expect(tradeBoundaryEvents(expired).map((event) => event.kind)).toEqual(["entry"]);
    expect(tradeBoundaryEvents(expired, { includeSyntheticExpirationExit: true }).map((event) => event.kind)).toEqual(["entry", "exit"]);
    expect(tradeBoundaryEvents(expired, { includeSyntheticExpirationExit: true })[0]).toMatchObject({
      kind: "entry",
      timeLabel: "09:30",
    });
  });

  it("selects nearest points for replay and at-or-before points for review", () => {
    const points = [{ time: 100, value: 1 }, { time: 130, value: 2 }, { time: 160, value: 3 }];

    expect(nearestPoint(points, 145)?.time).toBe(130);
    expect(pointAtOrBefore(points, 145)?.time).toBe(130);
    expect(nearestPoint(points, 155)?.time).toBe(160);
    expect(pointAtOrBefore(points, 155)?.time).toBe(130);
    expect(nearestPoint(points, 0)).toBeNull();
  });

  it("reads line values before candle closes", () => {
    expect(pointValue({ time: 100, value: -0.35, close: -0.4 })).toBe(-0.35);
    expect(pointValue({ time: 100, close: 5231.25 })).toBe(5231.25);
    expect(pointValue({ time: 100 })).toBeNull();
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
