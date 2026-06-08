import { describe, expect, it } from "vitest";
import { earningsHighlight } from "./earningsOverlay";

// Anchor on a week whose weekdays are certain: 2024-01-01 was a Monday.
// Mon 01-01 … Fri 01-05, Sat 01-06, Sun 01-07, Mon 01-08, …, Wed 01-10, … Wed 01-24.
const wed = new Date("2024-01-03T18:00:00Z"); // 13:00 ET Wednesday 2024-01-03
const sat = new Date("2024-01-06T18:00:00Z"); // 13:00 ET Saturday 2024-01-06

describe("earningsHighlight", () => {
  it("returns null when there is no earnings date", () => {
    expect(earningsHighlight(null, null, wed)).toBeNull();
    expect(earningsHighlight("not-a-date", "after-close", wed)).toBeNull();
  });

  it("after-close today is in window, imminent (0 days, full intensity)", () => {
    const h = earningsHighlight("2024-01-03", "after-close", wed)!;
    expect(h.inWindow).toBe(true);
    expect(h.effectiveDate).toBe("2024-01-03");
    expect(h.daysUntil).toBe(0);
    expect(h.intensity).toBeCloseTo(1, 6);
  });

  it("before-open counts as the previous trading day", () => {
    const thu = earningsHighlight("2024-01-04", "before-open", wed)!; // Thu BMO → last tradeable Wed (today)
    expect(thu.effectiveDate).toBe("2024-01-03");
    expect(thu.inWindow).toBe(true);
    expect(thu.daysUntil).toBe(0);
    const mon = earningsHighlight("2024-01-08", "before-open", wed)!; // Mon-next BMO → back over the weekend to Friday
    expect(mon.effectiveDate).toBe("2024-01-05");
    expect(mon.inWindow).toBe(true);
    expect(mon.daysUntil).toBe(2);
  });

  it("the window is ~2 weeks: next Wednesday is still highlighted (today is Wednesday)", () => {
    const nextWed = earningsHighlight("2024-01-10", "after-close", wed)!;
    expect(nextWed.inWindow).toBe(true);
    expect(nextWed.daysUntil).toBe(5); // Wed → next Wed = 5 trading days
    expect(nextWed.intensity).toBeGreaterThan(0.45);
    expect(nextWed.intensity).toBeLessThan(1);
  });

  it("intensity grows as the effective date nears, and floors but stays obvious", () => {
    const nearer = earningsHighlight("2024-01-04", "after-close", wed)!; // 1 day out
    const farther = earningsHighlight("2024-01-10", "after-close", wed)!; // 5 days out
    expect(nearer.intensity).toBeGreaterThan(farther.intensity);
    expect(farther.intensity).toBeGreaterThanOrEqual(0.45); // never dimmer than the floor
  });

  it("a report already past is not highlighted", () => {
    const past = earningsHighlight("2024-01-02", "after-close", wed)!; // Tue, before today (Wed)
    expect(past.inWindow).toBe(false);
  });

  it("a report beyond ~2 weeks is not highlighted", () => {
    const far = earningsHighlight("2024-01-24", "after-close", wed)!; // ~15 trading days out
    expect(far.inWindow).toBe(false);
  });

  it("on a weekend, the look-ahead counts from the upcoming trading days", () => {
    const tue = earningsHighlight("2024-01-09", "after-close", sat)!; // Tue next week
    expect(tue.inWindow).toBe(true);
    expect(tue.daysUntil).toBe(2); // Sat → Mon, Tue
  });
});
