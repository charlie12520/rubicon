import { describe, expect, it } from "vitest";
import type { TradeRecord } from "../shared/types";
import { defaultJournalEntry, type TradeJournalEntry } from "./tradeJournal";
import { journalReviewReminderDecision } from "./journalReviewReminder";

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    account: "DU123",
    bias: "Bearish",
    contracts: 1,
    date: "2026-06-15",
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    entryPrice: 1.25,
    entryTime: "2026-06-15T09:45:00-04:00",
    exitPrice: 0.25,
    exitTime: "2026-06-15T15:45:00-04:00",
    expiration: "2026-06-15",
    fees: 1,
    id: "T1",
    legs: [],
    longStrike: 5060,
    maxProfit: 125,
    maxRisk: 875,
    notes: "",
    pnl: 100,
    positionAfter: 0,
    positionBefore: 0,
    priceType: "Credit",
    returnOnRisk: 0.1,
    shortStrike: 5050,
    side: "Call",
    source: "test",
    spxEntry: 5000,
    spxExit: 5005,
    status: "Closed",
    strategy: "Call credit spread",
    width: 10,
    winLoss: "Win",
    ...overrides,
  };
}

describe("journal review reminder decision", () => {
  it("notifies after the 4:15 PM ET close window when today's trades need review", () => {
    const trades = [trade({ id: "late", entryTime: "2026-06-15T10:15:00-04:00" }), trade({ id: "early", entryTime: "2026-06-15T09:35:00-04:00" })];

    expect(
      journalReviewReminderDecision({
        armed: true,
        entries: {},
        lastNotifiedDate: null,
        latestTradeDate: "2026-06-15",
        now: new Date("2026-06-15T20:15:00.000Z"),
        trades,
      }),
    ).toEqual({
      date: "2026-06-15",
      firstTradeId: "early",
      shouldNotify: true,
      time: "16:15",
      unreviewedCount: 2,
    });
  });

  it("stays silent before close, after already notifying, or when disabled", () => {
    const trades = [trade({})];
    const base = {
      entries: {},
      latestTradeDate: "2026-06-15",
      now: new Date("2026-06-15T20:14:00.000Z"),
      trades,
    };

    expect(journalReviewReminderDecision({ ...base, armed: true, lastNotifiedDate: null }).shouldNotify).toBe(false);
    expect(
      journalReviewReminderDecision({
        ...base,
        armed: true,
        lastNotifiedDate: "2026-06-15",
        now: new Date("2026-06-15T20:30:00.000Z"),
      }).shouldNotify,
    ).toBe(false);
    expect(
      journalReviewReminderDecision({
        ...base,
        armed: false,
        lastNotifiedDate: null,
        now: new Date("2026-06-15T20:30:00.000Z"),
      }).shouldNotify,
    ).toBe(false);
  });

  it("does not notify weekends, stale latest dates, or fully reviewed sessions", () => {
    const reviewedTrade = trade({ id: "done" });
    const entries: Record<string, TradeJournalEntry> = {
      done: { ...defaultJournalEntry(reviewedTrade), status: "reviewed" },
    };

    expect(
      journalReviewReminderDecision({
        armed: true,
        entries: {},
        lastNotifiedDate: null,
        latestTradeDate: "2026-06-13",
        now: new Date("2026-06-13T20:30:00.000Z"),
        trades: [trade({ date: "2026-06-13", entryTime: "2026-06-13T09:35:00-04:00" })],
      }).shouldNotify,
    ).toBe(false);
    expect(
      journalReviewReminderDecision({
        armed: true,
        entries: {},
        lastNotifiedDate: null,
        latestTradeDate: "2026-06-14",
        now: new Date("2026-06-15T20:30:00.000Z"),
        trades: [trade({ date: "2026-06-14" })],
      }).shouldNotify,
    ).toBe(false);
    expect(
      journalReviewReminderDecision({
        armed: true,
        entries,
        lastNotifiedDate: null,
        latestTradeDate: "2026-06-15",
        now: new Date("2026-06-15T20:30:00.000Z"),
        trades: [reviewedTrade],
      }).shouldNotify,
    ).toBe(false);
  });
});
