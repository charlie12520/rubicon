import type { DataIssue } from "../shared/types";
import type { DailyPullCoverageItem } from "./dailyPullChecklist";

export function coverageImpactSummary(item: DailyPullCoverageItem): string {
  if (item.status === "failed") {
    return item.importance === "core"
      ? "Affects review: a core output is missing or stale for this date."
      : "Affects context: this support output needs review before trusting every chart.";
  }

  if (item.status === "complete") {
    return item.importance === "core"
      ? "No review blocker: this core output is ready."
      : "No review blocker: this context output is usable.";
  }

  if (item.id.includes("open-interest")) {
    return "Low impact: OI breadth is thinner, but P/L and replay are still usable.";
  }

  if (item.id.includes("volume-profile")) {
    return "Context only: volume breadth has gaps, but trade ledger and SPX replay are not blocked.";
  }

  if (item.id.includes("option") || item.id.includes("spread")) {
    return "Review usable with caution: traded spread replay is checked separately from breadth gaps.";
  }

  return "Needs review: the app can still open the date, but this output is not fully clean.";
}

export function issueReviewImpact(issue: DataIssue): string {
  const haystack = `${issue.title} ${issue.detail}`.toLowerCase();

  if (issue.severity === "error") {
    return "High impact: this can block trust in the selected date until checked.";
  }

  if (haystack.includes("secondary ibkr endpoint") || haystack.includes("fallback error")) {
    return "No review blocker if one IBKR endpoint connected; this records the unused fallback.";
  }

  if (haystack.includes("open interest")) {
    return "Low impact: OI context may be thinner; P/L and replay are not blocked.";
  }

  if (haystack.includes("volume profile")) {
    return "Context only: volume profile breadth has gaps, not the core trade ledger.";
  }

  if (haystack.includes("option intraday") || haystack.includes("option 1-minute") || haystack.includes("availability")) {
    return "Review usable with caution: option breadth is partial; core trade/SPX checks decide usability.";
  }

  if (issue.stage === "upload") {
    return "Local review unaffected; this is about Google/archive confirmation.";
  }

  if (issue.severity === "info") {
    return "No review blocker: informational diagnostic only.";
  }

  return "Needs review: expand details for the raw diagnostic before relying on this date.";
}
