import { describe, expect, it } from "vitest";
import type { TradeRecord } from "../shared/types";
import {
  buildJournalCoverage,
  defaultJournalEntry,
  filterJournalTrades,
  journalAspectChecklistForTrade,
  mergeJournalEntry,
  nextUnreviewedTradeId,
  parseJournalEntries,
  splitJournalTags,
  type TradeJournalEntry,
} from "./tradeJournal";

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    id: "T1",
    account: "U1",
    date: "2026-05-29",
    status: "Closed",
    side: "Call",
    strategy: "Call credit spread",
    bias: "Bearish",
    entryTime: "2026-05-29T09:30:00-04:00",
    exitTime: "2026-05-29T09:42:00-04:00",
    expiration: "2026-05-29",
    shortStrike: 7620,
    longStrike: 7625,
    width: 5,
    contracts: 10,
    positionBefore: 0,
    positionAfter: 10,
    entryPrice: 0.35,
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    exitPrice: 0.1,
    priceType: "Credit",
    fees: 7,
    maxRisk: 4650,
    maxProfit: 350,
    pnl: 250,
    returnOnRisk: 0.053,
    winLoss: "Win",
    spxEntry: 7580,
    spxExit: 7570,
    legs: [],
    notes: "",
    source: "test",
    ...overrides,
  };
}

describe("trade journal helpers", () => {
  it("creates a useful default entry from a trade", () => {
    const entry = defaultJournalEntry(trade({ id: "SPX-1", strategy: "Opening drive fade" }));

    expect(entry.tradeId).toBe("SPX-1");
    expect(entry.setup).toBe("Opening drive fade");
    expect(entry.status).toBe("todo");
    expect(entry.processScore).toBe(3);
    expect(entry.aspectChecks).toEqual({
      entryStructure: false,
      priceAction: false,
      volumeNode: false,
      orderflow: false,
    });
  });

  it("describes the four-aspect checklist for credit call and put spreads", () => {
    const callChecklist = journalAspectChecklistForTrade(trade({ side: "Call", strategy: "Call Credit Spread" }));
    const putChecklist = journalAspectChecklistForTrade(trade({ side: "Put", strategy: "Put Credit Spread" }));

    expect(callChecklist.map((item) => item.label)).toEqual([
      "Entry is at a level validation or a lower high",
      "Price action is positive",
      "Spread is above the Option Volume Node",
      "Strong selling orderflow",
    ]);
    expect(putChecklist.map((item) => item.label)).toEqual([
      "Entry is at a level validation or a higher low",
      "Price action is positive",
      "Spread is below the Option Volume Node",
      "Strong buying orderflow",
    ]);
    expect(callChecklist[3].optional).toBe(true);
    expect(putChecklist[3].optional).toBe(true);
  });

  it("counts reviewed, follow-up, and process score coverage for a session", () => {
    const trades = [trade({ id: "T1" }), trade({ id: "T2", pnl: -100 }), trade({ id: "T3" })];
    const entries: Record<string, TradeJournalEntry> = {
      T1: { ...defaultJournalEntry(trades[0]), status: "reviewed", processScore: 5 },
      T2: { ...defaultJournalEntry(trades[1]), status: "draft", followUp: true, processScore: 2 },
    };

    expect(buildJournalCoverage(trades, entries)).toEqual({
      total: 3,
      drafted: 2,
      reviewed: 1,
      needsReview: 2,
      followUps: 1,
      avgProcessScore: 3.5,
    });
  });

  it("filters trades by workflow state and outcome", () => {
    const trades = [trade({ id: "T1", pnl: 250 }), trade({ id: "T2", pnl: -75 }), trade({ id: "T3", pnl: 0 })];
    const entries: Record<string, TradeJournalEntry> = {
      T1: { ...defaultJournalEntry(trades[0]), status: "reviewed" },
      T2: { ...defaultJournalEntry(trades[1]), followUp: true, status: "draft" },
    };

    expect(filterJournalTrades(trades, entries, "needs_review").map((next) => next.id)).toEqual(["T2", "T3"]);
    expect(filterJournalTrades(trades, entries, "follow_up").map((next) => next.id)).toEqual(["T2"]);
    expect(filterJournalTrades(trades, entries, "winners").map((next) => next.id)).toEqual(["T1"]);
    expect(filterJournalTrades(trades, entries, "losers").map((next) => next.id)).toEqual(["T2"]);
  });

  it("finds the next unreviewed trade after the current trade", () => {
    const trades = [trade({ id: "T1" }), trade({ id: "T2" }), trade({ id: "T3" })];
    const entries: Record<string, TradeJournalEntry> = {
      T1: { ...defaultJournalEntry(trades[0]), status: "reviewed" },
      T2: { ...defaultJournalEntry(trades[1]), status: "reviewed" },
    };

    expect(nextUnreviewedTradeId(trades, entries, "T1")).toBe("T3");
    expect(nextUnreviewedTradeId(trades, { ...entries, T3: { ...defaultJournalEntry(trades[2]), status: "reviewed" } }, "T1")).toBeNull();
  });

  it("sanitizes stored entries and tags", () => {
    const parsed = parseJournalEntries(JSON.stringify({
      T1: {
        tradeId: "T1",
        date: "2026-05-29",
        setup: "breakout",
        emotion: "bad-value",
        grade: "Z",
        processScore: 99,
        tags: ["SPX", "spx", " late chase "],
        aspectChecks: {
          entryStructure: true,
          priceAction: "truthy",
          volumeNode: true,
          orderflow: false,
          extra: true,
        },
        followUp: true,
        status: "reviewed",
      },
    }));

    expect(parsed.T1.emotion).toBe("Focused");
    expect(parsed.T1.grade).toBe("B");
    expect(parsed.T1.processScore).toBe(5);
    expect(parsed.T1.tags).toEqual(["SPX", "late chase"]);
    expect(parsed.T1.aspectChecks).toEqual({
      entryStructure: true,
      priceAction: false,
      volumeNode: true,
      orderflow: false,
    });
    expect(splitJournalTags("fomo, fomo, late exit")).toEqual(["fomo", "late exit"]);
  });

  it("merges a save patch onto the current/default entry", () => {
    const sourceTrade = trade({ id: "T9", date: "2026-05-28" });
    const entry = mergeJournalEntry(sourceTrade, undefined, { lesson: "Wait for confirmation", status: "reviewed" }, "2026-05-31T10:00:00.000Z");

    expect(entry.tradeId).toBe("T9");
    expect(entry.date).toBe("2026-05-28");
    expect(entry.lesson).toBe("Wait for confirmation");
    expect(entry.status).toBe("reviewed");
    expect(entry.updatedAt).toBe("2026-05-31T10:00:00.000Z");
  });
});
