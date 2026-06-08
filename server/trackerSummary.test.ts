import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RUBICON_TRACKER_SUMMARY_FILE,
  buildRubiconDailySummaryFromSyncSummary,
  loadMissingRubiconDailySummary,
  loadOrBuildRubiconDailySummary,
} from "./trackerSummary.ts";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((target) => fs.rm(target, { force: true, recursive: true })));
  tempDirs = [];
});

async function tempDayDir(date = "2026-06-01"): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-tracker-summary-"));
  tempDirs.push(root);
  const dayDir = path.join(root, date);
  await fs.mkdir(dayDir, { recursive: true });
  return dayDir;
}

describe("Rubicon tracker summary cache", () => {
  it("builds the dashboard summary from daily_sync_summary without reading the giant upload payload", async () => {
    const dayDir = await tempDayDir();
    const syncSummary = {
      target_trade_date_et: "2026-06-01",
      log_path: path.join(dayDir, "sync.log"),
      spx: {
        status: "up_to_date",
        target_partition: {
          bar_size: "5s",
          expected_rows: 4680,
          rows: 4680,
          status: "ok",
        },
      },
      trades: {
        connections: [{ connected: true, host: "127.0.0.1", port: 7496 }],
        errors: [],
        entry_count: 22,
        option_contract_count: 19,
        outputs: {
          contracts_csv: path.join(dayDir, "contracts.csv"),
          entries_csv: path.join(dayDir, "entries.csv"),
          fills_csv: path.join(dayDir, "fills.csv"),
          spreads_csv: path.join(dayDir, "spreads.csv"),
        },
        spread_count: 31,
        status: "ok",
        trade_count: 75,
      },
      theta: {
        contract_count: 19,
        status: "disabled",
      },
      ibkr_option_trades: {
        bar_size: "5 secs",
        contract_count: 124,
        empty_contract_count: 7,
        expected_no_data_contract_count: 14,
        expected_rows_per_contract: 4860,
        leg_trade_rows: 540996,
        open_interest: {
          contract_count: 124,
          ok_count: 123,
          row_count: 124,
          status: "partial",
        },
        spread_trade_mark_rows: 103605,
        status: "partial",
        traded_option_contract_count: 19,
        underlying_intraday: {
          row_count: 7410,
          status: "ok",
          symbol_count: 8,
        },
        unexpected_error_count: 35,
        volume_profile: {
          profile_row_count: 540996,
          status: "ok",
        },
      },
      availability: {
        status: "partial",
        ibkr_option_intraday: {
          counts: {
            contract_count: 124,
            open_interest_rows: 124,
            spread_mark_rows: 103605,
            traded_option_contract_count: 19,
            underlying_1m_rows: 7410,
            underlying_1m_status: "ok",
            underlying_1m_symbol_count: 8,
            volume_profile_rows: 540996,
          },
        },
      },
    };
    await fs.writeFile(path.join(dayDir, "daily_sync_summary.json"), `${JSON.stringify(syncSummary, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(dayDir, "google_sheet_upload_payload.json"), "{this file is intentionally not JSON", "utf8");

    const summary = await loadOrBuildRubiconDailySummary(dayDir);

    expect(summary?.date).toBe("2026-06-01");
    expect(summary?.fillCount).toBe(75);
    expect(summary?.entryCount).toBe(22);
    expect(summary?.spxIntradayBarSize).toBe("5s");
    expect(summary?.optionIntradayRowCount).toBe(540996);
    expect(summary?.spreadMarkRowCount).toBe(103605);
    expect(summary?.volumeProfileRowCount).toBe(540996);
    expect(summary?.openInterestValidRowCount).toBe(123);
    expect(summary?.underlyingIntradayRowCount).toBe(7410);
    expect(summary?.uploadTabCount).toBe(1);
    expect(summary?.payloadRows).toBe(23);
    expect(summary?.payloadPath).toContain("google_sheet_upload_payload.json");
    expect(summary?.workbookPath).toBeUndefined();
    await expect(fs.access(path.join(dayDir, RUBICON_TRACKER_SUMMARY_FILE))).resolves.toBeUndefined();
  });

  it("keeps cached validated summaries stable until daily_sync_summary changes", async () => {
    const dayDir = await tempDayDir("2026-05-29");
    const source = {
      availability: { status: "ok" },
      spx: { status: "up_to_date", target_partition: { bar_size: "1m", expected_rows: 390, rows: 390 } },
      target_trade_date_et: "2026-05-29",
      theta: { status: "theta_unavailable" },
      trades: { entry_count: 19, option_contract_count: 12, spread_count: 24, status: "ok", trade_count: 136 },
      ibkr_option_trades: { contract_count: 120, expected_rows_per_contract: 405, leg_trade_rows: 43565, status: "partial" },
    };
    const sourcePath = path.join(dayDir, "daily_sync_summary.json");
    await fs.writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`, "utf8");

    const first = await loadOrBuildRubiconDailySummary(dayDir);
    const second = await loadOrBuildRubiconDailySummary(dayDir);

    expect(first?.fillCount).toBe(136);
    expect(second).toEqual(first);
  });

  it("describes Rubicon's current tracker-facing artifacts without embedding row-level data", () => {
    const summary = buildRubiconDailySummaryFromSyncSummary(
      {
        availability: { status: "ok" },
        target_trade_date_et: "2026-06-01",
        spx: { status: "up_to_date", target_partition: { rows: 4680 } },
        trades: { entry_count: 22, option_contract_count: 19, spread_count: 31, status: "ok", trade_count: 75 },
        theta: { status: "disabled" },
        ibkr_option_trades: { expected_rows_per_contract: 4860, leg_trade_rows: 540996, status: "partial" },
      },
      {
        date: "2026-06-01",
        payloadExists: true,
        payloadPath: "google_sheet_upload_payload.json",
      },
    );

    expect(summary.issues.some((issue) => issue.title === "Validated IBKR archive summary")).toBe(true);
    expect(summary.issues.find((issue) => issue.title === "Validated IBKR archive summary")?.detail).toContain("row-level IBKR artifacts stay in the archive");
  });

  it("builds a missing dashboard summary without parsing staged row-level payloads", async () => {
    const dayDir = await tempDayDir("2026-06-03");
    await fs.writeFile(path.join(dayDir, "google_sheet_upload_payload.json"), "{this file is intentionally not JSON", "utf8");

    const summary = await loadMissingRubiconDailySummary(dayDir);

    expect(summary.date).toBe("2026-06-03");
    expect(summary.uploadStatus).toBe("payload_ready_unconfirmed");
    expect(summary.payloadPath).toContain("google_sheet_upload_payload.json");
    expect(summary.uploadTabCount).toBe(0);
    expect(summary.payloadRows).toBe(0);
    expect(summary.issues.some((issue) => issue.title === "Daily sync summary missing")).toBe(true);
  });
});
