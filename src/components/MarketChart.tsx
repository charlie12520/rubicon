import { type ReactNode, useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SpxBar, SpreadMark, SpreadRangeBar } from "../../shared/types";
import { rubiconChartOptions, toCandlestickData, toLineData } from "./lightweightChartHelpers";
import {
  chartCountLabel,
  layoutCompactEventTicks,
  layoutEventMarkers,
  MARKER_ARROW_WIDTH,
  SPREAD_HL_BAR_OPTIONS,
  type CompactEventTick,
  type EventMarkerLayout,
  type MaOverlay,
  type PositionedTradeChartEvent,
  type TradeChartEvent,
} from "./marketChartMarkers";

const MARKER_ARROW_HEAD_HALF_WIDTH = 6;
const MARKER_ARROW_HEAD_LENGTH = 8;

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
        overlay.appendChild(createEventTick(tick, markerScale));
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

function createEventTick(tick: CompactEventTick, scale = 1): HTMLDivElement {
  // The tick geometry scales with the chart (the enlarged view passes >1) but
  // the presentation stays minimal everywhere — "which trade / when" lives in
  // the hover title, like the Daily Review chart.
  const width = Math.max(3, 3 * scale);
  const stubHeight = Math.max(11, 11 * scale);
  const el = document.createElement("div");
  el.className = `trade-tick ${tick.kind}`;
  el.style.left = `${tick.x - width / 2}px`;
  el.style.width = `${width}px`;
  el.title = tick.title;
  el.setAttribute("aria-label", tick.title);
  el.setAttribute("role", "img");
  const line = document.createElement("span");
  line.className = "trade-tick-line";
  line.style.left = `${width / 2 - 0.5}px`;
  line.style.bottom = `${stubHeight + 2}px`;
  const stub = document.createElement("span");
  stub.className = "trade-tick-stub";
  stub.style.width = `${width}px`;
  stub.style.height = `${stubHeight}px`;
  el.append(line, stub);
  return el;
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
