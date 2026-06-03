import { describe, expect, it } from "vitest";
import { buildDailySyncCommand, buildDailySyncTargetPlan, dailySyncCompletionAllowsDerivedStateRefresh, dailySyncSourceHealth, mergeDailySyncCompletionStatus, refreshDailySyncDerivedState, startDailySync } from "./dailySync.ts";

describe("daily SPX/IBKR sync launcher", () => {
  it("builds the guarded PowerShell wrapper command", () => {
    const command = buildDailySyncCommand({ date: "2026-05-29" });

    expect(command.command).toBe("powershell.exe");
    expect(command.display).toContain("--no-popup");
    expect(command.display).toContain("--date");
    expect(command.display).toContain("2026-05-29");
    expect(command.display.some((part) => part.endsWith("run_daily_spx_ibkr_sync_with_sheet_payload.ps1"))).toBe(true);
  });

  it("rejects invalid sync dates before launch", () => {
    expect(() => buildDailySyncCommand({ date: "05/29/2026" })).toThrow("YYYY-MM-DD or auto");
    expect(() => buildDailySyncTargetPlan("05/29/2026")).toThrow("YYYY-MM-DD or auto");
  });

  it("estimates the auto target before the 16:25 ET cutoff", () => {
    const plan = buildDailySyncTargetPlan("auto", new Date("2026-05-29T19:03:00.000Z"));

    expect(plan.mode).toBe("auto");
    expect(plan.nowEt).toBe("2026-05-29 15:03 ET");
    expect(plan.afterCutoff).toBe(false);
    expect(plan.estimatedTargetDate).toBe("2026-05-28");
    expect(plan.note).toContain("until 16:25 ET");
  });

  it("estimates today's auto target after the 16:25 ET cutoff", () => {
    const plan = buildDailySyncTargetPlan("auto", new Date("2026-05-29T20:30:00.000Z"));

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
    expect(plan.note).not.toContain("until 16:25 ET");
  });

  it("keeps explicit daily sync dates independent of the auto cutoff", () => {
    const plan = buildDailySyncTargetPlan("2026-05-27", new Date("2026-05-29T19:03:00.000Z"));

    expect(plan.mode).toBe("explicit");
    expect(plan.estimatedTargetDate).toBe("2026-05-27");
    expect(plan.note).toContain("Explicit date 2026-05-27");
  });

  it("exposes a dry-run preflight without starting the long sync", async () => {
    const result = await startDailySync({ date: "auto", dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.state).toBe("idle");
    expect(result.command?.join(" ")).toContain("run_daily_spx_ibkr_sync_with_sheet_payload.ps1");
    expect(result.targetPlan?.mode).toBe("auto");
    expect(result.targetPlan?.estimatedTargetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reports the local daily sync launcher in source health", async () => {
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
          label: "Core SPX/IBKR sync",
          status: "complete" as const,
          detail: "Local files updated.",
          updatedAt: "2026-05-29T19:15:00.000Z",
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
    expect(merged.message).toBe("Daily sync completed with warnings.");
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

  it("refreshes tracker, replay safe state, spread speed state, and Morning saved state after sync completion", async () => {
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
      refreshSpreadSpeedState: async (_root, date) => {
        calls.push(`spread-speed:${date}`);
      },
    });

    expect(result).toEqual({
      date: "2026-06-01",
      morningBriefRefreshed: true,
      replaySafeStateRefreshed: true,
      spreadSpeedStateRefreshed: true,
      trackerSummaryRefreshed: true,
      warnings: [],
    });
    expect(calls).toEqual(["tracker:2026-06-01", "replay:2026-06-01", "spread-speed:2026-06-01", "morning:2026-06-01:refresh"]);
  });
});
