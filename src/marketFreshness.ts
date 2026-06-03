import type { TrackerSnapshot } from "../shared/types";

type SnapshotDates = Pick<TrackerSnapshot, "availableDates" | "latestTradeDate" | "today">;

export type MarketFreshness = {
  detail: string;
  label: string;
  tone: "ok" | "warning";
  todayImported: boolean;
};

export function marketFreshness(snapshot: SnapshotDates, viewingDate: string): MarketFreshness | null {
  const todayImported = snapshot.availableDates.includes(snapshot.today);
  if (todayImported) {
    return {
      detail: `Today's archive is available; viewing ${viewingDate || snapshot.today}.`,
      label: "Today imported",
      todayImported,
      tone: "ok",
    };
  }

  if (isWeekendDate(snapshot.today)) {
    return null;
  }

  return null;
}

function isWeekendDate(date: string): boolean {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  const day = new Date(parsed).getUTCDay();
  return day === 0 || day === 6;
}
