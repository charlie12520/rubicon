import { describe, expect, it } from "vitest";
import type { DailySummary } from "../shared/types";
import { buildDailyPullChecklist } from "./dailyPullChecklist";
import { buildDailyPullReviewModel } from "./dailyPullReviewModel";

describe("daily pull review model", () => {
  it("keeps a non-near option cancellation out of review blockers", () => {
    const summary = dailySummary({
      availabilityStatus: "partial",
      issueCount: 2,
      issues: [
        {
          detail: "1 unexpected option-data error remained. Missing rows are non-SPX option rows and are not scored against SPX open/close.",
          severity: "info",
          stage: "pull",
          title: "Unexpected option pull errors",
        },
        {
          detail: "Availability status is partial.",
          severity: "warning",
          stage: "availability",
          title: "Availability check not clean",
        },
      ],
      optionIntradayStatus: "partial",
      optionIntradayUnexpectedErrorCount: 1,
    });
    const model = modelFor(summary);

    expect(model.verdict).toBe("ready");
    expect(model.reviewProblemCount).toBe(0);
    expect(model.buckets.review.entries).toEqual([]);
    expect(model.buckets.diagnostic.entries.map((entry) => entry.title)).toContain("Availability check not clean");
  });

  it("keeps Google tracker upload warnings in the upload bucket", () => {
    const summary = dailySummary({
      issueCount: 1,
      issues: [
        {
          detail: "The compact tracker payload exists, but no successful Google tracker update is recorded in the daily summary.",
          severity: "warning",
          stage: "upload",
          title: "Google tracker upload not confirmed",
        },
      ],
      rawUploadGoogleSheetUrl: undefined,
      uploadStatus: "payload_ready_unconfirmed",
      workbookPath: undefined,
    });
    const model = modelFor(summary);

    expect(model.verdict).toBe("ready");
    expect(model.buckets.review.entries).toEqual([]);
    expect(model.buckets.archive.entries.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(["Google tracker upload", "Google tracker upload not confirmed"]),
    );
  });

  it("marks today as in progress when only an empty folder summary exists", () => {
    const today = dailySummary({
      date: "2026-06-03",
      entryCount: 0,
      fillCount: 0,
      payloadRows: 0,
      spxIntradayRowCount: 0,
      spxStatus: "error",
      spreadCount: 0,
      spreadMarkRowCount: 0,
      tradeCount: 0,
      tradeStatus: "empty",
      uploadStatus: "missing_payload",
      uploadTabCount: 0,
    });
    const prior = dailySummary({ date: "2026-06-02", entryCount: 32, tradeCount: 32 });
    const checklist = buildDailyPullChecklist({
      selectedDate: today.date,
      sourceHealth: [],
      summary: today,
      today: today.date,
      tradeCount: 0,
    });

    const model = buildDailyPullReviewModel({
      availableDates: [prior.date, today.date],
      checklist,
      selectedDate: today.date,
      summaries: [prior, today],
      summary: today,
      today: today.date,
      tradeCount: 0,
      tradeCountsByDate: new Map([[prior.date, 32]]),
    });

    expect(model.verdict).toBe("today_in_progress");
    expect(model.todayBanner).toMatchObject({
      latestUsableDate: "2026-06-02",
      title: "Today pull is empty or still in progress",
    });
  });

  it("blocks review when a core SPX output is missing", () => {
    const model = modelFor(
      dailySummary({
        spxIntradayRowCount: 0,
        spxStatus: "missing",
      }),
    );

    expect(model.verdict).toBe("blocked");
    expect(model.buckets.review.entries.map((entry) => entry.title)).toContain("SPX 5s bars");
  });
});

function modelFor(summary: DailySummary) {
  const checklist = buildDailyPullChecklist({
    selectedDate: summary.date,
    sourceHealth: [],
    summary,
    today: summary.date,
    tradeCount: summary.entryCount,
  });
  return buildDailyPullReviewModel({
    availableDates: [summary.date],
    checklist,
    selectedDate: summary.date,
    summaries: [summary],
    summary,
    today: summary.date,
    tradeCount: summary.entryCount,
    tradeCountsByDate: new Map([[summary.date, summary.entryCount]]),
  });
}

function dailySummary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    availabilityStatus: "ok",
    date: "2026-06-02",
    entryCount: 32,
    fillCount: 121,
    issueCount: 0,
    issues: [],
    optionContractCount: 18,
    optionIntradayBarSize: "5s",
    optionIntradayContractCount: 18,
    optionIntradayExpectedRows: 87480,
    optionIntradayExpectedRowsPerContract: 4860,
    optionIntradayRowCount: 84625,
    optionIntradayStatus: "ok",
    payloadRows: 278000,
    rawUploadGoogleSheetUrl: "https://docs.google.test/raw",
    spxIntradayBarSize: "5s",
    spxIntradayExpectedRows: 4680,
    spxIntradayRowCount: 4680,
    spxStatus: "ok",
    spreadCount: 38,
    spreadMarkExpectedRows: 155520,
    spreadMarkRowCount: 153057,
    tradeArtifactExpectedCount: 4,
    tradeArtifactReadyCount: 4,
    tradeCount: 121,
    tradeStatus: "ok",
    tradedOptionContractCount: 18,
    underlyingIntradayExpectedRows: 7410,
    underlyingIntradayRowCount: 7410,
    underlyingIntradayStatus: "ok",
    underlyingIntradaySymbolCount: 19,
    uploadStatus: "uploaded",
    uploadTabCount: 11,
    volumeProfileExpectedRows: 87480,
    volumeProfileRowCount: 84625,
    ...overrides,
  };
}
