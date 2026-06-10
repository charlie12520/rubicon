import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { FplLiveStatus } from "../shared/types.ts";
import { easternClock, timeDeltaMinutes } from "./easternClock.ts";
import { pathExists } from "./jsonStore.ts";
import { openRotatingLogStream } from "./logRotation.ts";

// The live predictor streams IBKR SPX bars and appends to predictions_<today>.csv.
// It needs BOTH scikit-learn (the model) and ib_insync (streaming) — the system
// Python 3.11 has both; the IBKR venv does not. Override with FPL_LIVE_PYTHON.
const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..");
const FPL_DIR = path.join(AI_STUFF_ROOT, "analysis", "fpl_perbar_indicator");
const LIVE_SCRIPT = path.join(FPL_DIR, "fpl_live_predict.py");
const LIVE_PYTHON = process.env.FPL_LIVE_PYTHON ?? "python";
const LIVE_LOG = path.join(process.cwd(), "data", "fpl-live.log");
const DEFAULT_PORT = Number(process.env.FPL_LIVE_PORT ?? 7496);
const DEFAULT_CLIENT_ID = Number(process.env.FPL_LIVE_CLIENT_ID ?? 177);
const LOG_TAIL_MAX = 60;
const execFileAsync = promisify(execFile);

// Auto-start: fire startFplLive() at this America/New_York time on weekdays.
// 09:25 ET is 5 minutes before market open — gives ib_insync time to qualify
// the SPX contract and subscribe before the 09:30 bar. Set FPL_AUTO_START=false
// to disable; FPL_AUTO_START_TIME=HH:MM to override.
const AUTO_START_ENABLED = String(process.env.FPL_AUTO_START ?? "true").toLowerCase() !== "false";
const AUTO_START_TIME = process.env.FPL_AUTO_START_TIME ?? "09:25";

let activeChild: ChildProcessWithoutNullStreams | null = null;
let startedAt: string | null = null;
let lastExit: { code: number | null; at: string } | null = null;
let autoStartLastFiredDate: string | null = null;
let autoStartTimer: ReturnType<typeof setInterval> | null = null;
const logTail: string[] = [];

type ExternalFplProcess = {
  commandLine?: string;
  createdAt?: string;
  pid: number;
};

let externalProbeCache: { checkedAt: number; process: ExternalFplProcess | null } | null = null;

function pushLog(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed.trim()) {
      logTail.push(trimmed);
    }
  }
  if (logTail.length > LOG_TAIL_MAX) {
    logTail.splice(0, logTail.length - LOG_TAIL_MAX);
  }
}

function cleanLogTail(): string[] {
  return logTail
    .filter((line) => !line.includes("PerformanceWarning"))
    .filter((line) => !line.includes("DataFrame is highly fragmented"))
    .filter((line) => !line.trim().startsWith("row_full[col] = np.nan"))
    .slice(-18);
}

export async function getFplLiveStatus(): Promise<FplLiveStatus> {
  const external = activeChild ? null : await discoverExternalFplLiveProcess();
  const externalLog = external
    ? [`detected existing live predictor pid ${external.pid}${external.createdAt ? `, started ${external.createdAt}` : ""}`]
    : [];
  return {
    running: activeChild !== null || external !== null,
    pid: activeChild?.pid ?? external?.pid ?? null,
    startedAt: startedAt ?? external?.createdAt ?? null,
    lastExit,
    logTail: external ? externalLog : cleanLogTail(),
    script: LIVE_SCRIPT,
    python: LIVE_PYTHON,
    available: await pathExists(LIVE_SCRIPT),
    autoStartEt: AUTO_START_ENABLED ? AUTO_START_TIME : null,
    autoStartLastFiredDate,
  };
}

async function discoverExternalFplLiveProcess(): Promise<ExternalFplProcess | null> {
  const now = Date.now();
  if (externalProbeCache && now - externalProbeCache.checkedAt < 2500) {
    return externalProbeCache.process;
  }
  const processInfo = process.platform === "win32" ? await discoverExternalFplLiveProcessWindows() : await discoverExternalFplLiveProcessPosix();
  externalProbeCache = { checkedAt: now, process: processInfo };
  return processInfo;
}

async function discoverExternalFplLiveProcessWindows(): Promise<ExternalFplProcess | null> {
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$rows = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -and $_.CommandLine.Contains('fpl_live_predict.py') -and $_.CommandLine.Contains('--live') }",
    "$rows | Sort-Object CreationDate -Descending | Select-Object -First 1 @{Name='pid';Expression={$_.ProcessId}}, @{Name='commandLine';Expression={$_.CommandLine}}, @{Name='createdAt';Expression={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
      timeout: 3500,
      windowsHide: true,
    });
    return parseExternalProcessJson(stdout);
  } catch {
    return null;
  }
}

async function discoverExternalFplLiveProcessPosix(): Promise<ExternalFplProcess | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="], { timeout: 2500 });
    const line = stdout
      .split(/\r?\n/)
      .find((candidate) => candidate.includes("fpl_live_predict.py") && candidate.includes("--live"));
    if (!line) {
      return null;
    }
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    const pid = match ? Number(match[1]) : Number.NaN;
    return Number.isFinite(pid) ? { commandLine: match?.[2], pid } : null;
  } catch {
    return null;
  }
}

function parseExternalProcessJson(stdout: string): ExternalFplProcess | null {
  const text = stdout.trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record || typeof record !== "object") {
      return null;
    }
    const raw = record as Record<string, unknown>;
    const pid = Number(raw.pid);
    if (!Number.isFinite(pid)) {
      return null;
    }
    return {
      commandLine: typeof raw.commandLine === "string" ? raw.commandLine : undefined,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
      pid,
    };
  } catch {
    return null;
  }
}

// Arm the daily auto-start scheduler. Called once at server boot. Idempotent.
// Ticks every 30s, fires startFplLive() when the ET clock reaches AUTO_START_TIME
// on a weekday and we haven't already fired today. If the user already started
// it (manually or after a crash-restart), we just mark today as fired so the
// next check doesn't re-spawn on top of their session.
export function armFplLiveAutoStart(): void {
  if (!AUTO_START_ENABLED || autoStartTimer) return;
  pushLog(`[${new Date().toISOString()}] auto-start armed for ${AUTO_START_TIME} ET (Mon-Fri)`);
  autoStartTimer = setInterval(() => {
    const now = easternClock();
    const isWeekday = now.weekday >= 1 && now.weekday <= 5;
    if (!isWeekday) return;
    if (autoStartLastFiredDate === now.date) return;
    if (now.time < AUTO_START_TIME) return;
    // Guard the window: only fire within 5 minutes of the configured time, so
    // a server that boots at 13:00 doesn't immediately spawn the predictor for
    // a missed 09:25 window — that's almost certainly not what the user wants.
    if (timeDeltaMinutes(now.time, AUTO_START_TIME) > 5) {
      autoStartLastFiredDate = now.date;
      return;
    }
    autoStartLastFiredDate = now.date;
    void (async () => {
      const external = await discoverExternalFplLiveProcess();
      if (activeChild || external) {
        pushLog(
          `[${new Date().toISOString()}] auto-start skipped: predictor already running${
            external ? ` as pid ${external.pid}` : ""
          }`,
        );
        return;
      }
      pushLog(`[${new Date().toISOString()}] auto-start firing for ${now.date} ${now.time} ET`);
      startFplLive().catch((err) => pushLog(`auto-start error: ${(err as Error).message}`));
    })();
  }, 30_000);
  autoStartTimer.unref?.();
}

export async function startFplLive(opts: { port?: number; clientId?: number } = {}): Promise<FplLiveStatus> {
  if (activeChild) {
    return getFplLiveStatus();
  }
  const external = await discoverExternalFplLiveProcess();
  if (external) {
    pushLog(`[${new Date().toISOString()}] using existing live predictor pid ${external.pid}`);
    return getFplLiveStatus();
  }
  if (!(await pathExists(LIVE_SCRIPT))) {
    pushLog(`error: live predictor script not found at ${LIVE_SCRIPT}`);
    return getFplLiveStatus();
  }

  const port = Number.isFinite(opts.port) ? Number(opts.port) : DEFAULT_PORT;
  const clientId = Number.isFinite(opts.clientId) ? Number(opts.clientId) : DEFAULT_CLIENT_ID;
  const args = [LIVE_SCRIPT, "--live", "--port", String(port), "--client-id", String(clientId)];

  startedAt = new Date().toISOString();
  lastExit = null;
  logTail.length = 0;
  pushLog(`[${startedAt}] launching ${LIVE_PYTHON} fpl_live_predict.py --live --port ${port} --client-id ${clientId}`);

  const logStream = await openRotatingLogStream(LIVE_LOG);
  logStream.write(`\n[${startedAt}] launching ${LIVE_PYTHON} ${args.join(" ")}\n`);
  logStream.on("error", (error) => {
    pushLog(`log stream error: ${error.message}`);
  });

  const child = spawn(LIVE_PYTHON, args, { cwd: FPL_DIR, windowsHide: true });
  activeChild = child;
  child.stdout.on("data", (data) => pushLog(String(data)));
  child.stderr.on("data", (data) => pushLog(String(data)));
  child.stdout.on("error", (error) => pushLog(`stdout stream error: ${error.message}`));
  child.stderr.on("error", (error) => pushLog(`stderr stream error: ${error.message}`));
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  child.on("close", (code) => {
    lastExit = { code: code ?? null, at: new Date().toISOString() };
    pushLog(`[${lastExit.at}] live predictor exited with code ${code ?? "unknown"}`);
    logStream.end();
    activeChild = null;
  });
  child.on("error", (error) => {
    pushLog(`error: ${error.message}`);
    lastExit = { code: null, at: new Date().toISOString() };
    logStream.end();
    activeChild = null;
  });

  return getFplLiveStatus();
}

export async function stopFplLive(): Promise<FplLiveStatus> {
  if (activeChild) {
    pushLog("stop requested");
    activeChild.kill();
  } else {
    const external = await discoverExternalFplLiveProcess();
    if (external) {
      pushLog(`stop requested for existing live predictor pid ${external.pid}`);
      try {
        process.kill(external.pid);
        externalProbeCache = null;
        await new Promise((resolve) => setTimeout(resolve, 600));
      } catch (error) {
        pushLog(`stop failed for pid ${external.pid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return getFplLiveStatus();
}
