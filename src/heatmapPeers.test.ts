import { describe, expect, it } from "vitest";
import type { SpxHeatmapTile } from "../shared/types";
import { industryPeers } from "./heatmapPeers";

const tile = (symbol: string, sector: string, industry: string, weight: number): SpxHeatmapTile => ({
  symbol,
  name: symbol,
  sector,
  industry,
  weight,
  last: null,
  prevClose: null,
  pct: null,
  pctByTime: [],
  iv: null,
  earningsDate: null,
  earningsTime: null,
});

describe("industryPeers", () => {
  it("returns the same sector+industry tiles, heaviest first", () => {
    const tiles = [
      tile("AMAT", "Technology", "Semiconductor Equipment & Materials", 0.6),
      tile("LRCX", "Technology", "Semiconductor Equipment & Materials", 0.5),
      tile("KLAC", "Technology", "Semiconductor Equipment & Materials", 0.9),
      tile("NVDA", "Technology", "Semiconductors", 8), // different industry
      tile("JPM", "Financial", "Banks - Diversified", 1.3), // different sector
    ];
    expect(industryPeers(tiles, "Technology", "Semiconductor Equipment & Materials").map((t) => t.symbol)).toEqual([
      "KLAC",
      "AMAT",
      "LRCX",
    ]);
  });

  it("does not bleed across sectors that share an industry name", () => {
    const tiles = [
      tile("A", "Healthcare", "Diagnostics & Research", 1),
      tile("B", "Technology", "Diagnostics & Research", 1),
    ];
    expect(industryPeers(tiles, "Healthcare", "Diagnostics & Research").map((t) => t.symbol)).toEqual(["A"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(industryPeers([], "Technology", "Semiconductors")).toEqual([]);
  });
});
