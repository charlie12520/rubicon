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
  const date = status.targetDate ?? status.latestSummary?.date ?? status.latestPipelineRun?.date ?? "unknown";
  const run = status.runId ?? "unknown";
  return `${finished}|${date}|${run}`;
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
