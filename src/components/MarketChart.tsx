import { type ReactNode, useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  LineStyle,
  type CandlestickSeriesPartialOptions,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SpxBar, SpreadMark, SpreadRangeBar } from "../../shared/types";
import { rubiconChartOptions, toCandlestickData, toLineData } from "./lightweightChartHelpers";

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

type PositionedTradeChartEvent = TradeChartEvent & {
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

export type EventMarkerLayout = EventMarkerCluster & {
  markerX: number;
  markerY: number;
  markerWidth: number;
  markerHeight: number;
  leaderAngle: number;
  leaderLength: number;
};

const MARKER_TRIANGLE_SIZE = 11;
const MARKER_TRIANGLE_EDGE_PADDING = 4;
const MARKER_TRIANGLE_OVERLAP_GAP = 2;
const MARKER_TRIANGLE_OFFSETS = [0, -14, 14, -28, 28, -42, 42];
const MARKER_TRIANGLE_VERTICAL_OFFSETS = [0, 14, 28, 42];
const MARKER_DUPLICATE_TOLERANCE = 5;

type MarketChartProps =
  | {
      kind: "candles";
      data: SpxBar[];
      title: string;
      accent: string;
      events?: TradeChartEvent[];
      overlays?: MaOverlay[];
      toolbar?: ReactNode;
    }
  | {
      kind: "line";
      data: SpreadMark[];
      title: string;
      accent: string;
      events?: TradeChartEvent[];
      overlays?: MaOverlay[];
      toolbar?: ReactNode;
    }
  | {
      kind: "spread-bars";
      data: SpreadRangeBar[];
      title: string;
      accent: string;
      events?: TradeChartEvent[];
      overlays?: MaOverlay[];
      toolbar?: ReactNode;
    };

export function MarketChart(props: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const chart = createChart(container, rubiconChartOptions());
    const cleanups: Array<() => void> = [];

    if (props.kind === "candles") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        borderVisible: false,
      });
      series.setData(toCandlestickData(props.data));
      if (props.events?.length) {
        cleanups.push(renderEventMarkers(container, chart, series, props.events));
      }
    } else if (props.kind === "line") {
      const series = chart.addSeries(LineSeries, {
        color: props.accent,
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: false,
      });
      series.setData(toLineData(props.data, (mark) => mark.value));
      if (props.events?.length) {
        cleanups.push(renderEventMarkers(container, chart, series, props.events));
      }
    } else {
      const series = chart.addSeries(CandlestickSeries, SPREAD_HL_BAR_OPTIONS);
      series.setData(toCandlestickData(props.data));
      if (props.events?.length) {
        cleanups.push(renderEventMarkers(container, chart, series, props.events));
      }
    }

    for (const overlay of props.overlays ?? []) {
      if (!overlay.data.length) {
        continue;
      }
      const overlaySeries = chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: 1,
        lineStyle: overlay.dashed ? LineStyle.Dashed : LineStyle.Solid,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      overlaySeries.setData(overlay.data.map((point) => ({ time: point.time as UTCTimestamp, value: point.value })));
    }

    chart.timeScale().fitContent();

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      chart.remove();
    };
  }, [props]);

  const countLabel = chartCountLabel(props.kind, props.data);

  return (
    <section className="chart-panel">
      <div className="panel-title">
        <span>{props.title}</span>
        <div className="chart-title-tools">
          {props.toolbar}
          {countLabel && <span className="panel-count">{countLabel}</span>}
        </div>
      </div>
      <div className="market-chart" ref={containerRef} />
    </section>
  );
}

export function chartCountLabel(kind: MarketChartProps["kind"], data: Array<SpxBar | SpreadMark | SpreadRangeBar>): string {
  void kind;
  void data;
  return "";
}

function renderEventMarkers(
  container: HTMLDivElement,
  chart: ReturnType<typeof createChart>,
  series: {
    priceToCoordinate: (price: number) => number | null;
  },
  events: TradeChartEvent[],
) {
  const overlay = document.createElement("div");
  overlay.className = "event-cross-layer";
  container.appendChild(overlay);

  const render = () => {
    overlay.replaceChildren();
    const positionedEvents: PositionedTradeChartEvent[] = [];
    for (const event of events) {
      if (event.value === null) {
        continue;
      }
      const x = chart.timeScale().timeToCoordinate(event.time as UTCTimestamp);
      const y = series.priceToCoordinate(event.value);
      if (x === null || y === null) {
        continue;
      }
      positionedEvents.push({ ...event, x, y });
    }

    const layouts = layoutEventMarkers(positionedEvents, {
      width: container.clientWidth,
      height: container.clientHeight,
    });
    for (const layout of layouts) {
      overlay.appendChild(createEventMarker(layout));
    }
  };

  const resizeObserver = new ResizeObserver(render);
  resizeObserver.observe(container);
  chart.timeScale().subscribeVisibleTimeRangeChange(render);
  requestAnimationFrame(render);

  return () => {
    resizeObserver.disconnect();
    chart.timeScale().unsubscribeVisibleTimeRangeChange(render);
    overlay.remove();
  };
}

export function layoutEventMarkers(
  events: PositionedTradeChartEvent[],
  size: { width: number; height: number },
): EventMarkerLayout[] {
  const clusters = clusterEventMarkers(events);
  const occupied: EventMarkerLayout[] = [];
  const entries = layoutMarkerSide(clusters.filter((cluster) => cluster.kind === "entry"), size, occupied);
  const exits = layoutMarkerSide(clusters.filter((cluster) => cluster.kind === "exit"), size, occupied);
  return [...entries, ...exits].sort((left, right) => left.anchorX - right.anchorX || left.anchorY - right.anchorY);
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
  occupied: EventMarkerLayout[],
): EventMarkerLayout[] {
  const sorted = [...clusters].sort((left, right) => left.anchorX - right.anchorX || left.anchorY - right.anchorY);
  const layouts: EventMarkerLayout[] = [];

  for (const cluster of sorted) {
    let selected = markerLayoutCandidate(cluster, size, MARKER_TRIANGLE_OFFSETS[0], MARKER_TRIANGLE_VERTICAL_OFFSETS[0]);
    let foundOpenSlot = false;
    for (const verticalOffset of MARKER_TRIANGLE_VERTICAL_OFFSETS) {
      for (const horizontalOffset of MARKER_TRIANGLE_OFFSETS) {
        const candidate = markerLayoutCandidate(cluster, size, horizontalOffset, verticalOffset);
        if (!occupied.some((layout) => markerBoxesOverlap(candidate, layout))) {
          selected = candidate;
          foundOpenSlot = true;
          break;
        }
      }
      if (foundOpenSlot) {
        break;
      }
    }
    layouts.push(selected);
    occupied.push(selected);
  }

  return layouts;
}

function markerLayoutCandidate(
  cluster: EventMarkerCluster,
  size: { width: number; height: number },
  horizontalOffset: number,
  verticalOffset: number,
): EventMarkerLayout {
  const markerWidth = MARKER_TRIANGLE_SIZE;
  const markerHeight = MARKER_TRIANGLE_SIZE;
  const maxX = Math.max(MARKER_TRIANGLE_EDGE_PADDING, size.width - markerWidth - MARKER_TRIANGLE_EDGE_PADDING);
  const maxY = Math.max(MARKER_TRIANGLE_EDGE_PADDING, size.height - markerHeight - MARKER_TRIANGLE_EDGE_PADDING);
  const preferredX = cluster.anchorX - markerWidth / 2 + horizontalOffset;
  const preferredY = cluster.kind === "entry"
    ? cluster.anchorY + verticalOffset
    : cluster.anchorY - markerHeight - verticalOffset;
  const markerX = clamp(preferredX, MARKER_TRIANGLE_EDGE_PADDING, maxX);
  const markerY = clamp(preferredY, MARKER_TRIANGLE_EDGE_PADDING, maxY);
  const tipX = markerX + markerWidth / 2;
  const tipY = cluster.kind === "entry" ? markerY : markerY + markerHeight;
  const leaderDx = cluster.anchorX - tipX;
  const leaderDy = cluster.anchorY - tipY;

  return {
    ...cluster,
    markerX,
    markerY,
    markerWidth,
    markerHeight,
    leaderAngle: Math.atan2(leaderDy, leaderDx),
    leaderLength: Math.sqrt(leaderDx * leaderDx + leaderDy * leaderDy),
  };
}

function markerBoxesOverlap(left: EventMarkerLayout, right: EventMarkerLayout): boolean {
  return !(
    left.markerX + left.markerWidth + MARKER_TRIANGLE_OVERLAP_GAP <= right.markerX
    || right.markerX + right.markerWidth + MARKER_TRIANGLE_OVERLAP_GAP <= left.markerX
    || left.markerY + left.markerHeight + MARKER_TRIANGLE_OVERLAP_GAP <= right.markerY
    || right.markerY + right.markerHeight + MARKER_TRIANGLE_OVERLAP_GAP <= left.markerY
  );
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

function createEventMarker(layout: EventMarkerLayout): HTMLDivElement {
  const marker = document.createElement("div");
  marker.className = `trade-cross ${layout.kind}`;
  marker.style.left = `${layout.markerX}px`;
  marker.style.top = `${layout.markerY}px`;
  marker.style.width = `${layout.markerWidth}px`;
  marker.style.height = `${layout.markerHeight}px`;
  marker.title = layout.title;
  marker.setAttribute("aria-label", layout.title);
  marker.setAttribute("role", "img");

  const leader = document.createElement("span");
  leader.className = "trade-cross-leader";
  const tipX = layout.markerWidth / 2;
  const tipY = layout.kind === "entry" ? 0 : layout.markerHeight;
  leader.style.left = `${tipX}px`;
  leader.style.top = `${tipY}px`;
  leader.style.width = `${Math.max(0, layout.leaderLength)}px`;
  leader.style.transform = `rotate(${layout.leaderAngle}rad)`;
  if (layout.leaderLength <= 1.5) {
    leader.hidden = true;
  }

  const outline = document.createElement("span");
  outline.className = "trade-cross-triangle outline";
  const fill = document.createElement("span");
  fill.className = "trade-cross-triangle fill";

  marker.append(leader, outline, fill);
  return marker;
}
