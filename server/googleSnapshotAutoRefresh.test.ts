import { afterEach, describe, expect, it } from "vitest";
import {
  googleSnapshotAutoRefreshEnabled,
  googleSnapshotAutoRefreshIntervalMinutes,
  maybeAutoRefreshGoogleDriveSnapshot,
  resetGoogleSnapshotAutoRefreshForTests,
} from "./googleSnapshotAutoRefresh.ts";

describe("Google tracker snapshot auto-refresh", () => {
  afterEach(() => {
    resetGoogleSnapshotAutoRefreshForTests();
  });

  it("waits without attempting a refresh when no credential is configured", async () => {
    let attempts = 0;

    const status = await maybeAutoRefreshGoogleDriveSnapshot({
      env: {},
      now: new Date("2026-05-29T21:20:00.000Z"),
      refresh: async () => {
        attempts += 1;
        return "data/google-drive-tracker-snapshot.json";
      },
    });

    expect(attempts).toBe(0);
    expect(status.mode).toBe("waiting_for_credential");
    expect(status.ok).toBe(false);
    expect(status.message).toContain("waiting for a reusable Google Sheets credential");
  });

  it("refreshes once with a configured credential and throttles the next tracker read", async () => {
    let attempts = 0;
    const env = { GOOGLE_SHEETS_ACCESS_TOKEN: "token", SPX_GOOGLE_AUTO_REFRESH_MINUTES: "10" };
    const refresh = async () => {
      attempts += 1;
      return "data/google-drive-tracker-snapshot.json";
    };

    const first = await maybeAutoRefreshGoogleDriveSnapshot({
      env,
      now: new Date("2026-05-29T21:20:00.000Z"),
      refresh,
    });
    const second = await maybeAutoRefreshGoogleDriveSnapshot({
      env,
      now: new Date("2026-05-29T21:25:00.000Z"),
      refresh,
    });

    expect(attempts).toBe(1);
    expect(first.mode).toBe("refreshed");
    expect(first.ok).toBe(true);
    expect(second.mode).toBe("skipped_recent");
    expect(second.ok).toBe(true);
    expect(second.nextAttemptAfter).toBe("2026-05-29T21:30:00.000Z");
  });

  it("records credential failures and throttles retries", async () => {
    let attempts = 0;
    const env = { GOOGLE_SERVICE_ACCOUNT_PATH: "bad.json", SPX_GOOGLE_AUTO_REFRESH_MINUTES: "15" };
    const refresh = async () => {
      attempts += 1;
      throw new Error("invalid service account");
    };

    const first = await maybeAutoRefreshGoogleDriveSnapshot({
      env,
      now: new Date("2026-05-29T21:20:00.000Z"),
      refresh,
    });
    const second = await maybeAutoRefreshGoogleDriveSnapshot({
      env,
      now: new Date("2026-05-29T21:25:00.000Z"),
      refresh,
    });

    expect(attempts).toBe(1);
    expect(first.mode).toBe("failed");
    expect(first.ok).toBe(false);
    expect(first.message).toContain("invalid service account");
    expect(second.mode).toBe("skipped_recent");
    expect(second.ok).toBe(false);
    expect(second.message).toContain("retry after");
  });

  it("honors disable and interval environment controls", () => {
    expect(googleSnapshotAutoRefreshEnabled({ SPX_GOOGLE_AUTO_REFRESH: "0" })).toBe(false);
    expect(googleSnapshotAutoRefreshEnabled({ SPX_GOOGLE_AUTO_REFRESH: "false" })).toBe(false);
    expect(googleSnapshotAutoRefreshEnabled({})).toBe(true);
    expect(googleSnapshotAutoRefreshIntervalMinutes({ SPX_GOOGLE_AUTO_REFRESH_MINUTES: "7" })).toBe(7);
    expect(googleSnapshotAutoRefreshIntervalMinutes({ SPX_GOOGLE_AUTO_REFRESH_MINUTES: "nope" })).toBe(30);
  });
});
