import { describe, expect, it } from "vitest";
import { isMarketPullWindow } from "./spxHeatmapLive.ts";

const clock = (time: string, weekday: number) => ({ date: "2026-06-03", time, weekday });

describe("isMarketPullWindow", () => {
  it("opens during weekday regular trading hours (with a small pre-open grace)", () => {
    expect(isMarketPullWindow(clock("09:25", 3))).toBe(true); // grace open for the auto-start
    expect(isMarketPullWindow(clock("10:00", 3))).toBe(true);
    expect(isMarketPullWindow(clock("15:59", 3))).toBe(true);
  });

  it("refuses at/after the 16:00 close, pre-open, and on weekends", () => {
    expect(isMarketPullWindow(clock("16:00", 3))).toBe(false); // at the close
    expect(isMarketPullWindow(clock("16:30", 3))).toBe(false); // after close
    expect(isMarketPullWindow(clock("09:00", 3))).toBe(false); // pre-open
    expect(isMarketPullWindow(clock("12:00", 6))).toBe(false); // Saturday
    expect(isMarketPullWindow(clock("12:00", 0))).toBe(false); // Sunday
  });
});
