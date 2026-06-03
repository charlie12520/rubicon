import { describe, expect, it } from "vitest";
import { easternDateOffset, formatEasternHm, parseChartTimestampSeconds } from "./easternDate";

describe("easternDateOffset", () => {
  it("uses New York calendar days instead of UTC days", () => {
    const lateEveningEt = new Date("2026-06-02T02:41:00.000Z");

    expect(easternDateOffset(0, lateEveningEt)).toBe("2026-06-01");
    expect(easternDateOffset(1, lateEveningEt)).toBe("2026-06-02");
  });
});

describe("chart timestamp helpers", () => {
  it("parses lightweight-chart time inputs to epoch seconds", () => {
    expect(parseChartTimestampSeconds("2026-05-28T10:15:00-04:00")).toBe(1_779_977_700);
    expect(parseChartTimestampSeconds(1_779_977_700)).toBe(1_779_977_700);
    expect(parseChartTimestampSeconds({ year: 2026, month: 5, day: 28 })).toBe(Date.UTC(2026, 4, 28) / 1000);
    expect(parseChartTimestampSeconds("not a date")).toBe(0);
  });

  it("formats chart time inputs in New York hours and minutes", () => {
    expect(formatEasternHm("2026-05-28T10:15:00-04:00")).toBe("10:15");
    expect(formatEasternHm(1_779_977_700)).toBe("10:15");
    expect(formatEasternHm("bad")).toBe("");
  });
});
