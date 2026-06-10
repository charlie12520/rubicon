import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDailySyncCommand, buildDailySyncTargetPlan, dailySyncCompletionAllowsDerivedStateRefresh, dailySyncSourceHealth, mergeDailySyncCompletionStatus, refreshDailySyncDerivedState, resolveDailySyncGoogleUploaded, resolveDailySyncRuntimeState, selectDailySyncPreferredLogPath, spxHeatmapPayloadIsFilled, startDailySync, summaryGoogleUploaded } from "./dailySync.ts";

// Preflight + source-health hit the real wrapper in the sibling IBKR project,
// which only exists on the trading machine — skip (don't fail) on CI runners.
const hasLocalWrapper = existsSync(
  path.resolve(process.cwd(), "..", "IBKR Equity History Pull", "run_daily_spx_ibkr_sync_with_sheet_payload.ps1"),
);
const itWrapper = it.skipIf(!hasLocalWrapper);

describe("daily SPX/IBKR sync launcher", () => {
  it("builds the guarded PowerShell wrapper command", () => {
    const command = buildDailySyncCommand({ date: "2026-05-29" });

    expect(command.command).toBe("powershell.exe");
    expect(command.display).toContain("--no-popup");
    expect(command.display).toContain("--date");
    expect(command.display).toContain("2026-05-29");
    expect(command.display.some((part) => part.endsWith("run_daily_spx_ibkr_sync_with_sheet_payload.ps1"))).toBe(true);
  });

  it("builds an option-sidecars-only command for manual failed-or-missing retries", () => {
    const command = buildDailySyncCommand({ date: "2026-06-04", optionScope: "failed-or-missing", optionSidecarsOnly: true, runId: "option-test" });

    expect(command.display).toContain("--option-sidecars-only");
    expect(command.display).toContain("--option-sidecar-scope");
    expect(command.display).toContain("failed-or-missing");
    expect(command.display).toContain("option-test");
  });

  it("rejects invalid sync dates before launch", () => {
    expect(() => buildDailySyncCommand({ date: "05/29/2026" })).toThrow("YYYY-MM-DD or auto");
    expect(() => buildDailySyncTargetPlan("05/29/2026")).toThrow("YYYY-MM-DD or auto");
  });

  it("estimates the auto target before the 07:00 ET cutoff", () => {
    const plan = buildDailySyncTargetPlan("auto", new Date("2026-05-29T10:03:00.000Z"));

    expect(plan.mode).toBe("auto");
    expect(plan.nowEt).toBe("2026-05-29 06:03 ET");
    expect(plan.afterCutoff).toBe(false);
    expect(plan.estimatedTargetDate).toBe("2026-05-28");
    expect(plan.note).toContain("until 07:00 ET");
  });

  it("estimates today's auto target after the 07:00 ET cutoff", () => {
    const plan = buildDailySyncTargetPlan("auto", new Date("2026-05-29T11:30:00.000Z"));

    expect(plan.afterCutoff).toBe(true);
    expect(plan.estimatedTargetDate).toBe("2026-05-29");
    expect(plan.note).toContain("today's session");
  });

  it("does not describe a same-day cutoff window on weekends", () => {
    const plan = buildDailySyncTargetPlan("auto", new Date("2026-05-31T14:30:00.000Z"));

    expect(plan.mode).toBe("auto");
    expect(plan.nowEt).toBe("2026-05-31 10:30 ET");
    expect(plan.estimatedTargetDate).toBe("2026-05-29");
    expect(plan.note).toContain("weekend date (2026-05-31)");
    expect(plan.note).toContain("latest trading session (2026-05-29)");
    expect(plan.note).not.toContain("until 07:00 ET");
  });

  it("keeps explicit daily sync dates independent of the auto cutoff", () => {
    const plan = buildDailySyncTargetPlan("2026-05-27", new Date("2026-05-29T19:03:00.000Z"));

    expect(plan.mode).toBe("explicit");
    expect(plan.estimatedTargetDate).toBe("2026-05-27");
    expect(plan.note).toContain("Explicit date 2026-05-27");
  });

  itWrapper("exposes a dry-run preflight without starting the long sync", async () => {
    const result = await startDailySync({ date: "auto", dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.state).toBe("idle");
    expect(result.command?.join(" ")).toContain("run_daily_spx_ibkr_sync_with_sheet_payload.ps1");
    expect(result.targetPlan?.mode).toBe("auto");
    expect(result.targetPlan?.estimatedTargetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.steps?.map((step) => step.id)).toEqual([
      "sync-started",
      "core-sync",
      "rubicon-ingest",
      "sheet-payload",
      "google-upload",
      "tc2000-open",
      "tc2000-export",
      "qullamaggie-report",
      "tc2000-bars",
      "option-spx-spread-legs",
      "option-spx-chain-band",
      "option-owned-symbols",
      "option-open-interest",
      "option-rubicon-refresh",
    ]);
  });

  itWrapper("reports the local daily sync launcher in source health", async () => {
    const health = await dailySyncSourceHealth();

    expect(health.label).toBe("AI STUFF daily sync launcher");
    expect(health.status).toBe("ok");
    expect(health.detail).toContain("Launcher ready");
  });

  it("preserves wrapper progress and warnings when the launch process closes", () => {
    const launched = {
      ok: true,
      state: "running" as const,
      message: "Daily SPX/IBKR sync launched.",
      generatedAt: "2026-05-29T19:14:00.000Z",
      startedAt: "2026-05-29T19:14:00.000Z",
    };
    const persisted = {
      ...launched,
      message: "Daily sync completed with warnings.",
      warnings: ["SPX status is partial."],
      steps: [
        {
          id: "core-sync",
          label: "Data Collection",
          status: "complete" as const,
          detail: "Local files updated.",
          progress: {
            current: 4,
            total: 4,
            unit: "phases" as const,
            label: "Data Collection complete",
          },
          updatedAt: "2026-05-29T19:15:00.000Z",
        },
        {
          id: "rubicon-ingest",
          label: "Rubicon Ingest",
          status: "complete" as const,
          detail: "Rubicon state refreshed.",
          updatedAt: "2026-05-29T19:15:30.000Z",
        },
      ],
    };

    const merged = mergeDailySyncCompletionStatus({
      exitCode: 0,
      finishedAt: "2026-05-29T19:16:00.000Z",
      launched,
      persisted,
    });

    expect(merged.state).toBe("completed");
    expect(merged.ok).toBe(true);
    expect(merged.warnings).toEqual(["SPX status is partial."]);
    expect(merged.steps?.[0]?.status).toBe("complete");
    expect(merged.steps?.[0]?.progress).toMatchObject({ current: 4, total: 4, unit: "phases" });
    expect(merged.message).toBe("Daily sync completed with warnings.");
  });

  it("keeps TC2000 sidecar warnings from blocking review or Google status", () => {
    const launched = {
      ok: true,
      state: "running" as const,
      message: "Daily pipeline started.",
      generatedAt: "2026-06-03T13:14:00.000Z",
      startedAt: "2026-06-03T13:14:00.000Z",
    };
    const persisted = {
      ...launched,
      message: "Daily pipeline completed with sidecar warnings.",
      stages: {
        dataCollection: {
          id: "dataCollection" as const,
          label: "Data Collection",
          status: "complete" as const,
          detail: "Review-critical files are usable.",
        },
        rubiconIngest: {
          id: "rubiconIngest" as const,
          label: "Rubicon Ingest",
          status: "complete" as const,
          detail: "Rubicon-facing state refreshed.",
        },
        googleUpload: {
          id: "googleUpload" as const,
          label: "Google Upload",
          status: "complete" as const,
          detail: "Google receipt confirmed.",
        },
      },
      steps: [
        {
          id: "tc2000-open",
          label: "Open TC2000",
          status: "warning" as const,
          detail: "TC2000 could not be opened automatically.",
        },
        {
          id: "tc2000-export",
          label: "TC2000 export",
          status: "warning" as const,
          detail: "TC2000 export failed or did not produce a fresh non-empty CSV.",
        },
        {
          id: "qullamaggie-report",
          label: "Qullamaggie report/email",
          status: "warning" as const,
          detail: "Skipped Qullamaggie report/email because TC2000 export did not produce a fresh scanner CSV.",
        },
        {
          id: "tc2000-bars",
          label: "TC2000 daily bars",
          status: "complete" as const,
          detail: "Daily bars refreshed.",
        },
      ],
      warnings: ["TC2000 Qullamaggie export failed or did not produce a fresh non-empty CSV."],
    };

    const merged = mergeDailySyncCompletionStatus({
      exitCode: 0,
      finishedAt: "2026-06-03T13:18:00.000Z",
      launched,
      persisted,
    });

    expect(merged.ok).toBe(true);
    expect(merged.reviewReady).toBe(true);
    expect(merged.googleUploaded).toBe(true);
    expect(merged.pipelineState).toBe("completed");
    expect(merged.steps?.map((step) => step.id)).toEqual(["tc2000-open", "tc2000-export", "qullamaggie-report", "tc2000-bars"]);
    expect(merged.warnings).toEqual(["TC2000 Qullamaggie export failed or did not produce a fresh non-empty CSV."]);
  });

  it("does not fail a review-ready option retry just because the wrapper exits non-zero", () => {
    const launched = {
      ok: true,
      state: "running" as const,
      message: "Failed/missing option data retry started for 2026-06-08.",
      generatedAt: "2026-06-08T21:16:59.028Z",
      startedAt: "2026-06-08T21:16:59.028Z",
      runId: "option-retry-2026-06-08-20260608211659",
      targetDate: "2026-06-08",
    };
    const persisted = {
      ...launched,
      message: "Running bounded SPX spread-leg option pull.",
      reviewReady: true,
      googleUploaded: true,
      pipelineState: "running" as const,
      stages: {
        dataCollection: {
          id: "dataCollection" as const,
          label: "Data Collection",
          status: "complete" as const,
          detail: "Manual option retry uses existing review-critical local files.",
          blockers: [],
          warnings: [],
        },
        rubiconIngest: {
          id: "rubiconIngest" as const,
          label: "Rubicon Ingest",
          status: "complete" as const,
          detail: "Manual option retry will refresh option-derived Rubicon state if needed.",
          blockers: [],
          warnings: [],
        },
        googleUpload: {
          id: "googleUpload" as const,
          label: "Google Upload",
          status: "complete" as const,
          detail: "Manual option retry does not change Google tracker rows.",
          blockers: [],
          warnings: [],
        },
      },
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" as const },
        {
          id: "option-spx-spread-legs",
          label: "Option SPX spread legs",
          status: "running" as const,
          detail: "Running bounded SPX spread-leg option pull with hard timeout 360s.",
        },
        {
          id: "option-open-interest",
          label: "Option open interest",
          status: "pending" as const,
          detail: "Waiting for bounded option open-interest pull.",
        },
      ],
    };

    const merged = mergeDailySyncCompletionStatus({
      exitCode: 2,
      finishedAt: "2026-06-08T21:19:14.114Z",
      launched,
      persisted,
    });

    expect(merged.ok).toBe(true);
    expect(merged.state).toBe("completed");
    expect(merged.pipelineState).toBe("completed");
    expect(merged.message).toContain("completed with warnings");
    expect(merged.warnings?.join("\n")).toContain("launcher exited with code 2");
    expect(merged.steps?.find((step) => step.id === "option-spx-spread-legs")?.status).toBe("warning");
    expect(merged.steps?.find((step) => step.id === "option-open-interest")?.status).toBe("warning");
  });

  it("keeps local review ready while surfacing a missing Google payload as a stage error", () => {
    const launched = {
      ok: true,
      state: "running" as const,
      message: "Daily pipeline started.",
      generatedAt: "2026-06-08T20:00:09.151Z",
      startedAt: "2026-06-08T20:00:09.151Z",
      targetDate: "2026-06-08",
    };
    const persisted = {
      ...launched,
      reviewReady: true,
      stages: {
        dataCollection: {
          id: "dataCollection" as const,
          label: "Data Collection",
          status: "complete" as const,
          detail: "Local review data is usable.",
        },
        rubiconIngest: {
          id: "rubiconIngest" as const,
          label: "Rubicon Ingest",
          status: "complete" as const,
          detail: "Rubicon state refreshed.",
        },
        googleUpload: {
          id: "googleUpload" as const,
          label: "Google Upload",
          status: "failed" as const,
          detail: "Google Sheet upload payload missing.",
          blockers: ["No google_sheet_upload_payload.json found for 2026-06-08."],
        },
      },
    };

    const merged = mergeDailySyncCompletionStatus({
      exitCode: 2,
      finishedAt: "2026-06-08T20:06:56.984Z",
      launched,
      persisted,
    });

    expect(merged.ok).toBe(true);
    expect(merged.state).toBe("completed");
    expect(merged.reviewReady).toBe(true);
    expect(merged.googleUploaded).toBe(false);
    expect(merged.pipelineState).toBe("failed-with-stage-errors");
  });

  it("downgrades persisted running status when the lock is stale and no process is active", () => {
    expect(
      resolveDailySyncRuntimeState({
        activeProcess: false,
        persistedState: "running",
        lockActive: false,
        lockStale: true,
      }),
    ).toBe("failed");
    expect(
      resolveDailySyncRuntimeState({
        activeProcess: false,
        persistedState: "completed",
        lockActive: false,
        lockStale: true,
      }),
    ).toBe("completed");
    expect(
      resolveDailySyncRuntimeState({
        activeProcess: false,
        persistedState: "idle",
        lockActive: false,
        lockStale: false,
      }),
    ).toBe("idle");
  });

  it("treats a missing Google receipt as unknown, not false", () => {
    expect(summaryGoogleUploaded({ date: "2026-06-05", path: "summary.json" })).toBeUndefined();
    expect(summaryGoogleUploaded({ date: "2026-06-05", path: "summary.json", googleUploaded: false })).toBeUndefined();
    expect(summaryGoogleUploaded({ date: "2026-06-05", path: "summary.json", googleUploadStatus: "complete" })).toBe(true);
    expect(summaryGoogleUploaded({ date: "2026-06-05", path: "summary.json", googleUploadStatus: "failed" })).toBe(false);
  });

  it("does not let an option retry summary without a receipt downgrade a confirmed Google upload", () => {
    const stages = {
      dataCollection: { id: "dataCollection" as const, label: "Data Collection", status: "complete" as const },
      rubiconIngest: { id: "rubiconIngest" as const, label: "Rubicon Ingest", status: "complete" as const },
      googleUpload: { id: "googleUpload" as const, label: "Google Upload", status: "pending" as const },
    };

    const googleUploaded = resolveDailySyncGoogleUploaded({
      currentSummary: {
        date: "2026-06-05",
        path: "option-retry-summary.json",
        runId: "option-retry-2026-06-05",
      },
      persistedGoogleUploaded: true,
      stages,
      targetSummary: {
        date: "2026-06-05",
        path: "daily_sync_summary.json",
      },
    });

    expect(googleUploaded).toBe(true);
  });

  it("prefers the current or target summary log path over stale persisted log evidence", () => {
    expect(
      selectDailySyncPreferredLogPath({
        currentSummary: { date: "2026-06-05", path: "summary.json", logPath: "run.log" },
        persistedSummary: { date: "2026-06-04", path: "old-summary.json", logPath: "old.log" },
      }),
    ).toBe("run.log");
    expect(
      selectDailySyncPreferredLogPath({
        persistedSummary: { date: "2026-06-04", path: "old-summary.json", logPath: "old.log" },
        targetSummary: { date: "2026-06-05", path: "summary.json", logPath: "target.log" },
      }),
    ).toBe("target.log");
  });

  it("only refreshes derived state after a successful completion status", () => {
    expect(
      dailySyncCompletionAllowsDerivedStateRefresh({
        generatedAt: "2026-06-02T20:30:00.000Z",
        message: "Daily SPX/IBKR sync completed.",
        ok: true,
        state: "completed",
      }),
    ).toBe(true);
    expect(
      dailySyncCompletionAllowsDerivedStateRefresh({
        generatedAt: "2026-06-02T20:30:00.000Z",
        message: "Daily SPX/IBKR sync exited with code 1.",
        ok: false,
        state: "failed",
      }),
    ).toBe(false);
  });

  it("detects whether the SPX heatmap is already filled with real intraday data", () => {
    const realTiles = Array.from({ length: 120 }, (_, index) => ({
      pct: index < 30 ? 0.1 : null,
      pctByTime: [null, index < 30 ? 0.1 : null],
      symbol: `T${index}`,
      weight: 0.1,
    }));

    expect(
      spxHeatmapPayloadIsFilled({
        asOf: "15:45",
        source: "yahoo-1m",
        tiles: realTiles,
      }),
    ).toBe(true);
    expect(spxHeatmapPayloadIsFilled({ asOf: "15:45", source: "sample", tiles: realTiles })).toBe(false);
    expect(spxHeatmapPayloadIsFilled({ asOf: null, source: "yahoo-1m", tiles: realTiles })).toBe(false);
    expect(spxHeatmapPayloadIsFilled({ asOf: "15:45", source: "yahoo-1m", tiles: realTiles.slice(0, 20) })).toBe(false);
  });

  it("refreshes tracker, replay safe state, spread speed state, SPX heatmap, and Morning saved state after sync completion", async () => {
    const calls: string[] = [];

    const result = await refreshDailySyncDerivedState({
      date: "2026-06-01",
      refreshMorningBrief: async (date, _appRoot, options) => {
        calls.push(`morning:${date}:${options?.refresh === true ? "refresh" : "cached"}`);
      },
      refreshTrackerSummary: async (_root, date) => {
        calls.push(`tracker:${date}`);
      },
      refreshReplaySafeState: async (_root, date) => {
        calls.push(`replay:${date}`);
      },
      refreshSpxHeatmapBackfill: async () => {
        calls.push("heatmap:yahoo");
        return {
          asOf: "15:45",
          backfilled: true,
          detail: "Yahoo SPX heatmap backfilled.",
          skipped: false,
          source: "yahoo-1m",
          tiles: 500,
        };
      },
      refreshSectorRrg: async () => {
        calls.push("sector-rrg:yahoo");
        return { detail: "Sector RRG refreshed.", generatedAt: "2026-06-01T13:00:00Z", refreshed: true, symbols: 12 };
      },
      refreshSpreadSpeedState: async (_root, date) => {
        calls.push(`spread-speed:${date}`);
      },
    });

    expect(result).toEqual({
      date: "2026-06-01",
      morningBriefRefreshed: true,
      replaySafeStateRefreshed: true,
      sectorRrgRefreshed: true,
      spxHeatmapBackfilled: true,
      spxHeatmapBackfillSkipped: false,
      spreadSpeedStateRefreshed: true,
      trackerSummaryRefreshed: true,
      warnings: [],
    });
    expect(calls).toEqual(["tracker:2026-06-01", "replay:2026-06-01", "spread-speed:2026-06-01", "heatmap:yahoo", "sector-rrg:yahoo", "morning:2026-06-01:refresh"]);
  });
});
