import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  estimateSpreadRangeFromLegBars,
  googleDriveSnapshotFreshness,
  googleSheetCsvExportUrl,
  loadReplayPayload,
  loadTrackerSnapshot,
  mergeGoogleDriveDailySyncSummaries,
  mergeGoogleDriveReceiptChecks,
  optionLegTradeCsvCandidates,
  probeGoogleSheetCsvExport,
  readGoogleDriveReceiptChecks,
  readGoogleDriveTrackerSnapshot,
  readReviewNotes,
  readWallet,
  reconcileGoogleCsvProbeWithApi,
  shouldReconstructPreEntryMarks,
  spxIntradayTabCandidates,
  volumeProfileCsvCandidates,
  writeReviewNote,
} from "./dataImporter.ts";

const aiStuffRoot = process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..");
const hasLocalTradeArchive = existsSync(path.join(aiStuffRoot, "IBKR Equity History Pull", "data", "ibkr_trades", "2026-05-28"));
// Integration tests that read the real AI STUFF trade archive (and assert
// specific recorded sessions) only run on the trading machine -- CI runners
// have no archive, so they skip instead of failing.
const itArchive = it.skipIf(!hasLocalTradeArchive);

const originalGoogleExportProbe = process.env.SPX_GOOGLE_EXPORT_PROBE;
const originalGoogleDriveSnapshotStaleHours = process.env.SPX_GOOGLE_DRIVE_SNAPSHOT_STALE_HOURS;

beforeAll(() => {
  process.env.SPX_GOOGLE_EXPORT_PROBE = "0";
  process.env.SPX_GOOGLE_DRIVE_SNAPSHOT_STALE_HOURS = "100000";
});

afterAll(() => {
  if (originalGoogleExportProbe === undefined) {
    delete process.env.SPX_GOOGLE_EXPORT_PROBE;
  } else {
    process.env.SPX_GOOGLE_EXPORT_PROBE = originalGoogleExportProbe;
  }
  if (originalGoogleDriveSnapshotStaleHours === undefined) {
    delete process.env.SPX_GOOGLE_DRIVE_SNAPSHOT_STALE_HOURS;
  } else {
    process.env.SPX_GOOGLE_DRIVE_SNAPSHOT_STALE_HOURS = originalGoogleDriveSnapshotStaleHours;
  }
});

describe("AI STUFF trade importer", () => {
  itArchive("normalizes local IBKR entries into tracker trades", async () => {
    const snapshot = await loadTrackerSnapshot();
    const sourceHealth = new Map(snapshot.sourceHealth.map((source) => [source.label, source]));
    const latestSummary = snapshot.dailySummaries.find((summary) => summary.date === snapshot.latestTradeDate);
    const trackerUpload = sourceHealth.get("Google tracker upload");
    const stagedPayload = sourceHealth.get("Staged sheet payload");

    expect(snapshot.availableDates).toContain("2026-05-28");
    expect(snapshot.trades.length).toBeGreaterThan(0);
    expect(snapshot.trades.some((trade) => trade.id === "IBKR-997697494-1")).toBe(true);
    expect(snapshot.sourceHealth.some((source) => source.status === "ok")).toBe(true);
    expect(stagedPayload?.status).toBe((latestSummary?.payloadRows ?? 0) > 0 ? "ok" : "warning");
    expect(stagedPayload?.count).toBe(latestSummary?.payloadRows);
    expect(stagedPayload?.detail).toContain(snapshot.latestTradeDate ?? "");
    expect(["ok", "warning"]).toContain(sourceHealth.get("Google Drive connector snapshot")?.status);
    expect(sourceHealth.get("Google Drive connector snapshot")?.count).toBeGreaterThanOrEqual(4);
    expect(sourceHealth.get("Google Drive connector snapshot")?.detail).toContain("SPX Spread Trade Tracker");
    expect(trackerUpload?.status).toBe(latestSummary?.uploadStatus === "uploaded" ? "ok" : "warning");
    expect(trackerUpload?.detail).toMatch(/tracker upload|local Rubicon review|Trade Log rows/i);
    expect(sourceHealth.get("Google CSV export probe")?.status).toBe("warning");
    expect(sourceHealth.get("Google CSV export probe")?.detail).toContain("disabled");
    expect(sourceHealth.get("Replay market data")?.detail).toContain("Latest replay date");
    expect(sourceHealth.get("AI STUFF daily sync launcher")?.status).toBe("ok");
    expect(sourceHealth.get("IBKR wallet")?.detail).toMatch(/IBKR_ACCOUNT_SNAPSHOT_PATH|Wallet loaded from/);
    expect(sourceHealth.get("IBKR live wallet refresh")?.detail).toMatch(/TWS\/Gateway|IBKR port/);
  });

  itArchive("surfaces the live same-day sync summary with the repaired upload receipt confirmed", async () => {
    const snapshot = await loadTrackerSnapshot();
    const summary = snapshot.dailySummaries.find((nextSummary) => nextSummary.date === "2026-05-29");

    expect(snapshot.availableDates).toContain("2026-05-29");
    expect(snapshot.latestTradeDate).not.toBeNull();
    expect((snapshot.latestTradeDate ?? "") >= "2026-05-29").toBe(true);
    expect(summary?.fillCount).toBe(136);
    expect(summary?.spreadCount).toBe(24);
    expect(summary?.entryCount).toBe(19);
    expect(summary?.optionContractCount).toBe(12);
    expect(summary?.uploadTabCount).toBe(1);
    expect(summary?.payloadRows).toBe(20);
    expect(summary?.uploadStatus).toBe(summary?.rawUploadGoogleSheetUrl ? "uploaded" : "payload_ready_unconfirmed");
    if (summary?.rawUploadGoogleSheetUrl) {
      expect(summary.rawUploadGoogleSheetUrl).toContain("docs.google.com/spreadsheets");
    }
    expect(summary?.uploadReceiptCheck?.status).toBe("found");
    expect(summary?.issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(summary?.issues.find((issue) => issue.title === "Secondary IBKR endpoint did not connect")?.severity).toBe("info");
    expect(summary?.issues.find((issue) => issue.title === "Validated IBKR archive summary")?.detail).toContain("row-level IBKR artifacts stay in the archive");
    const openInterestIssue = summary?.issues.find((issue) => issue.title === "Open interest pull not fully clean");
    expect(openInterestIssue?.severity).toBe("info");
    expect(openInterestIssue?.detail).toContain("Open interest status partial");
    expect(summary?.issues.find((issue) => issue.title === "Validated option intraday exceptions")?.severity).toBe("info");
    expect(summary?.issues.find((issue) => issue.title === "Validated partial archive availability")?.severity).toBe("info");
    expect(summary?.issues.some((issue) => issue.title === "Option intraday missing rows near SPX open/close")).toBe(false);
    expect(summary?.issues.some((issue) => issue.title === "Volume profile missing rows near SPX open/close")).toBe(false);
    expect(summary?.issues.some((issue) => issue.title === "Google tracker upload not confirmed")).toBe(false);
    expect(summary?.issues.some((issue) => issue.title === "Connector receipt row not found")).toBe(false);
  });

  itArchive("loads the latest connector receipt row search evidence", async () => {
    const checks = await readGoogleDriveReceiptChecks();

    expect(checks?.source).toBe("Google Drive connector row search");
    expect(checks?.checks?.some((check) => check.date === "2026-05-29" && check.status === "found")).toBe(true);
  });

  itArchive("loads the connector snapshot captured from the SPX Spread Trade Tracker", async () => {
    const snapshot = await readGoogleDriveTrackerSnapshot();

    expect(snapshot?.title).toBe("SPX Spread Trade Tracker");
    expect(snapshot?.timeZone).toBe("America/New_York");
    expect(snapshot?.dailySyncRuns?.some((row) => row.target_trade_date_et === "2026-05-28")).toBe(true);
    expect(snapshot?.dailySyncRuns?.some((row) => row.target_trade_date_et === "2026-05-29")).toBe(true);
  });

  it("classifies Google Drive connector snapshots by freshness", () => {
    const fresh = googleDriveSnapshotFreshness(
      {
        title: "SPX Spread Trade Tracker",
        readAt: "2026-05-29T14:23:00-04:00",
        dailySyncRuns: [{ target_trade_date_et: "2026-05-28" }],
      },
      new Date("2026-05-29T18:23:00-04:00"),
      24,
    );
    const stale = googleDriveSnapshotFreshness(
      {
        title: "SPX Spread Trade Tracker",
        readAt: "2026-05-27T14:23:00-04:00",
        dailySyncRuns: [{ target_trade_date_et: "2026-05-28" }],
      },
      new Date("2026-05-29T18:23:00-04:00"),
      24,
    );

    expect(fresh.status).toBe("ok");
    expect(fresh.isFresh).toBe(true);
    expect(fresh.detail).toContain("fresh");
    expect(stale.status).toBe("warning");
    expect(stale.isFresh).toBe(false);
    expect(stale.detail).toContain("freshness window");
  });

  it("warns when a connector snapshot predates the latest staged upload payload", () => {
    const freshness = googleDriveSnapshotFreshness(
      {
        title: "SPX Spread Trade Tracker",
        readAt: "2026-05-29T15:10:44-04:00",
        dailySyncRuns: [{ target_trade_date_et: "2026-05-28" }],
      },
      new Date("2026-05-29T21:05:00-04:00"),
      24,
      {
        timestamp: "2026-05-29T16:38:22-04:00",
        label: "the latest staged payload for 2026-05-29",
      },
    );

    expect(freshness.status).toBe("warning");
    expect(freshness.isFresh).toBe(false);
    expect(freshness.detail).toContain("fresh by age");
    expect(freshness.detail).toContain("predates the latest staged payload for 2026-05-29");
  });

  it("warns when a fresh connector snapshot still lacks the required raw upload receipt", () => {
    const freshness = googleDriveSnapshotFreshness(
      {
        title: "SPX Spread Trade Tracker",
        readAt: "2026-05-29T17:40:00-04:00",
        dailySyncRuns: [{ target_trade_date_et: "2026-05-28", raw_upload_google_sheet_url: "https://docs.google.com/spreadsheets/d/raw" }],
      },
      new Date("2026-05-29T17:45:00-04:00"),
      24,
      {
        timestamp: "2026-05-29T16:38:22-04:00",
        label: "the latest staged payload for 2026-05-29",
        receiptDate: "2026-05-29",
      },
    );

    expect(freshness.status).toBe("warning");
    expect(freshness.isFresh).toBe(false);
    expect(freshness.detail).toContain("did not include a completed 2026-05-29 tracker upload row");
    expect(freshness.detail).toContain("Google upload remains unconfirmed");
  });

  it("merges connector raw upload receipts into daily summaries", () => {
    const summaries = mergeGoogleDriveDailySyncSummaries(
      [
        {
          date: "2026-05-28",
          tradeCount: 253,
          fillCount: 253,
          spreadCount: 30,
          entryCount: 21,
          optionContractCount: 11,
          spxStatus: "up_to_date",
          tradeStatus: "ok_with_errors",
          optionIntradayStatus: "ok",
          availabilityStatus: "ok",
          uploadStatus: "payload_ready_unconfirmed",
          issueCount: 1,
          issues: [
            {
              stage: "upload",
              severity: "warning",
              title: "Google tracker upload not confirmed",
              detail: "No receipt.",
            },
          ],
          uploadTabCount: 10,
          payloadRows: 59888,
        },
      ],
      {
        readAt: "2026-05-29T14:23:00-04:00",
        dailySyncRuns: [
          {
            target_trade_date_et: "2026-05-28",
            raw_upload_google_sheet_url: "https://docs.google.com/spreadsheets/d/raw",
            generated_at_local: "2026-05-28 19:13:39",
          },
        ],
      },
    );

    expect(summaries[0].uploadStatus).toBe("uploaded");
    expect(summaries[0].rawUploadGoogleSheetUrl).toBe("https://docs.google.com/spreadsheets/d/raw");
    expect(summaries[0].uploadReceiptSource).toBe("Google Drive connector snapshot");
    expect(summaries[0].uploadReceiptReadAt).toBe("2026-05-29T14:23:00-04:00");
    expect(summaries[0].issues.some((nextIssue) => nextIssue.title === "Google tracker upload not confirmed")).toBe(false);
    expect(summaries[0].issues.some((nextIssue) => nextIssue.title === "Google tracker upload confirmed")).toBe(true);
    expect(summaries[0].issueCount).toBe(0);
  });

  it("does not let connector rows downgrade validated local IBKR summary facts", () => {
    const summaries = mergeGoogleDriveDailySyncSummaries(
      [
        {
          date: "2026-06-01",
          tradeCount: 75,
          fillCount: 75,
          spreadCount: 31,
          entryCount: 22,
          optionContractCount: 19,
          spxStatus: "up_to_date",
          tradeStatus: "ok",
          optionIntradayStatus: "partial",
          optionIntradayExpectedRows: 602640,
          optionIntradayRowCount: 540996,
          optionIntradayContractCount: 124,
          optionIntradayExpectedRowsPerContract: 4860,
          availabilityStatus: "partial",
          uploadStatus: "payload_ready_unconfirmed",
          issueCount: 1,
          issues: [
            {
              stage: "upload",
              severity: "warning",
              title: "Google tracker upload not confirmed",
              detail: "No receipt.",
            },
          ],
          payloadRows: 1197958,
          uploadTabCount: 11,
        },
      ],
      {
        readAt: "2026-06-02T17:30:14.805Z",
        dailySyncRuns: [
          {
            target_trade_date_et: "2026-06-01",
            raw_upload_google_sheet_url: "https://docs.google.com/spreadsheets/d/raw",
            ibkr_option_trade_status: "skipped",
            ibkr_option_contract_count: 0,
            ibkr_option_expected_rows: 0,
            ibkr_option_expected_rows_per_contract: 0,
            ibkr_option_leg_trade_rows: 0,
          },
        ],
      },
    );

    expect(summaries[0].uploadStatus).toBe("uploaded");
    expect(summaries[0].rawUploadGoogleSheetUrl).toBe("https://docs.google.com/spreadsheets/d/raw");
    expect(summaries[0].optionIntradayStatus).toBe("partial");
    expect(summaries[0].optionIntradayContractCount).toBe(124);
    expect(summaries[0].optionIntradayExpectedRows).toBe(602640);
    expect(summaries[0].optionIntradayExpectedRowsPerContract).toBe(4860);
    expect(summaries[0].optionIntradayRowCount).toBe(540996);
  });

  it("merges connector receipt row-search proof into daily summaries", () => {
    const summaries = mergeGoogleDriveReceiptChecks(
      [
        {
          date: "2026-05-29",
          tradeCount: 136,
          fillCount: 136,
          spreadCount: 24,
          entryCount: 19,
          optionContractCount: 12,
          spxStatus: "up_to_date",
          tradeStatus: "ok",
          optionIntradayStatus: "partial",
          availabilityStatus: "partial",
          uploadStatus: "payload_ready_unconfirmed",
          issueCount: 1,
          issues: [
            {
              stage: "upload",
              severity: "warning",
              title: "Google tracker upload not confirmed",
              detail: "No receipt.",
            },
          ],
          uploadTabCount: 10,
          payloadRows: 59333,
        },
      ],
      {
        source: "Google Drive connector row search",
        checkedAt: "2026-05-29T17:43:01-04:00",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/tracker/edit",
        scannedRange: "A1:AA998",
        checks: [
          {
            date: "2026-05-29",
            status: "missing_receipt_row",
            matchedRowCount: 0,
            detail: "Connector search returned 0 matching rows for 2026-05-29.",
          },
        ],
      },
    );

    expect(summaries[0].uploadReceiptCheck?.status).toBe("missing_receipt_row");
    expect(summaries[0].uploadReceiptCheck?.scannedRange).toBe("A1:AA998");
    expect(summaries[0].issues.some((nextIssue) => nextIssue.title === "Connector receipt row not found")).toBe(true);
    expect(summaries[0].issueCount).toBe(2);
  });

  it("builds the direct Google Sheet CSV export URL for a named tracker tab", () => {
    expect(googleSheetCsvExportUrl("Daily Sync Runs")).toContain("/gviz/tq?tqx=out%3Acsv&sheet=Daily+Sync+Runs");
  });

  it("prefers new 5-second SPX and IBKR option artifacts while keeping 1-minute fallbacks", () => {
    expect(spxIntradayTabCandidates()[0]).toEqual({ csvName: "SPX_5s.csv", sheetName: "SPX 5s" });
    expect(spxIntradayTabCandidates()[1]).toEqual({ csvName: "SPX_1m.csv", sheetName: "SPX 1m" });
    expect(path.basename(optionLegTradeCsvCandidates("2026-05-29")[0])).toBe("option_leg_trades_5s.csv");
    expect(path.basename(optionLegTradeCsvCandidates("2026-05-29")[1])).toBe("option_leg_trades_1m.csv");
    expect(path.basename(volumeProfileCsvCandidates("2026-05-29")[0])).toBe("IBKR_0DTE_SPX_Cumulative_Volume_Profile_5s.csv");
    expect(path.basename(volumeProfileCsvCandidates("2026-05-29")[1])).toBe("IBKR_0DTE_SPX_Cumulative_Volume_Profile_1m.csv");
  });

  it("probes direct Google Sheet CSV export when the tracker tab is publicly readable", async () => {
    const previous = process.env.SPX_GOOGLE_EXPORT_PROBE;
    process.env.SPX_GOOGLE_EXPORT_PROBE = "1";
    const fakeFetch: typeof fetch = async () =>
      new Response("date,status\n2026-05-28,ok\n", {
        headers: { "content-type": "text/csv" },
        status: 200,
      });

    try {
      const source = await probeGoogleSheetCsvExport(fakeFetch);

      expect(source.label).toBe("Google CSV export probe");
      expect(source.status).toBe("ok");
      expect(source.count).toBe(1);
      expect(source.detail).toContain("readable without a browser session");
    } finally {
      if (previous === undefined) {
        delete process.env.SPX_GOOGLE_EXPORT_PROBE;
      } else {
        process.env.SPX_GOOGLE_EXPORT_PROBE = previous;
      }
    }
  });

  it("surfaces direct Google Sheet CSV auth failures as source diagnostics", async () => {
    const previous = process.env.SPX_GOOGLE_EXPORT_PROBE;
    process.env.SPX_GOOGLE_EXPORT_PROBE = "1";
    const fakeFetch: typeof fetch = async () =>
      new Response("<html>Sign in</html>", {
        headers: { "content-type": "text/html" },
        status: 401,
        statusText: "Unauthorized",
      });

    try {
      const source = await probeGoogleSheetCsvExport(fakeFetch);

      expect(source.label).toBe("Google CSV export probe");
      expect(source.status).toBe("warning");
      expect(source.detail).toContain("HTTP 401 Unauthorized");
      expect(source.detail).toContain("Google auth is required");
    } finally {
      if (previous === undefined) {
        delete process.env.SPX_GOOGLE_EXPORT_PROBE;
      } else {
        process.env.SPX_GOOGLE_EXPORT_PROBE = previous;
      }
    }
  });

  it("treats private CSV export auth gates as benign when authenticated Google API refresh is ready", () => {
    const source = reconcileGoogleCsvProbeWithApi(
      {
        detail: "Direct Google CSV export returned HTTP 401 Unauthorized; Google auth is required before the desktop app can import raw tracker tabs directly.",
        label: "Google CSV export probe",
        status: "warning",
      },
      {
        detail: "Credential source configured via GOOGLE_SERVICE_ACCOUNT_PATH; the desktop app auto-refreshes this snapshot from /api/tracker.",
        label: "Google API snapshot refresh",
        status: "ok",
      },
    );

    expect(source.status).toBe("ok");
    expect(source.detail).toContain("expected");
    expect(source.detail).toContain("Authenticated Google Sheets API refresh");
  });

  itArchive("loads replay panes for the latest traded date", async () => {
    const replay = await loadReplayPayload("2026-05-28", "IBKR-997697494-1");

    expect(replay.spxBars.length).toBeGreaterThan(300);
    expect(replay.spreadMarks.some((mark) => mark.tradeId === "IBKR-997697494-1")).toBe(true);
    expect(replay.openInterest.length).toBeGreaterThan(0);
    expect(replay.volume.length).toBeGreaterThan(0);
  });

  itArchive("loads live same-day replay data from staged payload tabs and filters non-SPX option noise", async () => {
    const replay = await loadReplayPayload("2026-05-29");

    expect(replay.spxBars.length).toBeGreaterThan(300);
    expect(replay.quickTrades.length).toBeGreaterThan(0);
    expect(replay.quickTrades.every((trade) => trade.legs.length >= 2)).toBe(true);
    expect(replay.quickTrades.every((trade) => trade.legs.every((leg) => normalizeTestSymbol(leg.localSymbol).startsWith("SPXW ")))).toBe(true);
    expect(replay.spreadMarks.some((mark) => replay.quickTrades.some((trade) => trade.id === mark.tradeId))).toBe(true);
    expect(replay.openInterest.length).toBeGreaterThan(0);
    expect(replay.openInterest.every((point) => point.strike > 1000)).toBe(true);
    expect(replay.volume.length).toBeGreaterThan(0);
    expect(replay.volume.every((point) => point.strike > 1000)).toBe(true);
  });

  itArchive("loads spread OHLC range data from the reconstructed two-leg spread marks", async () => {
    const replay = await loadReplayPayload("2026-05-28", "IBKR-997697617-7");
    const entryMark = replay.spreadMarks.find((mark) => mark.tradeId === "IBKR-997697617-7" && mark.label === "10:15");

    expect(entryMark).toBeDefined();
    expect(entryMark?.activeLegCount).toBe(2);
    expect(entryMark?.open).toBeCloseTo(-1.5);
    expect(entryMark?.high).toBeCloseTo(-0.5);
    expect(entryMark?.low).toBeCloseTo(-3.1);
    expect(entryMark?.close).toBeCloseTo(-0.9);
    expect(entryMark?.high).toBeGreaterThan(entryMark?.value ?? Number.POSITIVE_INFINITY);
    expect(entryMark?.low).toBeLessThan(entryMark?.value ?? Number.NEGATIVE_INFINITY);
  });

  itArchive("represents every imported spread with full-session two-leg mark reconstruction", async () => {
    const replay = await loadReplayPayload("2026-05-28", "IBKR-997697494-1");
    const expectedTradeIds = new Set(replay.quickTrades.map((trade) => trade.id));
    const expectedLegsByTrade = new Map(
      replay.quickTrades.map((trade) => [trade.id, new Set(trade.legs.map((leg) => normalizeTestSymbol(leg.localSymbol)))]),
    );
    const marksByTrade = new Map<string, typeof replay.spreadMarks>();

    for (const mark of replay.spreadMarks) {
      if (!expectedTradeIds.has(mark.tradeId)) {
        continue;
      }
      marksByTrade.set(mark.tradeId, [...(marksByTrade.get(mark.tradeId) ?? []), mark]);
    }

    expect(marksByTrade.size).toBe(expectedTradeIds.size);
    for (const [tradeId, marks] of marksByTrade) {
      expect(tradeId).toMatch(/^IBKR-/);
      // 391 = 09:30 .. 16:00 inclusive. The upstream series carries ~14 more
      // forward-filled phantom marks past the close; sanitize trims them.
      expect(marks.length).toBe(391);
      expect(marks.every((mark) => mark.activeLegCount === 2)).toBe(true);
      expect(marks.some((mark) => Number.isFinite(mark.high) && Number.isFinite(mark.low) && mark.high !== mark.low)).toBe(true);
      const expectedLegs = expectedLegsByTrade.get(tradeId) ?? new Set();
      expect(
        marks.every((mark) => {
          const markLegs = new Set((mark.legSymbols ?? []).map(normalizeTestSymbol));
          return [...expectedLegs].every((leg) => markLegs.has(leg));
        }),
      ).toBe(true);
    }
  });

  it("reconstructs fallback spread OHLC from every option leg instead of close-only marks", () => {
    const spread = estimateSpreadRangeFromLegBars([
      {
        symbol: "short call",
        dir: -1,
        ratio: 1,
        open: 5,
        high: 7,
        low: 4,
        close: 6,
        vwap: 5.5,
        volume: 20,
        count: 8,
      },
      {
        symbol: "long call",
        dir: 1,
        ratio: 1,
        open: 3,
        high: 4,
        low: 2,
        close: 2.5,
        vwap: 3.1,
        volume: 12,
        count: 4,
      },
    ]);

    expect(spread).toMatchObject({
      open: -2,
      high: 0,
      low: -5,
      close: -3.5,
      value: -3.5,
      vwap: -2.4,
      minLegVolume: 12,
      minLegCount: 4,
    });
  });

  itArchive("flags credit spread entry fills that diverge from the chart mark", async () => {
    const replay = await loadReplayPayload("2026-05-28");
    const flagged = replay.quickTrades.find((trade) => trade.id === "IBKR-997697617-7");
    const ordinary = replay.quickTrades.find((trade) => trade.id === "IBKR-997697494-1");

    expect(flagged?.entryChartDeviationFlag).toBe(true);
    expect(flagged?.entryChartMark).toBeCloseTo(-0.9);
    expect(flagged?.entryChartDeviation).toBeCloseTo(-0.4);
    expect(flagged?.entryChartMarkTime).toBe("2026-05-28T10:15:00-04:00");
    expect(ordinary?.entryChartDeviationFlag).toBe(false);
  });

  itArchive("keeps the tracker snapshot summary-first instead of hydrating row-level replay marks", async () => {
    const snapshot = await loadTrackerSnapshot();
    const trade = snapshot.trades.find((nextTrade) => nextTrade.id === "IBKR-997697617-7");

    expect(trade?.entryChartDeviationFlag).toBe(false);
    expect(trade?.entryChartMark).toBeNull();
    expect(trade?.entryChartDeviation).toBeNull();
  });

  itArchive("reuses the tracker snapshot for immediate repeated dashboard reads", async () => {
    const first = await loadTrackerSnapshot();
    const second = await loadTrackerSnapshot();

    expect(second.generatedAt).toBe(first.generatedAt);
    expect(second.latestTradeDate).toBe(first.latestTradeDate);
  });

  itArchive("loads pre-entry spread marks so the spread chart tracks before entry", async () => {
    const tradeId = "IBKR-997697564-4";
    const replay = await loadReplayPayload("2026-05-28", tradeId);
    const trade = replay.quickTrades.find((next) => next.id === tradeId);
    const entryTime = Math.floor(Date.parse(trade?.entryTime ?? "") / 1000);
    const marks = replay.spreadMarks.filter((mark) => mark.tradeId === tradeId);
    const preEntry = marks.filter((mark) => mark.time < entryTime);

    expect(preEntry.length).toBeGreaterThan(0);
    expect(preEntry.some((mark) => mark.source === "IBKR_TRADES_1m_ohlc_ffill_nickel")).toBe(true);
    // Credit spreads carry a negative mark; a flipped sign would jump at the seam.
    expect(preEntry.at(-1)?.value).toBeLessThan(0);
  });

  it("skips pre-entry reconstruction when derived spread marks already cover before entry", async () => {
    expect(
      shouldReconstructPreEntryMarks(
        [
          {
            entrySequence: 1,
            label: "09:30",
            permId: "123",
            source: "IBKR_TRADES_1m_ohlc_ffill_nickel",
            time: Math.floor(Date.parse("2026-05-28T09:30:00-04:00") / 1000),
            timestampEt: "2026-05-28T09:30:00-04:00",
            tradeId: "IBKR-123-1",
            value: -1.2,
          },
        ],
        {
          entryTime: "2026-05-28T09:32:00-04:00",
          id: "IBKR-123-1",
        },
      ),
    ).toBe(false);
  });

  itArchive("keeps safe replay spread marks inside the selected vertical width", async () => {
    const replay = await loadReplayPayload("2026-06-05");
    const trades = new Map(replay.quickTrades.map((trade) => [trade.id, trade]));
    const impossible = replay.spreadMarks.filter((mark) => {
      const trade = trades.get(mark.tradeId);
      return Boolean(trade?.width && Math.abs(mark.value) > trade.width + 0.01);
    });

    expect(impossible).toHaveLength(0);
  });

  itArchive("surfaces pull and upload issues from the daily sync archive", async () => {
    const snapshot = await loadTrackerSnapshot();
    const summary = snapshot.dailySummaries.find((nextSummary) => nextSummary.date === "2026-05-28");

    expect(summary).toBeDefined();
    expect(summary?.fillCount).toBe(253);
    expect(summary?.spreadCount).toBe(30);
    expect(summary?.entryCount).toBe(21);
    expect(summary?.optionContractCount).toBe(11);
    expect(summary?.issueCount).toBe(summary?.issues.filter((issue) => issue.severity !== "info").length);
    expect(summary?.issues.some((issue) => issue.stage === "pull")).toBe(true);
    expect(summary?.issues.find((issue) => issue.title === "Validated IBKR archive summary")).toBeDefined();
    expect(summary?.uploadStatus).toBe(summary?.rawUploadGoogleSheetUrl ? "uploaded" : "payload_ready_unconfirmed");
    if (summary?.rawUploadGoogleSheetUrl) {
      expect(summary.rawUploadGoogleSheetUrl).toContain("docs.google.com/spreadsheets");
    }
    expect(summary?.issues.some((issue) => issue.title === "Google tracker upload not confirmed")).toBe(false);
    expect(summary?.issues.some((issue) => issue.title === "Google tracker upload confirmed")).toBe(summary?.uploadStatus === "uploaded");
  });

  it("loads IBKR wallet size from a configured account snapshot file", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spx-wallet-"));
    const snapshotPath = path.join(tempDir, "account_snapshot.json");
    const previousPath = process.env.IBKR_ACCOUNT_SNAPSHOT_PATH;
    const previousEnvWallet = process.env.IBKR_WALLET_SIZE;

    await fs.writeFile(
      snapshotPath,
      JSON.stringify(
        {
          fetched_at: "2026-05-29T13:00:00-04:00",
          account_summary: [
            { account: "U19610351", tag: "BuyingPower", value: "250000.00", currency: "USD" },
            { account: "U19610351", tag: "NetLiquidation", value: "123456.78", currency: "USD" },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    process.env.IBKR_ACCOUNT_SNAPSHOT_PATH = snapshotPath;
    process.env.IBKR_WALLET_SIZE = "111";

    try {
      const wallet = await readWallet();

      expect(wallet.netLiquidation).toBe(123456.78);
      expect(wallet.account).toBe("U19610351");
      expect(wallet.updatedAt).toBe("2026-05-29T13:00:00-04:00");
      expect(wallet.source).toBe("IBKR_ACCOUNT_SNAPSHOT_PATH");
    } finally {
      if (previousPath === undefined) {
        delete process.env.IBKR_ACCOUNT_SNAPSHOT_PATH;
      } else {
        process.env.IBKR_ACCOUNT_SNAPSHOT_PATH = previousPath;
      }
      if (previousEnvWallet === undefined) {
        delete process.env.IBKR_WALLET_SIZE;
      } else {
        process.env.IBKR_WALLET_SIZE = previousEnvWallet;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("persists daily review notes by trade date", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spx-review-notes-"));
    const notesPath = path.join(tempDir, "review-notes.json");
    const previousPath = process.env.REVIEW_NOTES_PATH;
    process.env.REVIEW_NOTES_PATH = notesPath;

    try {
      const saved = await writeReviewNote("2026-05-28", "Avoid chasing the second CCS; wait for confirmation.", {
        "IBKR-997697617-7": "mistake",
        "IBKR-997697850-21": "quality",
        ignored: "bad-value",
      });
      const notes = await readReviewNotes();

      expect(saved.date).toBe("2026-05-28");
      expect(saved.note).toBe("Avoid chasing the second CCS; wait for confirmation.");
      expect(saved.tradeFlags).toEqual({
        "IBKR-997697617-7": "mistake",
        "IBKR-997697850-21": "quality",
      });
      expect(saved.updatedAt).toMatch(/^2026|^20/);
      expect(notes["2026-05-28"]?.note).toBe("Avoid chasing the second CCS; wait for confirmation.");
      expect(notes["2026-05-28"]?.tradeFlags["IBKR-997697617-7"]).toBe("mistake");

      const resaved = await writeReviewNote("2026-05-28", "Keep the flag if the UI saves text only.");
      expect(resaved.tradeFlags["IBKR-997697617-7"]).toBe("mistake");
    } finally {
      if (previousPath === undefined) {
        delete process.env.REVIEW_NOTES_PATH;
      } else {
        process.env.REVIEW_NOTES_PATH = previousPath;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves daily review notes saved concurrently for different dates", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spx-review-notes-race-"));
    const notesPath = path.join(tempDir, "review-notes.json");
    const previousPath = process.env.REVIEW_NOTES_PATH;
    process.env.REVIEW_NOTES_PATH = notesPath;

    try {
      await Promise.all([
        writeReviewNote("2026-05-28", "First note"),
        writeReviewNote("2026-05-29", "Second note"),
      ]);

      const notes = await readReviewNotes();
      expect(notes["2026-05-28"]?.note).toBe("First note");
      expect(notes["2026-05-29"]?.note).toBe("Second note");
    } finally {
      if (previousPath === undefined) {
        delete process.env.REVIEW_NOTES_PATH;
      } else {
        process.env.REVIEW_NOTES_PATH = previousPath;
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

function normalizeTestSymbol(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
