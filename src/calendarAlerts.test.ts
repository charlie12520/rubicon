import { describe, expect, it } from "vitest";
import type { MorningCalendarEvent } from "../shared/types";
import {
  calendarAlertTargets,
  calendarEventStartAt,
  formatCalendarAlertStatus,
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
    const target = nextCalendarAlertTarget(
      [event({ title: "Fed speaker", sortMinute: 10 * 60, timeLabel: "10:00 AM" })],
      new Date(2026, 4, 31, 9, 58, 45),
    );

    expect(formatCalendarAlertStatus(target)).toBe("Next alert in 15s: 10:00 AM - Fed speaker");
  });
});
