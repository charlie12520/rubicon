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
});
