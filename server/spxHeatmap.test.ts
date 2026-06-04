import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSpxHeatmap } from "./spxHeatmap.ts";

let appRoot: string;

beforeEach(async () => {
  appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spx-heatmap-"));
  await fs.mkdir(path.join(appRoot, "data"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(appRoot, { recursive: true, force: true });
});

async function writePayload(payload: unknown): Promise<void> {
  await fs.writeFile(path.join(appRoot, "data", "spx-heatmap.json"), JSON.stringify(payload), "utf8");
}

async function writeClassification(data: unknown): Promise<void> {
  await fs.writeFile(path.join(appRoot, "data", "finviz-classification.json"), JSON.stringify(data), "utf8");
}

describe("loadSpxHeatmap", () => {
  it("sanitises tiles, drops bad rows, sorts by weight, and aligns pctByTime to the axis", async () => {
    await writePayload({
      generatedAt: "2026-06-03T19:46:00.000Z",
      session: "2026-06-03",
      asOf: "10:31",
      source: "ibkr-live",
      live: true,
      delayMinutes: 0,
      times: ["09:30", "09:31", "10:31"],
      tiles: [
        { symbol: "aapl", name: "Apple", sector: "Information Technology", weight: 7, last: 200, prevClose: 202, pct: -0.99, pctByTime: [0, -0.5, -0.99] },
        { symbol: "nvda", name: "Nvidia", sector: "Information Technology", weight: 8, last: 100, prevClose: 98, pct: 2.04, pctByTime: [0, 1] }, // short -> padded
        { symbol: "bad", name: "Bad", sector: "x", weight: 0, last: 1, prevClose: 1, pct: 0, pctByTime: [] }, // weight 0 -> dropped
      ],
      sectors: [
        { name: "Financials", weight: 5, pct: -0.2, count: 1 },
        { name: "Information Technology", weight: 15, pct: 0.5, count: 2 },
      ],
      index: { label: "S&P 500", pct: 0.4, advancers: 1, decliners: 1, unchanged: 0 },
    });

    const payload = await loadSpxHeatmap(appRoot);

    expect(payload.source).toBe("ibkr-live");
    expect(payload.live).toBe(true);
    expect(payload.times).toEqual(["09:30", "09:31", "10:31"]);
    // weight 0 dropped, sorted by weight desc, symbols upper-cased
    expect(payload.tiles.map((t) => t.symbol)).toEqual(["NVDA", "AAPL"]);
    // short pctByTime padded to the axis length with null
    expect(payload.tiles[0].pctByTime).toHaveLength(3);
    expect(payload.tiles[0].pctByTime[2]).toBeNull();
    // sectors are re-derived from the (merged, classified) tiles, not the input
    // array — with no taxonomy file the raw GICS sector is kept; only IT has tiles
    expect(payload.sectors.map((s) => s.name)).toEqual(["Information Technology"]);
    expect(payload.sectors[0].count).toBe(2);
    expect(payload.index?.advancers).toBe(1);
  });

  it("returns an explained empty payload when the file is missing", async () => {
    const payload = await loadSpxHeatmap(appRoot);
    expect(payload.tiles).toEqual([]);
    expect(payload.sectors).toEqual([]);
    expect(payload.note).toMatch(/No S&P 500 heatmap/);
  });

  it("folds dual-class siblings into the primary listing with summed weight and blended %", async () => {
    await writeClassification({
      "Communication Services": { "Internet Content & Information": ["GOOGL"] },
      Technology: { Semiconductors: ["NVDA"] },
    });
    await writePayload({
      generatedAt: "2026-06-03T13:31:00.000Z",
      session: "2026-06-03",
      asOf: "09:31",
      source: "ibkr-live",
      live: true,
      delayMinutes: 0,
      times: ["09:30", "09:31"],
      tiles: [
        { symbol: "GOOGL", name: "Alphabet A", sector: "Communication Services", weight: 1.2, pct: 1, pctByTime: [0, 1] },
        { symbol: "GOOG", name: "Alphabet C", sector: "Communication Services", weight: 1.1, pct: 2, pctByTime: [0, 2] },
        { symbol: "NVDA", name: "Nvidia", sector: "Information Technology", weight: 8, pct: -1, pctByTime: [0, -1] },
      ],
    });

    const payload = await loadSpxHeatmap(appRoot);
    const symbols = payload.tiles.map((t) => t.symbol);
    expect(symbols).toContain("GOOGL");
    expect(symbols).not.toContain("GOOG"); // folded into GOOGL

    const alphabet = payload.tiles.find((t) => t.symbol === "GOOGL");
    expect(alphabet?.weight).toBeCloseTo(2.3, 6); // 1.2 + 1.1
    expect(alphabet?.industry).toBe("Internet Content & Information");
    // weight-blended last bucket: (1*1.2 + 2*1.1) / 2.3
    expect(alphabet?.pctByTime[1] ?? Number.NaN).toBeCloseTo((1 * 1.2 + 2 * 1.1) / 2.3, 6);
  });

  it("overlays the Finviz taxonomy and re-derives sectors from the merged tiles", async () => {
    await writeClassification({
      Technology: { Semiconductors: ["NVDA"], "Consumer Electronics": ["AAPL"] },
      Financial: { "Banks - Diversified": ["JPM"] },
    });
    await writePayload({
      generatedAt: "2026-06-03T13:31:00.000Z",
      session: "2026-06-03",
      asOf: "09:30",
      source: "ibkr-live",
      live: true,
      delayMinutes: 0,
      times: ["09:30"],
      tiles: [
        { symbol: "NVDA", name: "Nvidia", sector: "Information Technology", weight: 8, pct: 1, pctByTime: [1] },
        { symbol: "AAPL", name: "Apple", sector: "Information Technology", weight: 7, pct: -1, pctByTime: [-1] },
        { symbol: "JPM", name: "JPMorgan", sector: "Financials", weight: 4, pct: 0.5, pctByTime: [0.5] },
      ],
    });

    const payload = await loadSpxHeatmap(appRoot);
    const nvda = payload.tiles.find((t) => t.symbol === "NVDA");
    expect(nvda?.sector).toBe("Technology"); // re-keyed from GICS "Information Technology"
    expect(nvda?.industry).toBe("Semiconductors");
    // sectors derived from tiles, Finviz-named, sorted by weight desc (15 vs 4)
    expect(payload.sectors.map((s) => s.name)).toEqual(["Technology", "Financial"]);
    const tech = payload.sectors.find((s) => s.name === "Technology");
    expect(tech?.count).toBe(2);
    expect(tech?.weight).toBeCloseTo(15, 6);
  });
});
