import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { easternClock, timeDeltaMinutes } from "./easternClock.ts";
import { showLiveUpdateDesktopToast } from "./desktopAlert.ts";

// Daily pre-market check for S&P 500 / Nasdaq-100 reconstitutions. Runs
// scripts/reconcile-index-membership.py (detect adds/drops, auto-place new names by
// sector into the auto-overlay the loader merges under the curated taxonomy), and on a
// real change fires a toast + forces a fresh universe pull so the new member actually
// enters the map before the 09:28 ET live feed reuses the payload.

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(serverDir, "..");
const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(APP_ROOT, "..");
const VENV_PYTHON = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull", ".venv", "Scripts", "python.exe");
// Both scripts are stdlib-only; prefer the venv python if present (consistent with the feed).
const PYTHON = process.env.SPX_HEATMAP_PYTHON ?? (fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python");
const RECONCILE_SCRIPT = path.join(APP_ROOT, "scripts", "reconcile-index-membership.py");
const FEED_SCRIPT = path.join(APP_ROOT, "scripts", "refresh-spx-heatmap.py");
const RECONCILE_LOG = path.join(APP_ROOT, "data", "index-reconcile.log");

const ENABLED = String(process.env.RUBICON_INDEX_RECONCILE ?? "true").toLowerCase() !== "false";
// Fire pre-market, before the 09:28 ET heatmap auto-start, so classifications + a fresh
// universe are ready when the live feed loads.
const RECONCILE_TIME = process.env.RUBICON_INDEX_RECONCILE_TIME ?? "09:15";

const INDEX_LABELS: Record<string, string> = { spx: "S&P 500", qqq: "Nasdaq-100" };

export type ReconcileAdd = { symbol: string; sector: string; industry: string; via: string };
export type ReconcileDrop = { symbol: string };
export type ReconcileIndexResult = {
  added?: ReconcileAdd[];
  dropped?: ReconcileDrop[];
  bootstrapped?: boolean;
  gate?: string;
  reason?: string;
};
export type ReconcileOutcome = {
  ok: boolean;
  applied: boolean;
  gate: string;
  indexes: Record<string, ReconcileIndexResult>;
  error?: string;
};

export type ReconcileToast = { title: string; body: string; detail: string };
export type ReconcilePlan = { toast: ReconcileToast | null; freshPull: boolean };

// Pure decision: given the reconcile outcome, what should the server do?
//   • gate-blocked / error → "review manually" toast, NO fresh pull (keep prior universe)
//   • real adds/drops       → summary toast + fresh universe pull
//   • no change / bootstrap → nothing
export function planReconcileActions(outcome: ReconcileOutcome): ReconcilePlan {
  if (!outcome.ok || outcome.gate === "blocked") {
    const reasons = Object.entries(outcome.indexes ?? {})
      .filter(([, r]) => r.gate === "blocked")
      .map(([idx, r]) => `${INDEX_LABELS[idx] ?? idx}: ${r.reason ?? "blocked"}`);
    return {
      toast: {
        title: "Index reconstitution: review manually",
        body: outcome.error ? `Reconcile error: ${outcome.error}` : reasons.join(" · ") || "Suspicious membership delta — not applied.",
        detail: "A source delta tripped the safety gate; the heatmap kept its prior universe.",
      },
      freshPull: false,
    };
  }
  const segments: string[] = [];
  const needsSector: string[] = [];
  let changed = false;
  for (const [idx, r] of Object.entries(outcome.indexes ?? {})) {
    const added = r.added ?? [];
    const dropped = r.dropped ?? [];
    if (!added.length && !dropped.length) continue;
    changed = true;
    const parts: string[] = [];
    for (const a of added) {
      parts.push(`+${a.symbol} (${a.sector})`);
      if (a.via === "no-sector") needsSector.push(a.symbol);
    }
    for (const d of dropped) parts.push(`−${d.symbol}`); // − minus sign
    segments.push(`${INDEX_LABELS[idx] ?? idx}: ${parts.join(" ")}`);
  }
  if (!changed) return { toast: null, freshPull: false };
  const detailBits = ["New names placed by sector — set their industry in finviz-classification.json."];
  if (needsSector.length) detailBits.unshift(`No sector yet (set manually): ${needsSector.join(", ")}.`);
  return {
    toast: { title: "Index reconstitution", body: segments.join("  |  "), detail: detailBits.join(" ") },
    freshPull: true,
  };
}

export type ReconcileDeps = {
  runReconcile: () => Promise<ReconcileOutcome>;
  toast: (payload: ReconcileToast) => void;
  freshPull: () => void;
};

// Run one reconcile cycle and act on the plan. Pure-ish: all side effects are injected
// so the schedule/decision can be unit-tested without spawning python or firing toasts.
export async function runIndexReconcileOnce(deps: ReconcileDeps): Promise<ReconcilePlan> {
  let outcome: ReconcileOutcome;
  try {
    outcome = await deps.runReconcile();
  } catch (err) {
    outcome = { ok: false, applied: false, gate: "error", indexes: {}, error: (err as Error).message };
  }
  const plan = planReconcileActions(outcome);
  if (plan.toast) deps.toast(plan.toast);
  if (plan.freshPull) deps.freshPull();
  return plan;
}

// --- real side effects ---

function spawnReconcileScript(): Promise<ReconcileOutcome> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [RECONCILE_SCRIPT, "--indexes", "spx,qqq", "--apply"], { cwd: APP_ROOT, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-8000);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.on("error", (error) => resolve({ ok: false, applied: false, gate: "error", indexes: {}, error: error.message }));
    child.on("close", () => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
      try {
        resolve(JSON.parse(line) as ReconcileOutcome);
      } catch {
        resolve({ ok: false, applied: false, gate: "error", indexes: {}, error: `unparseable reconcile output: ${(stderr || stdout).slice(-200)}` });
      }
    });
  });
}

// Force a fresh universe into the payload the live feed reuses (--source yahoo is the
// only mode that re-pulls SSGA + Slickcharts and rewrites both spx/qqq-heatmap.json).
function spawnFreshUniversePull(): void {
  try {
    fs.mkdirSync(path.dirname(RECONCILE_LOG), { recursive: true });
    const out = fs.openSync(RECONCILE_LOG, "a");
    const child = spawn(PYTHON, [FEED_SCRIPT, "--source", "yahoo", "--indexes", "spx,qqq"], {
      cwd: APP_ROOT,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", out, out],
    });
    child.unref();
  } catch {
    // best-effort; a missed fresh pull just delays the new member to the next refresh
  }
}

function fireReconcileToast(payload: ReconcileToast): void {
  try {
    showLiveUpdateDesktopToast(payload, APP_ROOT);
  } catch {
    // toast is best-effort; the changelog still records the change
  }
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconcileLastFiredDate: string | null = null;

// Arm the daily pre-market reconcile. Mirrors armSpxHeatmapLiveAutoStart: 30s tick,
// once per weekday within a 5-min window of RECONCILE_TIME so a midday boot doesn't
// re-fire a long-missed run.
export function armIndexReconcileAutoRun(): void {
  if (!ENABLED || reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    const now = easternClock();
    if (now.weekday < 1 || now.weekday > 5) return;
    if (reconcileLastFiredDate === now.date) return;
    if (now.time < RECONCILE_TIME) return;
    if (timeDeltaMinutes(now.time, RECONCILE_TIME) > 5) {
      reconcileLastFiredDate = now.date;
      return;
    }
    reconcileLastFiredDate = now.date;
    void runIndexReconcileOnce({
      runReconcile: spawnReconcileScript,
      toast: fireReconcileToast,
      freshPull: spawnFreshUniversePull,
    }).catch(() => {});
  }, 30_000);
  reconcileTimer.unref?.();
}
