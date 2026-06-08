import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceHealth } from "../shared/types.ts";

export const SPX_TRACKER_SPREADSHEET_ID = "1w0S_DNJJ6ZhcSGB0qEtkBxsVLxQk0prVPqnV9t-WvtE";
export const SPX_TRACKER_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPX_TRACKER_SPREADSHEET_ID}/edit`;
export const DAILY_SYNC_RUNS_RANGE = "Daily Sync Runs!A1:AZ1000";
export const DEFAULT_GOOGLE_SERVICE_ACCOUNT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".secrets",
  "spx-replay-google-service-account.json",
);

type JsonRecord = Record<string, unknown>;

export type GoogleSheetsMetadataResponse = {
  properties?: {
    title?: string;
    timeZone?: string;
  };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
      gridProperties?: {
        rowCount?: number;
        columnCount?: number;
      };
    };
  }>;
};

export type GoogleSheetsValuesResponse = {
  values?: unknown[][];
};

export type GoogleSnapshotRefreshRuntimeStatus = {
  attempted: boolean;
  credentialSources: string[];
  generatedAt: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  message: string;
  mode: "disabled" | "waiting_for_credential" | "refreshed" | "failed" | "skipped_recent";
  nextAttemptAfter?: string;
  ok: boolean;
  outPath?: string;
};

export function normalizeSheetHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeCell(value: unknown): unknown {
  const text = String(value ?? "").trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text);
  }
  return text;
}

export function rowsFromGoogleValues(values: unknown[][] = []): JsonRecord[] {
  const [headerRow, ...bodyRows] = values;
  if (!headerRow?.length) {
    return [];
  }

  const keys = headerRow.map((header, index) => normalizeSheetHeader(header) || `column_${index + 1}`);
  return bodyRows
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => {
      const record: JsonRecord = {};
      for (let index = 0; index < keys.length; index += 1) {
        record[keys[index]] = normalizeCell(row[index]);
      }
      return record;
    });
}

export function buildGoogleDriveTrackerSnapshot({
  dailySyncRuns,
  metadata,
  readAt = new Date().toISOString(),
  source = "Google Sheets API refresh",
  spreadsheetId = SPX_TRACKER_SPREADSHEET_ID,
  spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
}: {
  dailySyncRuns: GoogleSheetsValuesResponse;
  metadata: GoogleSheetsMetadataResponse;
  readAt?: string;
  source?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
}): JsonRecord {
  return {
    source,
    readAt,
    spreadsheetId,
    spreadsheetUrl,
    title: metadata.properties?.title,
    timeZone: metadata.properties?.timeZone,
    sheets: (metadata.sheets ?? []).map((sheet) => ({
      sheetId: sheet.properties?.sheetId,
      title: sheet.properties?.title,
      rowCount: sheet.properties?.gridProperties?.rowCount,
      columnCount: sheet.properties?.gridProperties?.columnCount,
    })),
    dailySyncRuns: rowsFromGoogleValues(dailySyncRuns.values ?? []),
  };
}

export function googleSheetsApiUrl(spreadsheetId: string, pathSuffix = "", params: Record<string, string> = {}): string {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${pathSuffix}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function googleSheetsCredentialSources(env: NodeJS.ProcessEnv = process.env, includeDefaultServiceAccount = env === process.env): string[] {
  return [
    env.GOOGLE_SHEETS_ACCESS_TOKEN ? "GOOGLE_SHEETS_ACCESS_TOKEN" : "",
    env.GOOGLE_SERVICE_ACCOUNT_JSON ? "GOOGLE_SERVICE_ACCOUNT_JSON" : "",
    env.GOOGLE_SERVICE_ACCOUNT_PATH || (includeDefaultServiceAccount && fs.existsSync(DEFAULT_GOOGLE_SERVICE_ACCOUNT_PATH)) ? "GOOGLE_SERVICE_ACCOUNT_PATH" : "",
    env.GOOGLE_SHEETS_API_KEY ? "GOOGLE_SHEETS_API_KEY" : "",
  ].filter(Boolean);
}

export function googleSheetsRefreshSourceHealth(
  env: NodeJS.ProcessEnv = process.env,
  runtimeStatus?: GoogleSnapshotRefreshRuntimeStatus,
): SourceHealth {
  const configuredSources = googleSheetsCredentialSources(env);

  if (runtimeStatus) {
    const status = runtimeStatus.ok ? "ok" : "warning";
    const sourceDetail = configuredSources.length
      ? `Credential source: ${configuredSources.join(", ")}.`
      : "No reusable Google Sheets credential is configured.";
    return {
      label: "Google API snapshot refresh",
      status,
      detail: `${runtimeStatus.message} ${sourceDetail}`,
      url: SPX_TRACKER_SPREADSHEET_URL,
    };
  }

  if (configuredSources.length) {
    return {
      label: "Google API snapshot refresh",
      status: "ok",
      detail: `Credential source configured via ${configuredSources.join(", ")}; the desktop app auto-refreshes this snapshot from /api/tracker, and npm run google:snapshot remains available for manual refresh.`,
      url: SPX_TRACKER_SPREADSHEET_URL,
    };
  }

  return {
    label: "Google API snapshot refresh",
    status: "warning",
    detail:
      "No reusable Google Sheets API credential is configured. Set GOOGLE_SHEETS_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_PATH, or GOOGLE_SHEETS_API_KEY so the desktop app can auto-refresh the connector snapshot; npm run google:snapshot remains available for manual refresh.",
    url: SPX_TRACKER_SPREADSHEET_URL,
  };
}
