import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { SpxHeatmapLiveStatus } from "../shared/types.ts";
import { easternClock, timeDeltaMinutes } from "./easternClock.ts";
import { pathExists } from "./jsonStore.ts";

// Long-running per-minute IBKR snapshot poller. It rewrites data/spx-heatmap.json
// each minute so the Heatmap tab re-fetches a live map. It needs ib_insync — both
// the IBKR-history venv and the system Python 3.11 have it; prefer the venv (its
// zoneinfo/tzdata is known-good). Override with SPX_HEATMAP_PYTHON.
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(serverDir, "..");
const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(APP_ROOT, "..");
const VENV_PYTHON = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull", ".venv", "Scripts", "python.exe");
const LIVE_SCRIPT = path.join(APP_ROOT, "scripts", "refresh-spx-heatmap.py");
const LIVE_PYTHON = process.env.SPX_HEATMAP_PYTHON ?? (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python");
const LIVE_LOG = path.join(APP_ROOT, "data", "spx-heatmap-live.log");
const DEFAULT_PORTS = process.env.SPX_HEATMAP_PORTS ?? "7496,4001";
const DEFAULT_CLIENT_ID = Number(process.env.SPX_HEATMAP_CLIENT_ID ?? 941);
const LOG_TAIL_MAX = 60;
const execFileAsync = promisify(execFile);

// Auto-start the poller at this ET time on weekdays (09:28 ET = 2 min before the
// open; the script itself idles until 09:30). Disable with SPX_HEATMAP_AUTO_START=false.
const AUTO_START_ENABLED = String(process.env.SPX_HEATMAP_AUTO_START ?? "true").toLowerCase() !== "false";
const AUTO_START_TIME = process.env.SPX_HEATMAP_AUTO_START_TIME ?? "09:28";

let activeChild: ChildProcessWithoutNullStreams | null = null;
let startedAt: string | null = null;
let lastExit: { code: number | null; at: string } | null = null;
let autoStartLastFiredDate: string | null = null;
let autoStartTimer: ReturnType<typeof setInterval> | null = null;
const logTail: string[] = [];

type ExternalProcess = { commandLine?: string; createdAt?: string; pid: number };
let externalProbeCache: { checkedAt: number; process: ExternalProcess | null } | null = null;

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

// ib_insync emits informational "Error" codes for healthy farm connections —
// keep them out of the surfaced tail so the UI doesn't look alarming.
function cleanLogTail(): string[] {
  return logTail
    .filter((line) => !/Error (210[0-9]|2119|2158|2150)\b/.test(line))
    .filter((line) => !line.includes("farm connection is OK"))
    .filter((line) => !line.includes("Market data farm"))
    .slice(-18);
}

export async function getSpxHeatmapLiveStatus(): Promise<SpxHeatmapLiveStatus> {
  const external = activeChild ? null : await discoverExternalProcess();
  const externalLog = external
    ? [`detected existing heatmap poller pid ${external.pid}${external.createdAt ? `, started ${external.createdAt}` : ""}`]
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

async function discoverExternalProcess(): Promise<ExternalProcess | null> {
  const now = Date.now();
  if (externalProbeCache && now - externalProbeCache.checkedAt < 2500) {
    return externalProbeCache.process;
  }
  const found = process.platform === "win32" ? await discoverWindows() : await discoverPosix();
  externalProbeCache = { checkedAt: now, process: found };
  return found;
}

async function discoverWindows(): Promise<ExternalProcess | null> {
  const command = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$rows = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -and $_.CommandLine.Contains('refresh-spx-heatmap.py') -and $_.CommandLine.Contains('ibkr-live') }",
    "$rows | Sort-Object CreationDate -Descending | Select-Object -First 1 @{Name='pid';Expression={$_.ProcessId}}, @{Name='commandLine';Expression={$_.CommandLine}}, @{Name='createdAt';Expression={$_.CreationDate.ToString('o')}} | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], { timeout: 3500, windowsHide: true });
    return parseExternalJson(stdout);
  } catch {
    return null;
  }
}

async function discoverPosix(): Promise<ExternalProcess | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="], { timeout: 2500 });
    const line = stdout.split(/\r?\n/).find((c) => c.includes("refresh-spx-heatmap.py") && c.includes("ibkr-live"));
    if (!line) return null;
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    const pid = match ? Number(match[1]) : Number.NaN;
    return Number.isFinite(pid) ? { commandLine: match?.[2], pid } : null;
  } catch {
    return null;
  }
}

function parseExternalJson(stdout: string): ExternalProcess | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!record || typeof record !== "object") return null;
    const raw = record as Record<string, unknown>;
    const pid = Number(raw.pid);
    if (!Number.isFinite(pid)) return null;
    return {
      commandLine: typeof raw.commandLine === "string" ? raw.commandLine : undefined,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
      pid,
    };
  } catch {
    return null;
  }
}

// Arm the daily auto-start. Idempotent; ticks every 30s and fires within a 5-min
// window of AUTO_START_TIME on weekdays so a midday boot doesn't spawn a poller
// for a long-missed open.
export function armSpxHeatmapLiveAutoStart(): void {
  if (!AUTO_START_ENABLED || autoStartTimer) return;
  pushLog(`[${new Date().toISOString()}] auto-start armed for ${AUTO_START_TIME} ET (Mon-Fri)`);
  autoStartTimer = setInterval(() => {
    const now = easternClock();
    if (now.weekday < 1 || now.weekday > 5) return;
    if (autoStartLastFiredDate === now.date) return;
    if (now.time < AUTO_START_TIME) return;
    if (timeDeltaMinutes(now.time, AUTO_START_TIME) > 5) {
      autoStartLastFiredDate = now.date;
      return;
    }
    autoStartLastFiredDate = now.date;
    void (async () => {
      const external = await discoverExternalProcess();
      if (activeChild || external) {
        pushLog(`[${new Date().toISOString()}] auto-start skipped: poller already running${external ? ` as pid ${external.pid}` : ""}`);
        return;
      }
      pushLog(`[${new Date().toISOString()}] auto-start firing for ${now.date} ${now.time} ET`);
      startSpxHeatmapLive().catch((err) => pushLog(`auto-start error: ${(err as Error).message}`));
    })();
  }, 30_000);
  autoStartTimer.unref?.();
}

export async function startSpxHeatmapLive(opts: { clientId?: number; ports?: string } = {}): Promise<SpxHeatmapLiveStatus> {
  if (activeChild) {
    return getSpxHeatmapLiveStatus();
  }
  const external = await discoverExternalProcess();
  if (external) {
    pushLog(`[${new Date().toISOString()}] using existing heatmap poller pid ${external.pid}`);
    return getSpxHeatmapLiveStatus();
  }
  if (!(await pathExists(LIVE_SCRIPT))) {
    pushLog(`error: heatmap script not found at ${LIVE_SCRIPT}`);
    return getSpxHeatmapLiveStatus();
  }

  const clientId = Number.isFinite(opts.clientId) ? Number(opts.clientId) : DEFAULT_CLIENT_ID;
  const ports = opts.ports?.trim() || DEFAULT_PORTS;
  const args = [LIVE_SCRIPT, "--source", "ibkr-live", "--ports", ports, "--client-id", String(clientId)];

  startedAt = new Date().toISOString();
  lastExit = null;
  logTail.length = 0;
  pushLog(`[${startedAt}] launching ${LIVE_PYTHON} refresh-spx-heatmap.py --source ibkr-live --ports ${ports} --client-id ${clientId}`);

  await fsp.mkdir(path.dirname(LIVE_LOG), { recursive: true });
  const logStream = fs.createWriteStream(LIVE_LOG, { flags: "a" });
  logStream.write(`\n[${startedAt}] launching ${LIVE_PYTHON} ${args.join(" ")}\n`);
  logStream.on("error", (error) => pushLog(`log stream error: ${error.message}`));

  const child = spawn(LIVE_PYTHON, args, { cwd: APP_ROOT, windowsHide: true });
  activeChild = child;
  child.stdout.on("data", (data) => pushLog(String(data)));
  child.stderr.on("data", (data) => pushLog(String(data)));
  child.stdout.on("error", (error) => pushLog(`stdout stream error: ${error.message}`));
  child.stderr.on("error", (error) => pushLog(`stderr stream error: ${error.message}`));
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  child.on("close", (code) => {
    lastExit = { code: code ?? null, at: new Date().toISOString() };
    pushLog(`[${lastExit.at}] heatmap poller exited with code ${code ?? "unknown"}`);
    logStream.end();
    activeChild = null;
  });
  child.on("error", (error) => {
    pushLog(`error: ${error.message}`);
    lastExit = { code: null, at: new Date().toISOString() };
    logStream.end();
    activeChild = null;
  });

  return getSpxHeatmapLiveStatus();
}

export async function stopSpxHeatmapLive(): Promise<SpxHeatmapLiveStatus> {
  if (activeChild) {
    pushLog("stop requested");
    activeChild.kill();
  } else {
    const external = await discoverExternalProcess();
    if (external) {
      pushLog(`stop requested for existing heatmap poller pid ${external.pid}`);
      try {
        process.kill(external.pid);
        externalProbeCache = null;
        await new Promise((resolve) => setTimeout(resolve, 600));
      } catch (error) {
        pushLog(`stop failed for pid ${external.pid}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return getSpxHeatmapLiveStatus();
}
