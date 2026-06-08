import type { MorningCalendarEvent } from "../shared/types";

export const CALENDAR_ALERT_LEAD_MS = 60_000;

export type CalendarAlertTarget = {
  alertAt: Date;
  event: MorningCalendarEvent;
  eventAt: Date;
  millisUntilAlert: number;
};

// One alert "moment": every event sharing the same start time is coalesced into a
// single group so Rubicon fires ONE notification for the cluster, not one per event.
export type CalendarAlertGroup = {
  alertAt: Date;
  eventAt: Date;
  events: MorningCalendarEvent[];
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

// Coalesce per-event targets that share the same start time into one group, so a
// cluster like CPI + Retail Sales + Jobless Claims all at 8:30 fires a single alert.
export function calendarAlertGroups(
  events: MorningCalendarEvent[],
  now = new Date(),
  leadMs = CALENDAR_ALERT_LEAD_MS,
): CalendarAlertGroup[] {
  const byMoment = new Map<number, CalendarAlertGroup>();
  const order: number[] = [];
  for (const target of calendarAlertTargets(events, now, leadMs)) {
    const key = target.eventAt.getTime();
    let group = byMoment.get(key);
    if (!group) {
      group = {
        alertAt: target.alertAt,
        eventAt: target.eventAt,
        events: [],
        millisUntilAlert: target.millisUntilAlert,
      };
      byMoment.set(key, group);
      order.push(key);
    }
    group.events.push(target.event);
  }
  return order.map((key) => byMoment.get(key) as CalendarAlertGroup);
}

export function nextCalendarAlertGroup(
  events: MorningCalendarEvent[],
  now = new Date(),
  leadMs = CALENDAR_ALERT_LEAD_MS,
): CalendarAlertGroup | null {
  return calendarAlertGroups(events, now, leadMs)[0] ?? null;
}

export function formatCalendarAlertStatus(group: CalendarAlertGroup | null): string {
  if (!group || !group.events.length) {
    return "No future timed events for this date.";
  }
  const minutes = Math.floor(group.millisUntilAlert / 60_000);
  const seconds = Math.ceil((group.millisUntilAlert % 60_000) / 1000);
  const countdown = group.millisUntilAlert === 0 ? "now" : minutes ? `in ${minutes}m ${seconds}s` : `in ${seconds}s`;
  const [first] = group.events;
  const headline =
    group.events.length > 1 ? `${first.timeLabel} - ${group.events.length} events` : `${first.timeLabel} - ${first.title}`;
  return `Next alert ${countdown}: ${headline}`;
}
