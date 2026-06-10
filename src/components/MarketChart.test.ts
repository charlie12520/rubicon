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

  it("anchors every replay arrow tip to the event coordinate", () => {
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
      expect(layout.chartHeight).toBe(180);
      expect(layout.markerWidth).toBe(24);
      expect(layout.markerHeight).toBe(30);
      expect(layout.railWidth).toBeGreaterThan(0);
      expect(layout.markerX + layout.tipX).toBeCloseTo(layout.anchorX, 5);
      expect(layout.markerY + layout.tipY).toBeCloseTo(layout.anchorY, 5);
    }
  });

  it("groups overlapping vertical rails without merging the event arrows", () => {
    const layouts = layoutEventMarkers(
      [
        marker("entry", "E6 11:19", 111, 141),
        marker("entry", "E7 11:27", 116, 142),
        marker("entry", "E8 11:30", 118, 142),
        marker("exit", "X6 11:33", 128, 108),
      ],
      { width: 180, height: 180 },
    );

    const groupedEntries = layouts.filter((layout) => layout.kind === "entry");
    expect(groupedEntries).toHaveLength(3);
    expect(groupedEntries.filter((layout) => layout.showRail)).toHaveLength(1);
    expect(groupedEntries.every((layout) => layout.railGrouped)).toBe(true);
    expect(groupedEntries[0].railKind).toBe("entry");
    expect(groupedEntries[0].railWidth).toBeGreaterThan(3);
    expect(groupedEntries[0].railX).toBeLessThanOrEqual(111);

    for (const layout of groupedEntries) {
      expect(layout.markerX + layout.tipX).toBeCloseTo(layout.anchorX, 5);
      expect(layout.markerY + layout.tipY).toBeCloseTo(layout.anchorY, 5);
    }

    const isolatedExit = layouts.find((layout) => layout.kind === "exit");
    expect(isolatedExit?.showRail).toBe(true);
    expect(isolatedExit?.railGrouped).toBe(false);
    expect(isolatedExit?.railWidth).toBe(3);
  });

  it("uses one mixed rail when entry and exit rails collide", () => {
    const layouts = layoutEventMarkers(
      [
        marker("entry", "E1 09:31", 90, 100),
        marker("exit", "X1 09:31", 94, 100),
      ],
      { width: 240, height: 180 },
    );

    expect(layouts.filter((layout) => layout.showRail)).toHaveLength(1);
    expect(layouts.every((layout) => layout.railKind === "mixed")).toBe(true);
    expect(layouts.every((layout) => layout.railGrouped)).toBe(true);
  });

  it("draws entries from below and exits from above while keeping the tip anchored", () => {
    const layouts = layoutEventMarkers(
      [
        marker("entry", "E1 09:31", 90, 100),
        marker("exit", "X1 09:57", 120, 100),
      ],
      { width: 240, height: 180 },
    );

    const entry = layouts.find((layout) => layout.kind === "entry");
    const exit = layouts.find((layout) => layout.kind === "exit");

    expect(entry?.tipY).toBe(0);
    expect(entry?.markerY).toBe(entry?.anchorY);
    expect((entry?.markerY ?? 0) + (entry?.tipY ?? 0)).toBe(entry?.anchorY);
    expect(exit?.tipY).toBe(exit?.markerHeight);
    expect((exit?.markerY ?? 0) + (exit?.markerHeight ?? 0)).toBe(exit?.anchorY);
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
