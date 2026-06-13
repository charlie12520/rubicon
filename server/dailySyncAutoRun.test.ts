import { describe, expect, it, vi } from "vitest";
import type { DailySyncStatusResult } from "../shared/types.ts";
import { createDailySyncAutoRunController, evaluateDailySyncAutoRunDecision, readDailySyncAutoRunConfig } from "./dailySyncAutoRun.ts";
import { easternClock } from "./easternClock.ts";

function syncResult(overrides: Partial<DailySyncStatusResult> = {}): DailySyncStatusResult {
  return {
    generatedAt: "2026-06-15T20:15:00.000Z",
    message: "Daily pipeline started.",
    ok: true,
    runId: "daily-2026-06-15-201500",
    state: "running",
    targetDate: "2026-06-15",
    ...overrides,
  };
}

describe("daily sync auto-run config", () => {
  it("defaults to enabled at 16:15 ET with a 5-minute catch-up window", () => {
    expect(readDailySyncAutoRunConfig({})).toEqual({
      catchupMinutes: 5,
      configuredTimeEt: "16:15",
      enabled: true,
    });
  });

  it("allows disabling and time overrides through env", () => {
    expect(
      readDailySyncAutoRunConfig({
        RUBICON_DAILY_SYNC_AUTO_RUN: "false",
        RUBICON_DAILY_SYNC_AUTO_RUN_CATCHUP_MINUTES: "2",
        RUBICON_DAILY_SYNC_AUTO_RUN_TIME: "16:18",
      }),
    ).toEqual({
      catchupMinutes: 2,
      configuredTimeEt: "16:18",
      enabled: false,
    });
  });
});

describe("daily sync auto-run decision", () => {
  const decisionAt = (iso: string, over: { enabled?: boolean; lastFiredDate?: string | null; lastSkippedDate?: string | null } = {}) =>
    evaluateDailySyncAutoRunDecision({
      catchupMinutes: 5,
      clock: easternClock(new Date(iso)),
      configuredTimeEt: "16:15",
      enabled: over.enabled ?? true,
      lastFiredDate: over.lastFiredDate ?? null,
      lastSkippedDate: over.lastSkippedDate ?? null,
    });

  it("fires at 16:15 ET on a weekday", () => {
    expect(decisionAt("2026-06-15T20:15:00.000Z")).toMatchObject({
      action: "fire",
      date: "2026-06-15",
      time: "16:15",
    });
  });

  it("fires inside the catch-up window", () => {
    expect(decisionAt("2026-06-15T20:20:00.000Z")).toMatchObject({
      action: "fire",
      date: "2026-06-15",
      time: "16:20",
    });
  });

  it("waits before the configured time", () => {
    expect(decisionAt("2026-06-15T20:14:00.000Z")).toMatchObject({
      action: "wait",
      reason: "before configured time",
    });
  });

  it("waits on weekends", () => {
    expect(decisionAt("2026-06-13T20:15:00.000Z")).toMatchObject({
      action: "wait",
      reason: "weekend",
    });
  });

  it("skips a missed weekday window only once for that date", () => {
    expect(decisionAt("2026-06-15T20:21:00.000Z")).toMatchObject({
      action: "skip",
      reason: "missed catch-up window",
    });
    expect(decisionAt("2026-06-15T21:00:00.000Z", { lastSkippedDate: "2026-06-15" })).toMatchObject({
      action: "wait",
      reason: "missed catch-up window",
    });
  });

  it("does not fire twice for the same Eastern date", () => {
    expect(decisionAt("2026-06-15T20:16:00.000Z", { lastFiredDate: "2026-06-15" })).toMatchObject({
      action: "wait",
      reason: "already fired today",
    });
  });
});

describe("daily sync auto-run controller", () => {
  it("starts the existing daily sync launcher with auto date when firing", async () => {
    const start = vi.fn().mockResolvedValue(syncResult());
    const controller = createDailySyncAutoRunController({ start });

    const decision = await controller.tick(new Date("2026-06-15T20:15:00.000Z"));

    expect(decision.action).toBe("fire");
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ date: "auto" });
    expect(controller.getStatus()).toMatchObject({
      lastFiredDate: "2026-06-15",
      lastAttempt: {
        date: "2026-06-15",
        message: "Daily pipeline started.",
        ok: true,
        runId: "daily-2026-06-15-201500",
        state: "running",
        targetDate: "2026-06-15",
        timeEt: "16:15",
      },
    });
  });

  it("does not start the launcher when the window is missed", async () => {
    const start = vi.fn().mockResolvedValue(syncResult());
    const controller = createDailySyncAutoRunController({ start });

    const decision = await controller.tick(new Date("2026-06-15T20:21:00.000Z"));

    expect(decision.action).toBe("skip");
    expect(start).not.toHaveBeenCalled();
    expect(controller.getStatus()).toMatchObject({
      lastSkippedDate: "2026-06-15",
    });
  });

  it("does not start the launcher twice for the same day", async () => {
    const start = vi.fn().mockResolvedValue(syncResult());
    const controller = createDailySyncAutoRunController({ start });

    await controller.tick(new Date("2026-06-15T20:15:00.000Z"));
    await controller.tick(new Date("2026-06-15T20:16:00.000Z"));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("records launch errors without retrying every tick", async () => {
    const start = vi.fn().mockRejectedValue(new Error("wrapper launch failed"));
    const controller = createDailySyncAutoRunController({ start });

    await controller.tick(new Date("2026-06-15T20:15:00.000Z"));
    await controller.tick(new Date("2026-06-15T20:16:00.000Z"));

    expect(start).toHaveBeenCalledTimes(1);
    expect(controller.getStatus().lastAttempt).toMatchObject({
      date: "2026-06-15",
      message: "wrapper launch failed",
      ok: false,
      state: "error",
      timeEt: "16:15",
    });
  });
});
