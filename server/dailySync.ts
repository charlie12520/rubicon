import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DailySyncStatusResult, DailySyncStep, DailySyncTargetPlan, SourceHealth } from "../shared/types.ts";
import { easternClock } from "./easternClock.ts";
import { pathExists, readJson, writeJsonAtomic } from "./jsonStore.ts";
import { loadMorningBrief } from "./morningBrief.ts";
import { refreshRubiconDailySummary } from "./trackerSummary.ts";

const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..");
const IBKR_ROOT = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull");
const IBKR_TRADES_ROOT = path.join(IBKR_ROOT, "data", "ibkr_trades");
const DAILY_SYNC_WRAPPER = path.join(IBKR_ROOT, "run_daily_spx_ibkr_sync_with_sheet_payload.ps1");
const DAILY_SYNC_SCRIPT = path.join(IBKR_ROOT, "daily_spx_ibkr_sync.py");
const DAILY_SYNC_STATUS_PATH = path.join(process.cwd(), "data", "daily-sync-status.json");
const DAILY_SYNC_LAUNCH_LOG = path.join(process.cwd(), "data", "daily-sync-launch.log");
const DAILY_SYNC_AUTO_CUTOFF_ET = "16:25";

let activeDailySync: ChildProcessWithoutNullStreams | null = null;

type DailySyncLaunchInput = {
  date?: string;
  dryRun?: boolean;
};

type DailySyncCommand = {
  command: string;
  args: string[];
  cwd: string;
  display: string[];
};

type LatestSummary = {
  date: string;
  path: string;
  status?: string;
  spxStatus?: string;
  tradeStatus?: string;
  fillCount?: number;
  spreadCount?: number;
  entryCount?: number;
};

type DailySyncCompletionMergeInput = {
  exitCode: number | null;
  finishedAt: string;
  launched: DailySyncStatusResult;
  persisted?: DailySyncStatusResult | null;
};

type RefreshDailySyncDerivedStateInput = {
  appRoot?: string;
  date?: string;
  ibkrTradesRoot?: string;
  refreshMorningBrief?: (date: string, appRoot: string, options: { refresh: true }) => Promise<unknown>;
  refreshReplaySafeState?: (ibkrTradesRoot: string, date: string) => Promise<unknown>;
  refreshSpreadSpeedState?: (ibkrTradesRoot: string, date: string) => Promise<unknown>;
  refreshTrackerSummary?: (ibkrTradesRoot: string, date: string) => Promise<unknown>;
};

type RefreshDailySyncDerivedStateResult = {
  date: string | null;
  morningBriefRefreshed: boolean;
  replaySafeStateRefreshed: boolean;
  spreadSpeedStateRefreshed: boolean;
  trackerSummaryRefreshed: boolean;
  warnings: string[];
};

function isValidSyncDate(value: string): boolean {
  return value === "auto" || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12));
  return next.toISOString().slice(0, 10);
}

function isWeekday(dateString: string): boolean {
  const [year, month, day] = dateString.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

function previousWeekdayOnOrBefore(dateString: string): string {
  let cursor = dateString;
  while (!isWeekday(cursor)) {
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

export function buildDailySyncTargetPlan(requestedDate = "auto", now = new Date()): DailySyncTargetPlan {
  if (!isValidSyncDate(requestedDate)) {
    throw new Error("Daily sync date must be YYYY-MM-DD or auto.");
  }

  const clock = easternClock(now);
  const afterCutoff = clock.time >= DAILY_SYNC_AUTO_CUTOFF_ET;

  if (requestedDate !== "auto") {
    return {
      requestedDate,
      estimatedTargetDate: requestedDate,
      mode: "explicit",
      cutoffTimeEt: DAILY_SYNC_AUTO_CUTOFF_ET,
      nowEt: `${clock.date} ${clock.time} ET`,
      afterCutoff,
      note: `Explicit date ${requestedDate} will be passed to the daily sync wrapper.`,
    };
  }

  const estimatedTargetDate = afterCutoff && isWeekday(clock.date) ? clock.date : previousWeekdayOnOrBefore(addDays(clock.date, -1));
  const todayIsWeekday = isWeekday(clock.date);
  const note = !todayIsWeekday
    ? `Today is a weekend date (${clock.date}); auto mode is estimated to target the latest trading session (${estimatedTargetDate}) until the next market day.`
    : afterCutoff && estimatedTargetDate === clock.date
      ? `Auto mode is estimated to target today's session (${estimatedTargetDate}) because New York time is past ${DAILY_SYNC_AUTO_CUTOFF_ET} ET.`
      : `Auto mode is estimated to target the previous session (${estimatedTargetDate}) until ${DAILY_SYNC_AUTO_CUTOFF_ET} ET; the wrapper owns final market-calendar validation.`;

  return {
    requestedDate,
    estimatedTargetDate,
    mode: "auto",
    cutoffTimeEt: DAILY_SYNC_AUTO_CUTOFF_ET,
    nowEt: `${clock.date} ${clock.time} ET`,
    afterCutoff,
    note,
  };
}

async function writeStatus(status: DailySyncStatusResult): Promise<void> {
  await writeJsonAtomic(DAILY_SYNC_STATUS_PATH, status);
}

function defaultDailySyncSteps(startedAt: string): DailySyncStep[] {
  return [
    {
      id: "sync-started",
      label: "Sync started",
      status: "complete",
      detail: "Rubicon launched the daily sync wrapper.",
      updatedAt: startedAt,
    },
    {
      id: "core-sync",
      label: "Core SPX/IBKR sync",
      status: "pending",
      detail: "Waiting for local pull files.",
    },
    {
      id: "sheet-payload",
      label: "Sheet payload",
      status: "pending",
      detail: "Waiting for Google Sheet payload generation.",
    },
    {
      id: "raw-workbook",
      label: "Raw upload workbook",
      status: "pending",
      detail: "Waiting for workbook rebuild.",
    },
    {
      id: "tc2000-bars",
      label: "TC2000 daily bars",
      status: "pending",
      detail: "Waiting for daily-bar refresh.",
    },
  ];
}

export function mergeDailySyncCompletionStatus({
  exitCode,
  finishedAt,
  launched,
  persisted,
}: DailySyncCompletionMergeInput): DailySyncStatusResult {
  const base = persisted ?? launched;
  const warnings = Array.isArray(base.warnings) ? base.warnings.filter(Boolean) : [];
  const steps = Array.isArray(base.steps) ? base.steps : launched.steps;
  const failedStepCount = steps?.filter((step) => step.status === "failed").length ?? 0;
  const processFailed = exitCode !== 0;
  const failed = processFailed || failedStepCount > 0 || base.ok === false;
  const launchMessage = launched.message;
  const fallbackMessage = failed
    ? `Daily SPX/IBKR sync exited with code ${exitCode ?? "unknown"}.`
    : warnings.length
      ? "Daily SPX/IBKR sync completed with warnings."
      : "Daily SPX/IBKR sync completed.";
  const message = base.message && base.message !== launchMessage ? base.message : fallbackMessage;

  return {
    ...launched,
    ...base,
    ok: !failed,
    state: failed ? "failed" : "completed",
    message,
    exitCode,
    finishedAt,
    generatedAt: finishedAt,
    steps,
    warnings: warnings.length ? warnings : undefined,
  };
}

export function dailySyncCompletionAllowsDerivedStateRefresh(status: DailySyncStatusResult): boolean {
  return status.state === "completed" && status.ok !== false;
}

export async function refreshDailySyncDerivedState({
  appRoot = process.cwd(),
  date,
  ibkrTradesRoot = IBKR_TRADES_ROOT,
  refreshMorningBrief = loadMorningBrief,
  refreshReplaySafeState,
  refreshSpreadSpeedState,
  refreshTrackerSummary = refreshRubiconDailySummary,
}: RefreshDailySyncDerivedStateInput): Promise<RefreshDailySyncDerivedStateResult> {
  const warnings: string[] = [];
  if (!date) {
    return {
      date: null,
      morningBriefRefreshed: false,
      replaySafeStateRefreshed: false,
      spreadSpeedStateRefreshed: false,
      trackerSummaryRefreshed: false,
      warnings: ["No completed sync summary date was available for derived state refresh."],
    };
  }

  let trackerSummaryRefreshed = false;
  let morningBriefRefreshed = false;
  let replaySafeStateRefreshed = false;
  let spreadSpeedStateRefreshed = false;
  try {
    await refreshTrackerSummary(ibkrTradesRoot, date);
    trackerSummaryRefreshed = true;
  } catch (error) {
    warnings.push(`Could not refresh Rubicon tracker summary for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const refreshReplay = refreshReplaySafeState ?? (await import("./dataImporter.ts")).refreshReplaySafeState;
    await refreshReplay(ibkrTradesRoot, date);
    replaySafeStateRefreshed = true;
  } catch (error) {
    warnings.push(`Could not refresh Replay safe state for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const refreshSpreadSpeed = refreshSpreadSpeedState ?? (await import("./spreadSpeed.ts")).refreshSpreadSpeedState;
    await refreshSpreadSpeed(ibkrTradesRoot, date);
    spreadSpeedStateRefreshed = true;
  } catch (error) {
    warnings.push(`Could not refresh Spread Speed state for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    await refreshMorningBrief(date, appRoot, { refresh: true });
    morningBriefRefreshed = true;
  } catch (error) {
    warnings.push(`Could not refresh Morning brief state for ${date}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    date,
    morningBriefRefreshed,
    replaySafeStateRefreshed,
    spreadSpeedStateRefreshed,
    trackerSummaryRefreshed,
    warnings,
  };
}

export function buildDailySyncCommand({ date = "auto" }: DailySyncLaunchInput = {}): DailySyncCommand {
  if (!isValidSyncDate(date)) {
    throw new Error("Daily sync date must be YYYY-MM-DD or auto.");
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    DAILY_SYNC_WRAPPER,
    "--no-popup",
    "--date",
    date,
  ];

  return {
    command: "powershell.exe",
    args,
    cwd: IBKR_ROOT,
    display: ["powershell.exe", ...args],
  };
}

async function latestAnalysisLog(): Promise<{ path: string; updatedAt: string; tail: string } | undefined> {
  const analysisDir = path.join(IBKR_ROOT, "analysis");
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(analysisDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const logs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^daily_spx_ibkr_sync_.*\.log$/i.test(entry.name))
      .map(async (entry) => {
        const target = path.join(analysisDir, entry.name);
        const stat = await fsp.stat(target);
        return { path: target, mtimeMs: stat.mtimeMs, updatedAt: stat.mtime.toISOString() };
      }),
  );
  const latest = logs.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  if (!latest) {
    return undefined;
  }

  const raw = await fsp.readFile(latest.path, "utf8");
  const tail = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-8)
    .join("\n");
  return { path: latest.path, updatedAt: latest.updatedAt, tail };
}

async function latestDailySummary(): Promise<LatestSummary | undefined> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(IBKR_TRADES_ROOT, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const dates = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const latestDate = dates.at(-1);
  if (!latestDate) {
    return undefined;
  }

  const summaryPath = path.join(IBKR_TRADES_ROOT, latestDate, "daily_sync_summary.json");
  const summary = await readJson<Record<string, unknown> | null>(summaryPath, null);
  if (!summary) {
    return { date: latestDate, path: summaryPath };
  }

  const availability = (summary.availability ?? {}) as Record<string, unknown>;
  const trades = (availability.trades_and_spreads ?? {}) as Record<string, unknown>;
  const tradeCounts = (trades.counts ?? {}) as Record<string, unknown>;
  const spx = (availability.spx_intraday ?? {}) as Record<string, unknown>;

  return {
    date: latestDate,
    path: summaryPath,
    entryCount: Number(tradeCounts.entry_count ?? trades.entry_count ?? summary.entry_count ?? 0),
    fillCount: Number(tradeCounts.trade_count ?? tradeCounts.fill_count ?? trades.fill_count ?? summary.fill_count ?? 0),
    spxStatus: String(spx.status ?? summary.spx_status ?? ""),
    spreadCount: Number(tradeCounts.spread_count ?? trades.spread_count ?? summary.spread_count ?? 0),
    status: String(availability.status ?? ""),
    tradeStatus: String(trades.status ?? summary.trade_status ?? ""),
  };
}

export async function dailySyncSourceHealth(): Promise<SourceHealth> {
  const [wrapperExists, scriptExists, summary] = await Promise.all([
    pathExists(DAILY_SYNC_WRAPPER),
    pathExists(DAILY_SYNC_SCRIPT),
    latestDailySummary(),
  ]);

  if (!wrapperExists || !scriptExists) {
    return {
      label: "AI STUFF daily sync launcher",
      status: "missing",
      detail: "Daily SPX/IBKR sync wrapper or Python script was not found.",
    };
  }

  const targetPlan = buildDailySyncTargetPlan("auto");
  const detail = summary
    ? `Launcher ready. Auto target estimate ${targetPlan.estimatedTargetDate}. Latest summary ${summary.date}: availability ${summary.status || "unknown"}, fills ${summary.fillCount ?? 0}, entries ${summary.entryCount ?? 0}.`
    : `Launcher ready. Auto target estimate ${targetPlan.estimatedTargetDate}. No daily sync summary has been written yet.`;

  return {
    label: "AI STUFF daily sync launcher",
    status: "ok",
    detail,
  };
}

export async function getDailySyncStatus(): Promise<DailySyncStatusResult> {
  const persisted = await readJson<DailySyncStatusResult | null>(DAILY_SYNC_STATUS_PATH, null);
  const latestLog = await latestAnalysisLog();
  const latestSummary = await latestDailySummary();
  const targetPlan = activeDailySync ? persisted?.targetPlan ?? buildDailySyncTargetPlan("auto") : buildDailySyncTargetPlan("auto");

  return {
    ok: persisted?.ok ?? true,
    state: activeDailySync ? "running" : persisted?.state ?? "idle",
    message: activeDailySync ? persisted?.message ?? "Daily SPX/IBKR sync is running." : persisted?.message ?? "Daily SPX/IBKR sync is idle.",
    command: persisted?.command,
    cwd: persisted?.cwd ?? IBKR_ROOT,
    dryRun: persisted?.dryRun,
    exitCode: persisted?.exitCode,
    finishedAt: persisted?.finishedAt,
    generatedAt: new Date().toISOString(),
    latestLogPath: latestLog?.path,
    latestLogTail: latestLog?.tail,
    latestSummary,
    logPath: persisted?.logPath ?? DAILY_SYNC_LAUNCH_LOG,
    pid: activeDailySync?.pid ?? persisted?.pid,
    startedAt: persisted?.startedAt,
    steps: persisted?.steps,
    targetPlan,
    warnings: persisted?.warnings,
  };
}

export async function startDailySync(input: DailySyncLaunchInput = {}): Promise<DailySyncStatusResult> {
  const targetPlan = buildDailySyncTargetPlan(input.date ?? "auto");

  if (activeDailySync) {
    return getDailySyncStatus();
  }

  if (!(await pathExists(DAILY_SYNC_WRAPPER)) || !(await pathExists(DAILY_SYNC_SCRIPT))) {
    const missing: DailySyncStatusResult = {
      ok: false,
      state: "missing",
      message: "Daily SPX/IBKR sync wrapper or Python script was not found.",
      generatedAt: new Date().toISOString(),
      targetPlan,
    };
    await writeStatus(missing);
    return missing;
  }

  const command = buildDailySyncCommand(input);
  const startedAt = new Date().toISOString();
  const dryRun = Boolean(input.dryRun);

  if (dryRun) {
    return {
      ok: true,
      state: "idle",
      message: "Daily SPX/IBKR sync preflight passed; command is ready to launch.",
      command: command.display,
      cwd: command.cwd,
      dryRun: true,
      generatedAt: new Date().toISOString(),
      logPath: DAILY_SYNC_LAUNCH_LOG,
      startedAt,
      targetPlan,
    };
  }

  await fsp.mkdir(path.dirname(DAILY_SYNC_LAUNCH_LOG), { recursive: true });
  const logStream = fs.createWriteStream(DAILY_SYNC_LAUNCH_LOG, { flags: "a" });
  logStream.write(`\n[${startedAt}] Launching ${command.display.join(" ")}\n`);

  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    windowsHide: true,
  });
  activeDailySync = child;
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  logStream.on("error", (error) => {
    console.warn(`Daily sync launch log write failed: ${error.message}`);
  });

  const launched: DailySyncStatusResult = {
    ok: true,
    state: "running",
    message: "Daily SPX/IBKR sync started. Rubicon will update each output step as the wrapper reports progress.",
    command: command.display,
    cwd: command.cwd,
    generatedAt: new Date().toISOString(),
    logPath: DAILY_SYNC_LAUNCH_LOG,
    pid: child.pid,
    startedAt,
    steps: defaultDailySyncSteps(startedAt),
    targetPlan,
  };
  await writeStatus(launched);

  child.on("close", async (exitCode) => {
    const finishedAt = new Date().toISOString();
    logStream.write(`\n[${finishedAt}] Daily sync exited with code ${exitCode ?? "unknown"}\n`);
    logStream.end();
    activeDailySync = null;
    const persisted = await readJson<DailySyncStatusResult | null>(DAILY_SYNC_STATUS_PATH, null);
    const completionStatus = mergeDailySyncCompletionStatus({
      exitCode: exitCode ?? null,
      finishedAt,
      launched,
      persisted,
    });
    if (dailySyncCompletionAllowsDerivedStateRefresh(completionStatus)) {
      const completedSummary = await latestDailySummary();
      const derivedState = await refreshDailySyncDerivedState({ date: completedSummary?.date });
      for (const warning of derivedState.warnings) {
        console.warn(warning);
      }
      if (derivedState.warnings.length) {
        completionStatus.warnings = [...(completionStatus.warnings ?? []), ...derivedState.warnings];
      }
    }
    await writeStatus(completionStatus);
  });

  child.on("error", async (error) => {
    const finishedAt = new Date().toISOString();
    logStream.write(`\n[${finishedAt}] Daily sync launch error: ${error.message}\n`);
    logStream.end();
    activeDailySync = null;
    await writeStatus({
      ...launched,
      ok: false,
      state: "failed",
      message: error.message,
      finishedAt,
      generatedAt: finishedAt,
    });
  });

  return launched;
}
