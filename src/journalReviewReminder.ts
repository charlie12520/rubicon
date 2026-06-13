import type { TradeRecord } from "../shared/types";
import type { TradeJournalEntry } from "./tradeJournal";

export const JOURNAL_REVIEW_NOTIFY_TIME = "16:15";

type EasternClock = {
  date: string;
  time: string;
  weekday: number;
};

export type JournalReviewReminderDecisionInput = {
  armed: boolean;
  entries: Record<string, TradeJournalEntry>;
  lastNotifiedDate: string | null;
  latestTradeDate: string | null;
  now?: Date;
  notifyTime?: string;
  trades: TradeRecord[];
};

export type JournalReviewReminderDecision = {
  date: string;
  firstTradeId: string | null;
  shouldNotify: boolean;
  time: string;
  unreviewedCount: number;
};

export function journalReviewReminderDecision({
  armed,
  entries,
  lastNotifiedDate,
  latestTradeDate,
  now = new Date(),
  notifyTime = JOURNAL_REVIEW_NOTIFY_TIME,
  trades,
}: JournalReviewReminderDecisionInput): JournalReviewReminderDecision {
  const clock = easternClock(now);
  const fallback: JournalReviewReminderDecision = {
    date: clock.date,
    firstTradeId: null,
    shouldNotify: false,
    time: clock.time,
    unreviewedCount: 0,
  };

  if (!armed || !latestTradeDate || latestTradeDate !== clock.date || lastNotifiedDate === latestTradeDate) {
    return fallback;
  }

  const isWeekday = clock.weekday >= 1 && clock.weekday <= 5;
  if (!isWeekday || clock.time < notifyTime) {
    return fallback;
  }

  const unreviewedTrades = trades
    .filter((trade) => trade.date === latestTradeDate && entries[trade.id]?.status !== "reviewed")
    .sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));

  return {
    date: latestTradeDate,
    firstTradeId: unreviewedTrades[0]?.id ?? null,
    shouldNotify: unreviewedTrades.length > 0,
    time: clock.time,
    unreviewedCount: unreviewedTrades.length,
  };
}

function easternClock(now: Date): EasternClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}
