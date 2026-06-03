import { describe, expect, it } from "vitest";
import { easternClock, shouldFireDailyWindow, timeDeltaMinutes } from "./easternClock.ts";

describe("shared Eastern clock helpers", () => {
  it("formats date, time, and weekday in New York time", () => {
    expect(easternClock(new Date("2026-05-29T12:30:00.000Z"))).toEqual({
      date: "2026-05-29",
      time: "08:30",
      weekday: 5,
    });
  });

  it("guards one daily fire inside the configured weekday catchup window", () => {
    const decision = shouldFireDailyWindow({
      now: new Date("2026-05-29T12:34:00.000Z"),
      lastFiredDate: null,
      configuredTime: "08:30",
      catchupMinutes: 5,
      enabled: true,
    });

    expect(decision).toEqual({
      date: "2026-05-29",
      shouldFire: true,
      time: "08:34",
    });
    expect(
      shouldFireDailyWindow({
        now: new Date("2026-05-29T12:36:00.000Z"),
        lastFiredDate: null,
        configuredTime: "08:30",
        catchupMinutes: 5,
        enabled: true,
      }).shouldFire,
    ).toBe(false);
    expect(
      shouldFireDailyWindow({
        now: new Date("2026-05-31T12:30:00.000Z"),
        lastFiredDate: null,
        configuredTime: "08:30",
        enabled: true,
      }).shouldFire,
    ).toBe(false);
  });

  it("computes absolute HH:MM minute deltas", () => {
    expect(timeDeltaMinutes("08:30", "08:45")).toBe(15);
    expect(timeDeltaMinutes("09:10", "08:45")).toBe(25);
  });
});
