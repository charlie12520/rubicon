import { describe, expect, it } from "vitest";
import type { SpxBar, SpreadMark, TradeRecord } from "../shared/types";
import { buildDailyPnlSimulation, summarizeDailyPnlSimulation } from "./dailyPnlSimulator";

describe("daily PnL simulator", () => {
  it("sums reconstructed open PnL across all concurrently open positions", () => {
    const trades = [
      trade({
        contracts: 1,
        entryPrice: -1,
        entryTime: "2026-05-29T09:30:00-04:00",
        exitTime: "2026-05-29T09:32:00-04:00",
        fees: 2,
        id: "call",
        pnl: 40,
      }),
      trade({
        contracts: 2,
        entryPrice: -0.5,
        entryTime: "2026-05-29T09:31:00-04:00",
        exitTime: "2026-05-29T09:33:00-04:00",
        fees: 4,
        id: "put",
        pnl: 10,
        side: "Put",
      }),
    ];
    const points = buildDailyPnlSimulation(trades, [
      mark("call", "2026-05-29T09:30:00-04:00", -1),
      mark("call", "2026-05-29T09:31:00-04:00", -0.5),
      mark("put", "2026-05-29T09:31:00-04:00", -0.75),
      mark("put", "2026-05-29T09:32:00-04:00", -0.25),
    ]);

    const point931 = points.find((point) => point.label === "09:31");
    const point932 = points.find((point) => point.label === "09:32");
    const finalPoint = points.at(-1);

    expect(point931).toMatchObject({
      openTradeCount: 2,
      openPnl: -6,
      realizedPnl: 0,
      totalPnl: -6,
    });
    expect(point932).toMatchObject({
      openTradeCount: 1,
      openPnl: 46,
      realizedPnl: 40,
      totalPnl: 86,
    });
    expect(finalPoint).toMatchObject({
      openTradeCount: 0,
      realizedPnl: 50,
      totalPnl: 50,
    });
  });

  it("uses the SPX/replay timeline and reports missing reconstructed marks while positions are open", () => {
    const trades = [
      trade({
        contracts: 1,
        entryPrice: -0.4,
        entryTime: "2026-05-29T09:30:00-04:00",
        exitTime: "2026-05-29T09:32:00-04:00",
        id: "missing",
        pnl: 35,
      }),
    ];
    const points = buildDailyPnlSimulation(trades, [], [
      spxBar("2026-05-29T09:30:00-04:00"),
      spxBar("2026-05-29T09:31:00-04:00"),
      spxBar("2026-05-29T09:32:00-04:00"),
    ]);
    const summary = summarizeDailyPnlSimulation(points);

    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({
      missingOpenMarkCount: 1,
      openPnl: 0,
      openTradeCount: 1,
    });
    expect(summary).toMatchObject({
      finalPnl: 35,
      maxOpenTrades: 1,
      missingOpenMarkObservations: 2,
      pointCount: 3,
    });
  });
});

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    account: "test",
    bias: "Neutral",
    contracts: 1,
    date: "2026-05-29",
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    entryPrice: -0.5,
    entryTime: "2026-05-29T09:30:00-04:00",
    exitPrice: 0,
    exitTime: "2026-05-29T09:40:00-04:00",
    expiration: "2026-05-29",
    fees: 0,
    id: "trade",
    legs: [],
    longStrike: 7625,
    maxProfit: 50,
    maxRisk: 450,
    notes: "",
    pnl: 0,
    positionAfter: 0,
    positionBefore: 0,
    priceType: "Credit",
    returnOnRisk: null,
    shortStrike: 7620,
    side: "Call",
    source: "test",
    spxEntry: null,
    spxExit: null,
    status: "Closed",
    strategy: "Test Spread",
    width: 5,
    winLoss: "Flat",
    ...overrides,
  };
}

function mark(tradeId: string, timestampEt: string, close: number): SpreadMark {
  return {
    close,
    entrySequence: 1,
    label: timestampEt.slice(11, 16),
    permId: tradeId,
    source: "test",
    time: Math.floor(Date.parse(timestampEt) / 1000),
    timestampEt,
    tradeId,
    value: close,
  };
}

function spxBar(timestampEt: string): SpxBar {
  return {
    close: 1,
    high: 1,
    label: timestampEt.slice(11, 16),
    low: 1,
    open: 1,
    time: Math.floor(Date.parse(timestampEt) / 1000),
    timestampEt,
  };
}
