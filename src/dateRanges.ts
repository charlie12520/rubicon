import type { TradeRecord } from "../shared/types";

export type RangeId = "today" | "yesterday" | "thisWeek" | "lastWeek" | "mtd" | "ytd" | "custom";

export const rangePresets: Array<{ id: RangeId; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "thisWeek", label: "This Week" },
  { id: "lastWeek", label: "Last Week" },
  { id: "mtd", label: "MTD" },
  { id: "ytd", label: "YTD" },
  { id: "custom", label: "Date" },
];

function asDate(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

function isoDay(date: Date): string {
  return date.toLocaleDateString("en-CA");
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function previousTradingSessionDate(day: string): string {
  let previous = addDays(asDate(day), -1);
  while (previous.getDay() === 0 || previous.getDay() === 6) {
    previous = addDays(previous, -1);
  }
  return isoDay(previous);
}

function mondayStart(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

export function resolveRange(range: RangeId, today: string, customDate: string): { start: string; end: string; label: string } {
  const base = asDate(today);
  const selected = customDate || today;

  if (range === "today") {
    return { start: today, end: today, label: today };
  }
  if (range === "yesterday") {
    const yesterday = previousTradingSessionDate(today);
    return { start: yesterday, end: yesterday, label: yesterday };
  }
  if (range === "thisWeek") {
    return { start: isoDay(mondayStart(base)), end: today, label: "This Week" };
  }
  if (range === "lastWeek") {
    const start = addDays(mondayStart(base), -7);
    const end = addDays(start, 4);
    return { start: isoDay(start), end: isoDay(end), label: "Last Week" };
  }
  if (range === "mtd") {
    return { start: `${today.slice(0, 7)}-01`, end: today, label: "Month To Date" };
  }
  if (range === "ytd") {
    return { start: `${today.slice(0, 4)}-01-01`, end: today, label: "Year To Date" };
  }
  return { start: selected, end: selected, label: selected };
}

export function tradesInRange(trades: TradeRecord[], range: RangeId, today: string, customDate: string): TradeRecord[] {
  const resolved = resolveRange(range, today, customDate);
  return trades.filter((trade) => trade.date >= resolved.start && trade.date <= resolved.end);
}
