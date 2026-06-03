import { describe, expect, it } from "vitest";
import type { DailyReviewNote, TradeRecord } from "../shared/types";
import { buildMorningDiarySummary, previousSessionDate } from "./morningDiary";
import type { TradeJournalEntry } from "./tradeJournal";

describe("morning diary summary", () => {
  it("uses the prior available trading session instead of naive calendar yesterday", () => {
    expect(previousSessionDate("2026-06-01", ["2026-05-28", "2026-05-29", "2026-06-01"])).toBe("2026-05-29");
  });

  it("summarizes saved journal entries for yesterday", () => {
    const entries: Record<string, TradeJournalEntry> = {
      t1: {
        tradeId: "t1",
        date: "2026-05-29",
        setup: "Opening drive fade",
        thesis: "",
        execution: "",
        emotion: "Calm",
        mistake: "Chased the second fill.",
        lesson: "Wait for the candle close before adding.",
        grade: "B",
        processScore: 4,
        tags: ["open"],
        aspectChecks: {
          entryStructure: false,
          priceAction: false,
          volumeNode: false,
          orderflow: false,
        },
        followUp: true,
        status: "reviewed",
        updatedAt: "2026-05-29T20:00:00.000Z",
      },
    };
    const trades = [{ id: "t1", date: "2026-05-29" } as TradeRecord];
    const reviewNotes: Record<string, DailyReviewNote> = {};

    const summary = buildMorningDiarySummary({
      selectedDate: "2026-06-01",
      availableDates: ["2026-05-29", "2026-06-01"],
      entries,
      reviewNotes,
      trades,
    });

    expect(summary.available).toBe(true);
    expect(summary.date).toBe("2026-05-29");
    expect(summary.bullets.join(" ")).toContain("average process score 4.0/5");
    expect(summary.bullets.join(" ")).toContain("Wait for the candle close");
  });
});
