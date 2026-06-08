// Earnings-this-week overlay logic for the heatmap. A before-open (BMO) report
// counts as the PREVIOUS trading day — the prior session's close is the last
// chance to trade the name before the move. The outline is "always obvious" and
// gets more obvious as the effective (last-tradeable) date nears.

export type EarningsTime = "before-open" | "after-close" | "not-supplied";

export type EarningsHighlight = {
  inWindow: boolean; // effective date is within the ~2-week look-ahead and not already past
  effectiveDate: string; // YYYY-MM-DD — last tradeable date before the report
  daysUntil: number; // trading days from today (ET) to effectiveDate, >= 0
  intensity: number; // [FLOOR, 1]; higher = nearer = more obvious
};

const FLOOR = 0.45; // minimum "obvious" intensity, even at the far end of the window
const WINDOW_DAYS = 10; // trading days (~2 weeks) the overlay looks ahead, and the span the intensity ramps over

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parse(date: string): Date {
  return new Date(`${date}T12:00:00Z`); // UTC noon avoids any DST/offset drift
}
function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
function weekday(date: string): number {
  return parse(date).getUTCDay(); // 0 Sun .. 6 Sat
}
function easternYmd(now: Date): string {
  // en-CA renders as YYYY-MM-DD; America/New_York gives the ET calendar date.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
function previousTradingDay(date: string): string {
  let p = addDays(date, -1);
  const wd = weekday(p);
  if (wd === 0) p = addDays(p, -2); // Sun → Fri
  else if (wd === 6) p = addDays(p, -1); // Sat → Fri
  return p;
}
function tradingDaysUntil(fromDate: string, toDate: string): number {
  if (toDate <= fromDate) return 0;
  let count = 0;
  let cur = fromDate;
  while (cur < toDate) {
    cur = addDays(cur, 1);
    const wd = weekday(cur);
    if (wd >= 1 && wd <= 5) count += 1;
  }
  return count;
}

export function earningsHighlight(
  earningsDate: string | null | undefined,
  earningsTime: EarningsTime | null | undefined,
  now: Date,
): EarningsHighlight | null {
  if (!earningsDate || !/^\d{4}-\d{2}-\d{2}$/.test(earningsDate)) return null;
  // BMO → last tradeable day is the prior trading day; AMC / unknown → the report day itself.
  const effectiveDate = earningsTime === "before-open" ? previousTradingDay(earningsDate) : earningsDate;
  const today = easternYmd(now);
  const daysUntil = tradingDaysUntil(today, effectiveDate);
  const inWindow = effectiveDate >= today && daysUntil <= WINDOW_DAYS;
  const ramp = Math.max(0, 1 - daysUntil / WINDOW_DAYS);
  const intensity = FLOOR + (1 - FLOOR) * ramp;
  return { inWindow, effectiveDate, daysUntil, intensity };
}
