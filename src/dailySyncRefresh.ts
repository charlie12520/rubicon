import type { DailySyncStatusResult } from "../shared/types";

export type DailySyncRefreshDecision = {
  nextKey: string | null;
  shouldRefresh: boolean;
};

export function dailySyncCompletionRefreshKey(status: DailySyncStatusResult | null | undefined): string | null {
  if (!status || status.state !== "completed") {
    return null;
  }
  const finished = status.finishedAt ?? status.generatedAt;
  const summaryDate = status.latestSummary?.date ?? "unknown";
  return `${finished}|${summaryDate}`;
}

export function shouldRefreshTrackerAfterDailySyncStatus(
  previousKey: string | null,
  status: DailySyncStatusResult | null | undefined,
): DailySyncRefreshDecision {
  const nextKey = dailySyncCompletionRefreshKey(status);
  return {
    nextKey,
    shouldRefresh: Boolean(nextKey && nextKey !== previousKey),
  };
}
