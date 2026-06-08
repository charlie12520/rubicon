import { describe, expect, it } from "vitest";
import type { MorningCalendarEvent } from "../shared/types";
import {
  calendarAlertGroups,
  calendarAlertTargets,
  calendarEventStartAt,
  formatCalendarAlertStatus,
  nextCalendarAlertGroup,
  nextCalendarAlertTarget,
} from "./calendarAlerts";

function event(overrides: Partial<MorningCalendarEvent>): MorningCalendarEvent {
  return {
    id: overrides.id ?? "event-1",
    source: overrides.source ?? "RollCall",
    date: overrides.date ?? "2026-05-31",
    timeLabel: overrides.timeLabel ?? "9:30 AM",
    sortMinute: overrides.sortMinute ?? 9 * 60 + 30,
    title: overrides.title ?? "Calendar event",
    impact: overrides.impact ?? "political",
  };
}

describe("calendar alert scheduling", () => {
  it("converts dated calendar rows into local event start times", () => {
    const start = calendarEventStartAt(event({ date: "2026-05-31", sortMinute: 14 * 60 + 5 }));
    expect([start?.getFullYear(), start?.getMonth(), start?.getDate(), start?.getHours(), start?.getMinutes()]).toEqual([
      2026,
      4,
      31,
      14,
      5,
    ]);
  });

  it("schedules alerts one minute before future events", () => {
    const targets = calendarAlertTargets(
      [event({ id: "a", sortMinute: 9 * 60 + 30, timeLabel: "9:30 AM" })],
      new Date(2026, 4, 31, 9, 28, 30),
    );

    expect(targets).toHaveLength(1);
    expect(targets[0].event.timeLabel).toBe("9:30 AM");
    expect(targets[0].millisUntilAlert).toBe(30_000);
  });

  it("fires immediately if the one-minute alert window has already started", () => {
    const target = nextCalendarAlertTarget(
      [event({ id: "a", sortMinute: 9 * 60 + 30, timeLabel: "9:30 AM" })],
      new Date(2026, 4, 31, 9, 29, 30),
    );

    expect(target?.millisUntilAlert).toBe(0);
  });

  it("ignores untimed and already-started events", () => {
    const targets = calendarAlertTargets(
      [
        event({ id: "past", sortMinute: 9 * 60 + 30 }),
        event({ id: "untimed", sortMinute: null, timeLabel: "Time TBD" }),
        event({ id: "future", sortMinute: 10 * 60 }),
      ],
      new Date(2026, 4, 31, 9, 30),
    );

    expect(targets.map((target) => target.event.id)).toEqual(["future"]);
  });

  it("describes the next alert compactly for the UI", () => {
    const group = nextCalendarAlertGroup(
      [event({ title: "Fed speaker", sortMinute: 10 * 60, timeLabel: "10:00 AM" })],
      new Date(2026, 4, 31, 9, 58, 45),
    );

    expect(formatCalendarAlertStatus(group)).toBe("Next alert in 15s: 10:00 AM - Fed speaker");
  });

  it("coalesces simultaneous events into a single alert group", () => {
    const groups = calendarAlertGroups(
      [
        event({ id: "cpi", title: "CPI", sortMinute: 8 * 60 + 30, timeLabel: "8:30 AM" }),
        event({ id: "retail", title: "Retail Sales", sortMinute: 8 * 60 + 30, timeLabel: "8:30 AM" }),
        event({ id: "claims", title: "Jobless Claims", sortMinute: 8 * 60 + 30, timeLabel: "8:30 AM" }),
        event({ id: "fed", title: "Fed speaker", sortMinute: 8 * 60 + 31, timeLabel: "8:31 AM" }),
      ],
      new Date(2026, 4, 31, 8, 0, 0),
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].events.map((e) => e.id)).toEqual(["cpi", "claims", "retail"]);
    expect(groups[0].millisUntilAlert).toBe(29 * 60_000);
    expect(groups[1].events.map((e) => e.id)).toEqual(["fed"]);
  });

  it("summarises a coalesced group as an event count", () => {
    const group = nextCalendarAlertGroup(
      [
        event({ id: "cpi", title: "CPI", sortMinute: 8 * 60 + 30, timeLabel: "8:30 AM" }),
        event({ id: "retail", title: "Retail Sales", sortMinute: 8 * 60 + 30, timeLabel: "8:30 AM" }),
      ],
      new Date(2026, 4, 31, 8, 28, 30),
    );

    expect(formatCalendarAlertStatus(group)).toBe("Next alert in 30s: 8:30 AM - 2 events");
  });
});
