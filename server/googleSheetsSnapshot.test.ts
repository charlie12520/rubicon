import { describe, expect, it } from "vitest";
import {
  buildGoogleDriveTrackerSnapshot,
  DAILY_SYNC_RUNS_RANGE,
  googleSheetsApiUrl,
  googleSheetsCredentialSources,
  googleSheetsRefreshSourceHealth,
  rowsFromGoogleValues,
} from "./googleSheetsSnapshot.ts";

describe("Google Sheets tracker snapshot helpers", () => {
  it("uses a bounded Daily Sync Runs refresh range that covers the current tracker tab", () => {
    expect(DAILY_SYNC_RUNS_RANGE).toBe("Daily Sync Runs!A1:AZ1000");
  });

  it("normalizes Daily Sync Runs values into typed records", () => {
    const rows = rowsFromGoogleValues([
      ["Target Trade Date ET", "Fill Count", "Raw Upload Google Sheet URL"],
      ["2026-05-28", "253", "https://docs.google.com/spreadsheets/d/raw"],
      ["", "", ""],
    ]);

    expect(rows).toEqual([
      {
        fill_count: 253,
        raw_upload_google_sheet_url: "https://docs.google.com/spreadsheets/d/raw",
        target_trade_date_et: "2026-05-28",
      },
    ]);
  });

  it("builds the connector snapshot shape from Google Sheets API responses", () => {
    const snapshot = buildGoogleDriveTrackerSnapshot({
      dailySyncRuns: {
        values: [
          ["target_trade_date_et", "entry_count"],
          ["2026-05-28", "21"],
        ],
      },
      metadata: {
        properties: { timeZone: "America/New_York", title: "SPX Spread Trade Tracker" },
        sheets: [
          {
            properties: {
              gridProperties: { columnCount: 27, rowCount: 998 },
              sheetId: 1101001,
              title: "Daily Sync Runs",
            },
          },
        ],
      },
      readAt: "2026-05-29T18:00:00.000Z",
      spreadsheetId: "sheet-id",
    });

    expect(snapshot).toMatchObject({
      dailySyncRuns: [{ entry_count: 21, target_trade_date_et: "2026-05-28" }],
      readAt: "2026-05-29T18:00:00.000Z",
      sheets: [{ columnCount: 27, rowCount: 998, sheetId: 1101001, title: "Daily Sync Runs" }],
      spreadsheetId: "sheet-id",
      timeZone: "America/New_York",
      title: "SPX Spread Trade Tracker",
    });
  });

  it("reports whether a reusable Google Sheets refresh credential is configured", () => {
    expect(googleSheetsRefreshSourceHealth({}).status).toBe("warning");
    expect(googleSheetsRefreshSourceHealth({ GOOGLE_SHEETS_ACCESS_TOKEN: "token" }).status).toBe("ok");
    expect(googleSheetsRefreshSourceHealth({ GOOGLE_SERVICE_ACCOUNT_PATH: "service-account.json" }).detail).toContain("auto-refreshes");
    expect(googleSheetsCredentialSources({ GOOGLE_SHEETS_API_KEY: "key" })).toEqual(["GOOGLE_SHEETS_API_KEY"]);
  });

  it("includes automatic refresh runtime state in source health", () => {
    const source = googleSheetsRefreshSourceHealth(
      { GOOGLE_SHEETS_ACCESS_TOKEN: "token" },
      {
        attempted: true,
        credentialSources: ["GOOGLE_SHEETS_ACCESS_TOKEN"],
        generatedAt: "2026-05-29T21:20:00.000Z",
        lastAttemptAt: "2026-05-29T21:20:00.000Z",
        message: "Automatic Google tracker snapshot refresh failed at 2026-05-29T21:20:00.000Z: invalid token.",
        mode: "failed",
        ok: false,
      },
    );

    expect(source.status).toBe("warning");
    expect(source.detail).toContain("invalid token");
    expect(source.detail).toContain("Credential source: GOOGLE_SHEETS_ACCESS_TOKEN");
  });

  it("builds Google Sheets API URLs with encoded query params", () => {
    expect(googleSheetsApiUrl("sheet id", "/values/Daily%20Sync%20Runs!A1%3AAA20", { fields: "values" })).toBe(
      "https://sheets.googleapis.com/v4/spreadsheets/sheet%20id/values/Daily%20Sync%20Runs!A1%3AAA20?fields=values",
    );
  });
});
