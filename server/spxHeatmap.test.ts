import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpxHeatmapTile } from "../shared/types.ts";
import { forwardFillTileSeries, loadQqqHeatmap, loadSpxHeatmap } from "./spxHeatmap.ts";

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

async function writeQqqPayload(payload: unknown): Promise<void> {
  await fs.writeFile(path.join(appRoot, "data", "qqq-heatmap.json"), JSON.stringify(payload), "utf8");
}

async function writeAutoOverlay(data: unknown): Promise<void> {
  await fs.writeFile(path.join(appRoot, "data", "heatmap-classification-auto.json"), JSON.stringify(data), "utf8");
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
    // short pctByTime padded to the axis length...
    expect(payload.tiles[0].pctByTime).toHaveLength(3);
    // ...and the interior gap (AAPL prints at 10:31 so the frontier is index 2) is
    // forward-filled with NVDA's last value rather than left a grey "blank minute".
    expect(payload.tiles[0].pctByTime[2]).toBe(1);
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
        { symbol: "GOOGL", name: "Alphabet A", sector: "Communication Services", weight: 1.2, pct: 1, pctByTime: [0, 1], iv: 0.3, earningsDate: "2026-06-05", earningsTime: "before-open" },
        { symbol: "GOOG", name: "Alphabet C", sector: "Communication Services", weight: 1.1, pct: 2, pctByTime: [0, 2], iv: 0.31 },
        { symbol: "NVDA", name: "Nvidia", sector: "Information Technology", weight: 8, pct: -1, pctByTime: [0, -1], earningsDate: "soon", earningsTime: "whenever" },
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
    // dual-class merge keeps the primary listing's IV; a tile with no iv field reads null
    expect(alphabet?.iv).toBe(0.3);
    expect(payload.tiles.find((t) => t.symbol === "NVDA")?.iv).toBeNull();
    // earnings carries through the dual-class merge (primary kept); a bad date/time sanitizes to null
    expect(alphabet?.earningsDate).toBe("2026-06-05");
    expect(alphabet?.earningsTime).toBe("before-open");
    expect(payload.tiles.find((t) => t.symbol === "NVDA")?.earningsDate).toBeNull();
    expect(payload.tiles.find((t) => t.symbol === "NVDA")?.earningsTime).toBeNull();
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

function makeTile(symbol: string, pctByTime: (number | null)[]): SpxHeatmapTile {
  return {
    symbol,
    name: symbol,
    sector: "Sector",
    industry: "Industry",
    weight: 1,
    last: null,
    prevClose: null,
    pct: null,
    pctByTime,
    iv: null,
    earningsDate: null,
    earningsTime: null,
  };
}

describe("forwardFillTileSeries", () => {
  it("carries the last value forward across an interior null minute", () => {
    const [tile] = forwardFillTileSeries([makeTile("A", [1, null, 3])]);
    expect(tile.pctByTime).toEqual([1, 1, 3]);
  });

  it("fills a whole-map blank minute — every tile carries its own prior value", () => {
    // The exact bug: one minute is null for every tile (the feed skipped it).
    const out = forwardFillTileSeries([makeTile("A", [1, null, 3]), makeTile("B", [2, null, 4])]);
    expect(out.map((t) => t.pctByTime)).toEqual([
      [1, 1, 3],
      [2, 2, 4],
    ]);
  });

  it("forward-fills a tile that stopped printing, up to the global frontier", () => {
    // B's last print is index 0, but A extends the frontier to index 2 → B carries forward.
    const out = forwardFillTileSeries([makeTile("A", [1, 2, 3]), makeTile("B", [5, null, null])]);
    expect(out.find((t) => t.symbol === "B")?.pctByTime).toEqual([5, 5, 5]);
  });

  it("leaves leading nulls (not yet printed) and trailing nulls (future minutes) untouched", () => {
    const out = forwardFillTileSeries([makeTile("A", [1, 2, 3, null]), makeTile("B", [null, null, 7, null])]);
    expect(out.find((t) => t.symbol === "A")?.pctByTime).toEqual([1, 2, 3, null]); // trailing stays null
    expect(out.find((t) => t.symbol === "B")?.pctByTime).toEqual([null, null, 7, null]); // leading + trailing stay null
  });

  it("returns tiles unchanged when no tile has any data", () => {
    const out = forwardFillTileSeries([makeTile("A", [null, null])]);
    expect(out[0].pctByTime).toEqual([null, null]);
  });
});

describe("loadQqqHeatmap", () => {
  it("reads data/qqq-heatmap.json, folds dual-class, overlays the shared Finviz taxonomy, and keeps the Nasdaq label", async () => {
    await writeClassification({
      Technology: { Semiconductors: ["NVDA", "ARM"], "Consumer Electronics": ["AAPL"] },
    });
    await writeQqqPayload({
      generatedAt: "2026-06-05T13:31:00.000Z",
      session: "2026-06-05",
      asOf: "09:31",
      source: "ibkr-live",
      live: true,
      delayMinutes: 0,
      times: ["09:30", "09:31"],
      tiles: [
        { symbol: "NVDA", name: "Nvidia", sector: "Information Technology", weight: 12.9, pct: 1, pctByTime: [0, 1] },
        { symbol: "AAPL", name: "Apple", sector: "Information Technology", weight: 11.7, pct: -1, pctByTime: [0, -1] },
        { symbol: "ARM", name: "Arm Holdings", sector: "Unknown", weight: 1.2, pct: 2, pctByTime: [0, 2] },
        { symbol: "GOOGL", name: "Alphabet A", sector: "Communication Services", weight: 5, pct: 0.5, pctByTime: [0, 0.5] },
        { symbol: "GOOG", name: "Alphabet C", sector: "Communication Services", weight: 4, pct: 0.5, pctByTime: [0, 0.5] },
      ],
      index: { label: "Nasdaq-100 (QQQ weights)", pct: 0.4, advancers: 3, decliners: 1, unchanged: 0 },
    });

    const payload = await loadQqqHeatmap(appRoot);
    // dual-class GOOG folds into GOOGL (same merge as SPX), so GOOG disappears
    const symbols = payload.tiles.map((t) => t.symbol);
    expect(symbols).toContain("GOOGL");
    expect(symbols).not.toContain("GOOG");
    // Nasdaq-100 weighting preserved, tiles sorted by weight desc
    expect(payload.tiles[0].symbol).toBe("NVDA");
    expect(payload.tiles[0].weight).toBeCloseTo(12.9, 6);
    // a QQQ-only name (ARM) picks up the SHARED Finviz classification
    const arm = payload.tiles.find((t) => t.symbol === "ARM");
    expect(arm?.sector).toBe("Technology");
    expect(arm?.industry).toBe("Semiconductors");
    // the index label flows from the payload (Nasdaq, not S&P 500)
    expect(payload.index?.label).toBe("Nasdaq-100 (QQQ weights)");
  });

  it("returns an explained empty payload (Nasdaq-100 wording) when the file is missing", async () => {
    const payload = await loadQqqHeatmap(appRoot);
    expect(payload.tiles).toEqual([]);
    expect(payload.note).toMatch(/Nasdaq-100/);
  });
});

describe("auto-classification overlay (reconstitution adds)", () => {
  it("places overlay-only names by sector while the curated base wins on conflicts", async () => {
    // Base: NVDA + AAPL curated. The overlay tries to also claim AAPL (Technology /
    // Unclassified) — base MUST win — and adds FDXF (a fresh index member the
    // reconciler placed under Industrials / Unclassified).
    await writeClassification({
      Technology: { Semiconductors: ["NVDA"], "Consumer Electronics": ["AAPL"] },
    });
    await writeAutoOverlay({
      Industrials: { Unclassified: ["FDXF"] },
      Technology: { Unclassified: ["AAPL"] }, // conflict — must lose to the base file
    });
    await writePayload({
      generatedAt: "2026-06-05T13:31:00.000Z",
      session: "2026-06-05",
      asOf: "09:30",
      source: "ibkr-live",
      live: true,
      delayMinutes: 0,
      times: ["09:30"],
      tiles: [
        { symbol: "NVDA", name: "Nvidia", sector: "Information Technology", weight: 8, pct: 1, pctByTime: [1] },
        { symbol: "AAPL", name: "Apple", sector: "Information Technology", weight: 7, pct: -1, pctByTime: [-1] },
        { symbol: "FDXF", name: "FedEx Freight", sector: "Industrials", weight: 0.2, pct: 0.5, pctByTime: [0.5] },
      ],
    });

    const payload = await loadSpxHeatmap(appRoot);
    // FDXF: only in the overlay → nests under its real sector, "Unclassified" industry
    // (NOT the top-level "Other" bucket an absent symbol would get).
    const fdxf = payload.tiles.find((t) => t.symbol === "FDXF");
    expect(fdxf?.sector).toBe("Industrials");
    expect(fdxf?.industry).toBe("Unclassified");
    // AAPL: in BOTH → the hand-curated base wins.
    const aapl = payload.tiles.find((t) => t.symbol === "AAPL");
    expect(aapl?.sector).toBe("Technology");
    expect(aapl?.industry).toBe("Consumer Electronics");
  });
});
