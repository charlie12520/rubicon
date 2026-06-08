import { describe, expect, it } from "vitest";
import { heatmapColor, squarifyTreemap, type Rect } from "./spxTreemap";

describe("squarifyTreemap", () => {
  it("tiles the bounds with areas proportional to value and inside the rect", () => {
    const bounds: Rect = { x: 0, y: 0, w: 100, h: 50 };
    const placed = squarifyTreemap(
      [
        { key: "a", value: 50, data: "a" },
        { key: "b", value: 30, data: "b" },
        { key: "c", value: 20, data: "c" },
      ],
      bounds,
    );

    expect([...placed.map((p) => p.key)].sort()).toEqual(["a", "b", "c"]);
    const totalArea = placed.reduce((sum, p) => sum + p.rect.w * p.rect.h, 0);
    expect(totalArea).toBeCloseTo(bounds.w * bounds.h, 0); // fills the bounds, no gaps/overlap

    const a = placed.find((p) => p.key === "a")!.rect;
    const c = placed.find((p) => p.key === "c")!.rect;
    expect(a.w * a.h).toBeGreaterThan(c.w * c.h); // bigger value -> bigger tile

    for (const p of placed) {
      expect(p.rect.x).toBeGreaterThanOrEqual(bounds.x - 1e-6);
      expect(p.rect.y).toBeGreaterThanOrEqual(bounds.y - 1e-6);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(bounds.x + bounds.w + 1e-6);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(bounds.y + bounds.h + 1e-6);
    }
  });

  it("ignores non-positive values and empty bounds", () => {
    expect(squarifyTreemap([{ key: "a", value: 0, data: 1 }], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
    expect(squarifyTreemap([{ key: "a", value: 5, data: 1 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
  });
});

describe("heatmapColor", () => {
  const rgb = (s: string) => s.match(/\d+/g)!.map(Number);

  it("is neutral at flat, green up, red down, and clamps at the cap", () => {
    expect(heatmapColor(0)).toBe("rgb(62, 66, 76)");
    expect(heatmapColor(null)).toBe("#2b2f38");
    expect(heatmapColor(10)).toBe(heatmapColor(3)); // beyond the ±3 cap clamps

    const [ru, gu] = rgb(heatmapColor(1.5));
    expect(gu).toBeGreaterThan(ru); // up -> green dominates
    const [rd, gd] = rgb(heatmapColor(-1.5));
    expect(rd).toBeGreaterThan(gd); // down -> red dominates
  });
});
