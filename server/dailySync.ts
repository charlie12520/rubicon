import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type {
  DailyPipelineStage,
  DailyPipelineStages,
  DailyPipelineStageStatus,
  DailyOptionPullScope,
  DailySyncLockInfo,
  DailySyncLatestSummary,
  DailySyncPipelineState,
  DailySyncStatusResult,
  DailySyncStep,
  DailySyncTargetPlan,
  SourceHealth,
} from "../shared/types.ts";
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
const DAILY_SYNC_LOCK_PATH = path.join(IBKR_ROOT, "data", "daily_sync.lock.json");
const DAILY_SYNC_AUTO_CUTOFF_ET = "07:00";
const DAILY_SYNC_LOCK_STALE_MS = 12 * 60 * 60 * 1000;
const SPX_HEATMAP_FILE = "spx-heatmap.json";
const SPX_HEATMAP_SCRIPT = path.join("scripts", "refresh-spx-heatmap.py");
const SECTOR_RRG_FILE = "sector-rrg-bars.json";
const SECTOR_RRG_SCRIPT = path.join("scripts", "refresh-sector-rrg.py");

let activeDailySync: ChildProcessWithoutNullStreams | null = null;

type DailySyncLaunchInput = {
  date?: string;
  dryRun?: boolean;
  optionScope?: DailyOptionPullScope;
  optionSidecarsOnly?: boolean;
  runId?: string;
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
  runId?: string;
  status?: string;
  spxStatus?: string;
  tradeStatus?: string;
  fillCount?: number;
  spreadCount?: number;
  entryCount?: number;
  googleUploadMode?: string;
  googleUploadStatus?: string;
  googleUploaded?: boolean;
  googleUploadedAt?: string;
  logPath?: string;
};

type DailySyncCompletionMergeInput = {
  exitCode: number | null;
  finishedAt: string;
  launched: DailySyncStatusResult;
  persisted?: DailySyncStatusResult | null;
};

type RefreshDailySyncDerivedStateInput = {
  appRoot?: string;
  backfillSpxHeatmap?: boolean;
  date?: string;
  ibkrTradesRoot?: string;
  refreshMorningBrief?: (date: string, appRoot: string, options: { refresh: true }) => Promise<unknown>;
  refreshReplaySafeState?: (ibkrTradesRoot: string, date: string) => Promise<unknown>;
  refreshSpxHeatmapBackfill?: (appRoot: string) => Promise<SpxHeatmapBackfillResult>;
  refreshSectorRrg?: (appRoot: string) => Promise<SectorRrgRefreshResult>;
  refreshSpreadSpeedState?: (ibkrTradesRoot: string, date: string) => Promise<unknown>;
  refreshTrackerSummary?: (ibkrTradesRoot: string, date: string) => Promise<unknown>;
};

type RefreshDailySyncDerivedStateResult = {
  date: string | null;
  morningBriefRefreshed: boolean;
  replaySafeStateRefreshed: boolean;
  sectorRrgRefreshed: boolean;
  spxHeatmapBackfilled: boolean;
  spxHeatmapBackfillSkipped: boolean;
  spreadSpeedStateRefreshed: boolean;
  trackerSummaryRefreshed: boolean;
  warnings: string[];
};

type SpxHeatmapBackfillResult = {
  asOf?: string | null;
  backfilled: boolean;
  detail: string;
  skipped: boolean;
  source?: string;
  tiles?: number;
};

type SectorRrgRefreshResult = {
  detail: string;
  generatedAt?: string | null;
  refreshed: boolean;
  symbols?: number;
};

type DailySyncLockFile = {
  command?: string[];
  pid?: number;
  runId?: string;
  startedAt?: string;
  targetDate?: string;
};

function compactTimestamp(value = new Date()): string {
  return value.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function buildRunId(targetDate: string, now = new Date()): string {
  return `daily-${targetDate}-${compactTimestamp(now)}`;
}

function finiteNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(numberValue) ? numberValue : null;
}

function heatmapTileHasPct(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (finiteNumber(record.pct) !== null) {
    return true;
  }
  return Array.isArray(record.pctByTime) && record.pctByTime.some((entry) => finiteNumber(entry) !== null);
}

export function spxHeatmapPayloadIsFilled(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  const source = String(record.source ?? "").trim().toLowerCase();
  if (!source || source === "none" || source === "sample") {
    return false;
  }
  if (!source.includes("yahoo") && !source.includes("ibkr")) {
    return false;
  }
  const tiles = Array.isArray(record.tiles) ? record.tiles : [];
  if (tiles.length < 100) {
    return false;
  }
  const realTileCount = tiles.filter(heatmapTileHasPct).length;
  return typeof record.asOf === "string" && record.asOf.trim().length > 0 && realTileCount >= 25;
}

function shortOutput(stdout: string, stderr: string): string {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(-6).join(" | ");
}

function runHeatmapBackfill(appRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(appRoot, SPX_HEATMAP_SCRIPT);
    const child = spawn(process.env.PYTHON ?? "python", [scriptPath, "--source", "yahoo"], {
      cwd: appRoot,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-4000);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`Yahoo heatmap backfill exited with code ${exitCode ?? "unknown"}${shortOutput(stdout, stderr) ? `: ${shortOutput(stdout, stderr)}` : ""}`));
    });
  });
}

export async function maybeBackfillSpxHeatmapFromYahoo(appRoot = process.cwd()): Promise<SpxHeatmapBackfillResult> {
  const heatmapPath = path.join(appRoot, "data", SPX_HEATMAP_FILE);
  const existing = await readJson<Record<string, unknown> | null>(heatmapPath, null);
  if (spxHeatmapPayloadIsFilled(existing)) {
    return {
      asOf: typeof existing?.asOf === "string" ? existing.asOf : null,
      backfilled: false,
      detail: `Existing SPX heatmap is already filled from ${String(existing?.source ?? "unknown")}.`,
      skipped: true,
      source: String(existing?.source ?? "unknown"),
      tiles: Array.isArray(existing?.tiles) ? existing.tiles.length : undefined,
    };
  }

  const scriptPath = path.join(appRoot, SPX_HEATMAP_SCRIPT);
  if (!(await pathExists(scriptPath))) {
    throw new Error(`SPX heatmap refresh script is missing at ${scriptPath}.`);
  }

  await runHeatmapBackfill(appRoot);
  const next = await readJson<Record<string, unknown> | null>(heatmapPath, null);
  if (!spxHeatmapPayloadIsFilled(next)) {
    throw new Error("Yahoo heatmap backfill completed, but the output still has no usable intraday values.");
  }
  return {
    asOf: typeof next?.asOf === "string" ? next.asOf : null,
    backfilled: true,
    detail: `Yahoo SPX heatmap backfilled ${Array.isArray(next?.tiles) ? next.tiles.length : 0} tiles as of ${typeof next?.asOf === "string" ? next.asOf : "unknown"}.`,
    skipped: false,
    source: String(next?.source ?? "unknown"),
    tiles: Array.isArray(next?.tiles) ? next.tiles.length : undefined,
  };
}

function runSectorRrgScript(appRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(appRoot, SECTOR_RRG_SCRIPT);
    const child = spawn(process.env.PYTHON ?? "python", [scriptPath], {
      cwd: appRoot,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-4000);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }
      reject(new Error(`Sector RRG refresh exited with code ${exitCode ?? "unknown"}${shortOutput(stdout, stderr) ? `: ${shortOutput(stdout, stderr)}` : ""}`));
    });
  });
}

// Pull the SPDR sector ETFs + SPY daily bars from Yahoo for the default sector RRG.
// Unlike the heatmap backfill, this runs every sync — daily bars change each session —
// and has no TWS/IBKR dependency, so it is safe to run unattended.
export async function refreshSectorRrgFromYahoo(appRoot = process.cwd()): Promise<SectorRrgRefreshResult> {
  const scriptPath = path.join(appRoot, SECTOR_RRG_SCRIPT);
  if (!(await pathExists(scriptPath))) {
    throw new Error(`Sector RRG refresh script is missing at ${scriptPath}.`);
  }

  await runSectorRrgScript(appRoot);
  const filePath = path.join(appRoot, "data", SECTOR_RRG_FILE);
  const payload = await readJson<Record<string, unknown> | null>(filePath, null);
  const symbols = Array.isArray(payload?.symbols) ? payload.symbols.length : undefined;
  if (!symbols) {
    throw new Error("Sector RRG refresh completed, but the output has no symbols.");
  }
  const generatedAt = typeof payload?.generatedAt === "string" ? payload.generatedAt : null;
  return {
    detail: `Sector RRG refreshed from Yahoo (${symbols} symbols) as of ${generatedAt ?? "unknown"}.`,
    generatedAt,
    refreshed: true,
    symbols,
  };
}

function isPidRunning(pid: number | undefined): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readDailySyncLock(): Promise<DailySyncLockInfo> {
  const raw = await readJson<DailySyncLockFile | null>(DAILY_SYNC_LOCK_PATH, null);
  if (!raw) {
    return {
      active: false,
      path: DAILY_SYNC_LOCK_PATH,
      message: "No daily pipeline lock file exists.",
    };
  }

  let lockMtimeMs = 0;
  try {
    lockMtimeMs = (await fsp.stat(DAILY_SYNC_LOCK_PATH)).mtimeMs;
  } catch {
    lockMtimeMs = 0;
  }

  const startedAtMs = raw.startedAt ? Date.parse(raw.startedAt) : Number.NaN;
  const ageMs = Number.isFinite(startedAtMs)
    ? Date.now() - startedAtMs
    : lockMtimeMs
      ? Date.now() - lockMtimeMs
      : DAILY_SYNC_LOCK_STALE_MS + 1;
  const staleByAge = ageMs > DAILY_SYNC_LOCK_STALE_MS;
  const pidAlive = isPidRunning(raw.pid);
  const stale = staleByAge || !pidAlive;

  return {
    active: !stale,
    command: raw.command,
    path: DAILY_SYNC_LOCK_PATH,
    pid: raw.pid,
    runId: raw.runId,
    stale,
    startedAt: raw.startedAt,
    targetDate: raw.targetDate,
    message: stale
      ? `Daily pipeline lock is stale${raw.pid ? `; PID ${raw.pid} is not active or the lock aged out` : ""}.`
      : `Daily pipeline lock is active${raw.pid ? ` for PID ${raw.pid}` : ""}.`,
  };
}

async function clearStaleDailySyncLock(lock: DailySyncLockInfo): Promise<void> {
  if (!lock.stale) {
    return;
  }
  try {
    await fsp.unlink(DAILY_SYNC_LOCK_PATH);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

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
      detail: "Rubicon launched the daily pipeline wrapper.",
      updatedAt: startedAt,
    },
    {
      id: "core-sync",
      label: "Data Collection",
      status: "pending",
      detail: "Waiting for local pull files.",
    },
    {
      id: "rubicon-ingest",
      label: "Rubicon Ingest",
      status: "pending",
      detail: "Waiting to publish local data into Rubicon state.",
    },
    {
      id: "sheet-payload",
      label: "Sheet payload",
      status: "pending",
      detail: "Waiting for compact tracker payload generation.",
    },
    {
      id: "google-upload",
      label: "Google Upload",
      status: "pending",
      detail: "Waiting to update tracker rows in Google Sheets.",
    },
    {
      id: "tc2000-open",
      label: "Open TC2000",
      status: "pending",
      detail: "Waiting to verify TC2000 is open before scanner export.",
    },
    {
      id: "tc2000-export",
      label: "TC2000 export",
      status: "pending",
      detail: "Waiting to export Qullamaggie scanner rows from TC2000.",
    },
    {
      id: "qullamaggie-report",
      label: "Qullamaggie report/email",
      status: "pending",
      detail: "Waiting for a fresh TC2000 export.",
    },
    {
      id: "tc2000-bars",
      label: "TC2000 daily bars",
      status: "pending",
      detail: "Waiting for daily-bar refresh.",
    },
    {
      id: "option-spx-spread-legs",
      label: "Option SPX spread legs",
      status: "pending",
      detail: "Waiting to retry failed or missing SPX spread-leg option data.",
    },
    {
      id: "option-spx-chain-band",
      label: "Option SPX chain band",
      status: "pending",
      detail: "Waiting to retry failed or missing SPX 0DTE chain-band option data.",
    },
    {
      id: "option-owned-symbols",
      label: "Option owned symbols",
      status: "pending",
      detail: "Waiting to retry failed or missing owned/traded option data.",
    },
    {
      id: "option-open-interest",
      label: "Option open interest",
      status: "pending",
      detail: "Waiting to retry failed or missing option open-interest data.",
    },
    {
      id: "option-rubicon-refresh",
      label: "Option Rubicon refresh",
      status: "pending",
      detail: "Waiting to refresh replay and spread-speed state if retry changes option files.",
    },
  ];
}

function stage(
  id: keyof DailyPipelineStages,
  label: string,
  status: DailyPipelineStageStatus,
  detail: string,
  updatedAt?: string,
): DailyPipelineStage {
  return {
    id,
    label,
    status,
    detail,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function defaultDailyPipelineStages(startedAt: string, dataCollectionStatus: DailyPipelineStageStatus = "pending"): DailyPipelineStages {
  return {
    dataCollection: stage(
      "dataCollection",
      "Data Collection",
      dataCollectionStatus,
      "Pulling review-critical SPX 5s bars, IBKR executions, trade entries, and local summary.",
      startedAt,
    ),
    rubiconIngest: stage(
      "rubiconIngest",
      "Rubicon Ingest",
      "pending",
      "Waiting to publish collected data into Rubicon summaries and replay-safe state.",
    ),
    googleUpload: stage(
      "googleUpload",
      "Google Upload",
      "pending",
      "Waiting to update Daily Sync Runs and Trade Log rows.",
    ),
  };
}

function normalizeStages(status: DailySyncStatusResult | null | undefined, startedAt?: string): DailyPipelineStages {
  if (status?.stages?.dataCollection && status.stages.rubiconIngest && status.stages.googleUpload) {
    return status.stages;
  }

  const defaultDataStatus = status?.state === "running" ? "running" : "pending";
  const stages = defaultDailyPipelineStages(startedAt ?? status?.startedAt ?? new Date().toISOString(), defaultDataStatus);
  const stepById = new Map((status?.steps ?? []).map((step) => [step.id, step]));
  const core = stepById.get("core-sync");
  if (core) {
    stages.dataCollection = {
      ...stages.dataCollection,
      detail: core.detail,
      status: core.status,
      updatedAt: core.updatedAt,
    };
  }

  const ingest = stepById.get("rubicon-ingest");
  if (ingest) {
    stages.rubiconIngest = {
      ...stages.rubiconIngest,
      detail: ingest.detail,
      status: ingest.status,
      updatedAt: ingest.updatedAt,
    };
  }

  const payload = stepById.get("sheet-payload");
  const upload = stepById.get("google-upload") ?? payload;
  if (upload) {
    stages.googleUpload = {
      ...stages.googleUpload,
      detail: upload.detail,
      status: upload.status,
      updatedAt: upload.updatedAt,
    };
  }

  return stages;
}

function stageIsUsable(stageStatus: DailyPipelineStageStatus): boolean {
  return stageStatus === "complete" || stageStatus === "warning";
}

function stageHasBlockers(stage: DailyPipelineStage): boolean {
  return stage.status === "failed" || Boolean(stage.blockers?.length);
}

function pipelineReviewReady(stages: DailyPipelineStages): boolean {
  return stageIsUsable(stages.dataCollection.status) && stageIsUsable(stages.rubiconIngest.status) && !stageHasBlockers(stages.dataCollection) && !stageHasBlockers(stages.rubiconIngest);
}

function pipelineGoogleUploadEvidence(stages: DailyPipelineStages): boolean | undefined {
  if (stages.googleUpload.status === "complete" && !stageHasBlockers(stages.googleUpload)) {
    return true;
  }
  if (stages.googleUpload.status === "failed" || stageHasBlockers(stages.googleUpload)) {
    return false;
  }
  return undefined;
}

export function summaryGoogleUploaded(summary: DailySyncLatestSummary | undefined): boolean | undefined {
  if (!summary) {
    return undefined;
  }
  if (summary.googleUploaded === true) {
    return true;
  }
  const status = String(summary.googleUploadStatus ?? "").trim().toLowerCase();
  if (status === "complete" || status === "uploaded") {
    return true;
  }
  if (status === "failed" || status === "error") {
    return false;
  }
  return undefined;
}

export function resolveDailySyncGoogleUploaded(input: {
  currentSummary?: DailySyncLatestSummary;
  targetSummary?: DailySyncLatestSummary;
  persistedGoogleUploaded?: boolean;
  stages: DailyPipelineStages;
}): boolean | undefined {
  return (
    summaryGoogleUploaded(input.currentSummary) ??
    summaryGoogleUploaded(input.targetSummary) ??
    (input.persistedGoogleUploaded === true ? true : undefined) ??
    pipelineGoogleUploadEvidence(input.stages)
  );
}

export function selectDailySyncPreferredLogPath(input: {
  currentSummary?: DailySyncLatestSummary;
  targetSummary?: DailySyncLatestSummary;
  persistedSummary?: DailySyncLatestSummary;
}): string | undefined {
  return input.currentSummary?.logPath ?? input.targetSummary?.logPath ?? input.persistedSummary?.logPath;
}

function stagesWithSummaryGoogleUpload(stages: DailyPipelineStages, summary: DailySyncLatestSummary | undefined): DailyPipelineStages {
  if (!summaryGoogleUploaded(summary)) {
    return stages;
  }
  return {
    ...stages,
    googleUpload: {
      ...stages.googleUpload,
      blockers: [],
      detail: `Google tracker upload confirmed${summary?.googleUploadedAt ? ` at ${summary.googleUploadedAt}` : ""}.`,
      status: "complete",
    },
  };
}

function stepsWithSummaryGoogleUpload(steps: DailySyncStep[] | undefined, summary: DailySyncLatestSummary | undefined): DailySyncStep[] | undefined {
  if (!summaryGoogleUploaded(summary)) {
    return steps;
  }
  return steps
    ?.filter((step) => step.id !== "raw-workbook")
    .map((step) =>
      step.id === "google-upload"
        ? {
            ...step,
            detail: `Google tracker upload confirmed${summary?.googleUploadedAt ? ` at ${summary.googleUploadedAt}` : ""}.`,
            status: "complete",
          }
        : step,
    );
}

function pipelineStateFromStages(
  stages: DailyPipelineStages,
  state: DailySyncStatusResult["state"],
  processFailed = false,
): DailySyncPipelineState {
  if (state === "missing") {
    return "missing";
  }
  if (state === "running" || Object.values(stages).some((candidate) => candidate.status === "running")) {
    return "running";
  }
  if (state === "idle") {
    return "idle";
  }
  if (processFailed || stageHasBlockers(stages.dataCollection) || stageHasBlockers(stages.rubiconIngest)) {
    return "failed";
  }
  if (
    stageHasBlockers(stages.googleUpload) ||
    stages.googleUpload.status === "pending" ||
    stages.googleUpload.status === "skipped" ||
    Object.values(stages).some((candidate) => candidate.status === "warning")
  ) {
    return "failed-with-stage-errors";
  }
  return "completed";
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
  const stages = normalizeStages(base, launched.startedAt);
  const reviewReady = base.reviewReady ?? pipelineReviewReady(stages);
  const googleUploaded = resolveDailySyncGoogleUploaded({
    currentSummary: base.latestSummary,
    targetSummary: base.latestPipelineRun,
    persistedGoogleUploaded: base.googleUploaded,
    stages,
  });
  const processFailed = exitCode !== 0;
  const failed = processFailed || !reviewReady;
  const pipelineState = base.pipelineState ?? pipelineStateFromStages(stages, failed ? "failed" : "completed", processFailed);
  const launchMessage = launched.message;
  const fallbackMessage = failed
    ? `Daily pipeline exited with code ${exitCode ?? "unknown"}.`
    : warnings.length
      ? "Daily pipeline completed with stage warnings."
      : "Daily pipeline completed.";
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
    googleUploaded,
    pipelineState,
    reviewReady,
    stages,
    steps,
    warnings: warnings.length ? warnings : undefined,
  };
}

export function dailySyncCompletionAllowsDerivedStateRefresh(status: DailySyncStatusResult): boolean {
  return status.state === "completed" && status.ok !== false;
}

export async function refreshDailySyncDerivedState({
  appRoot = process.cwd(),
  backfillSpxHeatmap = true,
  date,
  ibkrTradesRoot = IBKR_TRADES_ROOT,
  refreshMorningBrief = loadMorningBrief,
  refreshReplaySafeState,
  refreshSpxHeatmapBackfill = maybeBackfillSpxHeatmapFromYahoo,
  refreshSectorRrg = refreshSectorRrgFromYahoo,
  refreshSpreadSpeedState,
  refreshTrackerSummary = refreshRubiconDailySummary,
}: RefreshDailySyncDerivedStateInput): Promise<RefreshDailySyncDerivedStateResult> {
  const warnings: string[] = [];
  if (!date) {
    return {
      date: null,
      morningBriefRefreshed: false,
      replaySafeStateRefreshed: false,
      sectorRrgRefreshed: false,
      spxHeatmapBackfilled: false,
      spxHeatmapBackfillSkipped: true,
      spreadSpeedStateRefreshed: false,
      trackerSummaryRefreshed: false,
      warnings: ["No completed sync summary date was available for derived state refresh."],
    };
  }

  let trackerSummaryRefreshed = false;
  let morningBriefRefreshed = false;
  let replaySafeStateRefreshed = false;
  let spreadSpeedStateRefreshed = false;
  let spxHeatmapBackfilled = false;
  let spxHeatmapBackfillSkipped = !backfillSpxHeatmap;
  let sectorRrgRefreshed = false;
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

  if (backfillSpxHeatmap) {
    try {
      const heatmap = await refreshSpxHeatmapBackfill(appRoot);
      spxHeatmapBackfilled = heatmap.backfilled;
      spxHeatmapBackfillSkipped = heatmap.skipped;
    } catch (error) {
      warnings.push(`Could not backfill SPX heatmap from Yahoo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const sectorRrg = await refreshSectorRrg(appRoot);
    sectorRrgRefreshed = sectorRrg.refreshed;
  } catch (error) {
    warnings.push(`Could not refresh sector RRG from Yahoo: ${error instanceof Error ? error.message : String(error)}`);
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
    sectorRrgRefreshed,
    spxHeatmapBackfilled,
    spxHeatmapBackfillSkipped,
    spreadSpeedStateRefreshed,
    trackerSummaryRefreshed,
    warnings,
  };
}

export function buildDailySyncCommand({ date = "auto", optionScope, optionSidecarsOnly, runId }: DailySyncLaunchInput = {}): DailySyncCommand {
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
  if (runId) {
    args.push("--run-id", runId);
  }
  if (optionSidecarsOnly) {
    args.push("--option-sidecars-only", "--option-sidecar-scope", optionScope ?? "failed-or-missing");
  }

  return {
    command: "powershell.exe",
    args,
    cwd: IBKR_ROOT,
    display: ["powershell.exe", ...args],
  };
}

async function readAnalysisLogTail(logPath: string): Promise<{ path: string; updatedAt: string; tail: string } | undefined> {
  try {
    const stat = await fsp.stat(logPath);
    const raw = await fsp.readFile(logPath, "utf8");
    const tail = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-8)
      .join("\n");
    return { path: logPath, updatedAt: stat.mtime.toISOString(), tail };
  } catch {
    return undefined;
  }
}

async function latestAnalysisLog(preferredLogPath?: string): Promise<{ path: string; updatedAt: string; tail: string } | undefined> {
  if (preferredLogPath) {
    const preferred = await readAnalysisLogTail(preferredLogPath);
    if (preferred) {
      return preferred;
    }
  }

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

  return (await readAnalysisLogTail(latest.path)) ?? { path: latest.path, updatedAt: latest.updatedAt, tail: "" };
}

function summarizeDailySyncSummary(summaryDate: string, summaryPath: string, summary: Record<string, unknown> | null): LatestSummary {
  if (!summary) {
    return { date: summaryDate, path: summaryPath };
  }

  const availability = (summary.availability ?? {}) as Record<string, unknown>;
  const trades = (availability.trades_and_spreads ?? {}) as Record<string, unknown>;
  const tradeCounts = (trades.counts ?? {}) as Record<string, unknown>;
  const spx = (availability.spx_intraday ?? {}) as Record<string, unknown>;
  const googleUpload = (summary.googleUpload ?? summary.google_upload ?? {}) as Record<string, unknown>;

  const runId = String(summary.runId ?? summary.run_id ?? "").trim() || undefined;
  const googleUploadStatus = String(googleUpload.status ?? summary.google_upload_status ?? "").trim() || undefined;
  const googleUploaded = googleUploadStatus === "complete" || googleUploadStatus === "uploaded" ? true : undefined;

  return {
    date: summaryDate,
    path: summaryPath,
    entryCount: Number(tradeCounts.entry_count ?? trades.entry_count ?? summary.entry_count ?? 0),
    fillCount: Number(tradeCounts.trade_count ?? tradeCounts.fill_count ?? trades.fill_count ?? summary.fill_count ?? 0),
    googleUploaded,
    googleUploadedAt: String(googleUpload.uploadedAt ?? googleUpload.uploaded_at ?? summary.google_uploaded_at ?? "").trim() || undefined,
    googleUploadMode: String(googleUpload.mode ?? summary.google_upload_mode ?? "").trim() || undefined,
    googleUploadStatus,
    logPath: String(summary.log_path ?? summary.logPath ?? "").trim() || undefined,
    runId,
    spxStatus: String(spx.status ?? summary.spx_status ?? ""),
    spreadCount: Number(tradeCounts.spread_count ?? trades.spread_count ?? summary.spread_count ?? 0),
    status: String(availability.status ?? summary.status ?? summary.local_review_status ?? ""),
    tradeStatus: String(trades.status ?? summary.trade_status ?? ""),
  };
}

async function dailySummaryForDate(summaryDate: string | undefined): Promise<LatestSummary | undefined> {
  if (!summaryDate || !isValidSyncDate(summaryDate)) {
    return undefined;
  }
  const summaryPath = path.join(IBKR_TRADES_ROOT, summaryDate, "daily_sync_summary.json");
  const summary = await readJson<Record<string, unknown> | null>(summaryPath, null);
  return summarizeDailySyncSummary(summaryDate, summaryPath, summary);
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

  return dailySummaryForDate(latestDate);
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
  const lock = await readDailySyncLock();
  const targetPlan = activeDailySync || lock.active ? persisted?.targetPlan ?? buildDailySyncTargetPlan("auto") : buildDailySyncTargetPlan("auto");
  const statusState = activeDailySync || lock.active ? "running" : persisted?.state ?? "idle";
  const targetDate = persisted?.targetDate ?? persisted?.targetPlan?.estimatedTargetDate ?? lock.targetDate;
  const runId = persisted?.runId ?? lock.runId;
  const latestPipelineRun = await latestDailySummary();
  const targetSummary = await dailySummaryForDate(targetDate);
  const currentRunSummary = runId
    ? [targetSummary, latestPipelineRun, persisted?.latestSummary].find((summary) => summary?.runId === runId)
    : undefined;
  const currentSummary = currentRunSummary ?? targetSummary ?? persisted?.latestSummary;
  const latestLog = await latestAnalysisLog(selectDailySyncPreferredLogPath({ currentSummary: currentRunSummary, targetSummary, persistedSummary: persisted?.latestSummary }));
  const stages = stagesWithSummaryGoogleUpload(normalizeStages(persisted, persisted?.startedAt), currentRunSummary ?? targetSummary);
  const reviewReady = persisted?.reviewReady ?? pipelineReviewReady(stages);
  const googleUploaded = resolveDailySyncGoogleUploaded({
    currentSummary: currentRunSummary,
    targetSummary,
    persistedGoogleUploaded: persisted?.googleUploaded,
    stages,
  });
  const pipelineState = summaryGoogleUploaded(currentRunSummary ?? targetSummary) ? pipelineStateFromStages(stages, statusState) : persisted?.pipelineState ?? pipelineStateFromStages(stages, statusState);
  const runningMessage = lock.active && !activeDailySync
    ? lock.message ?? "Daily pipeline is running from another process."
    : persisted?.message ?? "Daily pipeline is running.";

  return {
    ok: persisted?.ok ?? true,
    state: statusState,
    message: statusState === "running" ? runningMessage : persisted?.message ?? "Daily pipeline is idle.",
    command: persisted?.command,
    cwd: persisted?.cwd ?? IBKR_ROOT,
    catchup: persisted?.catchup,
    dryRun: persisted?.dryRun,
    exitCode: persisted?.exitCode,
    finishedAt: persisted?.finishedAt,
    generatedAt: new Date().toISOString(),
    googleUploaded,
    latestLogPath: latestLog?.path,
    latestLogTail: latestLog?.tail,
    latestPipelineRun,
    latestSummary: currentSummary,
    lock,
    logPath: persisted?.logPath ?? DAILY_SYNC_LAUNCH_LOG,
    pid: activeDailySync?.pid ?? persisted?.pid,
    pipelineState,
    reviewReady,
    runId,
    startedAt: persisted?.startedAt,
    stages,
    targetDate,
    steps: stepsWithSummaryGoogleUpload(persisted?.steps, currentSummary),
    targetPlan,
    warnings: persisted?.warnings,
  };
}

export async function startDailySync(input: DailySyncLaunchInput = {}): Promise<DailySyncStatusResult> {
  const targetPlan = buildDailySyncTargetPlan(input.date ?? "auto");
  const runId = input.runId ?? buildRunId(targetPlan.estimatedTargetDate);
  const targetDate = targetPlan.estimatedTargetDate;

  if (activeDailySync) {
    return getDailySyncStatus();
  }

  const lock = await readDailySyncLock();
  if (lock.active) {
    const blocked: DailySyncStatusResult = {
      ok: false,
      state: "running",
      message: lock.message ?? "Daily pipeline is already running; duplicate live runs are blocked.",
      generatedAt: new Date().toISOString(),
      lock,
      pipelineState: "running",
      runId: lock.runId,
      targetDate: lock.targetDate,
      targetPlan,
    };
    await writeStatus(blocked);
    return blocked;
  }
  await clearStaleDailySyncLock(lock);

  if (!(await pathExists(DAILY_SYNC_WRAPPER)) || !(await pathExists(DAILY_SYNC_SCRIPT))) {
    const missing: DailySyncStatusResult = {
      ok: false,
      state: "missing",
      message: "Daily pipeline wrapper or Python data-collection script was not found.",
      generatedAt: new Date().toISOString(),
      pipelineState: "missing",
      runId,
      targetDate,
      targetPlan,
    };
    await writeStatus(missing);
    return missing;
  }

  const command = buildDailySyncCommand({ ...input, runId });
  const startedAt = new Date().toISOString();
  const dryRun = Boolean(input.dryRun);
  const stages = defaultDailyPipelineStages(startedAt, dryRun ? "pending" : "running");

  if (dryRun) {
    return {
      ok: true,
      state: "idle",
      message: "Daily pipeline preflight passed; command is ready to launch.",
      command: command.display,
      cwd: command.cwd,
      dryRun: true,
      generatedAt: new Date().toISOString(),
      logPath: DAILY_SYNC_LAUNCH_LOG,
      pipelineState: "idle",
      reviewReady: false,
      runId,
      startedAt,
      stages,
      steps: defaultDailySyncSteps(startedAt),
      targetDate,
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
    message: "Daily pipeline started. Rubicon will update Data Collection, Rubicon Ingest, Google Upload, TC2000 steps, and final option retry as the wrapper reports progress.",
    command: command.display,
    cwd: command.cwd,
    generatedAt: new Date().toISOString(),
    logPath: DAILY_SYNC_LAUNCH_LOG,
    pipelineState: "running",
    pid: child.pid,
    reviewReady: false,
    runId,
    startedAt,
    stages,
    steps: defaultDailySyncSteps(startedAt),
    targetDate,
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
    if (dailySyncCompletionAllowsDerivedStateRefresh(completionStatus) && !stageIsUsable(completionStatus.stages?.rubiconIngest.status ?? "pending")) {
      const derivedState = await refreshDailySyncDerivedState({ date: completionStatus.targetDate ?? launched.targetDate });
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

export async function startDailyOptionPull(input: { date: string; scope?: DailyOptionPullScope }): Promise<DailySyncStatusResult> {
  if (!isValidSyncDate(input.date) || input.date === "auto") {
    throw new Error("Manual option retry date must be an explicit YYYY-MM-DD trade date.");
  }
  const scope = input.scope ?? "failed-or-missing";
  if (scope !== "failed-or-missing") {
    throw new Error("Manual option retry only supports failed-or-missing scope.");
  }

  const targetPlan = buildDailySyncTargetPlan(input.date);
  const targetDate = targetPlan.estimatedTargetDate;
  const runId = `option-retry-${targetDate}-${compactTimestamp()}`;

  if (activeDailySync) {
    return getDailySyncStatus();
  }

  const lock = await readDailySyncLock();
  if (lock.active) {
    const blocked: DailySyncStatusResult = {
      ok: false,
      state: "running",
      message: lock.message ?? "Daily pipeline is already running; option retry is blocked.",
      generatedAt: new Date().toISOString(),
      lock,
      pipelineState: "running",
      runId: lock.runId,
      targetDate: lock.targetDate,
      targetPlan,
    };
    await writeStatus(blocked);
    return blocked;
  }
  await clearStaleDailySyncLock(lock);

  const command = buildDailySyncCommand({
    date: input.date,
    optionScope: scope,
    optionSidecarsOnly: true,
    runId,
  });
  const startedAt = new Date().toISOString();
  const stages = defaultDailyPipelineStages(startedAt, "running");

  await fsp.mkdir(path.dirname(DAILY_SYNC_LAUNCH_LOG), { recursive: true });
  const logStream = fs.createWriteStream(DAILY_SYNC_LAUNCH_LOG, { flags: "a" });
  logStream.write(`\n[${startedAt}] Launching failed/missing option retry ${command.display.join(" ")}\n`);

  const child = spawn(command.command, command.args, {
    cwd: command.cwd,
    windowsHide: true,
  });
  activeDailySync = child;
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  const launched: DailySyncStatusResult = {
    ok: true,
    state: "running",
    message: `Failed/missing option data retry started for ${targetDate}.`,
    command: command.display,
    cwd: command.cwd,
    generatedAt: new Date().toISOString(),
    logPath: DAILY_SYNC_LAUNCH_LOG,
    pipelineState: "running",
    pid: child.pid,
    reviewReady: false,
    runId,
    startedAt,
    stages,
    steps: defaultDailySyncSteps(startedAt),
    targetDate,
    targetPlan,
  };
  await writeStatus(launched);

  child.on("close", async (exitCode) => {
    const finishedAt = new Date().toISOString();
    logStream.write(`\n[${finishedAt}] Option retry exited with code ${exitCode ?? "unknown"}\n`);
    logStream.end();
    activeDailySync = null;
    const persisted = await readJson<DailySyncStatusResult | null>(DAILY_SYNC_STATUS_PATH, null);
    const completionStatus = mergeDailySyncCompletionStatus({
      exitCode: exitCode ?? null,
      finishedAt,
      launched,
      persisted,
    });
    await writeStatus(completionStatus);
  });

  child.on("error", async (error) => {
    const finishedAt = new Date().toISOString();
    logStream.write(`\n[${finishedAt}] Option retry launch error: ${error.message}\n`);
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
