import { describe, expect, it } from "vitest";
import { buildRelauncherArgs, evaluateUpdateGate, filterUpdateBlockingDirtyFiles, isMarketHoursEt, normalizeGitStdout, parseTrackedDirtyFiles } from "./selfUpdate.ts";

describe("self-update guards", () => {
  it("counts tracked modifications but ignores untracked files", () => {
    const porcelain = [
      " M server/dailySync.ts",
      "M  naive_acceptance.md",
      "?? docs/superpowers/plans/new-plan.md",
      "?? lint_report.txt",
      "A  src/newFile.ts",
      "",
    ].join("\n");
    expect(parseTrackedDirtyFiles(porcelain)).toEqual(["server/dailySync.ts", "naive_acceptance.md", "src/newFile.ts"]);
    expect(parseTrackedDirtyFiles("?? scratch.txt\n")).toEqual([]);
    expect(parseTrackedDirtyFiles("")).toEqual([]);
  });

  it("preserves the first unstaged filename after git stdout normalization", () => {
    const porcelain = normalizeGitStdout([
      " M WORKLOG.md",
      " M server/selfUpdate.ts",
      "?? scratch.txt",
      "",
    ].join("\n"));

    expect(parseTrackedDirtyFiles(porcelain)).toEqual(["WORKLOG.md", "server/selfUpdate.ts"]);
  });

  it("keeps the first runtime data file exempt after git stdout normalization", () => {
    const porcelain = normalizeGitStdout([
      " M data/heatmap-classification-auto.json",
      " M server/selfUpdate.ts",
      "",
    ].join("\n"));

    expect(filterUpdateBlockingDirtyFiles(parseTrackedDirtyFiles(porcelain))).toEqual(["server/selfUpdate.ts"]);
  });

  it("flags weekday market hours including the open/close guard bands", () => {
    expect(isMarketHoursEt({ weekday: 4, time: "09:20" })).toBe(true);
    expect(isMarketHoursEt({ weekday: 4, time: "13:00" })).toBe(true);
    expect(isMarketHoursEt({ weekday: 4, time: "16:04" })).toBe(true);
    expect(isMarketHoursEt({ weekday: 4, time: "16:05" })).toBe(false);
    expect(isMarketHoursEt({ weekday: 4, time: "09:19" })).toBe(false);
    expect(isMarketHoursEt({ weekday: 6, time: "13:00" })).toBe(false);
    expect(isMarketHoursEt({ weekday: 0, time: "13:00" })).toBe(false);
  });

  it("refuses to update over uncommitted local work", () => {
    const gate = evaluateUpdateGate({
      aheadCount: 0,
      behindCount: 3,
      dirtyFiles: ["server/dailySync.ts", "WORKLOG.md"],
      marketHours: false,
      force: true,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("Uncommitted local changes");
    expect(gate.reason).toContain("server/dailySync.ts");
  });

  it("refuses when local commits are not on GitHub", () => {
    const gate = evaluateUpdateGate({ aheadCount: 2, behindCount: 1, dirtyFiles: [], marketHours: false, force: false });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("not on GitHub");
  });

  it("reports up to date when not behind", () => {
    const gate = evaluateUpdateGate({ aheadCount: 0, behindCount: 0, dirtyFiles: [], marketHours: false, force: false });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("latest GitHub version");
  });

  it("requires force during market hours and allows it off-hours", () => {
    const rth = evaluateUpdateGate({ aheadCount: 0, behindCount: 2, dirtyFiles: [], marketHours: true, force: false });
    expect(rth.allowed).toBe(false);
    expect(rth.reason).toContain("live feeds");

    const rthForced = evaluateUpdateGate({ aheadCount: 0, behindCount: 2, dirtyFiles: [], marketHours: true, force: true });
    expect(rthForced.allowed).toBe(true);

    const evening = evaluateUpdateGate({ aheadCount: 0, behindCount: 2, dirtyFiles: [], marketHours: false, force: false });
    expect(evening.allowed).toBe(true);
  });

  it("ignores runtime data churn but keeps source changes blocking", () => {
    expect(filterUpdateBlockingDirtyFiles([
      "data/heatmap-classification-auto.json",
      "data\\daily-sync-status.json",
      "server/dailySync.ts",
      "WORKLOG.md",
    ])).toEqual(["server/dailySync.ts", "WORKLOG.md"]);
  });

  it("hard-refuses while a daily sync is running, even with force", () => {
    const gate = evaluateUpdateGate({
      aheadCount: 0,
      behindCount: 5,
      dirtyFiles: [],
      marketHours: false,
      force: true,
      syncRunId: "daily-2026-06-10-20260611164630",
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain("daily sync is running");
    expect(gate.reason).toContain("daily-2026-06-10");
  });

  it("builds a relauncher that waits for this pid then runs the scheduled task", () => {
    const args = buildRelauncherArgs(12345);
    const script = args[args.length - 1];
    expect(args).toContain("-NoProfile");
    expect(script).toContain("Wait-Process -Id 12345");
    expect(script).toContain("schtasks /Run /TN 'Rubicon Server'");
  });
});
