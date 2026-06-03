import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const originalAiStuffRoot = process.env.AI_STUFF_ROOT;

afterEach(() => {
  vi.resetModules();
  if (originalAiStuffRoot === undefined) {
    delete process.env.AI_STUFF_ROOT;
  } else {
    process.env.AI_STUFF_ROOT = originalAiStuffRoot;
  }
});

async function writeFixtureArchive(root: string, date: string): Promise<string> {
  const dayDir = path.join(root, "IBKR Equity History Pull", "data", "ibkr_trades", date);
  const optionDir = path.join(dayDir, "ibkr_option_intraday");
  await fs.mkdir(optionDir, { recursive: true });
  await fs.writeFile(
    path.join(optionDir, "underlying_1m.csv"),
    [
      "timestamp_et,symbol,open,high,low,close",
      `${date}T09:30:00-04:00,SPX,5000,5001,4999,5000`,
      `${date}T09:31:00-04:00,SPX,5001,5002,5000,5001`,
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(optionDir, "option_leg_trades_5s.csv"),
    [
      "timestamp_et,trading_class,last_trade_date_or_contract_month,strike,right,close",
      `${date}T09:30:00-04:00,SPXW,20260601,5000,C,12`,
      `${date}T09:30:00-04:00,SPXW,20260601,5000,P,11`,
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(dayDir, "google_sheet_upload_payload.json"), "{not-json", "utf8");
  return dayDir;
}

async function writeDuplicateMinuteArchive(root: string, date: string): Promise<void> {
  const dayDir = path.join(root, "IBKR Equity History Pull", "data", "ibkr_trades", date);
  const tabDir = path.join(dayDir, "google_sheet_tab_csvs");
  const optionDir = path.join(dayDir, "ibkr_option_intraday");
  await fs.mkdir(tabDir, { recursive: true });
  await fs.mkdir(optionDir, { recursive: true });
  await fs.writeFile(
    path.join(tabDir, "SPX_5s.csv"),
    [
      "timestamp_et,symbol,open,high,low,close",
      `${date}T09:30:00-04:00,SPX,5000,5001,4999,5000`,
      `${date}T09:30:05-04:00,SPX,5000,5002,4999,5001`,
      `${date}T09:31:00-04:00,SPX,5001,5003,5000,5002`,
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(optionDir, "option_leg_trades_5s.csv"),
    [
      "timestamp_et,trading_class,last_trade_date_or_contract_month,strike,right,close",
      `${date}T09:30:00-04:00,SPXW,20260601,5000,C,12`,
      `${date}T09:30:00-04:00,SPXW,20260601,5000,P,11`,
    ].join("\n"),
    "utf8",
  );
}

describe("Spread Speed safe state", () => {
  it("writes a per-date state from safe sidecar inputs without reading the giant sheet payload", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-spread-speed-"));
    const date = "2026-06-01";
    const dayDir = await writeFixtureArchive(tempRoot, date);
    process.env.AI_STUFF_ROOT = tempRoot;
    vi.resetModules();

    try {
      const { loadSpreadSpeed } = await import("./spreadSpeed.ts");

      const payload = await loadSpreadSpeed(date);
      const statePath = path.join(dayDir, "rubicon_spread_speed_state.json");
      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        payload?: { frames?: unknown[] };
        projection?: { spxBars?: string };
        schema?: string;
        version?: number;
      };

      expect(payload.available).toBe(true);
      expect(payload.frames).toHaveLength(2);
      expect(state.schema).toBe("rubicon-spread-speed-state");
      expect(state.version).toBe(1);
      expect(state.payload?.frames).toHaveLength(2);
      expect(state.projection?.spxBars).toContain("never falls back");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("collapses 5-second SPX bars to one spread-speed frame per minute", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-spread-speed-"));
    const date = "2026-06-01";
    await writeDuplicateMinuteArchive(tempRoot, date);
    process.env.AI_STUFF_ROOT = tempRoot;
    vi.resetModules();

    try {
      const { loadSpreadSpeed } = await import("./spreadSpeed.ts");

      const payload = await loadSpreadSpeed(date);

      expect(payload.frames.map((frame) => frame.label)).toEqual(["09:30", "09:31"]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
