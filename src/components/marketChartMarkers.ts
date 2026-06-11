import type { CandlestickSeriesPartialOptions } from "lightweight-charts";
import type { SpxBar, SpreadMark, SpreadRangeBar } from "../../shared/types";

/** A moving-average line drawn on top of a chart's primary series. */
export type MaOverlay = {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  data: Array<{ time: number; value: number }>;
};

export const SPREAD_HL_BAR_OPTIONS = {
  upColor: "rgba(45, 212, 191, 0.34)",
  downColor: "rgba(251, 113, 133, 0.34)",
  wickUpColor: "#2dd4bf",
  wickDownColor: "#fb7185",
  borderUpColor: "#2dd4bf",
  borderDownColor: "#fb7185",
  borderVisible: true,
  wickVisible: true,
} satisfies CandlestickSeriesPartialOptions;

export type TradeChartEvent = {
  kind: "entry" | "exit";
  time: number;
  label: string;
  lane?: number;
  value: number | null;
};

export type PositionedTradeChartEvent = TradeChartEvent & {
  x: number;
  y: number;
};

type EventMarkerCluster = {
  kind: TradeChartEvent["kind"];
  label: string;
  title: string;
  anchorX: number;
  anchorY: number;
  clusterKey: string;
  events: PositionedTradeChartEvent[];
};

type EventMarkerLayoutBase = EventMarkerCluster & {
  chartHeight: number;
  chartWidth: number;
  markerX: number;
  markerY: number;
  markerWidth: number;
  markerHeight: number;
  tipX: number;
  tipY: number;
};

export type EventMarkerLayout = EventMarkerLayoutBase & {
  showRail: boolean;
  railX: number;
  railWidth: number;
  railKind: TradeChartEvent["kind"] | "mixed";
  railGrouped: boolean;
  railTitle: string;
};

export const MARKER_ARROW_WIDTH = 24;
const MARKER_ARROW_HEIGHT = 30;
const MARKER_DUPLICATE_TOLERANCE = 5;
const MARKER_RAIL_WIDTH = 3;
const MARKER_RAIL_GROUP_GAP = 6;

export function chartCountLabel(kind: "candles" | "line" | "spread-bars", data: Array<SpxBar | SpreadMark | SpreadRangeBar>): string {
  void kind;
  void data;
  return "";
}

export type CompactEventTick = {
  kind: TradeChartEvent["kind"];
  x: number;
  label: string;
  title: string;
};

/**
 * Compact-mode layout: one slim tick per event CLUSTER (same dedup as the full
 * markers), anchored at the event's time x. The price coordinate is ignored —
 * the small tiles only need to show WHEN entries/exits happened; the enlarged
 * view carries the full arrows, rails, and labels.
 */
export function layoutCompactEventTicks(events: PositionedTradeChartEvent[]): CompactEventTick[] {
  return clusterEventMarkers(events)
    .map((cluster) => ({ kind: cluster.kind, x: cluster.anchorX, label: cluster.label, title: cluster.title }))
    .sort((left, right) => left.x - right.x);
}

export function layoutEventMarkers(
  events: PositionedTradeChartEvent[],
  size: { width: number; height: number },
  scale = 1,
): EventMarkerLayout[] {
  const clusters = clusterEventMarkers(events);
  const entries = layoutMarkerSide(clusters.filter((cluster) => cluster.kind === "entry"), size, scale);
  const exits = layoutMarkerSide(clusters.filter((cluster) => cluster.kind === "exit"), size, scale);
  const layouts = [...entries, ...exits].sort((left, right) => left.anchorX - right.anchorX || left.anchorY - right.anchorY);
  return assignRailGroups(layouts, size.width, scale);
}

function clusterEventMarkers(events: PositionedTradeChartEvent[]): EventMarkerCluster[] {
  const clusters: Array<Omit<EventMarkerCluster, "label" | "title">> = [];

  for (const event of events) {
    const clusterKey = eventClusterKey(event);
    const cluster = clusters.find((candidate) =>
      candidate.clusterKey === clusterKey
      && candidate.kind === event.kind
      && Math.abs(candidate.anchorX - event.x) <= MARKER_DUPLICATE_TOLERANCE
      && Math.abs(candidate.anchorY - event.y) <= MARKER_DUPLICATE_TOLERANCE
    );

    if (cluster) {
      cluster.events.push(event);
      cluster.anchorX = average(cluster.events.map((item) => item.x));
      cluster.anchorY = average(cluster.events.map((item) => item.y));
    } else {
      clusters.push({
        kind: event.kind,
        anchorX: event.x,
        anchorY: event.y,
        clusterKey,
        events: [event],
      });
    }
  }

  return clusters.map((cluster) => ({
    ...cluster,
    label: compactEventLabel(cluster.events),
    title: cluster.events.map((event) => event.label).join(", "),
  }));
}

function eventClusterKey(event: PositionedTradeChartEvent): string {
  const parsed = replayShortLabelParts(event.label);
  return parsed ? `${event.kind}:${parsed.prefix}:${parsed.timeLabel}` : `${event.kind}:${event.label}`;
}

function layoutMarkerSide(
  clusters: EventMarkerCluster[],
  size: { width: number; height: number },
  scale = 1,
): EventMarkerLayoutBase[] {
  const sorted = [...clusters].sort((left, right) => left.anchorX - right.anchorX || left.anchorY - right.anchorY);
  return sorted.map((cluster) => markerLayoutCandidate(cluster, size, scale));
}

function markerLayoutCandidate(cluster: EventMarkerCluster, size: { width: number; height: number }, scale = 1): EventMarkerLayoutBase {
  const chartHeight = size.height;
  const markerWidth = MARKER_ARROW_WIDTH * scale;
  const markerHeight = MARKER_ARROW_HEIGHT * scale;
  const tipX = markerWidth / 2;
  const tipY = cluster.kind === "entry" ? 0 : markerHeight;
  return {
    ...cluster,
    chartHeight,
    chartWidth: size.width,
    markerX: cluster.anchorX - tipX,
    markerY: cluster.kind === "entry" ? cluster.anchorY : cluster.anchorY - markerHeight,
    markerWidth,
    markerHeight,
    tipX,
    tipY,
  };
}

function assignRailGroups(layouts: EventMarkerLayoutBase[], chartWidth: number, scale = 1): EventMarkerLayout[] {
  const railProps = new Map<EventMarkerLayoutBase, Pick<EventMarkerLayout, "showRail" | "railX" | "railWidth" | "railKind" | "railGrouped" | "railTitle">>();
  const sorted = [...layouts].sort((left, right) => left.anchorX - right.anchorX || left.anchorY - right.anchorY);
  const railBaseWidth = MARKER_RAIL_WIDTH * scale;
  let currentGroup: EventMarkerLayoutBase[] = [];
  let currentMaxX = Number.NEGATIVE_INFINITY;

  const flushGroup = () => {
    if (!currentGroup.length) {
      return;
    }
    const minX = Math.min(...currentGroup.map((layout) => layout.anchorX));
    const maxX = Math.max(...currentGroup.map((layout) => layout.anchorX));
    const naturalWidth = Math.max(railBaseWidth, maxX - minX + railBaseWidth);
    const railWidth = Math.min(Math.max(0, chartWidth), naturalWidth);
    const railCenter = (minX + maxX) / 2;
    const railX = chartWidth > railWidth ? clamp(railCenter - railWidth / 2, 0, chartWidth - railWidth) : 0;
    const railOwner = currentGroup[0];
    const kinds = new Set(currentGroup.map((layout) => layout.kind));
    const railKind = kinds.size > 1 ? "mixed" : railOwner.kind;
    const railTitle = [...new Set(currentGroup.map((layout) => layout.title))].join(", ");
    const railGrouped = currentGroup.length > 1;

    for (const layout of currentGroup) {
      railProps.set(layout, {
        showRail: layout === railOwner,
        railX,
        railWidth,
        railKind,
        railGrouped,
        railTitle,
      });
    }
  };

  for (const layout of sorted) {
    if (!currentGroup.length || layout.anchorX - currentMaxX <= MARKER_RAIL_GROUP_GAP) {
      currentGroup.push(layout);
      currentMaxX = Math.max(currentMaxX, layout.anchorX);
    } else {
      flushGroup();
      currentGroup = [layout];
      currentMaxX = layout.anchorX;
    }
  }
  flushGroup();

  return layouts.map((layout) => ({
    ...layout,
    ...(railProps.get(layout) ?? {
      showRail: true,
      railX: layout.anchorX - railBaseWidth / 2,
      railWidth: railBaseWidth,
      railKind: layout.kind,
      railGrouped: false,
      railTitle: layout.title,
    }),
  }));
}

function compactEventLabel(events: PositionedTradeChartEvent[]): string {
  if (events.length <= 1) {
    return events[0]?.label ?? "";
  }

  const parsed = events.map((event) => replayShortLabelParts(event.label));
  const first = parsed[0];
  if (first && parsed.every((part) => part && part.prefix === first.prefix && part.timeLabel === first.timeLabel)) {
    const numbers = parsed.map((part) => part?.index).filter((index): index is number => Number.isFinite(index)).sort((left, right) => left - right);
    if (numbers.length === parsed.length && numbers.length > 1) {
      const contiguous = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1);
      const indexLabel = contiguous ? `${numbers[0]}-${numbers[numbers.length - 1]}` : numbers.join(",");
      return `${first.prefix}${indexLabel} ${first.timeLabel}`;
    }
  }

  const labels = [...new Set(events.map((event) => event.label))];
  return labels.length === 1 ? `${labels[0]} x${events.length}` : `${labels[0]} +${events.length - 1}`;
}

function replayShortLabelParts(label: string): { prefix: "E" | "X"; index: number; timeLabel: string } | null {
  const match = /^([EX])(\d+)\s+(\d{1,2}:\d{2})$/i.exec(label.trim());
  if (!match) {
    return null;
  }
  return {
    prefix: match[1].toUpperCase() as "E" | "X",
    index: Number(match[2]),
    timeLabel: match[3],
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
