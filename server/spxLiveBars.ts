import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpxBar, SpxLiveBarsLiveStatus, SpxLiveBarsPayload } from "../shared/types.ts";
import { easternClock, timeDeltaMinutes, type EasternClock } from "./easternClock.ts";
import { pathExists } from "./jsonStore.ts";

// Dedicated live SPX intraday-bar sidecar. A long-running ib_insync process
// (scripts/refresh-spx-live-bars.py) re-pulls today's RTH 1-min SPX bars every
// ~15s and writes data/spx-live-bars.json; the Estimator chart reads it so its
// target-level line has a live SPX backdrop mid-session. Kept fully separate
// from the heatmap loop (own process, own client id 947, own file) so the two
// don't contend. Prefer the IBKR-history venv Python (known-good tz data).
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(serverDir, "..");
const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(APP_ROOT, "..");
const VENV_PYTHON = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull", ".venv", "Scripts", "python.exe");
const LIVE_SCRIPT = path.join(APP_ROOT, "scripts", "refresh-spx-live-bars.py");
const LIVE_PYTHON = process.env.SPX_LIVE_BARS_PYTHON ?? process.env.SPX_HEATMAP_PYTHON ?? (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python");
const LIVE_LOG = path.join(APP_ROOT, "data", "spx-live-bars-feed.log");
const DATA_FILE = "spx-live-bars.json";
const DEFAULT_PORTS = process.env.SPX_LIVE_BARS_PORTS ?? process.env.SPX_HEATMAP_PORTS ?? "7496,4001";
const DEFAULT_CLIENT_ID = Number(process.env.SPX_LIVE_BARS_CLIENT_ID ?? 947);
const LOG_TAIL_MAX = 60;

const AUTO_START_ENABLED = String(process.env.SPX_LIVE_BARS_AUTO_START ?? "true").toLowerCase() !== "false";
const AUTO_START_TIME = process.env.SPX_LIVE_BARS_AUTO_START_TIME ?? "09:28";

// Same RTH window as the heatmap feed: weekday 09:25–16:00 ET, so we never pull
// post-close. Holidays aren't detected (same weekday-only limitation as fplLive).
const PULL_WINDOW_OPEN = "09:25";
const PULL_WINDOW_CLOSE = "16:00";

export function isSpxBarsMarketWindow(now: EasternClock = easternClock()): boolean {
  if (now.weekday < 1 || now.weekday > 5) return false;
  return now.time >= PULL_WINDOW_OPEN && now.time < PULL_WINDOW_CLOSE;
}

// ---- loader -----------------------------------------------------------------

function finiteOrNull(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(num) ? num : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizeBar(value: unknown): SpxBar | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const time = finiteOrNull(record.time);
  const open = finiteOrNull(record.open);
  const high = finiteOrNull(record.high);
  const low = finiteOrNull(record.low);
  const close = finiteOrNull(record.close);
  if (time === null || open === null || high === null || low === null || close === null) return null;
  return { time, timestampEt: asString(record.timestampEt), label: asString(record.label), open, high, low, close };
}

function emptyPayload(note: string): SpxLiveBarsPayload {
  return { generatedAt: new Date().toISOString(), session: "", source: "none", live: false, barSize: "1 min", asOf: null, bars: [], note };
}

export async function loadSpxLiveBars(appRoot: string): Promise<SpxLiveBarsPayload> {
  const filePath = path.join(appRoot, "data", DATA_FILE);
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch {
    return emptyPayload("No live SPX bar feed yet — start it from the Estimator (it also auto-starts ~09:28 ET on weekdays).");
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const bars = Array.isArray(parsed.bars)
      ? parsed.bars
          .map(sanitizeBar)
          .filter((bar): bar is SpxBar => bar !== null)
          .sort((a, b) => a.time - b.time)
      : [];
    return {
      generatedAt: asString(parsed.generatedAt, new Date().toISOString()),
      session: asString(parsed.session),
      source: asString(parsed.source, "unknown"),
      live: Boolean(parsed.live),
      barSize: asString(parsed.barSize, "1 min"),
      asOf: bars.length > 0 ? bars[bars.length - 1].label : null,
      bars,
    };
  } catch (error) {
    return emptyPayload(`Live SPX bars could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---- process manager --------------------------------------------------------

let activeChild: ChildProcessWithoutNullStreams | null = null;
let startedAt: string | null = null;
let lastExit: { code: number | null; at: string } | null = null;
let autoStartLastFiredDate: string | null = null;
let autoStartTimer: ReturnType<typeof setInterval> | null = null;
const logTail: string[] = [];

function pushLog(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed.trim()) logTail.push(trimmed);
  }
  if (logTail.length > LOG_TAIL_MAX) logTail.splice(0, logTail.length - LOG_TAIL_MAX);
}

function cleanLogTail(): string[] {
  return logTail
    .filter((line) => !/Error (210[0-9]|2119|2158|2150)\b/.test(line))
    .filter((line) => !line.includes("farm connection is OK"))
    .slice(-18);
}

export async function getSpxLiveBarsStatus(): Promise<SpxLiveBarsLiveStatus> {
  return {
    running: activeChild !== null,
    pid: activeChild?.pid ?? null,
    startedAt,
    lastExit,
    logTail: cleanLogTail(),
    script: LIVE_SCRIPT,
    python: LIVE_PYTHON,
    available: await pathExists(LIVE_SCRIPT),
    autoStartEt: AUTO_START_ENABLED ? AUTO_START_TIME : null,
    autoStartLastFiredDate,
    marketOpen: isSpxBarsMarketWindow(),
  };
}

// Arm the daily auto-start. Idempotent; ticks every 30s and only fires within a
// 5-min window of AUTO_START_TIME on weekdays so a midday boot doesn't spawn a
// feed for a long-missed open.
export function armSpxLiveBarsAutoStart(): void {
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
    if (activeChild) return;
    pushLog(`[${new Date().toISOString()}] auto-start firing for ${now.date} ${now.time} ET`);
    startSpxLiveBars().catch((err) => pushLog(`auto-start error: ${(err as Error).message}`));
  }, 30_000);
  autoStartTimer.unref?.();
}

export async function startSpxLiveBars(opts: { clientId?: number; ports?: string } = {}): Promise<SpxLiveBarsLiveStatus> {
  if (activeChild) return getSpxLiveBarsStatus();
  if (!isSpxBarsMarketWindow()) {
    pushLog(`[${new Date().toISOString()}] start refused: market closed — the feed only pulls ${PULL_WINDOW_OPEN}–${PULL_WINDOW_CLOSE} ET, Mon–Fri`);
    return getSpxLiveBarsStatus();
  }
  if (!(await pathExists(LIVE_SCRIPT))) {
    pushLog(`error: SPX live-bars script not found at ${LIVE_SCRIPT}`);
    return getSpxLiveBarsStatus();
  }

  const clientId = Number.isFinite(opts.clientId) ? Number(opts.clientId) : DEFAULT_CLIENT_ID;
  const ports = opts.ports?.trim() || DEFAULT_PORTS;
  const args = [LIVE_SCRIPT, "--ports", ports, "--client-id", String(clientId)];

  startedAt = new Date().toISOString();
  lastExit = null;
  logTail.length = 0;
  pushLog(`[${startedAt}] launching ${LIVE_PYTHON} refresh-spx-live-bars.py --ports ${ports} --client-id ${clientId}`);

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
    pushLog(`[${lastExit.at}] SPX live-bars feed exited with code ${code ?? "unknown"}`);
    logStream.end();
    activeChild = null;
  });
  child.on("error", (error) => {
    pushLog(`error: ${error.message}`);
    lastExit = { code: null, at: new Date().toISOString() };
    logStream.end();
    activeChild = null;
  });

  return getSpxLiveBarsStatus();
}

export async function stopSpxLiveBars(): Promise<SpxLiveBarsLiveStatus> {
  if (activeChild) {
    pushLog("stop requested");
    activeChild.kill();
  }
  return getSpxLiveBarsStatus();
}
