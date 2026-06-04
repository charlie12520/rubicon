import fs from "node:fs/promises";
import path from "node:path";
import type {
  SpxHeatmapIndexSummary,
  SpxHeatmapPayload,
  SpxHeatmapSector,
  SpxHeatmapTile,
} from "../shared/types.ts";

// Loads the intraday S&P 500 market-map heatmap that scripts/refresh-spx-heatmap.py
// writes to data/spx-heatmap.json and normalises it into the shape the panel
// consumes. Standalone (no coupling to the morning brief or replay pipeline) so
// the feature can evolve and swap data feeds on its own.

const DATA_FILE = "spx-heatmap.json";

function finiteOrNull(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(num) ? num : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizePctSeries(value: unknown, length: number): (number | null)[] {
  if (!Array.isArray(value)) return new Array(length).fill(null);
  const series = value.map((entry) => finiteOrNull(entry));
  if (series.length === length) return series;
  if (series.length > length) return series.slice(0, length);
  return series.concat(new Array(length - series.length).fill(null));
}

function sanitizeTile(value: unknown, timeCount: number): SpxHeatmapTile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const symbol = asString(record.symbol).trim().toUpperCase();
  const weight = finiteOrNull(record.weight);
  if (!symbol || weight === null || weight <= 0) return null;
  return {
    symbol,
    name: asString(record.name, symbol),
    sector: asString(record.sector, "Unknown") || "Unknown",
    industry: asString(record.industry, ""), // filled in by applyClassification at load time
    weight,
    last: finiteOrNull(record.last),
    prevClose: finiteOrNull(record.prevClose),
    pct: finiteOrNull(record.pct),
    pctByTime: sanitizePctSeries(record.pctByTime, timeCount),
  };
}

const CLASSIFICATION_FILE = "finviz-classification.json";

// Finviz renders Alphabet, Fox and News Corp as a single weight-summed tile even
// though SPY holds two share classes each; fold the second class into the first.
const DUAL_CLASS_PRIMARY: Record<string, string> = {
  GOOG: "GOOGL",
  FOX: "FOXA",
  NWS: "NWSA",
};

export type SpxClassification = Map<string, { sector: string; industry: string }>;

// Match tiles to the taxonomy regardless of dot/dash form (BRK.B vs BRK-B).
function classKey(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Flatten data/finviz-classification.json ({ sector: { industry: [ticker, …] } })
// into ticker -> { sector, industry }. Tolerant: bad JSON yields an empty map.
export function parseClassification(raw: string): SpxClassification {
  const map: SpxClassification = new Map();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return map;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return map;
  for (const [sector, industries] of Object.entries(data as Record<string, unknown>)) {
    if (!industries || typeof industries !== "object" || Array.isArray(industries)) continue;
    for (const [industry, tickers] of Object.entries(industries as Record<string, unknown>)) {
      if (!Array.isArray(tickers)) continue;
      for (const ticker of tickers) {
        if (typeof ticker === "string" && ticker.trim()) map.set(classKey(ticker), { sector, industry });
      }
    }
  }
  return map;
}

async function loadClassification(appRoot: string): Promise<SpxClassification> {
  try {
    const raw = await fs.readFile(path.join(appRoot, "data", CLASSIFICATION_FILE), "utf8");
    return parseClassification(raw);
  } catch {
    return new Map();
  }
}

// Weight-weighted blend of two %-change readings; either may be null/absent.
function blendPct(aPct: number | null, aWeight: number, bPct: number | null, bWeight: number): number | null {
  let num = 0;
  let den = 0;
  if (aPct !== null && Number.isFinite(aPct) && aWeight > 0) {
    num += aPct * aWeight;
    den += aWeight;
  }
  if (bPct !== null && Number.isFinite(bPct) && bWeight > 0) {
    num += bPct * bWeight;
    den += bWeight;
  }
  return den > 0 ? num / den : null;
}

function foldTiles(primary: SpxHeatmapTile, secondaries: SpxHeatmapTile[]): SpxHeatmapTile {
  let weight = primary.weight;
  let pct = primary.pct;
  let pctWeight = primary.weight;
  const pctByTime = primary.pctByTime.slice();
  for (const secondary of secondaries) {
    for (let i = 0; i < pctByTime.length; i += 1) {
      pctByTime[i] = blendPct(pctByTime[i] ?? null, pctWeight, secondary.pctByTime[i] ?? null, secondary.weight);
    }
    pct = blendPct(pct, pctWeight, secondary.pct, secondary.weight);
    weight += secondary.weight;
    pctWeight += secondary.weight;
  }
  return { ...primary, weight, pct, pctByTime };
}

// Fold each Finviz second share class into its primary listing (weights add,
// %-change weight-blends) so the universe drops from 503 to 500 merged tiles.
export function mergeDualClassTiles(tiles: SpxHeatmapTile[]): SpxHeatmapTile[] {
  const present = new Set(tiles.map((tile) => tile.symbol));
  const isSecondary = (symbol: string): boolean => {
    const primary = DUAL_CLASS_PRIMARY[symbol];
    return Boolean(primary && present.has(primary));
  };
  const secondariesByPrimary = new Map<string, SpxHeatmapTile[]>();
  for (const tile of tiles) {
    if (!isSecondary(tile.symbol)) continue;
    const primary = DUAL_CLASS_PRIMARY[tile.symbol];
    const list = secondariesByPrimary.get(primary) ?? [];
    list.push(tile);
    secondariesByPrimary.set(primary, list);
  }
  const out: SpxHeatmapTile[] = [];
  for (const tile of tiles) {
    if (isSecondary(tile.symbol)) continue;
    const secondaries = secondariesByPrimary.get(tile.symbol);
    out.push(secondaries && secondaries.length > 0 ? foldTiles(tile, secondaries) : tile);
  }
  return out;
}

// Overlay the Finviz sector/industry taxonomy onto each tile. With no taxonomy
// file we degrade to the raw (GICS) sector as a single industry so the map still
// renders; a classified-but-unlisted name lands in an "Other" bucket (a visible
// nudge to classify a freshly-added constituent).
export function applyClassification(tiles: SpxHeatmapTile[], classification: SpxClassification): SpxHeatmapTile[] {
  const hasClassification = classification.size > 0;
  return tiles.map((tile) => {
    const hit = classification.get(classKey(tile.symbol));
    if (hit) return { ...tile, sector: hit.sector, industry: hit.industry };
    if (!hasClassification) return { ...tile, industry: tile.sector || "Unknown" };
    return { ...tile, sector: "Other", industry: "Other" };
  });
}

// Re-derive the sector summary (weight, breadth count, weight-weighted %) from the
// merged + classified tiles so the chips/blocks reflect the Finviz taxonomy.
export function computeSectors(tiles: SpxHeatmapTile[]): SpxHeatmapSector[] {
  const acc = new Map<string, { weight: number; count: number; num: number; den: number }>();
  for (const tile of tiles) {
    const entry = acc.get(tile.sector) ?? { weight: 0, count: 0, num: 0, den: 0 };
    entry.weight += tile.weight;
    entry.count += 1;
    if (tile.pct !== null && Number.isFinite(tile.pct)) {
      entry.num += tile.pct * tile.weight;
      entry.den += tile.weight;
    }
    acc.set(tile.sector, entry);
  }
  return [...acc.entries()]
    .map(([name, entry]) => ({
      name,
      weight: Number(entry.weight.toFixed(4)),
      count: entry.count,
      pct: entry.den > 0 ? entry.num / entry.den : null,
    }))
    .sort((a, b) => b.weight - a.weight);
}

function sanitizeIndex(value: unknown): SpxHeatmapIndexSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    label: asString(record.label, "S&P 500"),
    pct: finiteOrNull(record.pct),
    advancers: Math.max(0, Math.round(finiteOrNull(record.advancers) ?? 0)),
    decliners: Math.max(0, Math.round(finiteOrNull(record.decliners) ?? 0)),
    unchanged: Math.max(0, Math.round(finiteOrNull(record.unchanged) ?? 0)),
  };
}

function emptyPayload(note: string): SpxHeatmapPayload {
  return {
    generatedAt: new Date().toISOString(),
    session: "",
    asOf: null,
    source: "none",
    live: false,
    delayMinutes: null,
    times: [],
    tiles: [],
    sectors: [],
    index: null,
    note,
  };
}

export async function loadSpxHeatmap(appRoot: string): Promise<SpxHeatmapPayload> {
  const filePath = path.join(appRoot, "data", DATA_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return emptyPayload(
      "No S&P 500 heatmap built yet. Run `python scripts/refresh-spx-heatmap.py` (or the daily sync) to populate it.",
    );
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const times = Array.isArray(parsed.times) ? parsed.times.map((entry) => asString(entry)).filter(Boolean) : [];
    const rawTiles = Array.isArray(parsed.tiles)
      ? parsed.tiles
          .map((tile) => sanitizeTile(tile, times.length))
          .filter((tile): tile is SpxHeatmapTile => tile !== null)
      : [];
    // Fold dual-class siblings (GOOG→GOOGL …), then overlay the Finviz sector /
    // industry taxonomy so the panel can nest sector → industry → stock and the
    // universe collapses from 503 to 500 tiles. Sectors are re-derived from the
    // merged + classified tiles — the on-disk GICS sectors are intentionally ignored.
    const classification = await loadClassification(appRoot);
    const tiles = applyClassification(mergeDualClassTiles(rawTiles), classification).sort((a, b) => b.weight - a.weight);
    const sectors = computeSectors(tiles);

    return {
      generatedAt: asString(parsed.generatedAt, new Date().toISOString()),
      session: asString(parsed.session),
      asOf: parsed.asOf === null || parsed.asOf === undefined ? null : asString(parsed.asOf),
      source: asString(parsed.source, "unknown"),
      live: Boolean(parsed.live),
      delayMinutes: finiteOrNull(parsed.delayMinutes),
      times,
      tiles,
      sectors,
      index: sanitizeIndex(parsed.index),
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
  } catch (error) {
    return emptyPayload(`S&P 500 heatmap data could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
