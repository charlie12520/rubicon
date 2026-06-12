import { execFile, spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { easternClock } from "./easternClock.ts";

// Self-update: the header "Latest" button can pull origin/main, rebuild, and
// relaunch the server through the existing "Rubicon Server" scheduled task.
// Guards keep it honest: never over uncommitted local work, never when local
// commits aren't on GitHub, and market-hours restarts require an explicit
// force (killing the server orphans the day's live feeds — they only re-arm
// in the 09:28 ET open window).

const execFileAsync = promisify(execFile);
const APP_ROOT = process.cwd();
const APP_UPDATE_LOG = path.join(APP_ROOT, "data", "app-update.log");
const DAILY_SYNC_LOCK_PATH = path.join(
  process.env.AI_STUFF_ROOT ?? path.resolve(APP_ROOT, ".."),
  "IBKR Equity History Pull",
  "data",
  "daily_sync.lock.json",
);
const RELAUNCH_TASK_NAME = "Rubicon Server";
const MARKET_OPEN_GUARD_HHMM = "09:20";
const MARKET_CLOSE_GUARD_HHMM = "16:05";

export type AppVersionStatus = {
  ok: boolean;
  checkedAt: string;
  localRev: string | null;
  localRevShort: string | null;
  remoteRev: string | null;
  behindCount: number;
  aheadCount: number;
  dirtyFiles: string[];
  marketHours: boolean;
  syncRunId: string | null;
  error?: string;
};

export type AppUpdateResult = {
  ok: boolean;
  message: string;
  fromRev?: string;
  toRev?: string;
  npmCiRan?: boolean;
  restarting?: boolean;
  generatedAt: string;
};

/** Tracked modifications only — untracked files ("??") don't block an update. */
export function parseTrackedDirtyFiles(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.startsWith("??"))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

/**
 * Runtime data the live app rewrites continuously (heatmap classifications,
 * status json, ...) must not hold updates hostage — only source changes block.
 */
export function filterUpdateBlockingDirtyFiles(files: string[]): string[] {
  return files.filter((file) => !file.replaceAll("\\", "/").startsWith("data/"));
}

type DailySyncLockShape = { pid?: number; runId?: string };

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** runId of a LIVE daily sync (lock file present and its pid still running). */
export async function activeDailySyncRunId(): Promise<string | null> {
  try {
    const raw = await fsp.readFile(DAILY_SYNC_LOCK_PATH, "utf8");
    const lock = JSON.parse(raw) as DailySyncLockShape;
    if (typeof lock.pid === "number" && pidIsAlive(lock.pid)) {
      return lock.runId ?? `pid ${lock.pid}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function isMarketHoursEt(clock: { weekday: number; time: string }): boolean {
  const isWeekday = clock.weekday >= 1 && clock.weekday <= 5;
  return isWeekday && clock.time >= MARKET_OPEN_GUARD_HHMM && clock.time < MARKET_CLOSE_GUARD_HHMM;
}

export type UpdateGateDecision = {
  allowed: boolean;
  reason: string;
};

export function evaluateUpdateGate(input: {
  aheadCount: number;
  behindCount: number;
  dirtyFiles: string[];
  marketHours: boolean;
  force: boolean;
  syncRunId?: string | null;
}): UpdateGateDecision {
  if (input.syncRunId) {
    // Hard refusal — force does NOT override: restarting now would kill the
    // attached daily-sync wrapper mid-pull.
    return {
      allowed: false,
      reason: `A daily sync is running (${input.syncRunId}) — wait for it to finish before updating.`,
    };
  }
  if (input.dirtyFiles.length > 0) {
    const preview = input.dirtyFiles.slice(0, 4).join(", ");
    const more = input.dirtyFiles.length > 4 ? ` (+${input.dirtyFiles.length - 4} more)` : "";
    return {
      allowed: false,
      reason: `Uncommitted local changes (${preview}${more}) — refusing to update over in-flight work. Commit or stash them first.`,
    };
  }
  if (input.aheadCount > 0) {
    return {
      allowed: false,
      reason: `Local app has ${input.aheadCount} commit(s) that are not on GitHub — push or reconcile before updating.`,
    };
  }
  if (input.behindCount === 0) {
    return { allowed: false, reason: "Already on the latest GitHub version." };
  }
  if (input.marketHours && !input.force) {
    return {
      allowed: false,
      reason: "Market hours: restarting stops today's live feeds until tomorrow's open. Confirm to update anyway.",
    };
  }
  return { allowed: true, reason: "Update allowed." };
}

/**
 * Detached PowerShell relauncher: wait for THIS server process to exit, then
 * start the canonical "Rubicon Server" scheduled task (which rebuilds a stale
 * dist before serving, so the relaunch path stays the supervised one).
 */
export function buildRelauncherArgs(pid: number, taskName = RELAUNCH_TASK_NAME): string[] {
  const script = [
    `Wait-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "Start-Sleep -Seconds 1",
    `schtasks /Run /TN '${taskName}'`,
  ].join("; ");
  return ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script];
}

export function normalizeGitStdout(stdout: string): string {
  return stdout.replace(/[\r\n]+$/, "");
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: APP_ROOT, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  return normalizeGitStdout(stdout);
}

async function npmStep(label: string, command: string, timeoutMs: number): Promise<void> {
  await appendUpdateLog(`${label}: ${command}`);
  await execFileAsync("cmd.exe", ["/d", "/s", "/c", command], {
    cwd: APP_ROOT,
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function appendUpdateLog(message: string): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(APP_UPDATE_LOG), { recursive: true });
    await fsp.appendFile(APP_UPDATE_LOG, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // logging must never break the update itself
  }
}

export async function getAppVersionStatus({ refresh = true }: { refresh?: boolean } = {}): Promise<AppVersionStatus> {
  const checkedAt = new Date().toISOString();
  const clock = easternClock();
  try {
    if (refresh) {
      await git(["fetch", "origin", "main", "--quiet"]);
    }
    const localRev = await git(["rev-parse", "HEAD"]);
    const remoteRev = await git(["rev-parse", "origin/main"]);
    const behindCount = Number.parseInt(await git(["rev-list", "--count", "HEAD..origin/main"]), 10) || 0;
    const aheadCount = Number.parseInt(await git(["rev-list", "--count", "origin/main..HEAD"]), 10) || 0;
    const dirtyFiles = filterUpdateBlockingDirtyFiles(parseTrackedDirtyFiles(await git(["status", "--porcelain"])));
    return {
      ok: true,
      checkedAt,
      localRev,
      localRevShort: localRev.slice(0, 7),
      remoteRev,
      behindCount,
      aheadCount,
      dirtyFiles,
      marketHours: isMarketHoursEt(clock),
      syncRunId: await activeDailySyncRunId(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      checkedAt,
      localRev: null,
      localRevShort: null,
      remoteRev: null,
      behindCount: 0,
      aheadCount: 0,
      dirtyFiles: [],
      marketHours: isMarketHoursEt(clock),
      syncRunId: await activeDailySyncRunId(),
      error: message,
    };
  }
}

export async function runAppUpdate({ force = false }: { force?: boolean } = {}): Promise<AppUpdateResult> {
  const generatedAt = new Date().toISOString();
  const status = await getAppVersionStatus({ refresh: true });
  if (!status.ok) {
    return { ok: false, message: `Version check failed: ${status.error ?? "unknown error"}`, generatedAt };
  }
  const gate = evaluateUpdateGate({
    aheadCount: status.aheadCount,
    behindCount: status.behindCount,
    dirtyFiles: status.dirtyFiles,
    marketHours: status.marketHours,
    force,
    syncRunId: status.syncRunId,
  });
  if (!gate.allowed) {
    return { ok: false, message: gate.reason, generatedAt };
  }

  const fromRev = status.localRev ?? "";
  await appendUpdateLog(`update start: ${fromRev.slice(0, 7)} -> ${status.remoteRev?.slice(0, 7)} (behind ${status.behindCount}, force ${force})`);
  try {
    await git(["pull", "--ff-only", "origin", "main"]);
    const toRev = await git(["rev-parse", "HEAD"]);
    const changedFiles = (await git(["diff", "--name-only", `${fromRev}..${toRev}`])).split(/\r?\n/);
    const npmCiRan = changedFiles.includes("package-lock.json");
    if (npmCiRan) {
      await npmStep("npm ci", "npm ci", 8 * 60_000);
    }
    await npmStep("build", "npm run build", 5 * 60_000);

    const relauncher = spawn("powershell.exe", buildRelauncherArgs(process.pid), {
      cwd: APP_ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    relauncher.unref();
    await appendUpdateLog(`update built at ${toRev.slice(0, 7)}; relauncher armed (pid ${relauncher.pid}); exiting in 1.5s`);
    setTimeout(() => process.exit(0), 1500);

    return {
      ok: true,
      message: `Updated ${fromRev.slice(0, 7)} -> ${toRev.slice(0, 7)}; server restarting.`,
      fromRev,
      toRev,
      npmCiRan,
      restarting: true,
      generatedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendUpdateLog(`update FAILED (server stays up): ${message}`);
    return { ok: false, message: `Update failed before restart — server is untouched: ${message}`, generatedAt };
  }
}
