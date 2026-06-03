import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRrgBars } from "./rrgBars.ts";

let appRoot: string;

beforeEach(async () => {
  appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rrg-bars-"));
  await fs.mkdir(path.join(appRoot, "data"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(appRoot, { recursive: true, force: true });
});

async function writeBars(payload: unknown): Promise<void> {
  await fs.writeFile(path.join(appRoot, "data", "tc2000-daily-bars.json"), JSON.stringify(payload), "utf8");
}

describe("loadRrgBars", () => {
  it("normalises, sorts, and upper-cases the TC2000 daily-bar export", async () => {
    await writeBars({
      barsBySymbol: {
        onon: [
          { date: "2026-05-29", open: 40, high: 41, low: 39, close: 40.5, volume: 1000 },
          { date: "2026-05-27", open: 38, high: 39, low: 37, close: 38.5, volume: 900 },
          { date: "bad-date", open: 1, high: 1, low: 1, close: 1, volume: 1 },
        ],
        GE: [{ date: "2026-05-28", open: 200, high: 205, low: 199, close: 204, volume: 500 }],
      },
      generatedAt: "2026-05-31T20:30:00.000Z",
      source: "test-cache",
    });

    const payload = await loadRrgBars(appRoot);

    expect(payload.symbols).toEqual(["GE", "ONON"]);
    expect(payload.barsBySymbol.ONON.map((bar) => bar.date)).toEqual(["2026-05-27", "2026-05-29"]); // sorted, bad row dropped
    expect(payload.barsBySymbol.ONON[1].close).toBe(40.5);
    expect(payload.generatedAt).toBe("2026-05-31T20:30:00.000Z");
    expect(payload.source).toBe("test-cache");
  });

  it("returns an explained empty payload when the export is missing", async () => {
    const payload = await loadRrgBars(appRoot);
    expect(payload.symbols).toEqual([]);
    expect(payload.barsBySymbol).toEqual({});
    expect(payload.note).toMatch(/No TC2000 daily bars/);
  });
});
