import type { SpxHeatmapTile } from "../shared/types";

// All tiles sharing a tile's sector + industry (the Finviz sub-industry group),
// ordered by index weight (largest first) so the hover panel reads top-down like
// the treemap and Finviz's industry detail box. Matched on sector AND industry so
// a repeated industry name across two sectors never bleeds together.
export function industryPeers(tiles: SpxHeatmapTile[], sector: string, industry: string): SpxHeatmapTile[] {
  return tiles
    .filter((tile) => tile.sector === sector && tile.industry === industry)
    .sort((a, b) => b.weight - a.weight);
}
