import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpreadSpeedFrame, SpreadSpeedPayload, SpxLiveBarsLiveStatus } from "../shared/types.ts";
import { easternClock, timeDeltaMinutes, type EasternClock } from "./easternClock.ts";
import { pathExists } from "./jsonStore.ts";
import { buildFrame, FAST, TARGET_NET_DELTA } from "./spreadSpeed.ts";
import { openRotatingLogStream } from "./logRotation.ts";

// Live SPXW 0DTE Signal-Stack feed. A long-running ib_insync process
// (scripts/refresh-spx-0dte-chain.py) snapshots SPX spot + an at-the-money band
// of SPXW 0DTE call/put marks every ~15s and writes data/spx-0dte-chain.json.
// loadLiveSpreadSpeed() feeds that snapshot into the same engine the EOD path
// uses (buildFrame) so the Morning Signal Stack can show *today's* recommended
// credit spreads live. Kept fully separate from the SPX live-bars loop (own
// process, own client id 948, own file) so the two don't contend.
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(serverDir, "..");
const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(APP_ROOT, "..");
const VENV_PYTHON = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull", ".venv", "Scripts", "python.exe");
const LIVE_SCRIPT = path.join(APP_ROOT, "scripts", "refresh-spx-0dte-chain.py");
const LIVE_PYTHON =
  process.env.SPREAD_SPEED_LIVE_PYTHON ??
  process.env.SPX_LIVE_BARS_PYTHON ??
  process.env.SPX_HEATMAP_PYTHON ??
  (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python");
const LIVE_LOG = path.join(APP_ROOT, "data", "spx-0dte-chain-feed.log");
const DATA_FILE = "spx-0dte-chain.json";
const DEFAULT_PORTS = process.env.SPREAD_SPEED_LIVE_PORTS ?? process.env.SPX_LIVE_BARS_PORTS ?? process.env.SPX_HEATMAP_PORTS ?? "7496,4001";
const DEFAULT_CLIENT_ID = Number(process.env.SPREAD_SPEED_LIVE_CLIENT_ID ?? 948);
const LOG_TAIL_MAX = 60;
// Snapshots refresh ~15s; treat anything older than 3 min as stale so a crashed
// or wound-down feed degrades to the EOD fallback rather than showing dead picks.
const STALE_MS = 180_000;

const AUTO_START_ENABLED = String(process.env.SPREAD_SPEED_LIVE_AUTO_START ?? "true").toLowerCase() !== "false";
const AUTO_START_TIME = process.env.SPREAD_SPEED_LIVE_AUTO_START_TIME ?? "09:28";

// Same RTH window as the other live feeds: weekday 09:25–16:00 ET.
const PULL_WINDOW_OPEN = "09:25";
const PULL_WINDOW_CLOSE = "16:00";

export function isSpreadSpeedLiveMarketWindow(now: EasternClock = easternClock()): boolean {
  if (now.weekday < 1 || now.weekday > 5) return false;
  return now.time >= PULL_WINDOW_OPEN && now.time < PULL_WINDOW_CLOSE;
}

// ---- loader -----------------------------------------------------------------

type ChainRow = { strike: number; right: "C" | "P"; close: number };

function finiteOrNull(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(num) ? num : null;
}

function sanitizeRow(value: unknown): ChainRow | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const strike = finiteOrNull(record.strike);
  const close = finiteOrNull(record.close);
  const right = String(record.right ?? "").toUpperCase();
  if (strike === null || close === null || close <= 0 || (right !== "C" && right !== "P")) return null;
  return { strike, right: right as "C" | "P", close };
}

function emptyLivePayload(date: string, note: string): SpreadSpeedPayload {
  return {
    date,
    generatedAt: new Date().toISOString(),
    available: false,
    note,
    targetNetDelta: TARGET_NET_DELTA,
    fastThreshold: FAST,
    frames: [],
    requestedDate: date,
    fallback: false,
    live: true,
  };
}

// Read the live snapshot sidecar and assemble a single current spread-speed frame
// via the shared engine. Returns available:false (with a reason) whenever the
// feed is missing, stale, or too thin to build an ATM straddle — the caller then
// falls back to the EOD payload.
export async function loadLiveSpreadSpeed(appRoot: string): Promise<SpreadSpeedPayload> {
  const today = easternClock().date;
  const filePath = path.join(appRoot, "data", DATA_FILE);
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch {
    return emptyLivePayload(today, "No live SPXW 0DTE feed yet — start it from the Signal Stack (it also auto-starts ~09:28 ET on weekdays).");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    return emptyLivePayload(today, `Live 0DTE chain could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const session = typeof parsed.session === "string" && parsed.session ? parsed.session : today;
  const asOf = typeof parsed.asOf === "string" ? parsed.asOf : null;
  const asOfMs = asOf ? Date.parse(asOf) : NaN;
  if (Number.isFinite(asOfMs) && Date.now() - asOfMs > STALE_MS) {
    return emptyLivePayload(session, "Live 0DTE snapshot is stale; falling back to the last completed session.");
  }

  const spot = finiteOrNull(parsed.spot);
  const rows = Array.isArray(parsed.rows) ? parsed.rows.map(sanitizeRow).filter((row): row is ChainRow => row !== null) : [];
  if (spot === null || rows.length === 0) {
    return emptyLivePayload(session, "Live 0DTE snapshot has no usable SPX spot or option marks yet.");
  }

  const calls = new Map<number, number>();
  const puts = new Map<number, number>();
  for (const row of rows) {
    (row.right === "C" ? calls : puts).set(row.strike, row.close);
  }

  const label = typeof parsed.label === "string" && parsed.label ? parsed.label : easternClock().time;
  const frame: SpreadSpeedFrame | null = buildFrame(label, spot, calls, puts);
  if (!frame) {
    return emptyLivePayload(session, "Could not assemble an ATM straddle from the live snapshot.");
  }

  return {
    date: session,
    generatedAt: new Date().toISOString(),
    available: true,
    note: "",
    targetNetDelta: TARGET_NET_DELTA,
    fastThreshold: FAST,
    frames: [frame],
    requestedDate: session,
    fallback: false,
    live: true,
  };
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

export async function getSpreadSpeedLiveStatus(): Promise<SpxLiveBarsLiveStatus> {
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
    marketOpen: isSpreadSpeedLiveMarketWindow(),
  };
}

// Arm the daily auto-start. Idempotent; ticks every 30s and only fires within a
// 5-min window of AUTO_START_TIME on weekdays so a midday boot doesn't spawn a
// feed for a long-missed open.
export function armSpreadSpeedLiveAutoStart(): void {
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
    startSpreadSpeedLive().catch((err) => pushLog(`auto-start error: ${(err as Error).message}`));
  }, 30_000);
  autoStartTimer.unref?.();
}

export async function startSpreadSpeedLive(opts: { clientId?: number; ports?: string } = {}): Promise<SpxLiveBarsLiveStatus> {
  if (activeChild) return getSpreadSpeedLiveStatus();
  if (!isSpreadSpeedLiveMarketWindow()) {
    pushLog(`[${new Date().toISOString()}] start refused: market closed — the feed only pulls ${PULL_WINDOW_OPEN}–${PULL_WINDOW_CLOSE} ET, Mon–Fri`);
    return getSpreadSpeedLiveStatus();
  }
  if (!(await pathExists(LIVE_SCRIPT))) {
    pushLog(`error: SPXW 0DTE chain script not found at ${LIVE_SCRIPT}`);
    return getSpreadSpeedLiveStatus();
  }

  const clientId = Number.isFinite(opts.clientId) ? Number(opts.clientId) : DEFAULT_CLIENT_ID;
  const ports = opts.ports?.trim() || DEFAULT_PORTS;
  const args = [LIVE_SCRIPT, "--ports", ports, "--client-id", String(clientId)];

  startedAt = new Date().toISOString();
  lastExit = null;
  logTail.length = 0;
  pushLog(`[${startedAt}] launching ${LIVE_PYTHON} refresh-spx-0dte-chain.py --ports ${ports} --client-id ${clientId}`);

  const logStream = await openRotatingLogStream(LIVE_LOG);
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
    pushLog(`[${lastExit.at}] SPXW 0DTE chain feed exited with code ${code ?? "unknown"}`);
    logStream.end();
    activeChild = null;
  });
  child.on("error", (error) => {
    pushLog(`error: ${error.message}`);
    lastExit = { code: null, at: new Date().toISOString() };
    logStream.end();
    activeChild = null;
  });

  return getSpreadSpeedLiveStatus();
}

export async function stopSpreadSpeedLive(): Promise<SpxLiveBarsLiveStatus> {
  if (activeChild) {
    pushLog("stop requested");
    activeChild.kill();
  }
  return getSpreadSpeedLiveStatus();
}
