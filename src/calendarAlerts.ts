import type { MorningCalendarEvent } from "../shared/types";

export const CALENDAR_ALERT_LEAD_MS = 60_000;

export type CalendarAlertTarget = {
  alertAt: Date;
  event: MorningCalendarEvent;
  eventAt: Date;
  millisUntilAlert: number;
};

export function calendarEventStartAt(event: MorningCalendarEvent): Date | null {
  if (event.sortMinute == null) {
    return null;
  }
  const [year, month, day] = event.date.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day, Math.floor(event.sortMinute / 60), event.sortMinute % 60, 0, 0);
}

export function calendarAlertTargets(
  events: MorningCalendarEvent[],
  now = new Date(),
  leadMs = CALENDAR_ALERT_LEAD_MS,
): CalendarAlertTarget[] {
  const nowMs = now.getTime();
  return events
    .map((event): CalendarAlertTarget | null => {
      const eventAt = calendarEventStartAt(event);
      if (!eventAt || eventAt.getTime() <= nowMs) {
        return null;
      }
      const alertAt = new Date(eventAt.getTime() - leadMs);
      return {
        alertAt,
        event,
        eventAt,
        millisUntilAlert: Math.max(0, alertAt.getTime() - nowMs),
      };
    })
    .filter((target): target is CalendarAlertTarget => Boolean(target))
    .sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime() || a.event.title.localeCompare(b.event.title));
}

export function nextCalendarAlertTarget(
  events: MorningCalendarEvent[],
  now = new Date(),
  leadMs = CALENDAR_ALERT_LEAD_MS,
): CalendarAlertTarget | null {
  return calendarAlertTargets(events, now, leadMs)[0] ?? null;
}

export function formatCalendarAlertStatus(target: CalendarAlertTarget | null): string {
  if (!target) {
    return "No future timed events for this date.";
  }
  const minutes = Math.floor(target.millisUntilAlert / 60_000);
  const seconds = Math.ceil((target.millisUntilAlert % 60_000) / 1000);
  const countdown = target.millisUntilAlert === 0 ? "now" : minutes ? `in ${minutes}m ${seconds}s` : `in ${seconds}s`;
  return `Next alert ${countdown}: ${target.event.timeLabel} - ${target.event.title}`;
}
