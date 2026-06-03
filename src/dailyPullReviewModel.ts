import type { DailySummary } from "../shared/types";
import type { DailyPullChecklist, DailyPullCoverageItem } from "./dailyPullChecklist";
import { latestUsableDateFromSnapshot } from "./refreshLogic";

export type DailyPullReviewVerdict = "ready" | "usable_with_caution" | "blocked" | "today_in_progress";
export type DailyPullIssueBucketId = "review" | "diagnostic" | "archive";
export type DailyPullIssueTone = "ok" | "info" | "warning" | "error";

export type DailyPullIssueEntry = {
  detail: string;
  id: string;
  impact: string;
  title: string;
  tone: DailyPullIssueTone;
};

export type DailyPullIssueBucket = {
  emptyText: string;
  entries: DailyPullIssueEntry[];
  id: DailyPullIssueBucketId;
  label: string;
  tone: Exclude<DailyPullIssueTone, "info">;
};

export type DailyPullTodayBanner = {
  detail: string;
  latestUsableDate: string | null;
  title: string;
};

export type DailyPullViewModel = {
  archiveItems: DailyPullCoverageItem[];
  archiveProblemCount: number;
  buckets: Record<DailyPullIssueBucketId, DailyPullIssueBucket>;
  diagnosticItems: DailyPullCoverageItem[];
  diagnosticProblemCount: number;
  reviewItems: DailyPullCoverageItem[];
  reviewProblemCount: number;
  subtitle: string;
  title: string;
  todayBanner: DailyPullTodayBanner | null;
  tone: "complete" | "warning" | "failed";
  verdict: DailyPullReviewVerdict;
};

export type DailyPullReviewModelInput = {
  availableDates: string[];
  checklist: DailyPullChecklist;
  selectedDate: string;
  summaries: DailySummary[];
  summary?: DailySummary | null;
  today?: string;
  tradeCount: number;
  tradeCountsByDate?: Map<string, number>;
};

const REVIEW_OUTPUT_IDS = new Set(["trade-artifacts", "spx-bars", "spread-marks"]);
const ARCHIVE_OUTPUT_IDS = new Set(["payload-tabs", "raw-workbook", "upload-receipt"]);

export function buildDailyPullReviewModel({
  availableDates,
  checklist,
  selectedDate,
  summaries,
  summary,
  today,
  tradeCount,
  tradeCountsByDate,
}: DailyPullReviewModelInput): DailyPullViewModel {
  const reviewItems = checklist.coverageItems.filter((item) => REVIEW_OUTPUT_IDS.has(item.id));
  const archiveItems = checklist.coverageItems.filter((item) => ARCHIVE_OUTPUT_IDS.has(item.id));
  const diagnosticItems = checklist.coverageItems.filter((item) => !REVIEW_OUTPUT_IDS.has(item.id) && !ARCHIVE_OUTPUT_IDS.has(item.id));
  const buckets = buildIssueBuckets(summary, reviewItems, diagnosticItems, archiveItems);
  const reviewBlockers = reviewItems.filter((item) => item.status === "failed");
  const reviewWarnings = reviewItems.filter((item) => item.status === "warning");
  const diagnosticCautions = buckets.diagnostic.entries.filter((entry) => entry.tone === "error" || directlyAffectsReview(entry));
  const latestUsableDate = latestUsableDateFromSnapshot({
    availableDates,
    dailySummaries: summaries,
    latestTradeDate: availableDates.at(-1) ?? null,
    today: today ?? selectedDate,
    trades: tradeCountEntries(tradeCountsByDate),
  });
  const todayInProgress = selectedDate === today && (!summary || ((summary.entryCount ?? 0) <= 0 && tradeCount <= 0));
  const verdict: DailyPullReviewVerdict = todayInProgress
    ? "today_in_progress"
    : reviewBlockers.length
      ? "blocked"
      : reviewWarnings.length || diagnosticCautions.length
        ? "usable_with_caution"
        : "ready";
  const title = verdictTitle(verdict);
  const subtitle = verdictSubtitle(verdict, selectedDate, reviewBlockers.length, diagnosticCautions.length);
  const tone = verdict === "blocked" ? "failed" : verdict === "ready" ? "complete" : "warning";

  return {
    archiveItems,
    archiveProblemCount: countProblemItems(archiveItems) + buckets.archive.entries.filter((entry) => entry.tone !== "info").length,
    buckets,
    diagnosticItems,
    diagnosticProblemCount: countProblemItems(diagnosticItems) + buckets.diagnostic.entries.filter((entry) => entry.tone !== "info").length,
    reviewItems,
    reviewProblemCount: reviewBlockers.length + reviewWarnings.length,
    subtitle,
    title,
    todayBanner: todayInProgress
      ? {
          detail: latestUsableDate && latestUsableDate !== selectedDate
            ? `Open ${latestUsableDate} while today's pull finishes.`
            : "The app will update this date once trade entries and replay data arrive.",
          latestUsableDate: latestUsableDate && latestUsableDate !== selectedDate ? latestUsableDate : null,
          title: "Today pull is empty or still in progress",
        }
      : null,
    tone,
    verdict,
  };
}

function buildIssueBuckets(
  summary: DailySummary | null | undefined,
  reviewItems: DailyPullCoverageItem[],
  diagnosticItems: DailyPullCoverageItem[],
  archiveItems: DailyPullCoverageItem[],
): Record<DailyPullIssueBucketId, DailyPullIssueBucket> {
  const buckets: Record<DailyPullIssueBucketId, DailyPullIssueBucket> = {
    archive: {
      emptyText: "No archive or upload items need attention.",
      entries: [],
      id: "archive",
      label: "Archive / Upload",
      tone: "ok",
    },
    diagnostic: {
      emptyText: "No context diagnostics need attention.",
      entries: [],
      id: "diagnostic",
      label: "Diagnostics",
      tone: "ok",
    },
    review: {
      emptyText: "No review-critical blockers for this date.",
      entries: [],
      id: "review",
      label: "Review Readiness",
      tone: "ok",
    },
  };

  for (const item of [...reviewItems, ...diagnosticItems, ...archiveItems]) {
    if (item.status === "complete") {
      continue;
    }
    const bucket = REVIEW_OUTPUT_IDS.has(item.id) ? buckets.review : ARCHIVE_OUTPUT_IDS.has(item.id) ? buckets.archive : buckets.diagnostic;
    bucket.entries.push(coverageEntry(item));
  }

  for (const issue of summary?.issues ?? []) {
    const bucket = buckets[classifyIssue(issue.stage, issue.title, issue.detail)];
    bucket.entries.push({
      detail: issue.detail,
      id: `issue-${issue.stage}-${issue.title}-${bucket.entries.length}`,
      impact: issueImpact(issue.stage, issue.title, issue.detail, issue.severity),
      title: issue.title,
      tone: issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "info",
    });
  }

  for (const bucket of Object.values(buckets)) {
    bucket.entries = dedupeEntries(bucket.entries);
    bucket.tone = bucket.entries.some((entry) => entry.tone === "error")
      ? "error"
      : bucket.entries.some((entry) => entry.tone === "warning")
        ? "warning"
        : "ok";
  }

  return buckets;
}

function coverageEntry(item: DailyPullCoverageItem): DailyPullIssueEntry {
  const messages = [...item.failures, ...item.warnings, ...item.notes].filter(Boolean);
  return {
    detail: messages.join(" ") || item.basis,
    id: `coverage-${item.id}`,
    impact: coverageImpact(item),
    title: item.label,
    tone: item.status === "failed" ? "error" : "warning",
  };
}

function classifyIssue(stage: string, title: string, detail: string): DailyPullIssueBucketId {
  const haystack = `${stage} ${title} ${detail}`.toLowerCase();
  if (stage === "upload" || /payload|workbook|google|receipt|archive/.test(haystack)) {
    return "archive";
  }
  if (/spx pull|spx status|trade status|entry rows|trade files|spread replay|spread marks/.test(haystack)) {
    return "review";
  }
  return "diagnostic";
}

function coverageImpact(item: DailyPullCoverageItem): string {
  if (item.importance === "core") {
    return item.status === "failed" ? "Review blocker: this core output is required before trusting the date." : "Review caution: core output is present but not fully clean.";
  }
  if (ARCHIVE_OUTPUT_IDS.has(item.id)) {
    return "Archive only: local review can proceed, but upload/archive confirmation needs attention.";
  }
  return "Diagnostic only: this may affect context breadth, not the core trade/SPX replay.";
}

function issueImpact(stage: string, title: string, detail: string, severity: string): string {
  const haystack = `${title} ${detail}`.toLowerCase();
  if (stage === "upload" || /payload|workbook|google|receipt/.test(haystack)) {
    return "Archive only: local review is unaffected.";
  }
  if (/spx pull|spx status|trade status|entry rows|spread replay|spread marks/.test(haystack)) {
    return severity === "error" ? "Review blocker: core selected-date data needs repair." : "Review caution: a core selected-date check is not fully clean.";
  }
  if (/near spx|open\/close/.test(haystack) && severity !== "info") {
    return "Review caution: this diagnostic may affect selected-date context near SPX.";
  }
  return "Diagnostic only: keep for audit, but core review readiness is decided separately.";
}

function directlyAffectsReview(entry: DailyPullIssueEntry): boolean {
  const haystack = `${entry.title} ${entry.detail} ${entry.impact}`.toLowerCase();
  return entry.tone === "warning" && /near spx|review caution|core selected-date/.test(haystack);
}

function countProblemItems(items: DailyPullCoverageItem[]): number {
  return items.filter((item) => item.status !== "complete").length;
}

function verdictTitle(verdict: DailyPullReviewVerdict): string {
  if (verdict === "blocked") {
    return "Blocked";
  }
  if (verdict === "usable_with_caution") {
    return "Usable with caution";
  }
  if (verdict === "today_in_progress") {
    return "Today not ready yet";
  }
  return "Ready for review";
}

function verdictSubtitle(verdict: DailyPullReviewVerdict, selectedDate: string, blockerCount: number, cautionCount: number): string {
  if (verdict === "blocked") {
    return `${selectedDate} is missing ${blockerCount} review-critical output${blockerCount === 1 ? "" : "s"}.`;
  }
  if (verdict === "usable_with_caution") {
    return `${selectedDate} core review is available; ${cautionCount || 1} diagnostic item${(cautionCount || 1) === 1 ? "" : "s"} may affect context.`;
  }
  if (verdict === "today_in_progress") {
    return `${selectedDate} has a local folder, but usable entries/core replay data are not ready.`;
  }
  return `${selectedDate} has usable trade files, SPX bars, and traded spread replay marks.`;
}

function tradeCountEntries(tradeCountsByDate: Map<string, number> | undefined): Pick<{ date: string }, "date">[] {
  if (!tradeCountsByDate) {
    return [];
  }
  return Array.from(tradeCountsByDate.entries()).flatMap(([date, count]) => Array.from({ length: count }, () => ({ date })));
}

function dedupeEntries(entries: DailyPullIssueEntry[]): DailyPullIssueEntry[] {
  const seen = new Set<string>();
  const nextEntries: DailyPullIssueEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.title}\n${entry.detail}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    nextEntries.push(entry);
  }
  return nextEntries;
}
