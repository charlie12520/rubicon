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

const MARKER_ARROW_WIDTH = 24;
const MARKER_ARROW_HEIGHT = 30;
const MARKER_ARROW_HEAD_HALF_WIDTH = 6;
const MARKER_ARROW_HEAD_LENGTH = 8;
const MARKER_DUPLICATE_TOLERANCE = 5;
const MARKER_RAIL_WIDTH = 3;
const MARKER_RAIL_GROUP_GAP = 6;

type MarketChartCommonProps = {
  title: string;
  accent: string;
  events?: TradeChartEvent[];
  overlays?: MaOverlay[];
  toolbar?: ReactNode;
  /** Renders the chart in a fixed full-viewport overlay (theater mode). */
  enlarged?: boolean;
  /** When provided, an enlarge/restore button appears in the title tools. */
  onToggleEnlarge?: () => void;
  /** Multiplies the entry/exit marker geometry; labels appear above ~1.2. */
  markerScale?: number;
  /**
   * "full" draws arrows + rails (+ labels when scaled up). "compact" draws only
   * a slim bottom tick + faint hairline per event — for small grid tiles where
   * full markers bury the price action; the enlarge mode is the detail view.
   */
  markerMode?: "full" | "compact";
};

type MarketChartProps = MarketChartCommonProps &
  (
    | { kind: "candles"; data: SpxBar[] }
    | { kind: "line"; data: SpreadMark[] }
    | { kind: "spread-bars"; data: SpreadRangeBar[] }
  );

export function MarketChart(props: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const chart = createChart(container, rubiconChartOptions());
    const cleanups: Array<() => void> = [];
    const markerScale = props.markerScale ?? 1;
    const markerMode = props.markerMode ?? "full";

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
        cleanups.push(renderEventMarkers(container, chart, series, props.events, markerScale, markerMode));
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
        cleanups.push(renderEventMarkers(container, chart, series, props.events, markerScale, markerMode));
      }
    } else {
      const series = chart.addSeries(CandlestickSeries, SPREAD_HL_BAR_OPTIONS);
      series.setData(toCandlestickData(props.data));
      if (props.events?.length) {
        cleanups.push(renderEventMarkers(container, chart, series, props.events, markerScale, markerMode));
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
    <section className={props.enlarged ? "chart-panel chart-panel-enlarged" : "chart-panel"}>
      <div className="panel-title">
        <span>{props.title}</span>
        <div className="chart-title-tools">
          {props.toolbar}
          {countLabel && <span className="panel-count">{countLabel}</span>}
          {props.onToggleEnlarge && (
            <button
              aria-pressed={Boolean(props.enlarged)}
              className={props.enlarged ? "chart-enlarge-btn active" : "chart-enlarge-btn"}
              onClick={props.onToggleEnlarge}
              title={props.enlarged ? "Restore chart size (Esc)" : "Enlarge chart"}
              type="button"
            >
              {props.enlarged ? "✕" : "⤢"}
            </button>
          )}
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
  markerScale = 1,
  markerMode: "full" | "compact" = "full",
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

    if (markerMode === "compact") {
      for (const tick of layoutCompactEventTicks(positionedEvents)) {
        overlay.appendChild(createEventTick(tick));
      }
      return;
    }

    const layouts = layoutEventMarkers(positionedEvents, {
      width: container.clientWidth,
      height: container.clientHeight,
    }, markerScale);
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

function createEventTick(tick: CompactEventTick): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `trade-tick ${tick.kind}`;
  el.style.left = `${tick.x - 1.5}px`;
  el.title = tick.title;
  el.setAttribute("aria-label", tick.title);
  el.setAttribute("role", "img");
  const line = document.createElement("span");
  line.className = "trade-tick-line";
  const stub = document.createElement("span");
  stub.className = "trade-tick-stub";
  el.append(line, stub);
  return el;
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

  if (layout.showRail) {
    const rail = document.createElement("span");
    rail.className = [
      "trade-cross-candle-rail",
      layout.railKind,
      layout.railGrouped ? "grouped" : "",
    ].filter(Boolean).join(" ");
    rail.style.left = `${layout.railX - layout.markerX}px`;
    rail.style.top = `${-layout.markerY}px`;
    rail.style.width = `${layout.railWidth}px`;
    rail.style.height = `${layout.chartHeight}px`;
    rail.title = layout.railTitle;
    marker.appendChild(rail);
  }
  marker.appendChild(createEventArrowSvg(layout));

  // With enlarged markers there is room to print the label outright instead of
  // hiding it in a hover tooltip — the whole point of the enlarge mode.
  if (layout.markerWidth / MARKER_ARROW_WIDTH > 1.2 && layout.label) {
    const text = document.createElement("span");
    text.className = "trade-cross-label";
    text.textContent = layout.label;
    // Flip the label to the marker's left when it would clip the right edge.
    const estimatedLabelWidth = layout.label.length * 7.5 + 8;
    if (layout.markerX + layout.markerWidth + estimatedLabelWidth > layout.chartWidth) {
      text.style.right = `${layout.markerWidth + 4}px`;
    } else {
      text.style.left = `${layout.markerWidth + 4}px`;
    }
    text.style.top = layout.kind === "entry" ? `${layout.markerHeight * 0.3}px` : `${layout.markerHeight * 0.45}px`;
    marker.appendChild(text);
  }
  return marker;
}

function createEventArrowSvg(layout: EventMarkerLayout): SVGSVGElement {
  // Geometry scales with the layout's marker box (markerScale-aware): the
  // viewBox is the scaled box, so the head/dot must scale by the same factor.
  const scale = layout.markerWidth / MARKER_ARROW_WIDTH;
  const headHalfWidth = MARKER_ARROW_HEAD_HALF_WIDTH * scale;
  const headLength = MARKER_ARROW_HEAD_LENGTH * scale;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${layout.markerWidth} ${layout.markerHeight}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const stem = document.createElementNS("http://www.w3.org/2000/svg", "line");
  stem.setAttribute("class", "trade-cross-arrow-stem");
  stem.setAttribute("x1", String(layout.tipX));
  stem.setAttribute("x2", String(layout.tipX));

  const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  head.setAttribute("class", "trade-cross-arrow-head");

  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("class", "trade-cross-anchor-dot");
  dot.setAttribute("cx", String(layout.tipX));
  dot.setAttribute("cy", String(layout.tipY));
  dot.setAttribute("r", String(2.4 * scale));

  if (layout.kind === "entry") {
    const baseY = layout.tipY + headLength;
    stem.setAttribute("y1", String(baseY + 1));
    stem.setAttribute("y2", String(layout.markerHeight - 2));
    head.setAttribute(
      "points",
      `${layout.tipX},${layout.tipY} ${layout.tipX - headHalfWidth},${baseY} ${layout.tipX + headHalfWidth},${baseY}`,
    );
  } else {
    const baseY = layout.tipY - headLength;
    stem.setAttribute("y1", "2");
    stem.setAttribute("y2", String(baseY - 1));
    head.setAttribute(
      "points",
      `${layout.tipX},${layout.tipY} ${layout.tipX - headHalfWidth},${baseY} ${layout.tipX + headHalfWidth},${baseY}`,
    );
  }

  svg.append(stem, head, dot);
  return svg;
}
