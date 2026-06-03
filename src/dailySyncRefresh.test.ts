import { describe, expect, it } from "vitest";
import type { DailySyncStatusResult } from "../shared/types";
import { dailySyncCompletionRefreshKey, shouldRefreshTrackerAfterDailySyncStatus } from "./dailySyncRefresh";

function status(overrides: Partial<DailySyncStatusResult>): DailySyncStatusResult {
  return {
    generatedAt: "2026-06-02T12:00:00.000Z",
    message: "Daily sync is idle.",
    ok: true,
    state: "idle",
    ...overrides,
  };
}

describe("daily sync completion refresh decisions", () => {
  it("keys completed syncs by finish time and latest summary date", () => {
    expect(
      dailySyncCompletionRefreshKey(
        status({
          finishedAt: "2026-06-02T20:30:00.000Z",
          latestSummary: { date: "2026-06-01", entryCount: 22, fillCount: 75, path: "daily_sync_summary.json", spreadCount: 31 },
          state: "completed",
        }),
      ),
    ).toBe("2026-06-02T20:30:00.000Z|2026-06-01");
  });

  it("refreshes the tracker once when polling observes a new completed sync", () => {
    const completed = status({
      finishedAt: "2026-06-02T20:30:00.000Z",
      latestSummary: { date: "2026-06-01", entryCount: 22, fillCount: 75, path: "daily_sync_summary.json", spreadCount: 31 },
      state: "completed",
    });

    expect(shouldRefreshTrackerAfterDailySyncStatus(null, completed)).toEqual({
      nextKey: "2026-06-02T20:30:00.000Z|2026-06-01",
      shouldRefresh: true,
    });
    expect(shouldRefreshTrackerAfterDailySyncStatus("2026-06-02T20:30:00.000Z|2026-06-01", completed)).toEqual({
      nextKey: "2026-06-02T20:30:00.000Z|2026-06-01",
      shouldRefresh: false,
    });
  });

  it("does not refresh for running or idle status rows", () => {
    expect(shouldRefreshTrackerAfterDailySyncStatus(null, status({ state: "running" }))).toEqual({
      nextKey: null,
      shouldRefresh: false,
    });
    expect(shouldRefreshTrackerAfterDailySyncStatus(null, status({ state: "idle" }))).toEqual({
      nextKey: null,
      shouldRefresh: false,
    });
  });
});
