import type { DailySummary, TrackerSnapshot, TradeRecord } from "../shared/types";
import type { RangeId } from "./dateRanges";

type SnapshotDates = Pick<TrackerSnapshot, "availableDates" | "latestTradeDate" | "today">;
type SnapshotUsability = SnapshotDates & {
  dailySummaries?: DailySummary[];
  trades?: Pick<TradeRecord, "date">[];
};

export function marketDateFromSnapshot(snapshot: SnapshotDates): string {
  return snapshot.availableDates.includes(snapshot.today) ? snapshot.today : snapshot.latestTradeDate ?? snapshot.today;
}

export function latestUsableDateFromSnapshot(snapshot: SnapshotUsability): string | null {
  const summaries = new Map((snapshot.dailySummaries ?? []).map((summary) => [summary.date, summary]));
  const tradeCounts = new Map<string, number>();
  for (const trade of snapshot.trades ?? []) {
    tradeCounts.set(trade.date, (tradeCounts.get(trade.date) ?? 0) + 1);
  }

  for (const date of [...snapshot.availableDates].sort((a, b) => b.localeCompare(a))) {
    if (summaryHasReviewUsableCore(summaries.get(date), tradeCounts.get(date) ?? 0)) {
      return date;
    }
  }

  return snapshot.latestTradeDate ?? null;
}

export function summaryHasReviewUsableCore(summary: DailySummary | null | undefined, tradeCount = 0): boolean {
  if (!summary) {
    return false;
  }

  const entryCount = summary.entryCount || tradeCount;
  const tradeReady = entryCount > 0 && !isBlockingStatus(summary.tradeStatus);
  const spxReady = !isBlockingStatus(summary.spxStatus) && (summary.spxIntradayRowCount === undefined || summary.spxIntradayRowCount > 0);
  const marksReady = summary.spreadMarkRowCount === undefined || summary.spreadMarkRowCount > 0 || (summary.spreadMarkExpectedRows ?? 0) === 0;
  return tradeReady && spxReady && marksReady;
}

export function selectDateAfterTrackerRefresh({
  nextMarketDate,
  previousMarketDate,
  range,
  selectedDate,
}: {
  nextMarketDate: string;
  previousMarketDate: string;
  range: RangeId;
  selectedDate: string;
}): string {
  if (!selectedDate) {
    return nextMarketDate;
  }

  if (range === "today" || selectedDate === previousMarketDate) {
    return nextMarketDate;
  }

  return selectedDate;
}

function isBlockingStatus(status: string | undefined): boolean {
  const normalized = String(status ?? "").toLowerCase();
  return normalized === "empty" || normalized === "missing" || normalized.includes("error") || normalized.includes("failed");
}
