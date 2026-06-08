import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DailySyncCatchupStatus } from "../shared/types.ts";
import { refreshDailySyncDerivedState } from "./dailySync.ts";
import { readJson } from "./jsonStore.ts";

const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..");
const IBKR_TRADES_ROOT = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull", "data", "ibkr_trades");
const CATCHUP_LOOKBACK_DATES = 5;

let inFlight: Promise<DailySyncCatchupStatus> | null = null;
let lastStatus: DailySyncCatchupStatus = {
  attempted: false,
  generatedAt: new Date().toISOString(),
  message: "Daily sync catch-up has not run in this server process.",
  ok: true,
  refreshedDates: [],
};
const seenSignatures = new Set<string>();

async function mtimeMs(filePath: string): Promise<number | null> {
  try {
    return (await fsp.stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

async function latestSummaryDates(limit = CATCHUP_LOOKBACK_DATES): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(IBKR_TRADES_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, limit);
}

async function ingestIsStale(date: string): Promise<{ signature: string; stale: boolean }> {
  const dayDir = path.join(IBKR_TRADES_ROOT, date);
  const summaryPath = path.join(dayDir, "daily_sync_summary.json");
  const summaryMtime = await mtimeMs(summaryPath);
  if (summaryMtime === null) {
    return { signature: `${date}:missing`, stale: false };
  }

  const cachePath = path.join(dayDir, "rubicon_tracker_summary.json");
  const cache = await readJson<{ source?: { dailySyncSummaryMtimeMs?: number } } | null>(cachePath, null);
  const cacheMtime = await mtimeMs(cachePath);
  const signature = `${date}:${summaryMtime}`;
  const stale = !cacheMtime || cacheMtime < summaryMtime || cache?.source?.dailySyncSummaryMtimeMs !== summaryMtime;
  return { signature, stale };
}

async function runCatchup(): Promise<DailySyncCatchupStatus> {
  const generatedAt = new Date().toISOString();
  const warnings: string[] = [];
  const refreshedDates: string[] = [];
  const dates = await latestSummaryDates();

  for (const date of dates) {
    const freshness = await ingestIsStale(date);
    if (!freshness.stale || seenSignatures.has(freshness.signature)) {
      continue;
    }
    seenSignatures.add(freshness.signature);
    const result = await refreshDailySyncDerivedState({ backfillSpxHeatmap: false, date });
    refreshedDates.push(date);
    warnings.push(...result.warnings);
  }

  lastStatus = {
    attempted: true,
    generatedAt,
    message: refreshedDates.length
      ? `Refreshed stale Rubicon ingest outputs for ${refreshedDates.join(", ")}.`
      : "Rubicon ingest outputs are current for recent daily sync summaries.",
    ok: warnings.length === 0,
    refreshedDates,
    warnings: warnings.length ? warnings : undefined,
  };
  return lastStatus;
}

export function getDailySyncCatchupStatus(): DailySyncCatchupStatus {
  return lastStatus;
}

export async function maybeRunDailySyncCatchup(): Promise<DailySyncCatchupStatus> {
  if (!inFlight) {
    inFlight = runCatchup().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
