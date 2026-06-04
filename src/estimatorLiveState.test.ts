import { describe, expect, it } from "vitest";
import { estimatorLiveState } from "./estimatorLiveState";

// Fixed UTC instants chosen to land on known New York wall-clock times (June 2026
// is EDT, UTC-4), same technique as server/ibkrHoldings.test.ts.
const WED_14_ET = new Date("2026-06-03T18:00:00Z"); // Wednesday 14:00 ET
const WED_09_ET = new Date("2026-06-03T13:00:00Z"); // Wednesday 09:00 ET (pre-open)
const WED_1605_ET = new Date("2026-06-03T20:05:00Z"); // Wednesday 16:05 ET (after close)
const SAT_14_ET = new Date("2026-06-06T18:00:00Z"); // Saturday 14:00 ET
const minutesBefore = (now: Date, m: number): string => new Date(now.getTime() - m * 60_000).toISOString();

describe("estimatorLiveState", () => {
  it("is LIVE during the weekday window with a fresh snapshot", () => {
    const state = estimatorLiveState({ now: WED_14_ET, fetchedAt: minutesBefore(WED_14_ET, 3), autoRefreshConfigured: true, tracksToday: true });
    expect(state.phase).toBe("LIVE");
    expect(state.pulsing).toBe(true);
    expect(state.shouldPoll).toBe(true);
    expect(state.detail).toContain("auto every 5m");
  });

  it("is STALE in-window when the snapshot is older than ~2 intervals (but keeps polling)", () => {
    const state = estimatorLiveState({ now: WED_14_ET, fetchedAt: minutesBefore(WED_14_ET, 12), autoRefreshConfigured: true, tracksToday: true });
    expect(state.phase).toBe("STALE");
    expect(state.pulsing).toBe(false);
    expect(state.shouldPoll).toBe(true);
    expect(state.detail).toMatch(/TWS may be down/);
  });

  it("is STALE in-window when no snapshot has been fetched yet", () => {
    const state = estimatorLiveState({ now: WED_14_ET, fetchedAt: null, autoRefreshConfigured: true, tracksToday: true });
    expect(state.phase).toBe("STALE");
    expect(state.ageSeconds).toBeNull();
    expect(state.shouldPoll).toBe(true);
  });

  it("is STALE in-window when the server scheduler is disabled", () => {
    const state = estimatorLiveState({ now: WED_14_ET, fetchedAt: minutesBefore(WED_14_ET, 1), autoRefreshConfigured: false, tracksToday: true });
    expect(state.phase).toBe("STALE");
    expect(state.detail).toMatch(/disabled/);
  });

  it("is PRE_MARKET before 09:30 ET on a weekday and does not poll", () => {
    const state = estimatorLiveState({ now: WED_09_ET, fetchedAt: null, autoRefreshConfigured: true, tracksToday: true });
    expect(state.phase).toBe("PRE_MARKET");
    expect(state.shouldPoll).toBe(false);
  });

  it("is CLOSED after 16:00 ET even though the server pulls to 16:15", () => {
    const state = estimatorLiveState({ now: WED_1605_ET, fetchedAt: minutesBefore(WED_1605_ET, 1), autoRefreshConfigured: true, tracksToday: true });
    expect(state.phase).toBe("CLOSED");
    expect(state.shouldPoll).toBe(false);
  });

  it("is CLOSED on weekends", () => {
    const state = estimatorLiveState({ now: SAT_14_ET, fetchedAt: null, autoRefreshConfigured: true, tracksToday: true });
    expect(state.phase).toBe("CLOSED");
    expect(state.shouldPoll).toBe(false);
  });

  it("never claims LIVE when viewing a past date, even mid-session", () => {
    const state = estimatorLiveState({ now: WED_14_ET, fetchedAt: minutesBefore(WED_14_ET, 1), autoRefreshConfigured: true, tracksToday: false });
    expect(state.phase).toBe("CLOSED");
    expect(state.detail).toMatch(/past date/);
    expect(state.shouldPoll).toBe(false);
  });

  it("treats the freshness boundary inclusively (<= fresh is LIVE, just past is STALE)", () => {
    const atBoundary = estimatorLiveState({ now: WED_14_ET, fetchedAt: minutesBefore(WED_14_ET, 11), autoRefreshConfigured: true, tracksToday: true }); // 2*5 + 1 = 11m
    expect(atBoundary.phase).toBe("LIVE");
    const justPast = estimatorLiveState({ now: WED_14_ET, fetchedAt: new Date(WED_14_ET.getTime() - (11 * 60_000 + 1)).toISOString(), autoRefreshConfigured: true, tracksToday: true });
    expect(justPast.phase).toBe("STALE");
  });
});
