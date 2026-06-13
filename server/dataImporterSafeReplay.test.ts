import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_AI_STUFF_ROOT = process.env.AI_STUFF_ROOT;

afterEach(() => {
  vi.resetModules();
  if (ORIGINAL_AI_STUFF_ROOT === undefined) {
    delete process.env.AI_STUFF_ROOT;
  } else {
    process.env.AI_STUFF_ROOT = ORIGINAL_AI_STUFF_ROOT;
  }
});

describe("Replay safe default", () => {
  it("does not fall back to the full google payload when safe sidecars are unavailable", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-safe-replay-"));
    const date = "2026-06-01";
    const dayDir = path.join(tempRoot, "IBKR Equity History Pull", "data", "ibkr_trades", date);
    await fs.mkdir(dayDir, { recursive: true });
    await fs.writeFile(
      path.join(dayDir, "entries.csv"),
      [
        "account,target_trade_date_et,perm_id,entry_sequence,spread_class,legs,entry_quantity,entry_price,entry_credit_debit,total_commission,entry_time_et,lifecycle_status,exit_price,exit_time_et,exit_total_commission",
        "DU123,2026-06-01,123,1,call_credit_vertical,SPXW 260601C05000000|SPXW 260601C05005000,1,-1.00,credit,0,2026-06-01T09:30:00-04:00,Closed,0.25,2026-06-01T09:45:00-04:00,0",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(dayDir, "google_sheet_upload_payload.json"),
      JSON.stringify({
        tabs: [
          {
            headers: ["timestamp_et", "symbol", "open", "high", "low", "close"],
            rows: [["2026-06-01T09:30:00-04:00", "SPX", "5000", "5001", "4999", "5000"]],
            sheet_name: "SPX 5s",
          },
        ],
      }),
      "utf8",
    );

    process.env.AI_STUFF_ROOT = tempRoot;
    vi.resetModules();

    try {
      const { loadReplayPayload } = await import("./dataImporter.ts");
      const replay = await loadReplayPayload(date);

      expect(replay.date).toBe(date);
      expect(replay.selectedTradeId).toBeNull();
      expect(replay.spxBars).toEqual([]);
      expect(replay.quickTrades).toEqual([]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rebuilds old-version safe replay caches before serving spread marks", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-safe-replay-version-"));
    const date = "2026-06-05";
    const dayDir = path.join(tempRoot, "IBKR Equity History Pull", "data", "ibkr_trades", date);
    const tabsDir = path.join(dayDir, "google_sheet_tab_csvs");
    const optionDir = path.join(dayDir, "ibkr_option_intraday");
    await fs.mkdir(tabsDir, { recursive: true });
    await fs.mkdir(optionDir, { recursive: true });

    const entriesPath = path.join(dayDir, "entries.csv");
    const spxPath = path.join(tabsDir, "SPX_5s.csv");
    const marksPath = path.join(optionDir, "spread_trade_marks_5s.csv");
    const spreadKey = JSON.stringify([
      { abs_ratio: 1, expiration: "20260605", local_symbol: "SPXW  260605P07470000", right: "P", strike: 7470 },
      { abs_ratio: 1, expiration: "20260605", local_symbol: "SPXW  260605P07475000", right: "P", strike: 7475 },
    ]);
    await fs.writeFile(
      entriesPath,
      [
        "target_trade_date_et,account,perm_id,entry_sequence,entry_action,entry_time_et,spread_key,entry_quantity,entry_price,entry_credit_debit,spread_class,legs,direction_vector,total_commission,lifecycle_status,exit_time_et,exit_price,exit_total_commission,position_before,position_after",
        [
          date,
          "DU123",
          "123",
          "1",
          "entry",
          "2026-06-05T09:31:00-04:00",
          csvCell(spreadKey),
          "1",
          "-0.50",
          "credit",
          "put_credit_vertical",
          csvCell("SPXW  260605P07470000 BOT | SPXW  260605P07475000 SLD"),
          csvCell(JSON.stringify([1, -1])),
          "0",
          "Closed",
          "2026-06-05T09:45:00-04:00",
          "-1.00",
          "0",
          "0",
          "1",
        ].join(","),
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      spxPath,
      "timestamp_et,symbol,open,high,low,close\n2026-06-05T09:31:00-04:00,SPX,5000,5001,4999,5000\n",
      "utf8",
    );
    await fs.writeFile(
      marksPath,
      [
        "perm_id,entry_sequence,timestamp_et,spread_trade_mark,spread_close,source",
        "123,1,2026-06-05T09:31:00-04:00,-9,-9,IBKR_TRADES_5s_ohlc_ffill_nickel",
      ].join("\n"),
      "utf8",
    );

    const source = {
      entries: await sourceFile(entriesPath),
      openInterest: { path: null, mtimeMs: null },
      spx: await sourceFile(spxPath),
      spreadMarks: await sourceFile(marksPath),
      volume: { path: null, mtimeMs: null },
    };
    await fs.writeFile(
      path.join(dayDir, "rubicon_replay_safe_state.json"),
      JSON.stringify(
        {
          generatedAt: "2026-06-06T00:00:00.000Z",
          payload: {
            date,
            openInterest: [],
            quickTrades: [],
            selectedTradeId: null,
            spreadMarks: [
              {
                entrySequence: 1,
                label: "09:31",
                permId: "123",
                source: "cached-old",
                time: Math.floor(Date.parse("2026-06-05T09:31:00-04:00") / 1000),
                timestampEt: "2026-06-05T09:31:00-04:00",
                tradeId: "IBKR-123-1",
                value: -99,
              },
            ],
            spxBars: [
              {
                close: 4999,
                high: 4999,
                label: "09:31",
                low: 4999,
                open: 4999,
                time: Math.floor(Date.parse("2026-06-05T09:31:00-04:00") / 1000),
                timestampEt: "2026-06-05T09:31:00-04:00",
              },
            ],
            volume: [],
          },
          projection: { spxBars: "old", spreadMarks: "old", volume: "old" },
          schema: "rubicon-replay-safe-state",
          source,
          version: 2,
        },
        null,
        2,
      ),
      "utf8",
    );

    process.env.AI_STUFF_ROOT = tempRoot;
    vi.resetModules();

    try {
      const { loadReplayPayload } = await import("./dataImporter.ts");
      const replay = await loadReplayPayload(date);

      expect(replay.spxBars[0]?.close).toBe(5000);
      expect(replay.spreadMarks[0]?.value).toBe(-5);
      expect(replay.spreadMarks[0]?.source).toContain("rubicon_width_clamped");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("serves SPX-only safe replay for market-data-only review days", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-safe-replay-market-data-only-"));
    const date = "2026-06-12";
    const dayDir = path.join(tempRoot, "IBKR Equity History Pull", "data", "ibkr_trades", date);
    const tabsDir = path.join(dayDir, "google_sheet_tab_csvs");
    await fs.mkdir(tabsDir, { recursive: true });
    await fs.writeFile(path.join(dayDir, "entries.csv"), "target_trade_date_et,account,perm_id,entry_sequence\n", "utf8");
    await fs.writeFile(
      path.join(tabsDir, "IBKR_Underlying_1m.csv"),
      [
        "target_trade_date_et,timestamp_utc,timestamp_et,symbol,open,high,low,close",
        `${date},2026-06-12T13:30:00+00:00,2026-06-12T09:30:00-04:00,SPX,7410,7418,7409,7412`,
        `${date},2026-06-12T19:59:55+00:00,2026-06-12T15:59:55-04:00,SPX,7430,7432,7428,7431`,
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(tabsDir, "IBKR_0DTE_SPX_Open_Interest.csv"),
      [
        "target_trade_date_et,expiration,right,strike,option_label,open_interest",
        `${date},20260612,C,7430,SPXW 260612C07430000,125`,
        `${date},20260612,P,7420,SPXW 260612P07420000,220`,
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(tabsDir, "IBKR_0DTE_SPX_Cumulative_Volume_Profile_5s.csv"),
      [
        "target_trade_date_et,timestamp_et,expiration,right,strike,option_label,bar_volume,cumulative_volume",
        `${date},2026-06-12T09:30:00-04:00,20260612,C,7430,SPXW 260612C07430000,3,3`,
        `${date},2026-06-12T09:30:00-04:00,20260612,P,7420,SPXW 260612P07420000,5,5`,
        `${date},2026-06-12T09:30:05-04:00,20260612,C,7430,SPXW 260612C07430000,7,10`,
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(dayDir, "daily_sync_summary.json"),
      JSON.stringify({
        target_trade_date_et: date,
        reviewReady: true,
        localReviewStatus: { status: "market_data_only" },
        availability: {
          status: "ok",
          review_mode: "market_data_only",
          spx_intraday: { status: "ok", rows: 4680, bar_size: "5s" },
          trades_and_spreads: {
            status: "empty",
            counts: { trade_count: 0, spread_count: 0, entry_count: 0, option_contract_count: 0 },
          },
        },
        trades: { status: "empty", trade_count: 0, spread_count: 0, entry_count: 0, option_contract_count: 0 },
      }),
      "utf8",
    );

    process.env.AI_STUFF_ROOT = tempRoot;
    vi.resetModules();

    try {
      const { loadReplayPayload } = await import("./dataImporter.ts");
      const replay = await loadReplayPayload(date);

      expect(replay.date).toBe(date);
      expect(replay.selectedTradeId).toBeNull();
      expect(replay.quickTrades).toEqual([]);
      expect(replay.spreadMarks).toEqual([]);
      expect(replay.spxBars).toHaveLength(2);
      expect(replay.spxBars[0]?.timestampEt).toBe("2026-06-12T09:30:00-04:00");
      expect(replay.spxBars[1]?.timestampEt).toBe("2026-06-12T15:59:55-04:00");
      expect(replay.openInterest).toEqual([
        { strike: 7420, right: "P", label: "SPXW 260612P07420000", openInterest: 220 },
        { strike: 7430, right: "C", label: "SPXW 260612C07430000", openInterest: 125 },
      ]);
      expect(replay.volume).toEqual([
        {
          timestampEt: "2026-06-12T09:30:00-04:00",
          label: "09:30",
          time: Math.floor(Date.parse("2026-06-12T09:30:00-04:00") / 1000),
          strike: 7420,
          right: "P",
          optionLabel: "SPXW 260612P07420000",
          minuteVolume: 5,
          cumulativeVolume: 5,
        },
        {
          timestampEt: "2026-06-12T09:30:00-04:00",
          label: "09:30",
          time: Math.floor(Date.parse("2026-06-12T09:30:00-04:00") / 1000),
          strike: 7430,
          right: "C",
          optionLabel: "SPXW 260612C07430000",
          minuteVolume: 3,
          cumulativeVolume: 3,
        },
      ]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps trade-review days with missing entries out of safe replay", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-safe-replay-missing-entries-"));
    const date = "2026-06-12";
    const dayDir = path.join(tempRoot, "IBKR Equity History Pull", "data", "ibkr_trades", date);
    const tabsDir = path.join(dayDir, "google_sheet_tab_csvs");
    await fs.mkdir(tabsDir, { recursive: true });
    await fs.writeFile(path.join(dayDir, "entries.csv"), "target_trade_date_et,account,perm_id,entry_sequence\n", "utf8");
    await fs.writeFile(
      path.join(tabsDir, "IBKR_Underlying_1m.csv"),
      [
        "target_trade_date_et,timestamp_utc,timestamp_et,symbol,open,high,low,close",
        `${date},2026-06-12T13:30:00+00:00,2026-06-12T09:30:00-04:00,SPX,7410,7418,7409,7412`,
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(dayDir, "daily_sync_summary.json"),
      JSON.stringify({
        target_trade_date_et: date,
        reviewReady: false,
        localReviewStatus: { status: "blocked" },
        availability: {
          status: "incomplete",
          review_mode: "trade_review",
          spx_intraday: { status: "ok", rows: 4680, bar_size: "5s" },
          trades_and_spreads: {
            status: "ok",
            counts: { trade_count: 2, spread_count: 0, entry_count: 0, option_contract_count: 0 },
          },
        },
        trades: { status: "ok", trade_count: 2, spread_count: 0, entry_count: 0, option_contract_count: 0 },
      }),
      "utf8",
    );

    process.env.AI_STUFF_ROOT = tempRoot;
    vi.resetModules();

    try {
      const { loadReplayPayload } = await import("./dataImporter.ts");
      const replay = await loadReplayPayload(date);

      expect(replay.date).toBe(date);
      expect(replay.spxBars).toEqual([]);
      expect(replay.quickTrades).toEqual([]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

async function sourceFile(target: string): Promise<{ path: string; mtimeMs: number }> {
  const stats = await fs.stat(target);
  return { path: target, mtimeMs: stats.mtimeMs };
}
