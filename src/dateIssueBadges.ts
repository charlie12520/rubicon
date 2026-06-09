import type { DailySummary, SourceHealth } from "../shared/types";
import { buildDailyPullChecklist } from "./dailyPullChecklist";
import { buildDailyPullReviewModel } from "./dailyPullReviewModel";

export type DateIssueBadge = {
  count: number;
  label: string;
  title: string;
  tone: "warning" | "error";
};

export type DateIssueBadgeOptions = {
  sourceHealth?: SourceHealth[];
  tradeCount?: number;
  tradeCountsByDate?: Map<string, number>;
};

export function issueBadgeForSummary(summary: DailySummary, options: DateIssueBadgeOptions = {}): DateIssueBadge | null {
  const checklist = buildDailyPullChecklist({
    selectedDate: summary.date,
    sourceHealth: options.sourceHealth ?? [],
    summary,
    tradeCount: options.tradeCount ?? options.tradeCountsByDate?.get(summary.date) ?? summary.entryCount,
  });
  const model = buildDailyPullReviewModel({
    availableDates: [summary.date],
    checklist,
    selectedDate: summary.date,
    summaries: [summary],
    summary,
    tradeCount: options.tradeCount ?? options.tradeCountsByDate?.get(summary.date) ?? summary.entryCount,
    tradeCountsByDate: options.tradeCountsByDate,
  });
  const failedOutputs = model.reviewItems.filter((item) => item.status === "failed" && item.importance === "core");
  const count = failedOutputs.length;
  if (count <= 0) {
    return null;
  }

  const outputSummary = summarizeFailedOutputs(failedOutputs.map((item) => item.label));
  const noun = count === 1 ? "issue" : "issues";
  const outputNoun = count === 1 ? "output is" : "outputs are";

  return {
    count,
    label: `${count} ${noun}`,
    title: `${summary.date}: ${count} required ${outputNoun} red in Required Outputs${outputSummary}`,
    tone: "error",
  };
}

export function buildDateIssueIndex(summaries: DailySummary[], options: DateIssueBadgeOptions = {}): Map<string, DateIssueBadge> {
  const index = new Map<string, DateIssueBadge>();
  for (const summary of summaries) {
    const badge = issueBadgeForSummary(summary, options);
    if (badge) {
      index.set(summary.date, badge);
    }
  }
  return index;
}

function summarizeFailedOutputs(labels: string[]): string {
  if (!labels.length) {
    return ".";
  }
  const visibleLabels = labels.slice(0, 3);
  const extraCount = labels.length - visibleLabels.length;
  return ` (${visibleLabels.join(", ")}${extraCount > 0 ? `, +${extraCount} more` : ""}).`;
}
