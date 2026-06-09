import { describe, expect, it } from "vitest";
import type { DailySyncStatusResult } from "../shared/types";
import { buildDailySyncProgress } from "./dailySyncProgress";

describe("daily sync progress", () => {
  it("shows partial progress for a running step", () => {
    const progress = buildDailySyncProgress(status({
      state: "running",
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" },
        { id: "core-sync", label: "Data Collection", status: "running", detail: "Pulling SPX bars." },
        { id: "rubicon-ingest", label: "Rubicon Ingest", status: "pending" },
      ],
    }));

    expect(progress.tone).toBe("running");
    expect(progress.currentStepId).toBe("core-sync");
    expect(progress.label).toBe("Running: Data Collection");
    expect(progress.detail).toBe("Pulling SPX bars. Waiting for data update.");
    expect(progress.completedSteps).toBe(1);
    expect(progress.percent).toBeCloseTo(33.333, 2);
    expect(progress.countLabel).toBe("1 / 3 steps");
  });

  it("uses data-backed sub-progress for a running step", () => {
    const progress = buildDailySyncProgress(status({
      state: "running",
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" },
        {
          id: "option-spx-spread-legs",
          label: "Option SPX spread legs",
          status: "running",
          detail: "Running bounded SPX spread-leg option pull.",
          progress: {
            current: 7,
            total: 24,
            unit: "contracts",
            label: "SPXW 260605P07450",
            detail: "SPXW 260605P07450: 4,860 bars; spread marks updating",
          },
        },
        { id: "option-open-interest", label: "Option open interest", status: "pending" },
      ],
    }));

    expect(progress.tone).toBe("running");
    expect(progress.currentStepId).toBe("option-spx-spread-legs");
    expect(progress.label).toBe("Running: Option SPX spread legs");
    expect(progress.detail).toBe("SPXW 260605P07450: 4,860 bars; spread marks updating");
    expect(progress.countLabel).toBe("7 / 24 contracts");
    expect(progress.percent).toBeCloseTo(43.055, 2);
  });

  it("counts warning steps as progressed without making the progress an error", () => {
    const progress = buildDailySyncProgress(status({
      state: "running",
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" },
        { id: "core-sync", label: "Data Collection", status: "warning" },
        { id: "rubicon-ingest", label: "Rubicon Ingest", status: "running" },
      ],
    }));

    expect(progress.tone).toBe("running");
    expect(progress.completedSteps).toBe(2);
    expect(progress.percent).toBeCloseTo(66.666, 2);
  });

  it("marks failures red and stops at the failed step", () => {
    const progress = buildDailySyncProgress(status({
      pipelineState: "failed-with-stage-errors",
      state: "completed",
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" },
        { id: "core-sync", label: "Data Collection", status: "complete" },
        { id: "google-upload", label: "Google Upload", status: "failed", detail: "Google upload failed." },
        { id: "tc2000-export", label: "TC2000 export", status: "pending" },
      ],
    }));

    expect(progress.tone).toBe("error");
    expect(progress.label).toBe("Stopped at Google Upload");
    expect(progress.detail).toBe("Google upload failed.");
    expect(progress.percent).toBeLessThan(100);
    expect(progress.percent).toBeCloseTo(62.5);
  });

  it("does not render a running label for a closed status with stale running steps", () => {
    const progress = buildDailySyncProgress(status({
      ok: false,
      state: "failed",
      pipelineState: "failed",
      message: "Daily sync launcher exited before status cleanup.",
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" },
        {
          id: "option-spx-spread-legs",
          label: "Option SPX spread legs",
          status: "running",
          detail: "Running bounded SPX spread-leg option pull.",
        },
      ],
    }));

    expect(progress.tone).toBe("error");
    expect(progress.label).not.toContain("Running:");
    expect(progress.detail).toBe("Daily sync launcher exited before status cleanup.");
  });

  it("forces completed pipeline state to full progress", () => {
    const progress = buildDailySyncProgress(status({
      pipelineState: "completed",
      state: "completed",
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" },
        { id: "core-sync", label: "Data Collection", status: "complete" },
        { id: "tc2000-export", label: "TC2000 export", status: "complete" },
      ],
    }));

    expect(progress.tone).toBe("complete");
    expect(progress.percent).toBe(100);
    expect(progress.countLabel).toBe("3 / 3 steps");
  });

  it("returns muted zero progress for a missing or idle status", () => {
    expect(buildDailySyncProgress(null)).toMatchObject({
      available: false,
      completedSteps: 0,
      percent: 0,
      tone: "idle",
    });

    expect(buildDailySyncProgress(status({ state: "idle", steps: [] }))).toMatchObject({
      available: true,
      completedSteps: 0,
      percent: 0,
      tone: "idle",
    });
  });
});

function status(overrides: Partial<DailySyncStatusResult>): DailySyncStatusResult {
  return {
    generatedAt: "2026-06-03T12:00:00.000Z",
    message: "Daily pipeline status.",
    ok: true,
    state: "running",
    ...overrides,
  };
}
