import { describe, expect, it } from "vitest";
import type { SpxBar } from "../shared/types.ts";
import { loadSpxMaContext } from "./spxMaContext.ts";

// Synthetic session: `count` one-minute bars on day `dayIndex`. Close encodes
// dayIndex*100000 + minute, so closes increase strictly with (day, minute) — that
// lets the test verify chronological (oldest→newest) ordering and date exclusion.
function makeSession(dayIndex: number, count = 90): SpxBar[] {
  const base = 1_700_000_000 + dayIndex * 86_400;
  return Array.from({ length: count }, (_, minute) => {
    const close = dayIndex * 100_000 + minute;
    return {
      time: base + minute * 60,
      timestampEt: `day${dayIndex}-${minute}`,
      label: `day${dayIndex}-${minute}`,
      open: close,
      high: close,
      low: close,
      close,
    };
  });
}

function isoDate(dayIndex: number): string {
  // 2026-02-01 + dayIndex days, formatted YYYY-MM-DD (stays within Feb/Mar for our range).
  const d = new Date(Date.UTC(2026, 1, 1 + dayIndex));
  return d.toISOString().slice(0, 10);
}

describe("loadSpxMaContext", () => {
  const dayCount = 40;
  const dates = Array.from({ length: dayCount }, (_, i) => isoDate(i));
  const barsByDate = new Map(dates.map((date, i) => [date, makeSession(i)]));
  const queryDate = dates[dayCount - 1];

  const deps = {
    listDates: async () => [...dates],
    loadBars: async (date: string) => barsByDate.get(date) ?? [],
  };

  it("warms each timeframe from prior sessions, capped and chronological", async () => {
    const ctx = await loadSpxMaContext(queryDate, { intervals: [1, 30], warmupBars: 100, ...deps });

    // Capped to warmupBars (39 prior sessions × 90 1m bars and × 3 30m bars both exceed 100).
    expect(ctx.byInterval["1"]).toHaveLength(100);
    expect(ctx.byInterval["30"]).toHaveLength(100);

    // Oldest→newest: closes strictly increasing across the concatenation.
    for (const interval of ["1", "30"] as const) {
      const closes = ctx.byInterval[interval];
      for (let i = 1; i < closes.length; i += 1) {
        expect(closes[i]).toBeGreaterThan(closes[i - 1]);
      }
    }

    // newest prior session used (excludes the query date itself).
    expect(ctx.throughDate).toBe(dates[dayCount - 2]);
  });

  it("excludes the query date's own bars (no look-ahead)", async () => {
    const ctx = await loadSpxMaContext(queryDate, { intervals: [1], warmupBars: 5000, ...deps });
    const queryFloor = (dayCount - 1) * 100_000; // query date's closes start here
    expect(Math.max(...ctx.byInterval["1"])).toBeLessThan(queryFloor);
  });

  it("returns empty arrays when there is no prior history", async () => {
    const ctx = await loadSpxMaContext(dates[0], { intervals: [1, 30], warmupBars: 100, ...deps });
    expect(ctx.byInterval["1"]).toEqual([]);
    expect(ctx.byInterval["30"]).toEqual([]);
    expect(ctx.throughDate).toBeNull();
  });
});
