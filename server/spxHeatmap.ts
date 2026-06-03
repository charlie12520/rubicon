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
    weight,
    last: finiteOrNull(record.last),
    prevClose: finiteOrNull(record.prevClose),
    pct: finiteOrNull(record.pct),
    pctByTime: sanitizePctSeries(record.pctByTime, timeCount),
  };
}

function sanitizeSector(value: unknown): SpxHeatmapSector | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = asString(record.name).trim();
  const weight = finiteOrNull(record.weight);
  if (!name || weight === null) return null;
  return {
    name,
    weight,
    pct: finiteOrNull(record.pct),
    count: Math.max(0, Math.round(finiteOrNull(record.count) ?? 0)),
  };
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
    const tiles = Array.isArray(parsed.tiles)
      ? parsed.tiles
          .map((tile) => sanitizeTile(tile, times.length))
          .filter((tile): tile is SpxHeatmapTile => tile !== null)
          .sort((a, b) => b.weight - a.weight)
      : [];
    const sectors = Array.isArray(parsed.sectors)
      ? parsed.sectors
          .map((sector) => sanitizeSector(sector))
          .filter((sector): sector is SpxHeatmapSector => sector !== null)
          .sort((a, b) => b.weight - a.weight)
      : [];

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
