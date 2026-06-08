import fs from "node:fs/promises";
import path from "node:path";
import type { MorningDailyBar, RrgBarsPayload } from "../shared/types.ts";

// Loads the TC2000 daily-bar export the afternoon sync writes and normalises it
// into the shape the Relative Rotation Graph consumes. Standalone (no coupling
// to the morning brief) so the rotation feature can evolve on its own.

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : null;
}

function sanitizeBar(value: unknown): MorningDailyBar | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const date = typeof record.date === "string" ? record.date : "";
  const open = finiteNumber(record.open);
  const high = finiteNumber(record.high);
  const low = finiteNumber(record.low);
  const close = finiteNumber(record.close);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || open === null || high === null || low === null || close === null) {
    return null;
  }
  return { close, date, high, low, open, volume: finiteNumber(record.volume) };
}

export async function loadRrgBars(
  appRoot: string,
  fileName = "tc2000-daily-bars.json",
): Promise<RrgBarsPayload> {
  const filePath = path.join(appRoot, "data", fileName);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      barsBySymbol?: unknown;
      dailyBars?: unknown;
      generatedAt?: unknown;
      note?: unknown;
      source?: unknown;
    };
    const rawBars = parsed.barsBySymbol ?? parsed.dailyBars;
    const barsBySymbol: Record<string, MorningDailyBar[]> = {};
    if (rawBars && typeof rawBars === "object" && !Array.isArray(rawBars)) {
      for (const [rawSymbol, rawRows] of Object.entries(rawBars)) {
        if (!Array.isArray(rawRows)) continue;
        const rows = rawRows
          .map((row) => sanitizeBar(row))
          .filter((row): row is MorningDailyBar => row !== null)
          .sort((a, b) => a.date.localeCompare(b.date));
        const symbol = rawSymbol.trim().toUpperCase();
        if (rows.length && symbol) barsBySymbol[symbol] = rows;
      }
    }
    const symbols = Object.keys(barsBySymbol).sort((a, b) => a.localeCompare(b));
    return {
      barsBySymbol,
      symbols,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
      source: typeof parsed.source === "string" ? parsed.source : filePath,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
  } catch {
    const isSectors = fileName.includes("sector");
    const note = isSectors
      ? "No sector RRG bars yet. Run the daily sync (or npm run rrg:sectors) to populate them."
      : "No TC2000 daily bars exported yet. Run the daily sync (or npm run tc2000:daily-bars) to populate them.";
    return {
      barsBySymbol: {},
      symbols: [],
      generatedAt: null,
      source: null,
      note,
    };
  }
}
