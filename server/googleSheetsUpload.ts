import fs from "node:fs/promises";
import path from "node:path";
import { fetchGoogleJson, googleBearerAuth, googleWriteCredentialSources, type GoogleAuthConfig } from "./googleAuth.ts";
import { googleSheetsApiUrl, normalizeSheetHeader, SPX_TRACKER_SPREADSHEET_ID } from "./googleSheetsSnapshot.ts";
import { writeJsonAtomic } from "./jsonStore.ts";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type JsonRecord = Record<string, unknown>;

type GoogleValuesResponse = {
  values?: unknown[][];
};

type GoogleBatchUpdateResponse = {
  spreadsheetId?: string;
  totalUpdatedRows?: number;
  totalUpdatedCells?: number;
};

type PayloadTab = {
  date_column?: string;
  headers?: unknown[];
  mode?: string;
  rows?: unknown[][];
  sheet_name: string;
};

type TradeLogUpload = {
  blocks?: Record<string, unknown[][]>;
  included_row_count?: number;
  sheet_name?: string;
  start_row?: number;
};

type GoogleUploadPayload = {
  source_day_dir?: string;
  spreadsheet_id?: string;
  summary?: JsonRecord;
  tabs?: PayloadTab[];
  target_trade_date_et?: string;
  trade_log_upload?: TradeLogUpload;
};

export type GoogleDailyUploadResult = {
  ok: boolean;
  credentialSource: string;
  dailySyncRunRow: number;
  generatedAt: string;
  googleUploadedAt: string;
  rawUploadGoogleSheetId?: string;
  rawUploadGoogleSheetUrl?: string;
  spreadsheetId: string;
  targetDate: string;
  tradeLogStartRow?: number;
  uploadMode: "tracker_only";
  updatedCells?: number;
};

type UploadInput = {
  auth?: GoogleAuthConfig;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  payloadPath: string;
  runId?: string;
  spreadsheetId?: string;
};

function aiStuffRoot(): string {
  return process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..");
}

export function defaultPayloadPath(date: string): string {
  return path.join(aiStuffRoot(), "IBKR Equity History Pull", "data", "ibkr_trades", date, "google_sheet_upload_payload.json");
}

function sheetRange(sheetName: string, a1: string): string {
  const escaped = sheetName.replaceAll("'", "''");
  return `'${escaped}'!${a1}`;
}

function columnName(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function rangeForValues(sheetName: string, startRow: number, startColumn: number, rows: number, columns: number): string {
  const start = `${columnName(startColumn)}${startRow}`;
  const end = `${columnName(startColumn + columns - 1)}${startRow + rows - 1}`;
  return sheetRange(sheetName, `${start}:${end}`);
}

function valueAt(row: unknown[], index: number): unknown {
  return index >= 0 && index < row.length ? row[index] : "";
}

function rowHasAnyValue(row: unknown[] | undefined): boolean {
  return Boolean(row?.some((cell) => String(cell ?? "").trim()));
}

function mergeHeaderNames(existing: unknown[], required: string[]): string[] {
  const merged = existing.map((header) => String(header ?? "").trim()).filter(Boolean);
  const normalized = new Set(merged.map((header) => normalizeSheetHeader(header)));
  for (const header of required) {
    const key = normalizeSheetHeader(header);
    if (!normalized.has(key)) {
      merged.push(header);
      normalized.add(key);
    }
  }
  return merged;
}

function mapRow(headers: unknown[] = [], row: unknown[] = []): JsonRecord {
  const mapped: JsonRecord = {};
  headers.forEach((header, index) => {
    const key = normalizeSheetHeader(header);
    if (key) {
      mapped[key] = valueAt(row, index);
    }
  });
  return mapped;
}

function rowFromMap(headers: string[], mapped: JsonRecord): unknown[] {
  return headers.map((header) => mapped[normalizeSheetHeader(header)] ?? "");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function readSheetValues(spreadsheetId: string, range: string, auth: GoogleAuthConfig): Promise<unknown[][]> {
  const response = await fetchGoogleJson<GoogleValuesResponse>(
    googleSheetsApiUrl(spreadsheetId, `/values/${encodeURIComponent(range)}`),
    { method: "GET" },
    auth,
  );
  return response.values ?? [];
}

async function batchUpdateValues(
  spreadsheetId: string,
  data: Array<{ range: string; values: unknown[][] }>,
  auth: GoogleAuthConfig,
): Promise<GoogleBatchUpdateResponse> {
  if (!data.length) {
    return {};
  }
  return fetchGoogleJson<GoogleBatchUpdateResponse>(
    googleSheetsApiUrl(spreadsheetId, "/values:batchUpdate"),
    {
      body: JSON.stringify({
        data,
        valueInputOption: "RAW",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    auth,
  );
}

async function batchClearValues(spreadsheetId: string, ranges: string[], auth: GoogleAuthConfig): Promise<void> {
  if (!ranges.length) {
    return;
  }
  await fetchGoogleJson<unknown>(
    googleSheetsApiUrl(spreadsheetId, "/values:batchClear"),
    {
      body: JSON.stringify({ ranges }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    auth,
  );
}

function buildDailySyncRunValues({
  payload,
  runId,
  uploadedAt,
}: {
  payload: GoogleUploadPayload;
  runId: string;
  uploadedAt: string;
}): { headers: string[]; row: unknown[]; targetDate: string } {
  const tab = payload.tabs?.find((candidate) => candidate.sheet_name === "Daily Sync Runs");
  if (!tab?.rows?.[0]) {
    throw new Error("Google upload payload is missing the Daily Sync Runs tab row.");
  }
  const requiredHeaders = [
    ...(tab.headers ?? []).map((header) => String(header ?? "")),
    "google_uploaded_at",
    "google_upload_mode",
    "run_id",
    "data_collection_status",
    "rubicon_ingest_status",
    "google_upload_status",
  ];
  const mapped = mapRow(tab.headers, tab.rows[0]);
  const targetDate = String(mapped.target_trade_date_et ?? payload.target_trade_date_et ?? "").trim();
  if (!targetDate) {
    throw new Error("Google upload payload does not include target_trade_date_et.");
  }
  mapped.google_uploaded_at = uploadedAt;
  mapped.google_upload_mode = "tracker_only";
  mapped.run_id = runId;
  mapped.data_collection_status = "complete";
  mapped.rubicon_ingest_status = "complete";
  mapped.google_upload_status = "complete";
  return {
    headers: requiredHeaders,
    row: rowFromMap(requiredHeaders, mapped),
    targetDate,
  };
}

async function dailySyncRunUpdates(
  spreadsheetId: string,
  auth: GoogleAuthConfig,
  dailyRun: { headers: string[]; row: unknown[]; targetDate: string },
): Promise<{ rowNumber: number; updates: Array<{ range: string; values: unknown[][] }> }> {
  const values = await readSheetValues(spreadsheetId, sheetRange("Daily Sync Runs", "A1:AZ1000"), auth);
  const existingHeader = values[0] ?? [];
  const headers = mergeHeaderNames(existingHeader, dailyRun.headers);
  const dateColumn = headers.findIndex((header) => normalizeSheetHeader(header) === "target_trade_date_et");
  if (dateColumn < 0) {
    throw new Error("Daily Sync Runs sheet is missing target_trade_date_et.");
  }
  const existingBody = values.slice(1);
  const existingIndex = existingBody.findIndex((row) => String(valueAt(row, dateColumn)).trim() === dailyRun.targetDate);
  const rowNumber = existingIndex >= 0 ? existingIndex + 2 : Math.max(values.length + 1, 2);
  const mapped = mapRow(dailyRun.headers, dailyRun.row);
  const updates: Array<{ range: string; values: unknown[][] }> = [];
  if (headers.length !== existingHeader.length || headers.some((header, index) => String(existingHeader[index] ?? "") !== header)) {
    updates.push({ range: rangeForValues("Daily Sync Runs", 1, 0, 1, headers.length), values: [headers] });
  }
  updates.push({
    range: rangeForValues("Daily Sync Runs", rowNumber, 0, 1, headers.length),
    values: [rowFromMap(headers, mapped)],
  });
  return { rowNumber, updates };
}

function blockColumns(blockName: string): { start: string; end: string; startIndex: number; width: number } {
  const [start, end] = blockName.split("_");
  if (!start || !end) {
    throw new Error(`Unsupported Trade Log block name: ${blockName}`);
  }
  const startIndex = columnIndex(start);
  const endIndex = columnIndex(end);
  return { start, end, startIndex, width: endIndex - startIndex + 1 };
}

function columnIndex(column: string): number {
  return column.split("").reduce((value, char) => value * 26 + char.toUpperCase().charCodeAt(0) - 64, 0) - 1;
}

async function tradeLogUpdates(
  spreadsheetId: string,
  auth: GoogleAuthConfig,
  payload: GoogleUploadPayload,
  targetDate: string,
): Promise<{ clearRanges: string[]; startRow?: number; updates: Array<{ range: string; values: unknown[][] }> }> {
  const upload = payload.trade_log_upload;
  const blocks = upload?.blocks ?? {};
  const primaryRows = blocks.A_G ?? Object.values(blocks)[0] ?? [];
  if (!primaryRows.length) {
    return { clearRanges: [], updates: [] };
  }

  const sheetName = upload?.sheet_name ?? "Trade Log";
  const configuredStartRow = Number(upload?.start_row ?? 6);
  const existing = await readSheetValues(spreadsheetId, sheetRange(sheetName, `A${configuredStartRow}:AC2000`), auth);
  const matchedOffsets = existing
    .map((row, index) => ({ index, row }))
    .filter(({ row }) => String(valueAt(row, 0)).startsWith("IBKR-") && String(valueAt(row, 1)).trim() === targetDate)
    .map(({ index }) => index);
  const lastUsedOffset = existing.reduce((last, row, index) => (rowHasAnyValue(row) ? index : last), -1);
  const startRow = matchedOffsets.length ? configuredStartRow + Math.min(...matchedOffsets) : Math.max(configuredStartRow, configuredStartRow + lastUsedOffset + 1);
  const oldRowCount = matchedOffsets.length ? Math.max(...matchedOffsets) - Math.min(...matchedOffsets) + 1 : 0;
  const newRowCount = primaryRows.length;

  const updates: Array<{ range: string; values: unknown[][] }> = [];
  const clearRanges: string[] = [];
  for (const [blockName, rows] of Object.entries(blocks)) {
    const block = blockColumns(blockName);
    updates.push({
      range: rangeForValues(sheetName, startRow, block.startIndex, rows.length, block.width),
      values: rows,
    });
    if (oldRowCount > newRowCount) {
      clearRanges.push(sheetRange(sheetName, `${block.start}${startRow + newRowCount}:${block.end}${startRow + oldRowCount - 1}`));
    }
  }

  return { clearRanges, startRow, updates };
}

async function updateLocalSummary({
  payload,
  payloadPath,
  runId,
  uploadedAt,
}: {
  payload: GoogleUploadPayload;
  payloadPath: string;
  runId: string;
  uploadedAt: string;
}): Promise<void> {
  const summaryPath = path.join(payload.source_day_dir ? path.resolve(payload.source_day_dir) : path.dirname(payloadPath), "daily_sync_summary.json");
  const summary: JsonRecord = await readJsonFile<JsonRecord>(summaryPath).catch(() => ({} as JsonRecord));
  const {
    rawUploadGoogleSheetId: _rawUploadGoogleSheetId,
    rawUploadGoogleSheetUrl: _rawUploadGoogleSheetUrl,
    raw_upload_google_sheet_id: _rawUploadGoogleSheetIdSnake,
    raw_upload_google_sheet_url: _rawUploadGoogleSheetUrlSnake,
    ...summaryWithoutRawWorkbookReceipt
  } = summary;
  const next = {
    ...summaryWithoutRawWorkbookReceipt,
    googleUpload: {
      mode: "tracker_only",
      runId,
      status: "complete",
      uploadedAt,
    },
    google_upload_status: "complete",
    google_upload_mode: "tracker_only",
    google_uploaded_at: uploadedAt,
  };
  await writeJsonAtomic(summaryPath, next);
}

export function assertGoogleUploadConfig(env: NodeJS.ProcessEnv = process.env): { credentialSources: string[] } {
  const credentialSources = googleWriteCredentialSources(env);
  if (!credentialSources.length) {
    throw new Error("Google upload requires write credentials: set GOOGLE_SHEETS_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_PATH.");
  }
  return { credentialSources };
}

export async function uploadDailyPipelineToGoogle(input: UploadInput): Promise<GoogleDailyUploadResult> {
  const env = input.env ?? process.env;
  const auth = input.auth ?? (await googleBearerAuth([SHEETS_SCOPE], env));
  const payload = await readJsonFile<GoogleUploadPayload>(input.payloadPath);
  const targetDate = String(payload.target_trade_date_et ?? "").trim();
  if (!targetDate) {
    throw new Error("Google upload payload is missing target_trade_date_et.");
  }
  const spreadsheetId = input.spreadsheetId ?? payload.spreadsheet_id ?? env.SPX_GOOGLE_SHEET_ID ?? SPX_TRACKER_SPREADSHEET_ID;
  const uploadedAt = (input.now ?? new Date()).toISOString();
  const runId = input.runId ?? String(payload.summary?.run_id ?? payload.summary?.runId ?? `daily-${targetDate}`);

  const dailyRun = buildDailySyncRunValues({
    payload,
    runId,
    uploadedAt,
  });
  const dailyRunPlan = await dailySyncRunUpdates(spreadsheetId, auth, dailyRun);
  const tradePlan = await tradeLogUpdates(spreadsheetId, auth, payload, targetDate);
  await batchClearValues(spreadsheetId, tradePlan.clearRanges, auth);
  const batch = await batchUpdateValues(spreadsheetId, [...dailyRunPlan.updates, ...tradePlan.updates], auth);
  await updateLocalSummary({
    payload,
    payloadPath: input.payloadPath,
    runId,
    uploadedAt,
  });

  return {
    ok: true,
    credentialSource: auth.credentialSource,
    dailySyncRunRow: dailyRunPlan.rowNumber,
    generatedAt: new Date().toISOString(),
    googleUploadedAt: uploadedAt,
    spreadsheetId,
    targetDate,
    tradeLogStartRow: tradePlan.startRow,
    uploadMode: "tracker_only",
    updatedCells: batch.totalUpdatedCells,
  };
}
