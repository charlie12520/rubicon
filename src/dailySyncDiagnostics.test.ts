import { describe, expect, it } from "vitest";
import type { DailySyncStatusResult } from "../shared/types";
import { buildDailySyncDiagnostics } from "./dailySyncDiagnostics";

function status(overrides: Partial<DailySyncStatusResult> = {}): DailySyncStatusResult {
  return {
    generatedAt: "2026-05-29T19:14:00.000Z",
    latestLogPath: "C:/Users/charl/Desktop/AI STUFF/IBKR Equity History Pull/analysis/daily_spx_ibkr_sync.log",
    latestLogTail: "12:28:05 INFO daily data availability: status=partial\n12:28:06 INFO done",
    latestSummary: {
      date: "2026-05-28",
      entryCount: 21,
      path: "C:/summary.json",
      status: "partial",
    },
    message: "Daily SPX/IBKR sync is idle.",
    ok: true,
    state: "idle",
    targetPlan: {
      afterCutoff: false,
      cutoffTimeEt: "16:25",
      estimatedTargetDate: "2026-05-28",
      mode: "auto",
      note: "Auto mode is estimated to target the previous session.",
      nowEt: "2026-05-29 15:14 ET",
      requestedDate: "auto",
    },
    ...overrides,
  };
}

describe("daily sync diagnostics", () => {
  it("summarizes the latest target, summary, and log path", () => {
    const diagnostics = buildDailySyncDiagnostics(status());

    expect(diagnostics.available).toBe(true);
    expect(diagnostics.tone).toBe("ok");
    expect(diagnostics.badge).toBe("No flagged tail lines");
    expect(diagnostics.logPath).toContain("daily_spx_ibkr_sync.log");
    expect(diagnostics.facts).toContainEqual({ label: "Target", value: "2026-05-28 (auto, cutoff 16:25 ET)" });
    expect(diagnostics.facts).toContainEqual({ label: "Latest summary", value: "2026-05-28: partial, 21 entries" });
  });

  it("labels a different-date summary as the latest pipeline run", () => {
    const diagnostics = buildDailySyncDiagnostics(status(), "2026-05-29");

    expect(diagnostics.facts).toContainEqual({ label: "Latest pipeline run", value: "2026-05-28: partial, 21 entries" });
    expect(diagnostics.facts).not.toContainEqual({ label: "Latest summary", value: "2026-05-28: partial, 21 entries" });
  });

  it("flags pull or upload error lines from the latest log tail", () => {
    const diagnostics = buildDailySyncDiagnostics(
      status({
        latestLogTail:
          "12:27:37 ERROR ib_insync.wrapper Error 162, reqId 248: Historical Market Data Service error message:HMDS query returned no data\n12:28:05 INFO daily data availability: status=partial",
      }),
    );

    expect(diagnostics.tone).toBe("warning");
    expect(diagnostics.badge).toBe("1 flagged line");
    expect(diagnostics.logLines[0]).toContain("HMDS query returned no data");
  });

  it("treats a failed sync status as an error even without a tail", () => {
    const diagnostics = buildDailySyncDiagnostics(
      status({
        latestLogTail: "",
        ok: false,
        state: "failed",
      }),
    );

    expect(diagnostics.tone).toBe("error");
    expect(diagnostics.badge).toBe("Sync failed");
  });

  it("surfaces wrapper step progress and warning messages", () => {
    const diagnostics = buildDailySyncDiagnostics(
      status({
        warnings: ["SPX status is partial."],
        steps: [
          {
            id: "core-sync",
            label: "Core SPX/IBKR sync",
            status: "complete",
            detail: "Local files updated.",
            updatedAt: "2026-05-29T19:15:00.000Z",
          },
          {
            id: "sheet-payload",
            label: "Sheet payload",
            status: "warning",
            detail: "Payload built with incomplete data.",
            updatedAt: "2026-05-29T19:16:00.000Z",
          },
        ],
      } as Partial<DailySyncStatusResult>),
    );

    expect(diagnostics.tone).toBe("warning");
    expect(diagnostics.badge).toBe("2 warnings");
    expect(diagnostics.warnings).toEqual(["SPX status is partial."]);
    expect(diagnostics.steps).toEqual([
      {
        id: "core-sync",
        label: "Core SPX/IBKR sync",
        status: "complete",
        detail: "Local files updated.",
        updatedAt: "2026-05-29T19:15:00.000Z",
      },
      {
        id: "sheet-payload",
        label: "Sheet payload",
        status: "warning",
        detail: "Payload built with incomplete data.",
        updatedAt: "2026-05-29T19:16:00.000Z",
      },
    ]);
  });
});
