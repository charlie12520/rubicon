import { describe, expect, it } from "vitest";
import { splineSegments, type ScreenPoint } from "./rrgSpline";

const SEG = /^M(-?[\d.]+),(-?[\d.]+)C(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)$/;

function parse(seg: string) {
  const m = seg.match(SEG);
  if (!m) throw new Error(`unparseable segment: ${seg}`);
  const n = m.slice(1).map(Number);
  return { x1: n[0], y1: n[1], c1x: n[2], c1y: n[3], c2x: n[4], c2y: n[5], x2: n[6], y2: n[7] };
}

describe("splineSegments", () => {
  it("returns nothing for fewer than two points", () => {
    expect(splineSegments([])).toEqual([]);
    expect(splineSegments([{ x: 1, y: 2 }])).toEqual([]);
  });

  it("emits one segment per gap, anchored on the data points", () => {
    const pts: ScreenPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 22, y: 3 },
      { x: 30, y: 14 },
    ];
    const segs = splineSegments(pts);
    expect(segs).toHaveLength(3);
    segs.forEach((seg, i) => {
      const p = parse(seg);
      expect(p.x1).toBeCloseTo(pts[i].x, 1);
      expect(p.y1).toBeCloseTo(pts[i].y, 1);
      expect(p.x2).toBeCloseTo(pts[i + 1].x, 1);
      expect(p.y2).toBeCloseTo(pts[i + 1].y, 1);
    });
  });

  it("keeps a straight collinear run flat (no overshoot)", () => {
    const pts: ScreenPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    for (const seg of splineSegments(pts)) {
      const p = parse(seg);
      // control points stay on the line → no bulge
      expect(Math.abs(p.c1y)).toBeLessThan(0.05);
      expect(Math.abs(p.c2y)).toBeLessThan(0.05);
    }
  });

  it("produces only finite coordinates, even through a sharp curl-back", () => {
    // a turning point that doubles back on itself (the case uniform CR loops on)
    const pts: ScreenPoint[] = [
      { x: 100, y: 100 },
      { x: 120, y: 110 },
      { x: 118, y: 112 },
      { x: 100, y: 100 },
      { x: 100, y: 100 }, // duplicate (coincident) — must not divide by zero
    ];
    const segs = splineSegments(pts);
    expect(segs).toHaveLength(4);
    for (const seg of segs) {
      const p = parse(seg);
      for (const v of Object.values(p)) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
