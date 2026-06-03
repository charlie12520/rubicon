import { describe, expect, it } from "vitest";
import type { DataIssue } from "../shared/types";
import type { DailyPullCoverageItem } from "./dailyPullChecklist";
import { coverageImpactSummary, issueReviewImpact } from "./reviewImpact";

describe("review impact copy", () => {
  it("puts core output failures in review-blocking language", () => {
    expect(coverageImpactSummary(coverage({ importance: "core", status: "failed" }))).toContain("Affects review");
  });

  it("frames far-context breadth gaps as non-blocking context", () => {
    expect(coverageImpactSummary(coverage({ id: "volume-profile", importance: "breadth", status: "warning" }))).toContain("Context only");
  });

  it("explains secondary IBKR endpoint warnings as non-blocking when another endpoint worked", () => {
    expect(issueReviewImpact(issue({ title: "Secondary IBKR endpoint did not connect" }))).toContain("No review blocker");
  });

  it("keeps option intraday partial availability cautious but usable", () => {
    expect(issueReviewImpact(issue({ title: "Option intraday missing rows near SPX open/close" }))).toContain("Review usable with caution");
  });
});

function coverage(overrides: Partial<DailyPullCoverageItem>): DailyPullCoverageItem {
  return {
    basis: "Required for review",
    coveragePct: 100,
    expected: 10,
    expectedLabel: "10 rows",
    failures: [],
    id: "spx-bars",
    importance: "core",
    label: "SPX intraday",
    missing: 0,
    missingLabel: "0 rows",
    notes: [],
    pulled: 10,
    pulledLabel: "10 rows",
    readinessLabel: "Ready",
    status: "complete",
    unit: "rows",
    warnings: [],
    ...overrides,
  };
}

function issue(overrides: Partial<DataIssue>): DataIssue {
  return {
    detail: "127.0.0.1:7496 returned fills; fallback endpoint failed.",
    severity: "warning",
    stage: "pull",
    title: "Sync warning",
    ...overrides,
  };
}
