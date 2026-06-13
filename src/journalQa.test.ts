import { describe, expect, it } from "vitest";
import type { TradeRecord } from "../shared/types";
import { defaultJournalEntry } from "./tradeJournal";
import { journalQaAnswerValue, journalQaPatchForAnswer, journalQaStepsForTrade } from "./journalQa";

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

describe("journal Q/A helpers", () => {
  it("builds a question sequence that covers the visible journal fields", () => {
    const steps = journalQaStepsForTrade(trade({ side: "Call", strategy: "Call credit spread" }));

    expect(steps.map((step) => step.id)).toEqual([
      "setup",
      "tags",
      "thesis",
      "execution",
      "aspect-entryStructure",
      "aspect-priceAction",
      "aspect-volumeNode",
      "aspect-orderflow",
      "emotion",
      "processScore",
      "grade",
      "followUp",
    ]);
  });

  it("maps typed answers onto journal entry patches", () => {
    const sourceTrade = trade({});
    const entry = defaultJournalEntry(sourceTrade);

    expect(journalQaPatchForAnswer(entry, { id: "setup", kind: "text", prompt: "" }, "Opening drive fade")).toEqual({
      setup: "Opening drive fade",
    });
    expect(journalQaPatchForAnswer(entry, { id: "tags", kind: "tags", prompt: "" }, "fomo, fomo, late")).toEqual({
      tags: ["fomo", "late"],
    });
    expect(journalQaPatchForAnswer(entry, { id: "processScore", kind: "score", prompt: "" }, 9)).toEqual({
      processScore: 5,
    });
  });

  it("maps boolean answers onto aspect checks and follow-up", () => {
    const entry = defaultJournalEntry(trade({}));

    expect(
      journalQaPatchForAnswer(
        entry,
        { aspectKey: "entryStructure", id: "aspect-entryStructure", kind: "boolean", prompt: "" },
        "yes",
      ),
    ).toEqual({
      aspectChecks: {
        entryStructure: true,
        orderflow: false,
        priceAction: false,
        volumeNode: false,
      },
    });
    expect(journalQaPatchForAnswer(entry, { id: "followUp", kind: "boolean", prompt: "" }, "no")).toEqual({
      followUp: false,
    });
  });

  it("reads the current answer value without manufacturing text for blank fields", () => {
    const entry = defaultJournalEntry(trade({}));

    expect(journalQaAnswerValue(entry, { id: "thesis", kind: "textarea", prompt: "" })).toBe("");
    expect(journalQaAnswerValue(entry, { id: "emotion", kind: "choice", prompt: "" })).toBe("Focused");
  });
});
