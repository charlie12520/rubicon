import { describe, expect, it } from "vitest";
import type { DailySummary } from "../shared/types";
import { buildDateIssueIndex, issueBadgeForSummary } from "./dateIssueBadges";

describe("date issue badges", () => {
  it("does not badge a clean imported date", () => {
    expect(issueBadgeForSummary(summary({ issueCount: 0, issues: [] }))).toBeNull();
  });

  it("does not badge a date when required outputs are green despite raw pull warnings", () => {
    expect(
      issueBadgeForSummary(
        summary({
          issueCount: 2,
          issues: [
            { detail: "10 no-data responses across far OTM contracts.", severity: "warning", stage: "pull", title: "Expected HMDS no-data responses" },
            { detail: "Open interest context is thinner but usable.", severity: "warning", stage: "pull", title: "Open interest pull not fully clean" },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("summarizes failed required outputs", () => {
    const badge = issueBadgeForSummary(
      summary({
        date: "2026-05-28",
        spxIntradayRowCount: 0,
        spxStatus: "missing",
      }),
    );

    expect(badge).toMatchObject({
      count: 1,
      label: "1 issue",
      tone: "error",
    });
    expect(badge?.title).toContain("2026-05-28");
    expect(badge?.title).toContain("SPX 5s bars");
    expect(badge?.title).not.toContain("..");
  });

  it("keeps non-red required outputs out of the date badge", () => {
    const badge = issueBadgeForSummary(
      summary({
        openInterestValidRowCount: 110,
        issueCount: 1,
        issues: [{ detail: "Open interest status partial; 110 / 120 contracts returned rows.", severity: "warning", stage: "pull", title: "Open interest pull not fully clean" }],
      }),
    );

    expect(badge).toBeNull();
  });

  it("does not make option breadth failures red in the date rail", () => {
    expect(
      issueBadgeForSummary(
        summary({
          optionIntradayRowCount: 0,
          optionIntradayStatus: "missing",
        }),
      ),
    ).toBeNull();
  });

  it("uses error tone for review-critical red outputs", () => {
    expect(
      issueBadgeForSummary(
        summary({
          spxIntradayRowCount: 0,
          spxStatus: "missing",
        }),
      )?.tone,
    ).toBe("error");
  });

  it("indexes only dates that have failed required outputs", () => {
    const index = buildDateIssueIndex([
      summary({ date: "2026-05-27", issueCount: 0, issues: [] }),
      summary({
        date: "2026-05-28",
        tradeArtifactReadyCount: 0,
      }),
    ]);

    expect(index.has("2026-05-27")).toBe(false);
    expect(index.get("2026-05-28")?.label).toBe("1 issue");
  });
});

function summary(overrides: Partial<DailySummary>): DailySummary {
  return {
    availabilityStatus: "ok",
    date: "2026-05-28",
    entryCount: 19,
    fillCount: 136,
    issueCount: 0,
    issues: [],
    optionContractCount: 12,
    optionIntradayBarSize: "5s",
    optionIntradayContractCount: 120,
    optionIntradayExpectedRows: 583200,
    optionIntradayExpectedRowsPerContract: 4860,
    optionIntradayRowCount: 583200,
    optionIntradayStatus: "ok",
    payloadRows: 59333,
    rawUploadGoogleSheetUrl: "https://docs.google.com/spreadsheets/d/raw",
    spxIntradayBarSize: "5s",
    spxIntradayExpectedRows: 4680,
    spxIntradayRowCount: 4680,
    spxStatus: "ok",
    spreadCount: 24,
    spreadMarkExpectedRows: 92340,
    spreadMarkRowCount: 92340,
    tradeArtifactExpectedCount: 4,
    tradeArtifactReadyCount: 4,
    tradeCount: 136,
    tradeStatus: "ok",
    tradedOptionContractCount: 12,
    underlyingIntradayExpectedRows: 2340,
    underlyingIntradayRowCount: 2340,
    underlyingIntradayStatus: "ok",
    underlyingIntradaySymbolCount: 6,
    uploadStatus: "uploaded",
    uploadTabCount: 11,
    volumeProfileExpectedRows: 583200,
    volumeProfileRowCount: 583200,
    openInterestExpectedRows: 120,
    openInterestRowCount: 120,
    openInterestValidRowCount: 120,
    ...overrides,
  };
}
