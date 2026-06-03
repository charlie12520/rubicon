import { describe, expect, it } from "vitest";
import type { DailySummary } from "../shared/types";
import { latestUsableDateFromSnapshot, marketDateFromSnapshot, selectDateAfterTrackerRefresh } from "./refreshLogic";

describe("tracker refresh logic", () => {
  it("uses today's session when the archive contains today's date", () => {
    expect(
      marketDateFromSnapshot({
        availableDates: ["2026-05-28", "2026-05-29"],
        latestTradeDate: "2026-05-29",
        today: "2026-05-29",
      }),
    ).toBe("2026-05-29");
  });

  it("falls back to the latest imported session when today has no archive yet", () => {
    expect(
      marketDateFromSnapshot({
        availableDates: ["2026-05-27", "2026-05-28"],
        latestTradeDate: "2026-05-28",
        today: "2026-05-29",
      }),
    ).toBe("2026-05-28");
  });

  it("follows a newly imported latest session while the trader is on Today", () => {
    expect(
      selectDateAfterTrackerRefresh({
        nextMarketDate: "2026-05-29",
        previousMarketDate: "2026-05-28",
        range: "today",
        selectedDate: "2026-05-28",
      }),
    ).toBe("2026-05-29");
  });

  it("does not yank a custom historical review date during auto refresh", () => {
    expect(
      selectDateAfterTrackerRefresh({
        nextMarketDate: "2026-05-29",
        previousMarketDate: "2026-05-28",
        range: "custom",
        selectedDate: "2026-05-27",
      }),
    ).toBe("2026-05-27");
  });

  it("keeps today selected while exposing the latest usable fallback date", () => {
    const snapshot = {
      availableDates: ["2026-06-01", "2026-06-02", "2026-06-03"],
      dailySummaries: [
        summary("2026-06-01", 1),
        summary("2026-06-02", 32),
        summary("2026-06-03", 0, {
          availabilityStatus: "incomplete",
          spxIntradayRowCount: 0,
          spxStatus: "error",
          tradeStatus: "empty",
          uploadStatus: "missing_payload",
        }),
      ],
      latestTradeDate: "2026-06-03",
      today: "2026-06-03",
      trades: [{ date: "2026-06-02" }],
    };

    expect(marketDateFromSnapshot(snapshot)).toBe("2026-06-03");
    expect(latestUsableDateFromSnapshot(snapshot)).toBe("2026-06-02");
  });
});

function summary(date: string, entryCount: number, overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    availabilityStatus: "ok",
    date,
    entryCount,
    fillCount: entryCount,
    issueCount: 0,
    issues: [],
    optionContractCount: entryCount * 2,
    optionIntradayStatus: "ok",
    payloadRows: 10,
    spxIntradayRowCount: 4680,
    spxStatus: "ok",
    spreadCount: entryCount,
    spreadMarkRowCount: entryCount * 4860,
    tradeCount: entryCount,
    tradeStatus: "ok",
    uploadStatus: "uploaded",
    uploadTabCount: 11,
    ...overrides,
  };
}
