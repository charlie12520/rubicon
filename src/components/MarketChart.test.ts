import { describe, expect, it } from "vitest";
import { layoutEventMarkers } from "./MarketChart";

describe("replay event marker layout", () => {
  it("collapses duplicate same-point exits into one compact label", () => {
    const layouts = layoutEventMarkers(
      [
        marker("exit", "X2 11:17", 112, 156),
        marker("exit", "X3 11:17", 114, 158),
        marker("entry", "E2 10:08", 62, 120),
      ],
      { width: 360, height: 220 },
    );

    const exit = layouts.find((layout) => layout.kind === "exit");
    expect(exit?.label).toBe("X2-3 11:17");
    expect(exit?.title).toBe("X2 11:17, X3 11:17");
  });

  it("keeps nearby but different-time markers separately labeled", () => {
    const layouts = layoutEventMarkers(
      [
        marker("exit", "X2 11:17", 112, 156),
        marker("exit", "X3 11:17", 114, 158),
        marker("exit", "X4 11:21", 115, 157),
        marker("exit", "X5 11:21", 117, 159),
      ],
      { width: 360, height: 220 },
    );

    expect(layouts.filter((layout) => layout.kind === "exit").map((layout) => layout.label)).toEqual([
      "X2-3 11:17",
      "X4-5 11:21",
    ]);
  });

  it("keeps dense triangle markers within bounds without overlapping on a narrow chart", () => {
    const layouts = layoutEventMarkers(
      [
        marker("entry", "E1 09:31", 36, 138),
        marker("entry", "E2 10:08", 61, 142),
        marker("entry", "E3 10:23", 72, 140),
        marker("entry", "E4 10:31", 77, 140),
        marker("entry", "E5 10:52", 92, 140),
        marker("entry", "E6 11:19", 111, 141),
        marker("entry", "E7 11:27", 116, 142),
        marker("entry", "E8 11:30", 118, 142),
      ],
      { width: 180, height: 180 },
    );

    for (const layout of layouts) {
      expect(layout.markerWidth).toBeLessThanOrEqual(11);
      expect(layout.markerHeight).toBeLessThanOrEqual(11);
      expect(layout.markerX).toBeGreaterThanOrEqual(4);
      expect(layout.markerY).toBeGreaterThanOrEqual(4);
      expect(layout.markerX + layout.markerWidth).toBeLessThanOrEqual(176);
      expect(layout.markerY + layout.markerHeight).toBeLessThanOrEqual(176);
    }

    for (let leftIndex = 0; leftIndex < layouts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < layouts.length; rightIndex += 1) {
        expect(overlaps(layouts[leftIndex], layouts[rightIndex])).toBe(false);
      }
    }
  });

  it("points entry triangles from below and exit triangles from above", () => {
    const layouts = layoutEventMarkers(
      [
        marker("entry", "E1 09:31", 90, 100),
        marker("exit", "X1 09:57", 120, 100),
      ],
      { width: 240, height: 180 },
    );

    const entry = layouts.find((layout) => layout.kind === "entry");
    const exit = layouts.find((layout) => layout.kind === "exit");

    expect(entry?.markerY).toBeGreaterThanOrEqual(entry?.anchorY ?? 0);
    expect((exit?.markerY ?? 0) + (exit?.markerHeight ?? 0)).toBeLessThanOrEqual(exit?.anchorY ?? 0);
  });
});

function marker(kind: "entry" | "exit", label: string, x: number, y: number) {
  return {
    kind,
    label,
    time: x,
    value: 1,
    x,
    y,
  };
}

function overlaps(
  left: { markerX: number; markerY: number; markerWidth: number; markerHeight: number },
  right: { markerX: number; markerY: number; markerWidth: number; markerHeight: number },
): boolean {
  const gap = 2;
  return !(
    left.markerX + left.markerWidth + gap <= right.markerX
    || right.markerX + right.markerWidth + gap <= left.markerX
    || left.markerY + left.markerHeight + gap <= right.markerY
    || right.markerY + right.markerHeight + gap <= left.markerY
  );
}
