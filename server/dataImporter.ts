import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type {
  DailySummary,
  DailyReviewNote,
  DataIssue,
  OpenInterestPoint,
  ReplayPayload,
  SourceHealth,
  SpxBar,
  SpreadLeg,
  SpreadMark,
  TrackerSnapshot,
  TradeReviewFlag,
  TradeRecord,
  UploadReceiptCheckEvidence,
  VolumePoint,
  WalletSnapshot,
} from "../shared/types.ts";
import { googleSheetsRefreshSourceHealth, type GoogleSnapshotRefreshRuntimeStatus } from "./googleSheetsSnapshot.ts";
import { ibkrWalletRefreshSourceHealth } from "./ibkrWalletRefresh.ts";
import { dailySyncSourceHealth } from "./dailySync.ts";
import { firstExistingPath, mtimeMs, pathExists, readJson, writeJsonAtomic } from "./jsonStore.ts";
import { loadMissingRubiconDailySummary, loadOrBuildRubiconDailySummary } from "./trackerSummary.ts";

const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..");
const GOOGLE_SHEET_ID = "1w0S_DNJJ6ZhcSGB0qEtkBxsVLxQk0prVPqnV9t-WvtE";
const GOOGLE_SHEET_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`;
const GOOGLE_CSV_PROBE_SHEET = "Daily Sync Runs";
const GOOGLE_EXPORT_PROBE_TIMEOUT_MS = 3000;
const GOOGLE_DRIVE_SNAPSHOT_STALE_HOURS = 24;
const IBKR_ROOT = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull");
export const IBKR_TRADES_ROOT = path.join(IBKR_ROOT, "data", "ibkr_trades");
const WALLET_PATH = path.join(process.cwd(), "data", "wallet.json");
const ENTRY_CHART_MARK_MAX_AGE_SECONDS = 90;
const ENTRY_CHART_DEVIATION_ABS_THRESHOLD = 0.1;
const ENTRY_CHART_DEVIATION_REL_THRESHOLD = 0.25;
const DEFAULT_TRACKER_SNAPSHOT_CACHE_TTL_MS = 30_000;
const REPLAY_SAFE_STATE_FILE = "rubicon_replay_safe_state.json";
const REPLAY_SAFE_STATE_SCHEMA = "rubicon-replay-safe-state";
const REPLAY_SAFE_STATE_VERSION = 4;

type CsvRow = Record<string, string>;

type JsonRecord = Record<string, unknown>;

type TrackerSnapshotLoadOptions = {
  googleAutoRefreshStatus?: GoogleSnapshotRefreshRuntimeStatus;
};

type ReplayPayloadLoadOptions = {
  mode?: "safe" | "full";
  refreshSafeState?: boolean;
};

type ReplaySafeStateSourceFile = {
  path: string | null;
  mtimeMs: number | null;
};

type ReplaySafeStateSource = Record<"entries" | "spx" | "spreadMarks" | "openInterest" | "volume", ReplaySafeStateSourceFile>;

type ReplaySafeStateCache = {
  generatedAt: string;
  payload: ReplayPayload;
  projection: {
    spxBars: string;
    spreadMarks: string;
    volume: string;
  };
  schema: typeof REPLAY_SAFE_STATE_SCHEMA;
  source: ReplaySafeStateSource;
  version: typeof REPLAY_SAFE_STATE_VERSION;
};

let trackerSnapshotCache: { expiresAt: number; snapshot: TrackerSnapshot } | null = null;
let trackerSnapshotInFlight: Promise<TrackerSnapshot> | null = null;
let reviewNotesWriteQueue: Promise<unknown> = Promise.resolve();

function trackerSnapshotCacheTtlMs(): number {
  const parsed = Number(process.env.RUBICON_TRACKER_SNAPSHOT_CACHE_TTL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TRACKER_SNAPSHOT_CACHE_TTL_MS;
}

export function invalidateTrackerSnapshotCache(): void {
  trackerSnapshotCache = null;
  trackerSnapshotInFlight = null;
}

function replayReadyFromSummary(summary?: DailySummary): boolean {
  return Boolean(summary && ((summary.spxIntradayRowCount ?? 0) > 0 || summary.spxStatus === "up_to_date"));
}

function replayMarketDataDetail(latest: string | undefined, summary?: DailySummary): string {
  if (!latest) {
    return "No dated replay folders found.";
  }

  if (summary?.spxIntradayRowCount) {
    const barSize = summary.spxIntradayBarSize ? `${summary.spxIntradayBarSize}, ` : "";
    return `Latest replay date: ${latest} (${barSize}${summary.spxIntradayRowCount} SPX rows from compact summary).`;
  }

  return `Latest replay date: ${latest}.`;
}

type GoogleDriveTrackerSheet = {
  sheetId?: number;
  title?: string;
  rowCount?: number;
  columnCount?: number;
};

export type GoogleDriveTrackerSnapshot = {
  source?: string;
  readAt?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  title?: string;
  timeZone?: string;
  sheets?: GoogleDriveTrackerSheet[];
  dailySyncRuns?: JsonRecord[];
};

export type GoogleDriveReceiptChecksSnapshot = {
  source?: string;
  checkedAt?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  sheetName?: string;
  scannedRange?: string;
  checks?: JsonRecord[];
};

type OptionLegBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  vwap?: number;
  volume?: number;
  count?: number;
};

export type SpreadLegBarInput = OptionLegBar & {
  symbol: string;
  dir: number;
  ratio: number;
};

export async function readCsv(target: string): Promise<CsvRow[]> {
  if (!(await pathExists(target))) {
    return [];
  }

  const raw = await fs.readFile(target, "utf8");
  if (!raw.trim()) {
    return [];
  }

  return parse(raw, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as CsvRow[];
}

export async function readFirstCsv(candidates: string[]): Promise<CsvRow[]> {
  for (const candidate of candidates) {
    const rows = await readCsv(candidate);
    if (rows.length) {
      return rows;
    }
  }
  return [];
}

export function optionLegTradeCsvCandidates(date: string): string[] {
  return [
    path.join(IBKR_TRADES_ROOT, date, "ibkr_option_intraday", "option_leg_trades_5s.csv"),
    path.join(IBKR_TRADES_ROOT, date, "ibkr_option_intraday", "option_leg_trades_1m.csv"),
  ];
}

export function spxIntradayTabCandidates(): { csvName: string; sheetName: string }[] {
  return [
    { csvName: "SPX_5s.csv", sheetName: "SPX 5s" },
    { csvName: "SPX_1m.csv", sheetName: "SPX 1m" },
  ];
}

export function safeSpxCsvCandidates(date: string): string[] {
  const dayDir = path.join(IBKR_TRADES_ROOT, date);
  return [
    path.join(dayDir, "google_sheet_tab_csvs", "SPX_5s.csv"),
    path.join(dayDir, "google_sheet_tab_csvs", "SPX_1m.csv"),
    path.join(dayDir, "ibkr_option_intraday", "underlying_1m.csv"),
    path.join(dayDir, "google_sheet_tab_csvs", "IBKR_Underlying_1m.csv"),
  ];
}

function spreadMarkCsvCandidates(date: string): string[] {
  const dayDir = path.join(IBKR_TRADES_ROOT, date);
  return [
    path.join(dayDir, "google_sheet_tab_csvs", "IBKR_Spread_Trade_Marks.csv"),
    path.join(dayDir, "ibkr_option_intraday", "spread_trade_marks_5s.csv"),
    path.join(dayDir, "ibkr_option_intraday", "spread_trade_marks_1m.csv"),
  ];
}

export function volumeProfileCsvCandidates(date: string): string[] {
  return [
    path.join(IBKR_TRADES_ROOT, date, "google_sheet_tab_csvs", "IBKR_0DTE_SPX_Cumulative_Volume_Profile_5s.csv"),
    path.join(IBKR_TRADES_ROOT, date, "google_sheet_tab_csvs", "IBKR_0DTE_SPX_Cumulative_Volume_Profile_1m.csv"),
  ];
}

export function googleSheetCsvExportUrl(sheetName: string, spreadsheetId = GOOGLE_SHEET_ID): string {
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet: sheetName,
  });
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?${params.toString()}`;
}

function googleExportProbeEnabled(): boolean {
  return !["0", "false", "off"].includes(String(process.env.SPX_GOOGLE_EXPORT_PROBE ?? "1").toLowerCase());
}

function looksLikeCsv(contentType: string, body: string): boolean {
  const head = body.slice(0, 400).toLowerCase();
  return contentType.includes("text/csv") || contentType.includes("application/octet-stream") || (!head.includes("<html") && body.includes(","));
}

function countCsvRows(body: string): number {
  try {
    return parse(body, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }).length;
  } catch {
    return Math.max(0, body.trim().split(/\r?\n/).length - 1);
  }
}

export async function probeGoogleSheetCsvExport(fetchImpl: typeof fetch = globalThis.fetch): Promise<SourceHealth> {
  const url = googleSheetCsvExportUrl(GOOGLE_CSV_PROBE_SHEET);

  if (!googleExportProbeEnabled()) {
    return {
      label: "Google CSV export probe",
      status: "warning",
      detail: "Direct Google CSV export probe is disabled by SPX_GOOGLE_EXPORT_PROBE=0; local AI STUFF mirrors remain active.",
      url,
    };
  }

  if (!fetchImpl) {
    return {
      label: "Google CSV export probe",
      status: "missing",
      detail: "Runtime fetch is unavailable, so direct Google CSV export cannot be tested.",
      url,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_EXPORT_PROBE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const body = await response.text();
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

    if (!response.ok) {
      return {
        label: "Google CSV export probe",
        status: "warning",
        detail: `Direct Google CSV export returned HTTP ${response.status} ${response.statusText || "error"}; Google auth is required before the desktop app can import raw tracker tabs directly.`,
        url,
      };
    }

    if (!looksLikeCsv(contentType, body)) {
      return {
        label: "Google CSV export probe",
        status: "warning",
        detail: "Direct Google CSV export returned non-CSV content, likely a Google auth or sharing page. Local AI STUFF mirrors remain active.",
        url,
      };
    }

    const rowCount = countCsvRows(body);
    return {
      label: "Google CSV export probe",
      status: "ok",
      detail: `${GOOGLE_CSV_PROBE_SHEET} CSV export is readable without a browser session; ${rowCount} rows sampled from the tracker.`,
      count: rowCount,
      url,
    };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError"
      ? `Direct Google CSV export timed out after ${GOOGLE_EXPORT_PROBE_TIMEOUT_MS}ms; local AI STUFF mirrors remain active.`
      : `Direct Google CSV export failed: ${error instanceof Error ? error.message : String(error)}. Local AI STUFF mirrors remain active.`;
    return {
      label: "Google CSV export probe",
      status: "warning",
      detail,
      url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function reconcileGoogleCsvProbeWithApi(csvProbe: SourceHealth, apiRefresh: SourceHealth): SourceHealth {
  if (apiRefresh.status !== "ok" || csvProbe.status !== "warning") {
    return csvProbe;
  }

  const detail = csvProbe.detail.toLowerCase();
  const isPrivateSheetAuthGate =
    detail.includes("401") ||
    detail.includes("unauthorized") ||
    detail.includes("google auth") ||
    detail.includes("auth or sharing page");

  if (!isPrivateSheetAuthGate) {
    return csvProbe;
  }

  return {
    ...csvProbe,
    status: "ok",
    detail:
      "Private-sheet CSV export is blocked without a browser Google session, which is expected. Authenticated Google Sheets API refresh is configured and is the desktop app's live Google import path.",
  };
}

async function readPayloadTabRows(date: string, sheetName: string): Promise<CsvRow[]> {
  const payload = await readJson<JsonRecord>(path.join(IBKR_TRADES_ROOT, date, "google_sheet_upload_payload.json"), {});
  const tab = asArray(payload.tabs)
    .map(asRecord)
    .find((nextTab) => String(nextTab.sheet_name ?? "") === sheetName);
  if (!tab) {
    return [];
  }

  const headers = asArray(tab.headers).map((header) => String(header));
  if (!headers.length) {
    return [];
  }

  return asArray(tab.rows).map((row) => {
    const values = asArray(row);
    const record: CsvRow = {};
    headers.forEach((header, index) => {
      const value = values[index];
      record[header] = value === null || value === undefined ? "" : String(value);
    });
    return record;
  });
}

async function readCsvOrPayloadTab(date: string, csvName: string, sheetName: string): Promise<CsvRow[]> {
  const csvRows = await readCsv(path.join(IBKR_TRADES_ROOT, date, "google_sheet_tab_csvs", csvName));
  return csvRows.length ? csvRows : readPayloadTabRows(date, sheetName);
}

async function readCsvOrPayloadTabCandidates(date: string, candidates: { csvName: string; sheetName: string }[]): Promise<CsvRow[]> {
  for (const candidate of candidates) {
    const rows = await readCsvOrPayloadTab(date, candidate.csvName, candidate.sheetName);
    if (rows.length) {
      return rows;
    }
  }
  return [];
}

function replaySafeStatePath(date: string): string {
  return path.join(IBKR_TRADES_ROOT, date, REPLAY_SAFE_STATE_FILE);
}

async function replaySafeStateSource(date: string): Promise<ReplaySafeStateSource> {
  const dayDir = path.join(IBKR_TRADES_ROOT, date);
  const sourcePaths = {
    entries: path.join(dayDir, "entries.csv"),
    spx: await firstExistingPath(safeSpxCsvCandidates(date)),
    spreadMarks: await firstExistingPath(spreadMarkCsvCandidates(date)),
    openInterest: path.join(dayDir, "google_sheet_tab_csvs", "IBKR_0DTE_SPX_Open_Interest.csv"),
    volume: await firstExistingPath(volumeProfileCsvCandidates(date)),
  };

  return {
    entries: { path: sourcePaths.entries, mtimeMs: await mtimeMs(sourcePaths.entries) },
    spx: { path: sourcePaths.spx, mtimeMs: await mtimeMs(sourcePaths.spx) },
    spreadMarks: { path: sourcePaths.spreadMarks, mtimeMs: await mtimeMs(sourcePaths.spreadMarks) },
    openInterest: { path: sourcePaths.openInterest, mtimeMs: await mtimeMs(sourcePaths.openInterest) },
    volume: { path: sourcePaths.volume, mtimeMs: await mtimeMs(sourcePaths.volume) },
  };
}

function sameReplaySafeStateSource(left: ReplaySafeStateSource, right: ReplaySafeStateSource): boolean {
  return (Object.keys(left) as Array<keyof ReplaySafeStateSource>).every(
    (key) => left[key].path === right[key]?.path && left[key].mtimeMs === right[key]?.mtimeMs,
  );
}

function isReplaySafeStateCache(value: ReplaySafeStateCache | null, source: ReplaySafeStateSource): value is ReplaySafeStateCache {
  return Boolean(
    value &&
      value.schema === REPLAY_SAFE_STATE_SCHEMA &&
      value.version === REPLAY_SAFE_STATE_VERSION &&
      value.payload &&
      sameReplaySafeStateSource(value.source, source),
  );
}

function replayPayloadWithSelectedTrade(payload: ReplayPayload, selectedTradeId?: string): ReplayPayload {
  const sanitized = sanitizeReplayPayload(payload);
  return {
    ...sanitized,
    selectedTradeId: selectedTradeId || sanitized.quickTrades[0]?.id || null,
  };
}

function sanitizeReplayPayload(payload: ReplayPayload): ReplayPayload {
  return {
    ...payload,
    spreadMarks: sanitizeSpreadMarksForTrades(payload.spreadMarks, payload.quickTrades),
  };
}

function googleDriveTrackerSnapshotPath(): string {
  return process.env.SPX_GOOGLE_DRIVE_TRACKER_SNAPSHOT_PATH ?? path.join(process.cwd(), "data", "google-drive-tracker-snapshot.json");
}

function googleDriveReceiptChecksPath(): string {
  return process.env.SPX_GOOGLE_RECEIPT_CHECKS_PATH ?? path.join(process.cwd(), "data", "google-drive-receipt-checks.json");
}

export async function readGoogleDriveTrackerSnapshot(): Promise<GoogleDriveTrackerSnapshot | null> {
  const snapshot = await readJson<GoogleDriveTrackerSnapshot | null>(googleDriveTrackerSnapshotPath(), null);
  if (!snapshot || (!snapshot.spreadsheetId && !snapshot.spreadsheetUrl && !snapshot.dailySyncRuns?.length)) {
    return null;
  }
  return snapshot;
}

export async function readGoogleDriveReceiptChecks(): Promise<GoogleDriveReceiptChecksSnapshot | null> {
  const snapshot = await readJson<GoogleDriveReceiptChecksSnapshot | null>(googleDriveReceiptChecksPath(), null);
  if (!snapshot || !snapshot.checks?.length) {
    return null;
  }
  return snapshot;
}

function googleDriveSnapshotStaleHours(): number {
  const configured = Number(process.env.SPX_GOOGLE_DRIVE_SNAPSHOT_STALE_HOURS);
  return Number.isFinite(configured) && configured > 0 ? configured : GOOGLE_DRIVE_SNAPSHOT_STALE_HOURS;
}

export function googleDriveSnapshotFreshness(
  snapshot: GoogleDriveTrackerSnapshot | null,
  now = new Date(),
  staleHours = googleDriveSnapshotStaleHours(),
  requiredReadAfter?: { timestamp?: string; label: string; receiptDate?: string },
): { ageHours: number | null; detail: string; isFresh: boolean; status: SourceHealth["status"] } {
  if (!snapshot) {
    return {
      ageHours: null,
      detail: "No connector snapshot found at data/google-drive-tracker-snapshot.json; local mirrors and public CSV probe remain active.",
      isFresh: false,
      status: "warning",
    };
  }

  if (!snapshot.readAt) {
    return {
      ageHours: null,
      detail: `${snapshot.title ?? "Tracker"} connector snapshot has no readAt timestamp; refresh it before trusting today's Google upload receipts.`,
      isFresh: false,
      status: "warning",
    };
  }

  const readAt = Date.parse(snapshot.readAt);
  const nowTime = now.getTime();
  if (!Number.isFinite(readAt) || !Number.isFinite(nowTime)) {
    return {
      ageHours: null,
      detail: `${snapshot.title ?? "Tracker"} connector snapshot has an unreadable readAt value (${snapshot.readAt}); refresh it before trusting today's Google upload receipts.`,
      isFresh: false,
      status: "warning",
    };
  }

  const ageHours = Math.max(0, (nowTime - readAt) / 3_600_000);
  const rowCount = snapshot.dailySyncRuns?.length ?? 0;
  const detailPrefix = `${snapshot.title ?? "Tracker"} read through Google Drive connector at ${snapshot.readAt}; ${rowCount} Daily Sync Runs rows captured`;
  const requiredReadAfterTime = requiredReadAfter?.timestamp ? Date.parse(requiredReadAfter.timestamp) : Number.NaN;
  const requiredReadAfterLabel = requiredReadAfter?.label ?? "the latest staged payload";
  const requiredReceiptDate = requiredReadAfter?.receiptDate;
  if (Number.isFinite(requiredReadAfterTime) && readAt < requiredReadAfterTime) {
    return {
      ageHours,
      detail: `${detailPrefix}. Snapshot is fresh by age but predates ${requiredReadAfterLabel}; refresh the connector snapshot before trusting today's Google upload receipts.`,
      isFresh: false,
      status: "warning",
    };
  }

  if (requiredReceiptDate && !snapshotContainsTrackerUploadReceipt(snapshot, requiredReceiptDate)) {
    return {
      ageHours,
      detail: `${detailPrefix}. Snapshot was read after ${requiredReadAfterLabel} but did not include a completed ${requiredReceiptDate} tracker upload row; Google upload remains unconfirmed.`,
      isFresh: false,
      status: "warning",
    };
  }

  if (ageHours > staleHours) {
    return {
      ageHours,
      detail: `${detailPrefix}. Snapshot is ${ageHours.toFixed(1)}h old, beyond the ${staleHours}h freshness window; refresh before relying on today's upload receipts.`,
      isFresh: false,
      status: "warning",
    };
  }

  return {
    ageHours,
    detail: `${detailPrefix}. Snapshot is fresh (${ageHours.toFixed(1)}h old).`,
    isFresh: true,
    status: "ok",
  };
}

function snapshotContainsTrackerUploadReceipt(snapshot: GoogleDriveTrackerSnapshot, date: string): boolean {
  return (snapshot.dailySyncRuns ?? []).some((row) => {
    const record = asRecord(row);
    const rowDate = firstString(record.target_trade_date_et, record.date);
    const rawUploadGoogleSheetUrl = firstString(record.raw_upload_google_sheet_url, record.rawUploadGoogleSheetUrl);
    const googleUploadStatus = firstString(record.google_upload_status, record.googleUploadStatus);
    return rowDate === date && (Boolean(rawUploadGoogleSheetUrl) || googleUploadStatus === "complete" || googleUploadStatus === "uploaded");
  });
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function issue(stage: DataIssue["stage"], severity: DataIssue["severity"], title: string, detail: string, count?: number): DataIssue {
  return { stage, severity, title, detail, ...(count === undefined ? {} : { count }) };
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const clean = String(value ?? "")
    .replace(/\((.*)\)/, "-$1")
    .replace(/[$,%]/g, "")
    .replace(/,/g, "")
    .trim();

  if (!clean || clean === "-") {
    return fallback;
  }

  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-") {
    return null;
  }
  return toNumber(raw, Number.NaN);
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = toNullableNumber(value);
    if (parsed !== null && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  const parsed = toNullableNumber(value);
  return parsed === null || !Number.isFinite(parsed) ? undefined : parsed;
}

function isoDateFromTimestamp(value: string): string {
  return value.slice(0, 10);
}

function chartTime(value: string): number {
  const normalized = value.includes("+0000") ? value.replace("+0000", "Z") : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return Math.floor(date.getTime() / 1000);
}

function timeLabel(value: string): string {
  const match = value.match(/T(\d{2}:\d{2})/);
  if (match) {
    return match[1];
  }
  const fallback = value.match(/\s(\d{2}:\d{2})/);
  return fallback ? fallback[1] : value.slice(11, 16);
}

function parseLegs(spreadKey: string, legsText: string): SpreadLeg[] {
  try {
    const parsed = JSON.parse(spreadKey) as Array<{
      local_symbol?: string;
      right?: "C" | "P";
      strike?: number | string;
      abs_ratio?: number | string;
    }>;

    return parsed.map((leg) => ({
      localSymbol: leg.local_symbol ?? "",
      right: leg.right ?? "",
      strike: toNumber(leg.strike),
      ratio: toNumber(leg.abs_ratio, 1),
    }));
  } catch {
    const matches = [...legsText.matchAll(/SPXW\s+\d{6}([CP])0*(\d+)/g)];
    return matches.map((match) => ({
      localSymbol: match[0],
      right: match[1] as "C" | "P",
      strike: toNumber(match[2]) / 1000,
      ratio: 1,
    }));
  }
}

function strategyLabel(spreadClass: string): string {
  const labels: Record<string, string> = {
    call_credit_vertical: "Call Credit Spread",
    put_credit_vertical: "Put Credit Spread",
    call_debit_vertical: "Call Debit Spread",
    put_debit_vertical: "Put Debit Spread",
  };
  return labels[spreadClass] ?? spreadClass.replaceAll("_", " ");
}

function inferSide(spreadClass: string, legs: SpreadLeg[]): TradeRecord["side"] {
  if (spreadClass.includes("call") || legs.every((leg) => leg.right === "C")) {
    return "Call";
  }
  if (spreadClass.includes("put") || legs.every((leg) => leg.right === "P")) {
    return "Put";
  }
  return "Mixed";
}

function inferBias(spreadClass: string): TradeRecord["bias"] {
  if (spreadClass === "put_credit_vertical" || spreadClass === "call_debit_vertical") {
    return "Bullish";
  }
  if (spreadClass === "call_credit_vertical" || spreadClass === "put_debit_vertical") {
    return "Bearish";
  }
  return "Neutral";
}

function strikePair(legs: SpreadLeg[], spreadClass: string): { shortStrike: number | null; longStrike: number | null } {
  if (legs.length < 2) {
    return { shortStrike: null, longStrike: null };
  }

  const strikes = legs.map((leg) => leg.strike).filter((strike) => Number.isFinite(strike));
  if (strikes.length < 2) {
    return { shortStrike: null, longStrike: null };
  }

  if (spreadClass.includes("credit")) {
    return spreadClass.includes("put")
      ? { shortStrike: Math.max(...strikes), longStrike: Math.min(...strikes) }
      : { shortStrike: Math.min(...strikes), longStrike: Math.max(...strikes) };
  }

  return spreadClass.includes("put")
    ? { shortStrike: Math.min(...strikes), longStrike: Math.max(...strikes) }
    : { shortStrike: Math.max(...strikes), longStrike: Math.min(...strikes) };
}

function widthFromLegs(legs: SpreadLeg[]): number {
  const strikes = legs.map((leg) => leg.strike).filter((strike) => Number.isFinite(strike));
  if (strikes.length < 2) {
    return 0;
  }
  return Math.abs(Math.max(...strikes) - Math.min(...strikes));
}

function optionRight(value: string): "C" | "P" {
  return value === "C" ? "C" : "P";
}

function splitLegSymbols(value: string): string[] {
  return value
    .split("|")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
}

function normalizeTrade(row: CsvRow, source: string): TradeRecord {
  const spreadClass = row.spread_class ?? "";
  const legs = parseLegs(row.spread_key ?? "", row.legs ?? "");
  const side = inferSide(spreadClass, legs);
  const { shortStrike, longStrike } = strikePair(legs, spreadClass);
  const width = widthFromLegs(legs);
  const contracts = Math.abs(toNumber(row.entry_quantity));
  const entryPrice = toNumber(row.entry_price);
  const exitPrice = toNullableNumber(row.exit_price);
  const entryFees = toNumber(row.total_commission);
  const exitFees = toNumber(row.exit_total_commission);
  const fees = entryFees + exitFees;
  const priceType = String(row.entry_credit_debit).toLowerCase() === "debit" ? "Debit" : "Credit";
  const realizedExit = exitPrice ?? entryPrice;
  const pnl = exitPrice === null ? 0 : (realizedExit - entryPrice) * contracts * 100 - fees;
  const maxRisk =
    priceType === "Credit"
      ? Math.max(0, (width - Math.abs(entryPrice)) * contracts * 100 + fees)
      : Math.max(0, Math.abs(entryPrice) * contracts * 100 + fees);
  const maxProfit =
    priceType === "Credit"
      ? Math.max(0, Math.abs(entryPrice) * contracts * 100 - fees)
      : Math.max(0, (width - Math.abs(entryPrice)) * contracts * 100 - fees);
  const status = row.lifecycle_status || "Open";
  const winLoss = status === "Open" ? "Open" : pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Flat";
  const returnOnRisk = maxRisk > 0 ? pnl / maxRisk : null;
  const date = row.target_trade_date_et || isoDateFromTimestamp(row.entry_time_et ?? "");
  const id = `IBKR-${row.perm_id}-${row.entry_sequence}`;

  return {
    id,
    account: row.account ?? "",
    date,
    status,
    side,
    strategy: strategyLabel(spreadClass),
    bias: inferBias(spreadClass),
    entryTime: row.entry_time_et ?? "",
    exitTime: row.exit_time_et || null,
    expiration: row.expiration_date || date,
    shortStrike,
    longStrike,
    width,
    contracts,
    positionBefore: toNumber(row.position_before),
    positionAfter: toNumber(row.position_after),
    entryPrice,
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    exitPrice,
    priceType,
    fees,
    maxRisk,
    maxProfit,
    pnl,
    returnOnRisk,
    winLoss,
    spxEntry: null,
    spxExit: toNullableNumber(row.expiration_spx_close),
    legs,
    notes: [row.entry_action, row.legs, row.expiration_note].filter(Boolean).join("; "),
    source,
  };
}

export async function tradeDates(): Promise<string[]> {
  if (!(await pathExists(IBKR_TRADES_ROOT))) {
    return [];
  }

  const entries = await fs.readdir(IBKR_TRADES_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

type TradeLoadOptions = {
  includeReplayMarks?: boolean;
};

async function loadTradesForDate(date: string, options: TradeLoadOptions = {}): Promise<TradeRecord[]> {
  const dayDir = path.join(IBKR_TRADES_ROOT, date);
  const rows = await readCsv(path.join(dayDir, "entries.csv"));
  const trades = rows.map((row) => normalizeTrade(row, path.join(dayDir, "entries.csv"))).filter(isSpxSpreadTrade);
  if (!options.includeReplayMarks) {
    return trades;
  }

  const [spxBars, spreadMarks] = await Promise.all([loadSpxBars(date), loadSpreadMarks(date)]);
  const checkedTrades = withEntryChartChecks(trades, spreadMarks);

  if (!spxBars.length) {
    return checkedTrades;
  }

  return checkedTrades.map((trade) => ({
    ...trade,
    spxEntry: closestSpxClose(spxBars, trade.entryTime),
    spxExit: trade.spxExit ?? closestSpxClose(spxBars, trade.exitTime ?? ""),
  }));
}

function withEntryChartChecks(trades: TradeRecord[], spreadMarks: SpreadMark[]): TradeRecord[] {
  const marksByTrade = new Map<string, SpreadMark[]>();
  for (const mark of spreadMarks) {
    const marks = marksByTrade.get(mark.tradeId) ?? [];
    marks.push(mark);
    marksByTrade.set(mark.tradeId, marks);
  }

  return trades.map((trade) => {
    if (!isCreditSpreadEntryCheckCandidate(trade)) {
      return trade;
    }

    const entryTime = chartTime(trade.entryTime);
    const mark = closestEntrySpreadMark(marksByTrade.get(trade.id) ?? [], entryTime);
    if (!mark) {
      return trade;
    }

    const deviation = Number((trade.entryPrice - mark.value).toFixed(4));
    const absDeviation = Math.abs(deviation);
    const deviationPct = absDeviation / Math.max(Math.abs(mark.value), 0.05);
    const range = spreadRange(mark);

    return {
      ...trade,
      entryChartDeviation: deviation,
      entryChartDeviationFlag:
        absDeviation + Number.EPSILON >= ENTRY_CHART_DEVIATION_ABS_THRESHOLD &&
        deviationPct + Number.EPSILON >= ENTRY_CHART_DEVIATION_REL_THRESHOLD,
      entryChartDeviationPct: Number(deviationPct.toFixed(4)),
      entryChartMark: mark.value,
      entryChartMarkTime: mark.timestampEt,
      entryChartRangeHigh: range?.high ?? null,
      entryChartRangeLow: range?.low ?? null,
      entryChartWithinRange: range ? trade.entryPrice >= range.low - 0.005 && trade.entryPrice <= range.high + 0.005 : null,
    };
  });
}

function isCreditSpreadEntryCheckCandidate(trade: TradeRecord): boolean {
  return trade.priceType === "Credit" && (trade.strategy === "Call Credit Spread" || trade.strategy === "Put Credit Spread");
}

function closestEntrySpreadMark(marks: SpreadMark[], entryTime: number): SpreadMark | null {
  if (!marks.length || !entryTime) {
    return null;
  }

  let closest = marks[0];
  let distance = Math.abs(closest.time - entryTime);
  for (const mark of marks) {
    const nextDistance = Math.abs(mark.time - entryTime);
    if (nextDistance < distance) {
      closest = mark;
      distance = nextDistance;
    }
  }

  return distance <= ENTRY_CHART_MARK_MAX_AGE_SECONDS ? closest : null;
}

function spreadRange(mark: SpreadMark): { low: number; high: number } | null {
  const values = [mark.open, mark.high, mark.low, mark.close, mark.value].filter((value): value is number => Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  return {
    high: Math.max(...values),
    low: Math.min(...values),
  };
}

function closestSpxClose(bars: SpxBar[], timestamp: string): number | null {
  const target = chartTime(timestamp);
  if (!target) {
    return null;
  }
  let closest = bars[0];
  let distance = Math.abs(closest.time - target);
  for (const bar of bars) {
    const nextDistance = Math.abs(bar.time - target);
    if (nextDistance < distance) {
      closest = bar;
      distance = nextDistance;
    }
  }
  return closest.close;
}

async function loadDailySummary(date: string): Promise<DailySummary> {
  const dayDir = path.join(IBKR_TRADES_ROOT, date);
  const compactSummary = await loadOrBuildRubiconDailySummary(dayDir);
  return compactSummary ?? loadMissingRubiconDailySummary(dayDir);
}

function connectorRowsByDate(snapshot: GoogleDriveTrackerSnapshot | null): Map<string, JsonRecord> {
  const rows = new Map<string, JsonRecord>();
  for (const row of snapshot?.dailySyncRuns ?? []) {
    const date = firstString(row.target_trade_date_et, row.date);
    if (date) {
      rows.set(date, row);
    }
  }
  return rows;
}

export function mergeGoogleDriveDailySyncSummaries(
  summaries: DailySummary[],
  snapshot: GoogleDriveTrackerSnapshot | null,
): DailySummary[] {
  const rows = connectorRowsByDate(snapshot);
  if (!rows.size) {
    return summaries;
  }

  return summaries.map((summary) => {
    const row = rows.get(summary.date);
    if (!row) {
      return summary;
    }

    const rawUploadGoogleSheetUrl = firstString(row.raw_upload_google_sheet_url, row.rawUploadGoogleSheetUrl, summary.rawUploadGoogleSheetUrl);
    const googleUploadStatus = firstString(row.google_upload_status, row.googleUploadStatus);
    const connectorReceiptFound = Boolean(rawUploadGoogleSheetUrl && !summary.rawUploadGoogleSheetUrl);
    const connectorTrackerUploadFound = connectorReceiptFound || googleUploadStatus === "complete" || googleUploadStatus === "uploaded";
    const issues = summary.issues.filter((nextIssue) => !["Live Google upload not confirmed", "Google tracker upload not confirmed"].includes(nextIssue.title));
    if (connectorTrackerUploadFound) {
      issues.push(
        issue(
          "upload",
          "info",
          "Google tracker upload confirmed",
          rawUploadGoogleSheetUrl
            ? `Google Drive connector snapshot found a historical raw workbook link ${rawUploadGoogleSheetUrl}.`
            : "Google Drive connector snapshot found a completed tracker upload row.",
        ),
      );
    }

    return {
      ...summary,
      fillCount: firstNumber(summary.fillCount, row.fill_count),
      generatedAtLocal: firstString(summary.generatedAtLocal, row.generated_at_local),
      issueCount: issues.filter((nextIssue) => nextIssue.severity !== "info").length,
      issues,
      optionContractCount: firstNumber(summary.optionContractCount, row.option_contract_count),
      optionIntradayContractCount: firstNumber(summary.optionIntradayContractCount, row.ibkr_option_contract_count),
      optionIntradayBarSize: firstString(summary.optionIntradayBarSize, row.ibkr_option_bar_size, row.ibkr_option_intraday_bar_size),
      optionIntradayExpectedRows: firstNumber(summary.optionIntradayExpectedRows, row.ibkr_option_expected_rows),
      optionIntradayExpectedRowsPerContract: firstNumber(summary.optionIntradayExpectedRowsPerContract, row.ibkr_option_expected_rows_per_contract),
      optionIntradayRowCount: firstNumber(summary.optionIntradayRowCount, row.ibkr_option_leg_trade_rows),
      optionIntradayStatus: firstString(summary.optionIntradayStatus, row.ibkr_option_trade_status) ?? summary.optionIntradayStatus,
      openInterestExpectedRows: firstNumber(summary.openInterestExpectedRows, row.ibkr_open_interest_contract_count),
      openInterestRowCount: firstNumber(summary.openInterestRowCount, row.ibkr_open_interest_rows),
      openInterestValidRowCount: firstNumber(summary.openInterestValidRowCount, row.ibkr_open_interest_ok_count),
      rawUploadGoogleSheetUrl,
      spxIntradayBarSize: firstString(summary.spxIntradayBarSize, row.spx_bar_size, row.spx_intraday_bar_size),
      spxIntradayRowCount: firstNumber(summary.spxIntradayRowCount, row.spx_rows, row.spx_intraday_rows, row.spx_1m_rows),
      spxStatus: firstString(summary.spxStatus, row.spx_status) ?? summary.spxStatus,
      spreadCount: firstNumber(summary.spreadCount, row.spread_count),
      spreadMarkRowCount: firstNumber(summary.spreadMarkRowCount, row.spread_mark_rows),
      tradeCount: firstNumber(summary.tradeCount, row.fill_count),
      tradeStatus: firstString(summary.tradeStatus, row.trade_status) ?? summary.tradeStatus,
      tradedOptionContractCount: firstNumber(summary.tradedOptionContractCount, row.option_contract_count),
      underlyingIntradayExpectedRows: firstNumber(summary.underlyingIntradayExpectedRows, row.ibkr_underlying_1m_expected_rows),
      underlyingIntradayRowCount: firstNumber(summary.underlyingIntradayRowCount, row.ibkr_underlying_1m_rows),
      underlyingIntradayStatus: firstString(summary.underlyingIntradayStatus, row.ibkr_underlying_1m_status),
      underlyingIntradaySymbolCount: firstNumber(summary.underlyingIntradaySymbolCount, row.ibkr_underlying_1m_symbol_count),
      volumeProfileRowCount: firstNumber(summary.volumeProfileRowCount, row.volume_profile_rows),
      uploadReceiptReadAt: connectorTrackerUploadFound ? snapshot?.readAt : summary.uploadReceiptReadAt,
      uploadReceiptSource: connectorTrackerUploadFound ? "Google Drive connector snapshot" : summary.uploadReceiptSource,
      uploadStatus: connectorTrackerUploadFound ? "uploaded" : summary.uploadStatus,
    };
  });
}

function normalizeReceiptCheck(snapshot: GoogleDriveReceiptChecksSnapshot, row: JsonRecord): { date: string; evidence: UploadReceiptCheckEvidence } | null {
  const date = firstString(row.date, row.target_trade_date_et, row.targetTradeDateEt);
  if (!date) {
    return null;
  }

  const matchedRowCount = toOptionalNumber(row.matchedRowCount ?? row.matched_row_count);
  const status = firstString(row.status) ?? (matchedRowCount && matchedRowCount > 0 ? "found" : "unknown");
  const knownStatuses = new Set<UploadReceiptCheckEvidence["status"]>([
    "found",
    "missing_receipt_row",
    "quota_limited",
    "error",
    "unknown",
  ]);
  const normalizedStatus = knownStatuses.has(status as UploadReceiptCheckEvidence["status"])
    ? (status as UploadReceiptCheckEvidence["status"])
    : "unknown";
  const source = firstString(row.source, snapshot.source) ?? "Google Drive connector row search";
  const checkedAt = firstString(row.checkedAt, row.checked_at, snapshot.checkedAt);
  const scannedRange = firstString(row.scannedRange, row.scanned_range, snapshot.scannedRange);
  const detail =
    firstString(row.detail) ??
    (normalizedStatus === "missing_receipt_row"
      ? `${source} found no Daily Sync Runs row for ${date}${checkedAt ? ` at ${checkedAt}` : ""}.`
      : `${source} recorded ${normalizedStatus} for ${date}${checkedAt ? ` at ${checkedAt}` : ""}.`);

  return {
    date,
    evidence: {
      checkedAt,
      detail,
      matchedRowCount,
      scannedRange,
      source,
      status: normalizedStatus,
      url: firstString(row.url, snapshot.spreadsheetUrl, GOOGLE_SHEET_URL),
    },
  };
}

function receiptChecksByDate(snapshot: GoogleDriveReceiptChecksSnapshot | null): Map<string, UploadReceiptCheckEvidence> {
  const checks = new Map<string, UploadReceiptCheckEvidence>();
  if (!snapshot) {
    return checks;
  }

  for (const row of snapshot.checks ?? []) {
    const normalized = normalizeReceiptCheck(snapshot, asRecord(row));
    if (normalized) {
      checks.set(normalized.date, normalized.evidence);
    }
  }
  return checks;
}

export function mergeGoogleDriveReceiptChecks(
  summaries: DailySummary[],
  snapshot: GoogleDriveReceiptChecksSnapshot | null,
): DailySummary[] {
  const checks = receiptChecksByDate(snapshot);
  if (!checks.size) {
    return summaries;
  }

  return summaries.map((summary) => {
    const uploadReceiptCheck = checks.get(summary.date);
    if (!uploadReceiptCheck) {
      return summary;
    }

    const issues = [...summary.issues];
    const needsReceiptWarning = !summary.rawUploadGoogleSheetUrl && uploadReceiptCheck.status !== "found";
    if (needsReceiptWarning && !issues.some((nextIssue) => nextIssue.title === "Connector receipt row not found")) {
      issues.push(
        issue(
          "upload",
          uploadReceiptCheck.status === "error" || uploadReceiptCheck.status === "quota_limited" ? "error" : "warning",
          "Connector receipt row not found",
          uploadReceiptCheck.detail,
          uploadReceiptCheck.matchedRowCount,
        ),
      );
    }

    return {
      ...summary,
      issueCount: issues.filter((nextIssue) => nextIssue.severity !== "info").length,
      issues,
      uploadReceiptCheck,
    };
  });
}

export async function readWallet(): Promise<WalletSnapshot> {
  const fromFile = await readJson<WalletSnapshot | null>(WALLET_PATH, null);
  if (fromFile) {
    return fromFile;
  }

  const fromAccountSnapshot = await readWalletFromAccountSnapshot();
  if (fromAccountSnapshot) {
    return fromAccountSnapshot;
  }

  const envValue = toNullableNumber(process.env.IBKR_WALLET_SIZE);
  if (envValue !== null) {
    return {
      netLiquidation: envValue,
      source: "IBKR_WALLET_SIZE",
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    netLiquidation: null,
    source: "not_configured",
    updatedAt: null,
  };
}

async function readWalletFromAccountSnapshot(): Promise<WalletSnapshot | null> {
  const seen = new Set<string>();
  const candidates = [
    process.env.IBKR_ACCOUNT_SNAPSHOT_PATH,
    path.join(IBKR_ROOT, "data", "ibkr_account_snapshot.json"),
    path.join(IBKR_ROOT, "data", "account_snapshot.json"),
    path.join(IBKR_TRADES_ROOT, "ibkr_account_snapshot_latest.json"),
    path.join(IBKR_TRADES_ROOT, "account_snapshot_latest.json"),
    path.join(IBKR_TRADES_ROOT, "account_summary_latest.json"),
    path.join(IBKR_TRADES_ROOT, "ibkr_account_snapshot_latest.csv"),
    path.join(IBKR_TRADES_ROOT, "account_snapshot_latest.csv"),
    path.join(IBKR_TRADES_ROOT, "account_summary_latest.csv"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const target = path.resolve(candidate);
    if (seen.has(target)) {
      continue;
    }
    seen.add(target);
    if (!(await pathExists(target))) {
      continue;
    }

    const source = process.env.IBKR_ACCOUNT_SNAPSHOT_PATH && path.resolve(process.env.IBKR_ACCOUNT_SNAPSHOT_PATH) === target
      ? "IBKR_ACCOUNT_SNAPSHOT_PATH"
      : `AI_STUFF:${path.basename(target)}`;
    const payload = target.toLowerCase().endsWith(".csv")
      ? await readCsv(target)
      : await readJson<unknown>(target, null);
    const wallet = parseWalletSnapshotPayload(payload, source);
    if (wallet) {
      return wallet;
    }
  }

  return null;
}

function parseWalletSnapshotPayload(payload: unknown, source: string): WalletSnapshot | null {
  const record = asRecord(payload);
  const accountValues = asRecord(record.account_values ?? record.accountValues ?? record.values);
  const directNetLiquidation = toNullableNumber(
    record.netLiquidation ??
      record.net_liquidation ??
      record.NetLiquidation ??
      record.walletSize ??
      record.wallet_size ??
      accountValues.NetLiquidation ??
      accountValues.netLiquidation ??
      accountValues.net_liquidation,
  );
  const baseUpdatedAt =
    firstString(record.updatedAt, record.updated_at, record.fetchedAt, record.fetched_at, record.timestamp, record.timestamp_et) ?? null;
  const baseAccount = firstString(record.account, record.accountId, record.account_id);

  if (directNetLiquidation !== null) {
    return {
      netLiquidation: directNetLiquidation,
      source,
      updatedAt: baseUpdatedAt,
      account: baseAccount,
    };
  }

  const rows = [
    ...asArray(payload),
    ...asArray(record.account_summary),
    ...asArray(record.accountSummary),
    ...asArray(record.summary),
    ...asArray(record.rows),
  ];

  for (const row of rows) {
    const next = asRecord(row);
    const tag = firstString(next.tag, next.Tag, next.name, next.Name, next.key, next.Key);
    if (!tag || !isNetLiquidationTag(tag)) {
      continue;
    }
    const value = toNullableNumber(next.value ?? next.Value ?? next.amount ?? next.Amount ?? next.balance ?? next.Balance);
    if (value === null) {
      continue;
    }
    return {
      netLiquidation: value,
      source,
      updatedAt:
        firstString(next.updatedAt, next.updated_at, next.fetchedAt, next.fetched_at, next.timestamp, next.timestamp_et) ?? baseUpdatedAt,
      account: firstString(next.account, next.Account, next.accountId, next.account_id) ?? baseAccount,
    };
  }

  return null;
}

function isNetLiquidationTag(value: string): boolean {
  return value.replace(/[\s_-]/g, "").toLowerCase() === "netliquidation";
}

function walletSourceDetail(wallet: WalletSnapshot): string {
  if (wallet.netLiquidation === null) {
    return "Wallet size is ready for manual local entry, IBKR_ACCOUNT_SNAPSHOT_PATH, AI STUFF account snapshot files, IBKR_WALLET_SIZE, or read-only TWS/Gateway refresh.";
  }

  const parts = [`Wallet loaded from ${wallet.source}`];
  if (wallet.account) {
    parts.push(`account ${wallet.account}`);
  }
  if (wallet.updatedAt) {
    parts.push(`updated ${wallet.updatedAt}`);
  }
  return `${parts.join(" - ")}.`;
}

function reviewNotesPath(): string {
  return process.env.REVIEW_NOTES_PATH || path.join(process.cwd(), "data", "review-notes.json");
}

const TRADE_REVIEW_FLAGS = new Set<TradeReviewFlag>(["follow_up", "mistake", "quality"]);

function normalizeTradeFlags(value: unknown): Record<string, TradeReviewFlag> {
  const flags: Record<string, TradeReviewFlag> = {};
  const record = asRecord(value);

  for (const [tradeId, rawFlag] of Object.entries(record)) {
    if (!tradeId || typeof rawFlag !== "string") {
      continue;
    }
    if (TRADE_REVIEW_FLAGS.has(rawFlag as TradeReviewFlag)) {
      flags[tradeId.slice(0, 160)] = rawFlag as TradeReviewFlag;
    }
  }

  return flags;
}

export async function readReviewNotes(): Promise<Record<string, DailyReviewNote>> {
  const raw = await readJson<JsonRecord>(reviewNotesPath(), {});
  const notes: Record<string, DailyReviewNote> = {};

  for (const [date, value] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue;
    }
    const record = asRecord(value);
    notes[date] = {
      date,
      note: String(record.note ?? ""),
      tradeFlags: normalizeTradeFlags(record.tradeFlags ?? record.trade_flags),
      updatedAt: firstString(record.updatedAt, record.updated_at) ?? null,
    };
  }

  return notes;
}

export async function writeReviewNote(date: string, note: string, tradeFlags?: unknown): Promise<DailyReviewNote> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date must be YYYY-MM-DD");
  }

  return enqueueReviewNotesWrite(async () => {
    const notes = await readReviewNotes();
    const nextNote: DailyReviewNote = {
      date,
      note: String(note ?? "").slice(0, 4000),
      tradeFlags: tradeFlags === undefined ? (notes[date]?.tradeFlags ?? {}) : normalizeTradeFlags(tradeFlags),
      updatedAt: new Date().toISOString(),
    };
    notes[date] = nextNote;
    await writeJsonAtomic(reviewNotesPath(), notes);
    invalidateTrackerSnapshotCache();
    return nextNote;
  });
}

export async function writeWallet(netLiquidation: number, account?: string): Promise<WalletSnapshot> {
  const snapshot: WalletSnapshot = {
    netLiquidation,
    source: "manual_local",
    updatedAt: new Date().toISOString(),
    account,
  };
  await writeJsonAtomic(WALLET_PATH, snapshot);
  invalidateTrackerSnapshotCache();
  return snapshot;
}

function enqueueReviewNotesWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = reviewNotesWriteQueue.then(write, write);
  reviewNotesWriteQueue = next.catch(() => undefined);
  return next;
}

async function buildTrackerSnapshot({
  googleAutoRefreshStatus,
}: TrackerSnapshotLoadOptions = {}): Promise<TrackerSnapshot> {
  const dates = await tradeDates();
  const tradeGroups = await Promise.all(dates.map((date) => loadTradesForDate(date)));
  const trades = tradeGroups.flat().sort((a, b) => a.entryTime.localeCompare(b.entryTime));
  const localSummaries = await Promise.all(dates.map(loadDailySummary));
  const googleDriveTrackerSnapshot = await readGoogleDriveTrackerSnapshot();
  const googleDriveReceiptChecks = await readGoogleDriveReceiptChecks();
  const summaries = mergeGoogleDriveReceiptChecks(
    mergeGoogleDriveDailySyncSummaries(localSummaries, googleDriveTrackerSnapshot),
    googleDriveReceiptChecks,
  );
  const latestTradeDate = dates.at(-1) ?? null;
  const wallet = await readWallet();
  const reviewNotes = await readReviewNotes();
  const sourceHealth = await buildSourceHealth(dates, trades, wallet, summaries, googleDriveTrackerSnapshot, googleAutoRefreshStatus);

  return {
    generatedAt: new Date().toISOString(),
    aiStuffRoot: AI_STUFF_ROOT,
    googleSheetUrl: GOOGLE_SHEET_URL,
    today: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    availableDates: dates,
    latestTradeDate,
    trades,
    dailySummaries: summaries,
    wallet,
    reviewNotes,
    sourceHealth,
  };
}

export async function loadTrackerSnapshot(options: TrackerSnapshotLoadOptions = {}): Promise<TrackerSnapshot> {
  const ttlMs = trackerSnapshotCacheTtlMs();
  const now = Date.now();
  if (ttlMs > 0 && trackerSnapshotCache && trackerSnapshotCache.expiresAt > now) {
    return trackerSnapshotCache.snapshot;
  }

  if (trackerSnapshotInFlight) {
    return trackerSnapshotInFlight;
  }

  trackerSnapshotInFlight = buildTrackerSnapshot(options)
    .then((snapshot) => {
      if (ttlMs > 0) {
        trackerSnapshotCache = {
          expiresAt: Date.now() + ttlMs,
          snapshot,
        };
      }
      return snapshot;
    })
    .finally(() => {
      trackerSnapshotInFlight = null;
    });

  return trackerSnapshotInFlight;
}

async function buildSourceHealth(
  dates: string[],
  trades: TradeRecord[],
  wallet: WalletSnapshot,
  summaries: DailySummary[],
  googleDriveTrackerSnapshot: GoogleDriveTrackerSnapshot | null,
  googleAutoRefreshStatus?: GoogleSnapshotRefreshRuntimeStatus,
): Promise<SourceHealth[]> {
  const uploadDoc = path.join(IBKR_ROOT, "SPX_GOOGLE_SHEET_UPLOAD.md");
  const trackerConfigured = await pathExists(uploadDoc);
  const latest = dates.at(-1);
  const latestSummary = latest ? summaries.find((summary) => summary.date === latest) : undefined;
  const latestReplayReady = replayReadyFromSummary(latestSummary);
  const stagedPayloadReady = Boolean(latestSummary?.payloadRows);
  const googleApiRefresh = googleSheetsRefreshSourceHealth(process.env, googleAutoRefreshStatus);
  const googleCsvProbe = reconcileGoogleCsvProbeWithApi(await probeGoogleSheetCsvExport(), googleApiRefresh);
  const ibkrWalletRefreshHealth = await ibkrWalletRefreshSourceHealth();
  const dailySyncHealth = await dailySyncSourceHealth();
  const connectorFreshness = googleDriveSnapshotFreshness(
    googleDriveTrackerSnapshot,
    new Date(),
    googleDriveSnapshotStaleHours(),
    latestSummary?.uploadStatus === "uploaded"
      ? undefined
      : {
          timestamp: latestSummary?.generatedAtLocal,
          label: `the latest staged payload for ${latestSummary?.date}`,
          receiptDate: latestSummary?.date,
        },
  );

  return [
    {
      label: "SPX Spread Trade Tracker Google Sheet",
      status: trackerConfigured ? "ok" : "missing",
      detail: trackerConfigured
        ? "Tracker index is configured; the desktop app imports local AI STUFF mirrors and staged sheet payloads."
        : "Tracker configuration document was not found.",
      url: GOOGLE_SHEET_URL,
    },
    {
      label: "Google Drive connector snapshot",
      status: connectorFreshness.status,
      detail: connectorFreshness.detail,
      count: googleDriveTrackerSnapshot?.dailySyncRuns?.length ?? 0,
      url: googleDriveTrackerSnapshot?.spreadsheetUrl ?? GOOGLE_SHEET_URL,
    },
    googleApiRefresh,
    googleCsvProbe,
    {
      label: "Staged sheet payload",
      status: stagedPayloadReady ? "ok" : "warning",
      detail: latestSummary
        ? `${latestSummary.date}: ${latestSummary.uploadTabCount} tracker tab and ${latestSummary.payloadRows} tracker rows available locally.`
        : "No staged Google Sheet payload summary is available.",
      count: latestSummary?.payloadRows ?? 0,
    },
    {
      label: "Google tracker upload",
      status: latestSummary?.uploadStatus === "uploaded" ? "ok" : "warning",
      detail: latestSummary?.uploadStatus === "uploaded"
        ? "Daily Sync Runs and Trade Log rows are marked uploaded; raw archive workbooks are no longer part of the sync."
        : "Tracker upload has not been confirmed; local Rubicon review remains independent of Google.",
      url: latestSummary?.rawUploadGoogleSheetUrl,
    },
    {
      label: "AI STUFF IBKR trade mirror",
      status: trades.length ? "ok" : "warning",
      detail: trades.length ? `${trades.length} normalized entries across ${dates.length} date folders.` : "No entries.csv rows found.",
      count: trades.length,
    },
    {
      label: "Replay market data",
      status: latestReplayReady ? "ok" : "warning",
      detail: replayMarketDataDetail(latest, latestSummary),
    },
    dailySyncHealth,
    {
      label: "IBKR wallet",
      status: wallet.netLiquidation === null ? "warning" : "ok",
      detail: walletSourceDetail(wallet),
    },
    ibkrWalletRefreshHealth,
  ];
}

export async function loadSpxBars(date: string): Promise<SpxBar[]> {
  const rows = await readCsvOrPayloadTabCandidates(date, spxIntradayTabCandidates());
  return spxBarsFromRows(rows);
}

function spxBarsFromRows(rows: CsvRow[]): SpxBar[] {
  return rows
    .filter((row) => {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      return !symbol || symbol === "SPX";
    })
    .map((row) => ({
      time: chartTime(row.timestamp_et),
      timestampEt: row.timestamp_et,
      label: timeLabel(row.timestamp_et),
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
    }))
    .filter((row) => row.time && row.close)
    .sort((a, b) => a.time - b.time);
}

export async function loadSafeSpxBars(date: string): Promise<SpxBar[]> {
  return spxBarsFromRows(await readFirstCsv(safeSpxCsvCandidates(date)));
}

function spreadMarkFromRow(row: CsvRow): SpreadMark | null {
  const entrySequence = toNumber(row.entry_sequence);
  const permId = String(row.perm_id ?? "");
  const value = toNumber(row.spread_trade_mark);
  const close = toOptionalNumber(row.spread_close) ?? value;
  const time = chartTime(row.timestamp_et);
  if (!time || !permId) {
    return null;
  }
  return {
    tradeId: `IBKR-${permId}-${entrySequence}`,
    permId,
    entrySequence,
    timestampEt: row.timestamp_et,
    label: timeLabel(row.timestamp_et),
    time,
    value,
    open: toOptionalNumber(row.spread_open),
    high: toOptionalNumber(row.spread_high_est),
    low: toOptionalNumber(row.spread_low_est),
    close,
    vwap: toOptionalNumber(row.spread_vwap_est),
    staleLegCount: toOptionalNumber(row.stale_leg_count),
    activeLegCount: toOptionalNumber(row.active_leg_count),
    minLegVolume: toOptionalNumber(row.min_leg_volume),
    minLegCount: toOptionalNumber(row.min_leg_count),
    legSymbols: splitLegSymbols(row.leg_symbols ?? ""),
    source: row.source ?? "",
  };
}

async function loadSpreadMarks(date: string): Promise<SpreadMark[]> {
  const rows = await readCsvOrPayloadTab(date, "IBKR_Spread_Trade_Marks.csv", "IBKR Spread Trade Marks");
  return rows
    .map(spreadMarkFromRow)
    .filter((row): row is SpreadMark => row !== null)
    .sort((a, b) => a.time - b.time);
}

function isMinuteBoundary(timestampEt: string): boolean {
  const seconds = timestampEt.match(/T\d{2}:\d{2}:(\d{2})/)?.[1];
  return !seconds || seconds === "00";
}

function isFiveMinuteBoundary(timestampEt: string): boolean {
  const match = timestampEt.match(/T\d{2}:(\d{2})(?::(\d{2}))?/);
  if (!match) {
    return false;
  }
  const minute = Number(match[1]);
  const seconds = match[2] ?? "00";
  return Number.isFinite(minute) && minute % 5 === 0 && seconds === "00";
}

async function loadSafeSpreadMarks(date: string, tradeIds: Set<string>): Promise<SpreadMark[]> {
  const rows = await readFirstCsv(spreadMarkCsvCandidates(date));
  return rows
    .map(spreadMarkFromRow)
    .filter((row): row is SpreadMark => row !== null && tradeIds.has(row.tradeId) && isMinuteBoundary(row.timestampEt))
    .sort((a, b) => a.time - b.time);
}

// Trade-print marks past the close are pure forward-fill (expired 0DTE legs do
// not print after 16:00) — the upstream series carries a frozen phantom tail to
// ~16:14 on every spread.
const SPREAD_MARK_SESSION_CLOSE_HHMM = "16:00";
// A trade-print mark whose legs include a stale (non-printing) leg and which
// jumps more than this fraction of the vertical width versus the last trusted
// CO-PRINT mark is a fresh-print-paired-with-stale-print artifact, not a market
// move — the signature sawtooth that flips between ~0 and ~-width on ITM 0DTE
// spreads. Only co-print marks (staleLegCount 0) advance the trusted baseline,
// so stale noise cannot staircase the baseline away.
const SPREAD_MARK_STALE_FLIP_WIDTH_FRACTION = 0.25;

function spreadMarkEtHhmm(timestampEt: string): string {
  return timestampEt.length >= 16 ? timestampEt.slice(11, 16) : "";
}

function isTradePrintMarkSource(source: string): boolean {
  return source.includes("TRADES");
}

export function sanitizeSpreadMarksForTrades(spreadMarks: SpreadMark[], trades: TradeRecord[]): SpreadMark[] {
  if (!spreadMarks.length || !trades.length) {
    return spreadMarks;
  }
  const tradesById = new Map(trades.map((trade) => [trade.id, trade]));
  const clamped = spreadMarks.map((mark) => {
    const trade = tradesById.get(mark.tradeId);
    const bounds = trade ? spreadMarkBoundsForTrade(trade) : null;
    if (!bounds) {
      return mark;
    }

    const nextValue = clampSpreadMarkValue(mark.value, bounds);
    const nextOpen = clampOptionalSpreadMarkValue(mark.open, bounds);
    const nextHigh = clampOptionalSpreadMarkValue(mark.high, bounds);
    const nextLow = clampOptionalSpreadMarkValue(mark.low, bounds);
    const nextClose = clampOptionalSpreadMarkValue(mark.close, bounds);
    const nextVwap = clampOptionalSpreadMarkValue(mark.vwap, bounds);
    const changed =
      nextValue !== mark.value ||
      nextOpen !== mark.open ||
      nextHigh !== mark.high ||
      nextLow !== mark.low ||
      nextClose !== mark.close ||
      nextVwap !== mark.vwap;

    if (!changed) {
      return mark;
    }

    const rangeValues = [nextOpen, nextHigh, nextLow, nextClose, nextValue].filter((value): value is number => Number.isFinite(value));
    return {
      ...mark,
      close: nextClose,
      high: rangeValues.length ? Math.max(...rangeValues) : nextHigh,
      low: rangeValues.length ? Math.min(...rangeValues) : nextLow,
      open: nextOpen,
      source: appendSourceMarker(mark.source, "rubicon_width_clamped"),
      value: nextValue,
      vwap: nextVwap,
    };
  });

  // Sequential per-trade pass: drop the phantom post-close tail and carry the
  // last trusted value over stale-leg full-width flips. Quote/midpoint-sourced
  // marks are never touched — only the sparse-trade-print fallback misbehaves.
  const byTrade = new Map<string, SpreadMark[]>();
  for (const mark of clamped) {
    const list = byTrade.get(mark.tradeId);
    if (list) {
      list.push(mark);
    } else {
      byTrade.set(mark.tradeId, [mark]);
    }
  }

  const out: SpreadMark[] = [];
  for (const [tradeId, marks] of byTrade) {
    const trade = tradesById.get(tradeId);
    const width = trade && Number.isFinite(trade.width) && trade.width > 0 ? trade.width : null;
    marks.sort((a, b) => a.time - b.time);
    let lastTrusted: number | null = null;
    for (const mark of marks) {
      const hhmm = spreadMarkEtHhmm(mark.timestampEt);
      if (hhmm && hhmm > SPREAD_MARK_SESSION_CLOSE_HHMM) {
        continue;
      }
      const staleLegs = (mark.staleLegCount ?? 0) >= 1;
      if (
        width !== null &&
        staleLegs &&
        isTradePrintMarkSource(mark.source) &&
        lastTrusted !== null &&
        Math.abs(mark.value - lastTrusted) > width * SPREAD_MARK_STALE_FLIP_WIDTH_FRACTION
      ) {
        out.push({
          ...mark,
          value: lastTrusted,
          open: lastTrusted,
          high: lastTrusted,
          low: lastTrusted,
          close: lastTrusted,
          vwap: undefined,
          source: appendSourceMarker(mark.source, "rubicon_stale_leg_carry"),
        });
        continue;
      }
      out.push(mark);
      if (!staleLegs || !isTradePrintMarkSource(mark.source)) {
        lastTrusted = mark.value;
      }
    }
  }
  out.sort((a, b) => a.time - b.time || a.tradeId.localeCompare(b.tradeId));
  return out;
}

function spreadMarkBoundsForTrade(trade: TradeRecord): { lower: number; upper: number } | null {
  if (!Number.isFinite(trade.width) || trade.width <= 0) {
    return null;
  }
  if (trade.priceType === "Credit" || trade.strategy.includes("Credit")) {
    return { lower: -trade.width, upper: 0 };
  }
  if (trade.priceType === "Debit" || trade.strategy.includes("Debit")) {
    return { lower: 0, upper: trade.width };
  }
  return null;
}

function clampOptionalSpreadMarkValue(value: number | undefined, bounds: { lower: number; upper: number }): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? clampSpreadMarkValue(value, bounds) : value;
}

function clampSpreadMarkValue(value: number, bounds: { lower: number; upper: number }): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return Math.min(bounds.upper, Math.max(bounds.lower, value));
}

function appendSourceMarker(source: string, marker: string): string {
  return source.includes(marker) ? source : `${source}|${marker}`;
}

function normalizeSymbol(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function yyyymmdd(date: string): string {
  return date.replaceAll("-", "");
}

function dateDigits(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

function rowExpiryOrTradeDate(row: CsvRow): string {
  return dateDigits(firstString(
    row.last_trade_date_or_contract_month,
    row.expiration,
    row.expiration_date,
    row.target_trade_date_et,
  ));
}

function rowHasSpxRoot(row: CsvRow): boolean {
  const roots = [
    row.symbol,
    row.trading_class,
    row.underlying,
    row.underlying_symbol,
  ].map((value) => String(value ?? "").trim().toUpperCase()).filter(Boolean);
  return roots.length === 0 || roots.some((root) => root === "SPX" || root === "SPXW");
}

function rowHasOptionSideAndStrike(row: CsvRow): boolean {
  const right = String(row.right ?? "").trim().toUpperCase();
  return (right === "C" || right === "P") && toNumber(row.strike) > 0;
}

function isSpxOptionRow(row: CsvRow, date: string): boolean {
  const localSymbol = normalizeSymbol(row.local_symbol ?? "");
  const expectedExpiry = yyyymmdd(date);
  const rowExpiry = rowExpiryOrTradeDate(row);
  if (localSymbol.startsWith("SPXW ")) {
    return !rowExpiry || rowExpiry === expectedExpiry;
  }

  return rowExpiry === expectedExpiry && rowHasSpxRoot(row) && rowHasOptionSideAndStrike(row);
}

function isSpxSpreadTrade(trade: TradeRecord): boolean {
  return trade.legs.length >= 2 && trade.legs.every((leg) => normalizeSymbol(leg.localSymbol).startsWith("SPXW "));
}

// Reconstructs the spread mark for the bars BEFORE entry from the already-pulled
// per-leg option trades. New daily pulls use 5-second bars; older archives fall back
// to 1-minute bars.
async function loadPreEntrySpreadMarks(date: string, trade: TradeRecord): Promise<SpreadMark[]> {
  if (trade.shortStrike === null || trade.longStrike === null || trade.legs.length < 2) {
    return [];
  }
  const entryTime = chartTime(trade.entryTime);
  if (!entryTime) {
    return [];
  }

  const legDirections = new Map<string, { dir: number; ratio: number }>();
  for (const leg of trade.legs) {
    if (!leg.localSymbol) {
      return [];
    }
    const dir = leg.strike === trade.shortStrike ? -1 : leg.strike === trade.longStrike ? 1 : 0;
    if (dir === 0) {
      return [];
    }
    legDirections.set(normalizeSymbol(leg.localSymbol), { dir, ratio: leg.ratio || 1 });
  }

  const rows = await readFirstCsv(optionLegTradeCsvCandidates(date));
  if (!rows.length) {
    return [];
  }

  const perLeg = new Map<string, Map<number, OptionLegBar>>();
  const timeMeta = new Map<number, string>();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.local_symbol ?? "");
    if (!legDirections.has(symbol)) {
      continue;
    }
    const time = chartTime(row.timestamp_et);
    const open = toNumber(row.open, Number.NaN);
    const high = toNumber(row.high, Number.NaN);
    const low = toNumber(row.low, Number.NaN);
    const close = toNumber(row.close, Number.NaN);
    if (!time || time >= entryTime || !Number.isFinite(close)) {
      continue;
    }
    const series = perLeg.get(symbol) ?? new Map<number, OptionLegBar>();
    series.set(time, {
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      vwap: toOptionalNumber(row.vwap),
      volume: toOptionalNumber(row.volume),
      count: toOptionalNumber(row.count),
    });
    perLeg.set(symbol, series);
    timeMeta.set(time, row.timestamp_et);
  }

  if (perLeg.size < legDirections.size) {
    return [];
  }

  const sortedTimes = [...timeMeta.keys()].sort((a, b) => a - b);
  const permId = trade.id.split("-")[1] ?? "";
  const entrySequence = toNumber(trade.id.split("-")[2]);
  const lastBar = new Map<string, OptionLegBar>();
  const marks: SpreadMark[] = [];

  for (const time of sortedTimes) {
    for (const [symbol, series] of perLeg) {
      const bar = series.get(time);
      if (bar !== undefined) {
        lastBar.set(symbol, bar);
      }
    }
    if (lastBar.size < legDirections.size) {
      continue;
    }
    const spreadBar = estimateSpreadRangeFromLegBars(
      [...legDirections.entries()].map(([symbol, { dir, ratio }]) => ({
        symbol,
        dir,
        ratio,
        ...(lastBar.get(symbol) as OptionLegBar),
      })),
    );
    if (!spreadBar) {
      continue;
    }
    const timestampEt = timeMeta.get(time) ?? "";
    marks.push({
      tradeId: trade.id,
      permId,
      entrySequence,
      timestampEt,
      label: timeLabel(timestampEt),
      time,
      value: spreadBar.value,
      open: spreadBar.open,
      high: spreadBar.high,
      low: spreadBar.low,
      close: spreadBar.close,
      vwap: spreadBar.vwap,
      activeLegCount: legDirections.size,
      minLegVolume: spreadBar.minLegVolume,
      minLegCount: spreadBar.minLegCount,
      legSymbols: [...legDirections.keys()],
      source: "reconstructed_ffill_pre_entry_ohlc",
    });
  }

  return marks;
}

export function estimateSpreadRangeFromLegBars(legs: SpreadLegBarInput[]): {
  open: number;
  high: number;
  low: number;
  close: number;
  value: number;
  vwap?: number;
  minLegVolume?: number;
  minLegCount?: number;
} | null {
  if (!legs.length || legs.some((leg) => !Number.isFinite(leg.dir) || !Number.isFinite(leg.ratio) || !Number.isFinite(leg.close))) {
    return null;
  }

  let open = 0;
  let high = 0;
  let low = 0;
  let close = 0;
  let vwap = 0;
  let hasEveryVwap = true;
  const volumes: number[] = [];
  const counts: number[] = [];

  for (const leg of legs) {
    const coefficient = leg.dir * leg.ratio;
    const legOpen = Number.isFinite(leg.open) ? leg.open : leg.close;
    const legHigh = Number.isFinite(leg.high) ? Math.max(leg.high, legOpen, leg.close) : Math.max(legOpen, leg.close);
    const legLow = Number.isFinite(leg.low) ? Math.min(leg.low, legOpen, leg.close) : Math.min(legOpen, leg.close);

    open += coefficient * legOpen;
    close += coefficient * leg.close;
    high += coefficient >= 0 ? coefficient * legHigh : coefficient * legLow;
    low += coefficient >= 0 ? coefficient * legLow : coefficient * legHigh;

    if (typeof leg.vwap === "number" && Number.isFinite(leg.vwap)) {
      vwap += coefficient * leg.vwap;
    } else {
      hasEveryVwap = false;
    }
    if (typeof leg.volume === "number" && Number.isFinite(leg.volume)) {
      volumes.push(leg.volume);
    }
    if (typeof leg.count === "number" && Number.isFinite(leg.count)) {
      counts.push(leg.count);
    }
  }

  return {
    open: roundSpread(open),
    high: roundSpread(Math.max(high, open, close)),
    low: roundSpread(Math.min(low, open, close)),
    close: roundSpread(close),
    value: roundSpread(close),
    vwap: hasEveryVwap ? roundSpread(vwap) : undefined,
    minLegVolume: volumes.length === legs.length ? Math.min(...volumes) : undefined,
    minLegCount: counts.length === legs.length ? Math.min(...counts) : undefined,
  };
}

function roundSpread(value: number): number {
  return Number(value.toFixed(4));
}

async function loadOpenInterest(date: string): Promise<OpenInterestPoint[]> {
  const rows = await readCsv(path.join(IBKR_TRADES_ROOT, date, "google_sheet_tab_csvs", "IBKR_0DTE_SPX_Open_Interest.csv"));
  return rows
    .filter((row) => isSpxOptionRow(row, date))
    .map((row) => ({
      strike: toNumber(row.strike),
      right: optionRight(row.right),
      label: row.option_label || `${row.strike}${row.right}`,
      openInterest: toNumber(row.open_interest),
    }))
    .filter((row) => row.strike && row.openInterest > 0)
    .sort((a, b) => a.strike - b.strike);
}

async function loadVolume(date: string): Promise<VolumePoint[]> {
  const rows = await readFirstCsv(volumeProfileCsvCandidates(date));
  return volumePointsFromRows(rows, date);
}

function volumePointsFromRows(rows: CsvRow[], date: string): VolumePoint[] {
  return rows
    .filter((row) => isSpxOptionRow(row, date))
    .map((row) => ({
      timestampEt: row.timestamp_et,
      label: timeLabel(row.timestamp_et),
      time: chartTime(row.timestamp_et),
      strike: toNumber(row.strike),
      right: optionRight(row.right),
      optionLabel: row.option_label || `${row.strike}${row.right}`,
      minuteVolume: toNumber(row.bar_volume || row.minute_volume),
      cumulativeVolume: toNumber(row.cumulative_volume),
    }))
    .filter((row) => row.time && row.strike)
    .sort((a, b) => a.time - b.time || a.strike - b.strike);
}

async function loadSafeVolume(date: string): Promise<VolumePoint[]> {
  const rows = await readFirstCsv(volumeProfileCsvCandidates(date));
  return volumePointsFromRows(rows.filter((row) => isFiveMinuteBoundary(row.timestamp_et ?? "")), date);
}

function hydrateReplayTrades(trades: TradeRecord[], spxBars: SpxBar[], spreadMarks: SpreadMark[]): TradeRecord[] {
  const checkedTrades = withEntryChartChecks(trades, spreadMarks);
  if (!spxBars.length) {
    return checkedTrades;
  }

  return checkedTrades.map((trade) => ({
    ...trade,
    spxEntry: closestSpxClose(spxBars, trade.entryTime),
    spxExit: trade.spxExit ?? closestSpxClose(spxBars, trade.exitTime ?? ""),
  }));
}

async function buildReplaySafePayload(date: string): Promise<ReplayPayload> {
  const [spxBars, openInterest, baseTrades] = await Promise.all([
    loadSafeSpxBars(date),
    loadOpenInterest(date),
    loadTradesForDate(date),
  ]);
  const tradeIds = new Set(baseTrades.map((trade) => trade.id));
  const [rawSpreadMarks, volume] = await Promise.all([
    loadSafeSpreadMarks(date, tradeIds),
    loadSafeVolume(date),
  ]);
  const spreadMarks = sanitizeSpreadMarksForTrades(rawSpreadMarks, baseTrades);
  const quickTrades = hydrateReplayTrades(baseTrades, spxBars, spreadMarks);

  return {
    date,
    selectedTradeId: quickTrades[0]?.id ?? null,
    spxBars,
    spreadMarks,
    openInterest,
    volume,
    quickTrades,
  };
}

async function allowsMarketDataOnlyReplay(date: string): Promise<boolean> {
  const summary = await loadDailySummary(date);
  return summary.reviewMode === "market_data_only" || summary.localReviewStatus === "market_data_only";
}

async function loadOrBuildReplaySafeState(date: string, options: { refresh?: boolean } = {}): Promise<ReplayPayload | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const source = await replaySafeStateSource(date);
  const cachePath = replaySafeStatePath(date);
  if (!options.refresh) {
    const cached = await readJson<ReplaySafeStateCache | null>(cachePath, null);
    if (isReplaySafeStateCache(cached, source)) {
      return sanitizeReplayPayload(cached.payload);
    }
  }

  const payload = await buildReplaySafePayload(date);
  const allowSpxOnlyReplay = payload.quickTrades.length === 0 && (await allowsMarketDataOnlyReplay(date));
  if (!payload.spxBars.length || (!payload.quickTrades.length && !allowSpxOnlyReplay)) {
    return null;
  }

  const cache: ReplaySafeStateCache = {
    generatedAt: new Date().toISOString(),
    payload,
    projection: {
      spxBars: "first available SPX sidecar CSV; never falls back to google_sheet_upload_payload.json",
      spreadMarks: "first available spread-mark sidecar CSV, filtered to imported SPX quick trades and minute boundaries",
      volume: "first available cumulative-volume sidecar CSV, filtered to SPX and five-minute boundaries",
    },
    schema: REPLAY_SAFE_STATE_SCHEMA,
    source,
    version: REPLAY_SAFE_STATE_VERSION,
  };
  await writeJsonAtomic(cachePath, cache);
  return payload;
}

export async function refreshReplaySafeState(_ibkrTradesRoot: string, date: string): Promise<ReplayPayload | null> {
  return loadOrBuildReplaySafeState(date, { refresh: true });
}

export function shouldReconstructPreEntryMarks(
  spreadMarks: SpreadMark[],
  selectedTrade: Pick<TradeRecord, "entryTime" | "id">,
): boolean {
  const entryTime = chartTime(selectedTrade.entryTime);
  if (!entryTime) {
    return false;
  }
  return !spreadMarks.some((mark) => mark.tradeId === selectedTrade.id && mark.time < entryTime);
}

async function loadFullReplayPayload(date: string, selectedTradeId?: string): Promise<ReplayPayload> {
  const [spxBars, spreadMarks, openInterest, volume, quickTrades] = await Promise.all([
    loadSpxBars(date),
    loadSpreadMarks(date),
    loadOpenInterest(date),
    loadVolume(date),
    loadTradesForDate(date, { includeReplayMarks: true }),
  ]);
  const fallbackTradeId = selectedTradeId || quickTrades[0]?.id || null;

  let allMarks = spreadMarks;
  const selectedTrade = quickTrades.find((trade) => trade.id === fallbackTradeId);
  if (selectedTrade && shouldReconstructPreEntryMarks(spreadMarks, selectedTrade)) {
    const preEntryMarks = await loadPreEntrySpreadMarks(date, selectedTrade);
    if (preEntryMarks.length) {
      allMarks = [...spreadMarks, ...preEntryMarks].sort((a, b) => a.time - b.time);
    }
  }

  return {
    date,
    selectedTradeId: fallbackTradeId,
    spxBars,
    spreadMarks: sanitizeSpreadMarksForTrades(allMarks, quickTrades),
    openInterest,
    volume,
    quickTrades,
  };
}

export async function loadReplayPayload(date: string, selectedTradeId?: string, options: ReplayPayloadLoadOptions = {}): Promise<ReplayPayload> {
  if (options.mode !== "full") {
    const safePayload = await loadOrBuildReplaySafeState(date, { refresh: options.refreshSafeState });
    if (safePayload) {
      return replayPayloadWithSelectedTrade(safePayload, selectedTradeId);
    }
    return emptyReplayPayload(date);
  }

  return loadFullReplayPayload(date, selectedTradeId);
}

function emptyReplayPayload(date: string): ReplayPayload {
  return {
    date,
    selectedTradeId: null,
    spxBars: [],
    spreadMarks: [],
    openInterest: [],
    volume: [],
    quickTrades: [],
  };
}
