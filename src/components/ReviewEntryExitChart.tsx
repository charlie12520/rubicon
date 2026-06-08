import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  LineStyle,
  type AutoscaleInfo,
  type AutoscaleInfoProvider,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SpxBar, TradeRecord } from "../../shared/types";
import { resampleBars } from "../../shared/resampleBars";
import { buildWarmedCheatOverlays } from "../movingAverages";
import type { DailyPnlSimulationPoint } from "../dailyPnlSimulator";
import { reviewActionDirectionLabel, reviewActionSide } from "../dailyReviewSide";
import { formatNumber, formatSignedCurrency } from "../format";
import { pointAtOrBefore, tradeBoundaryEvents } from "../tradeChartEvents";
import { rubiconChartOptions, toCandlestickData } from "./lightweightChartHelpers";

export type MarkerEvent = {
  key: string;
  kind: "entry" | "exit" | "expiration";
  time: number;
  timeLabel: string;
  actionLabel: string;
  price: number;
  trade: TradeRecord;
  actionSide: TradeRecord["side"];
  groupedEvents?: MarkerEvent[];
  groupPnl?: number;
  premiumAmount?: number;
  totalContracts?: number;
};

export type ReviewHoverReadout = {
  label: string;
  pnl: number | null;
  spxClose: number;
  spxHigh: number;
  spxLow: number;
  spxOpen: number;
};

// Action side drives marker placement: CCS entries and PCS exits are short; PCS entries and CCS exits are long.
const SIDE_COLOR: Record<TradeRecord["side"], string> = {
  Call: "#ef4444",
  Put: "#22c55e",
  Mixed: "#f59e0b",
};

const ARROW_HEIGHT = 22;
const ARROW_VISUAL_WIDTH = 22;
const ARROW_HEAD_LENGTH = 8;
const ARROW_HEAD_HALF_WIDTH = 5.4;
const ARROW_CANDLE_CLEARANCE = 28;
const ARROW_GUIDE_CANDLE_GAP = 5;
const ARROW_GUIDE_HEAD_GAP = 2;
const ARROW_EDGE_PADDING = 4;
const FULL_SIZE_ARROW_HEAD_PREMIUM = 16;
const MIN_ARROW_EDGE_CLEARANCE = ARROW_GUIDE_CANDLE_GAP + ARROW_GUIDE_HEAD_GAP + 1;
const MIN_ARROW_HEAD_SIZE_RATIO = 0.68;
const MIN_ARROW_STEM_WIDTH = 1.2;
const MAX_ARROW_STEM_WIDTH = 5.2;
const REVIEW_TIME_AXIS_HEIGHT = 28;
const TOOLTIP_AWAY_OFFSET = 28;
const PNL_AUTOSCALE_PROVIDER: AutoscaleInfoProvider = (baseImplementation) => expandReviewPnlAutoscaleInfo(baseImplementation());

function sideAbove(side: TradeRecord["side"]): boolean {
  return side !== "Put";
}

function spreadSideLabel(side: TradeRecord["side"]): string {
  if (side === "Call") {
    return "CCS";
  }
  if (side === "Put") {
    return "PCS";
  }
  return "Mixed";
}

function markerActionLabel(event: Pick<MarkerEvent, "actionSide" | "groupedEvents" | "kind" | "trade">): string {
  const direction = reviewActionDirectionLabel(event.actionSide).toLowerCase();
  if (event.groupedEvents && event.groupedEvents.length > 1) {
    return `${reviewActionDirectionLabel(event.actionSide)} actions`;
  }
  if (event.kind === "exit") {
    return `${spreadSideLabel(event.trade.side)} exit / ${direction}`;
  }
  if (event.kind === "entry") {
    return `${spreadSideLabel(event.trade.side)} entry / ${direction}`;
  }
  return `${spreadSideLabel(event.trade.side)} expiry`;
}

export function entryPremiumAmount(trade: Pick<TradeRecord, "contracts" | "entryPrice">): number {
  const contracts = Math.abs(Number(trade.contracts) || 0);
  const premium = Math.abs(Number(trade.entryPrice) || 0);
  return contracts * premium;
}

export function premiumArrowStemWidth(trade: Pick<TradeRecord, "contracts" | "entryPrice">): number {
  return premiumArrowStemWidthFromAmount(entryPremiumAmount(trade));
}

export function premiumArrowStemWidthFromAmount(premiumAmount: number): number {
  const scaledWidth = MIN_ARROW_STEM_WIDTH + Math.sqrt(premiumAmount) * 0.7;
  return Math.min(MAX_ARROW_STEM_WIDTH, Math.max(MIN_ARROW_STEM_WIDTH, Number(scaledWidth.toFixed(2))));
}

export function premiumArrowScale(premiumAmount: number): number {
  const scale = 1 + Math.sqrt(Math.max(0, premiumAmount)) * 0.11;
  return Number(Math.min(1.6, Math.max(1, scale)).toFixed(3));
}

export function premiumArrowHeadScale(premiumAmount: number): number {
  const currentScaleCap = premiumArrowScale(premiumAmount);
  const premiumRatio = Math.min(1, Math.sqrt(Math.max(0, premiumAmount) / FULL_SIZE_ARROW_HEAD_PREMIUM));
  const sizeRatio = MIN_ARROW_HEAD_SIZE_RATIO + premiumRatio * (1 - MIN_ARROW_HEAD_SIZE_RATIO);
  return Number((currentScaleCap * sizeRatio).toFixed(3));
}

export function ReviewEntryExitChart({
  bars,
  intervalMinutes = 1,
  pnlPoints = [],
  trades,
  onSelectTrade,
  cheatCode = false,
  warmupCloses = [],
}: {
  bars: SpxBar[];
  intervalMinutes?: number;
  pnlPoints?: DailyPnlSimulationPoint[];
  trades: TradeRecord[];
  onSelectTrade?: (trade: TradeRecord) => void;
  cheatCode?: boolean;
  warmupCloses?: number[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const displayBars = useMemo(() => aggregateReviewBars(bars, intervalMinutes), [bars, intervalMinutes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !displayBars.length) {
      return;
    }

    const pnlData = buildReviewPnlLineData(pnlPoints, displayBars);
    const hasPnlOverlay = pnlData.length > 1;
    const chart = createChart(container, rubiconChartOptions({
      overrides: {
        leftPriceScale: {
          autoScale: true,
          borderVisible: false,
          minimumWidth: 0,
          scaleMargins: {
            bottom: 0.16,
            top: 0.12,
          },
          visible: false,
        },
      },
    }));

    let pnlSeries: ReturnType<typeof chart.addSeries> | null = null;
    let cleanupPnlAxisOverlay = () => {};
    if (hasPnlOverlay) {
      pnlSeries = chart.addSeries(LineSeries, {
        autoscaleInfoProvider: PNL_AUTOSCALE_PROVIDER,
        color: "rgba(45, 212, 191, 0.58)",
        crosshairMarkerBackgroundColor: "#2dd4bf",
        crosshairMarkerBorderColor: "#071014",
        crosshairMarkerBorderWidth: 2,
        crosshairMarkerRadius: 3,
        crosshairMarkerVisible: true,
        lastValueVisible: false,
        lineStyle: LineStyle.Solid,
        lineWidth: 1,
        priceFormat: {
          formatter: (price: number) => formatCompactPnlAxis(price),
          minMove: 1,
          type: "custom",
        },
        priceLineVisible: false,
        priceScaleId: "left",
        title: "",
      });
      pnlSeries.setData(pnlData);
      chart.priceScale("left").applyOptions({
        autoScale: true,
        borderVisible: false,
        minimumWidth: 0,
        scaleMargins: {
          bottom: 0.16,
          top: 0.12,
        },
        visible: false,
      });
      const pnlAxisOverlay = document.createElement("div");
      pnlAxisOverlay.className = "review-pnl-axis-overlay";
      pnlAxisOverlay.setAttribute("aria-hidden", "true");
      container.appendChild(pnlAxisOverlay);

      let pnlAxisFrame: number | null = null;
      const updatePnlAxisOverlay = () => {
        if (!pnlSeries || !pnlAxisOverlay.isConnected) {
          return;
        }
        const ticks = buildReviewPnlAxisTicks(pnlData, chart.timeScale().getVisibleRange());
        pnlAxisOverlay.innerHTML = "";
        ticks.forEach((tick) => {
          const coordinate = pnlSeries?.priceToCoordinate(tick);
          if (coordinate === null || coordinate === undefined || coordinate < 12) {
            return;
          }
          const label = document.createElement("span");
          label.className = "review-pnl-axis-tick";
          label.style.top = `${Math.round(coordinate)}px`;
          label.textContent = formatCompactPnlAxis(tick);
          pnlAxisOverlay.appendChild(label);
        });
      };
      const schedulePnlAxisOverlayUpdate = () => {
        if (pnlAxisFrame !== null) {
          window.cancelAnimationFrame(pnlAxisFrame);
        }
        pnlAxisFrame = window.requestAnimationFrame(() => {
          pnlAxisFrame = null;
          updatePnlAxisOverlay();
        });
      };
      chart.timeScale().subscribeVisibleTimeRangeChange(schedulePnlAxisOverlayUpdate);
      chart.timeScale().subscribeSizeChange(schedulePnlAxisOverlayUpdate);
      cleanupPnlAxisOverlay = () => {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(schedulePnlAxisOverlayUpdate);
        chart.timeScale().unsubscribeSizeChange(schedulePnlAxisOverlayUpdate);
        if (pnlAxisFrame !== null) {
          window.cancelAnimationFrame(pnlAxisFrame);
        }
        pnlAxisOverlay.remove();
      };
      schedulePnlAxisOverlayUpdate();
    }

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
    });
    series.setData(toCandlestickData(displayBars));

    // Cheat-code MA overlays, warm-started from prior sessions so the 50/200
    // EMA/SMA are true full-period lines across the whole session.
    if (cheatCode) {
      const overlays = buildWarmedCheatOverlays(
        displayBars.map((bar) => ({ time: bar.time, close: bar.close })),
        warmupCloses,
      );
      for (const overlay of overlays) {
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
    }

    const hoverReadout = document.createElement("div");
    hoverReadout.className = "review-hover-readout";
    hoverReadout.setAttribute("aria-live", "polite");
    hoverReadout.innerHTML = hoverReadoutHtml(null);
    container.appendChild(hoverReadout);

    const updateHoverReadout = (param: { time?: unknown; seriesData: Map<unknown, unknown> }) => {
      const eventTime = typeof param.time === "number" ? param.time : null;
      const candleData = param.seriesData.get(series) as CandlestickData<UTCTimestamp> | undefined;
      const pnlPoint = pnlSeries ? (param.seriesData.get(pnlSeries) as LineData<UTCTimestamp> | undefined) : undefined;
      const readout = reviewHoverReadoutForTime(eventTime, displayBars, pnlPoints);
      hoverReadout.innerHTML = hoverReadoutHtml(
        readout
          ? {
              ...readout,
              pnl: typeof pnlPoint?.value === "number" ? pnlPoint.value : readout.pnl,
              spxClose: typeof candleData?.close === "number" ? candleData.close : readout.spxClose,
              spxHigh: typeof candleData?.high === "number" ? candleData.high : readout.spxHigh,
              spxLow: typeof candleData?.low === "number" ? candleData.low : readout.spxLow,
              spxOpen: typeof candleData?.open === "number" ? candleData.open : readout.spxOpen,
            }
          : null,
      );
    };
    chart.subscribeCrosshairMove(updateHoverReadout);

    const markers = groupReviewMarkers(buildReviewMarkers(displayBars, trades));
    const cleanup = renderMarkers(container, chart, series, markers, onSelectTrade);
    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeCrosshairMove(updateHoverReadout);
      hoverReadout.remove();
      cleanup();
      cleanupPnlAxisOverlay();
      chart.remove();
    };
  }, [bars, displayBars, pnlPoints, trades, onSelectTrade, cheatCode, warmupCloses]);

  return <div className="review-entry-exit-chart" data-pnl-overlay={pnlPoints.length ? "true" : "false"} ref={containerRef} />;
}

export function formatCompactPnlAxis(price: number): string {
  const rounded = Math.round(price);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  const absValue = Math.abs(rounded);
  if (absValue >= 1000) {
    const scaled = absValue / 1000;
    const fractionDigits = scaled >= 10 || Number.isInteger(scaled) ? 0 : 1;
    return `${sign}$${scaled.toFixed(fractionDigits).replace(/\.0$/, "")}k`;
  }
  return `${sign}$${formatNumber(absValue, 0)}`;
}

export function compactReviewPnlAxisTicks(values: number[]): number[] {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return [];
  }
  const minValue = Math.min(...finiteValues, 0);
  const maxValue = Math.max(...finiteValues, 0);
  if (minValue === maxValue) {
    return [minValue];
  }
  const ticks = [maxValue, (maxValue + minValue) / 2, minValue].filter((value) => Math.abs(value) >= 1);
  return ticks.filter((value, index) => ticks.findIndex((candidate) => Math.abs(candidate - value) < 1) === index);
}

function buildReviewPnlAxisTicks(
  pnlData: LineData<UTCTimestamp>[],
  visibleRange: { from: unknown; to: unknown } | null,
): number[] {
  const from = typeof visibleRange?.from === "number" ? visibleRange.from : null;
  const to = typeof visibleRange?.to === "number" ? visibleRange.to : null;
  const visibleData =
    from !== null && to !== null
      ? pnlData.filter((point) => typeof point.time === "number" && point.time >= from && point.time <= to)
      : pnlData;
  const axisData = visibleData.length >= 2 ? visibleData : pnlData;
  return compactReviewPnlAxisTicks(axisData.map((point) => point.value));
}

export function expandReviewPnlAutoscaleInfo(baseInfo: AutoscaleInfo | null): AutoscaleInfo | null {
  if (!baseInfo?.priceRange) {
    return baseInfo;
  }
  const minValue = Math.min(baseInfo.priceRange.minValue, 0);
  const maxValue = Math.max(baseInfo.priceRange.maxValue, 0);
  if (minValue === maxValue) {
    const padding = Math.max(1, Math.abs(maxValue) * 0.08);
    return {
      ...baseInfo,
      margins: baseInfo.margins ?? { above: 14, below: 14 },
      priceRange: {
        minValue: minValue - padding,
        maxValue: maxValue + padding,
      },
    };
  }
  return {
    ...baseInfo,
    margins: baseInfo.margins ?? { above: 14, below: 14 },
    priceRange: {
      minValue,
      maxValue,
    },
  };
}

export function buildReviewPnlLineData(
  points: DailyPnlSimulationPoint[],
  bars: SpxBar[],
): LineData<UTCTimestamp>[] {
  if (!points.length || !bars.length) {
    return [];
  }
  const sortedBars = [...bars].sort((left, right) => left.time - right.time);
  const minBarTime = sortedBars[0]?.time ?? 0;
  const maxBarTime = sortedBars.at(-1)?.time ?? minBarTime;
  const pointsInRange = points.filter((point) => point.time >= minBarTime && point.time <= maxBarTime);
  if (!pointsInRange.length) {
    return [];
  }
  const seenTimes = new Set<number>();
  return sortedBars.flatMap((bar) => {
    if (seenTimes.has(bar.time)) {
      return [];
    }
    seenTimes.add(bar.time);
    const point = nearestByTime(pointsInRange, bar.time);
    return point
      ? [
          {
            time: bar.time as UTCTimestamp,
            value: point.totalPnl,
          },
        ]
      : [];
  });
}

export function reviewHoverReadoutForTime(
  time: number | null | undefined,
  bars: SpxBar[],
  points: DailyPnlSimulationPoint[],
): ReviewHoverReadout | null {
  if (!time || !bars.length) {
    return null;
  }
  const spxBar = nearestByTime(bars, time);
  if (!spxBar) {
    return null;
  }
  const pnlPoint = points.length ? nearestByTime(points, time) : null;
  return {
    label: spxBar.label,
    pnl: pnlPoint?.totalPnl ?? null,
    spxClose: spxBar.close,
    spxHigh: spxBar.high,
    spxLow: spxBar.low,
    spxOpen: spxBar.open,
  };
}

function nearestByTime<T extends { time: number }>(items: T[], time: number): T | null {
  if (!items.length) {
    return null;
  }
  let nearest = items[0];
  let nearestDistance = Math.abs(nearest.time - time);
  for (let index = 1; index < items.length; index += 1) {
    const item = items[index];
    const distance = Math.abs(item.time - time);
    if (distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function hoverReadoutHtml(readout: ReviewHoverReadout | null): string {
  if (!readout) {
    return `<span class="muted">Hover chart</span><b>SPX -</b><b>P/L -</b>`;
  }
  const pnlClass = readout.pnl === null ? "muted" : readout.pnl >= 0 ? "profit" : "loss";
  return [
    `<span>${escapeHtml(readout.label)} EST</span>`,
    `<b>SPX ${formatNumber(readout.spxClose, 2)}</b>`,
    `<b class="${pnlClass}">P/L ${readout.pnl === null ? "-" : formatSignedCurrency(readout.pnl)}</b>`,
    `<small>O ${formatNumber(readout.spxOpen, 2)} / H ${formatNumber(readout.spxHigh, 2)} / L ${formatNumber(readout.spxLow, 2)}</small>`,
  ].join("");
}

// Thin wrapper kept for call sites/tests; delegates to the shared resampler so the
// Daily Review chart, the Replay chart, and the server warmup feed bucket identically.
export function aggregateReviewBars(bars: SpxBar[], intervalMinutes: number): SpxBar[] {
  return resampleBars(bars, intervalMinutes);
}

export function buildReviewMarkers(bars: SpxBar[], trades: TradeRecord[]): MarkerEvent[] {
  const markers: MarkerEvent[] = [];
  for (const trade of trades) {
    for (const event of tradeBoundaryEvents(trade)) {
      const bar = pointAtOrBefore(bars, event.time);
      const actionSide = reviewActionSide(trade.side, event.kind);
      markers.push({
        actionSide,
        key: `${trade.id}-${event.kind}`,
        kind: event.kind,
        time: bar?.time ?? event.time,
        timeLabel: event.timeLabel,
        actionLabel: event.kind === "entry" ? "Entry" : "Exit",
        price: candleAnchorPrice(actionSide, bar, event.kind === "entry" ? trade.spxEntry : trade.spxExit),
        trade,
      });
    }
  }
  return markers;
}

export function groupReviewMarkers(markers: MarkerEvent[]): MarkerEvent[] {
  const groups = new Map<string, MarkerEvent[]>();
  for (const marker of markers) {
    const key = `${marker.time}:${marker.actionSide}`;
    groups.set(key, [...(groups.get(key) ?? []), marker]);
  }

  return [...groups.values()]
    .map((group) => {
      if (group.length === 1) {
        return group[0];
      }
      const sorted = [...group].sort((left, right) => {
        const premiumDelta = entryPremiumAmount(right.trade) - entryPremiumAmount(left.trade);
        return premiumDelta || left.timeLabel.localeCompare(right.timeLabel) || left.key.localeCompare(right.key);
      });
      const representative = sorted[0];
      const totalContracts = sorted.reduce((sum, marker) => sum + Math.abs(Number(marker.trade.contracts) || 0), 0);
      const premiumAmount = sorted.reduce((sum, marker) => sum + entryPremiumAmount(marker.trade), 0);
      const groupPnl = sorted.reduce((sum, marker) => sum + marker.trade.pnl, 0);
      const timeLabels = [...new Set(sorted.map((marker) => marker.timeLabel))];
      const actionLabel = groupActionLabel(sorted);
      const kind: MarkerEvent["kind"] = sorted.some((marker) => marker.kind === "entry")
        ? "entry"
        : sorted.some((marker) => marker.kind === "exit")
          ? "exit"
          : "expiration";
      return {
        ...representative,
        actionLabel,
        groupedEvents: sorted,
        groupPnl,
        key: `${representative.key}-group-${group.length}`,
        kind,
        premiumAmount,
        timeLabel: timeLabels.length === 1 ? timeLabels[0] : `${timeLabels[0]} +${timeLabels.length - 1}`,
        totalContracts,
      };
    })
    .sort((left, right) => left.time - right.time || left.price - right.price || left.key.localeCompare(right.key));
}

function groupActionLabel(events: MarkerEvent[]): string {
  const entryCount = events.filter((event) => event.kind === "entry").length;
  const exitCount = events.filter((event) => event.kind === "exit").length;
  const expirationCount = events.filter((event) => event.kind === "expiration").length;
  const parts: string[] = [];
  if (entryCount) {
    parts.push(`${entryCount} ${pluralize("Entry", entryCount)}`);
  }
  if (exitCount) {
    parts.push(`${exitCount} ${pluralize("Exit", exitCount)}`);
  }
  if (expirationCount) {
    parts.push(`${expirationCount} ${pluralize("Expiry", expirationCount)}`);
  }
  return parts.join(" / ");
}

function pluralize(label: string, count: number): string {
  if (label === "Entry") {
    return count === 1 ? label : "Entries";
  }
  if (label === "Expiry") {
    return count === 1 ? label : "Expiries";
  }
  return count === 1 ? label : `${label}s`;
}

function candleAnchorPrice(actionSide: TradeRecord["side"], bar: SpxBar | null, fallback: number | null | undefined): number {
  if (!bar) {
    return fallback ?? 0;
  }
  return sideAbove(actionSide) ? bar.high : bar.low;
}

function renderMarkers(
  container: HTMLDivElement,
  chart: ReturnType<typeof createChart>,
  series: { priceToCoordinate: (price: number) => number | null },
  markers: MarkerEvent[],
  onSelectTrade?: (trade: TradeRecord) => void,
): () => void {
  const overlay = document.createElement("div");
  overlay.className = "review-marker-layer";
  container.appendChild(overlay);

  const tooltip = document.createElement("div");
  tooltip.className = "review-marker-tooltip";
  tooltip.style.display = "none";
  overlay.appendChild(tooltip);

  const showTooltip = (event: MarkerEvent, x: number, y: number) => {
    tooltip.innerHTML = tooltipHtml(event);
    tooltip.style.display = "flex";
    const above = sideAbove(event.actionSide);
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipLeft = clamp(x - tooltipWidth / 2, 6, Math.max(6, overlay.clientWidth - tooltipWidth - 6));
    tooltip.style.left = `${tooltipLeft}px`;
    tooltip.style.top = `${above ? y - TOOLTIP_AWAY_OFFSET : y + TOOLTIP_AWAY_OFFSET}px`;
    tooltip.style.transform = above ? "translate(0, -100%)" : "translate(0, 0)";
  };
  const hideTooltip = () => {
    tooltip.style.display = "none";
  };

  const render = () => {
    overlay.querySelectorAll(".review-marker").forEach((node) => node.remove());
    const placedMarkers: Array<{ event: MarkerEvent; x: number; y: number }> = [];
    const chartWidth = container.clientWidth;
    const chartHeight = container.clientHeight;
    const plotHeight = Math.max(0, chartHeight - REVIEW_TIME_AXIS_HEIGHT);
    for (const event of markers) {
      if (!event.price) {
        continue;
      }
      const x = chart.timeScale().timeToCoordinate(event.time as UTCTimestamp);
      const y = series.priceToCoordinate(event.price);
      if (x === null || y === null) {
        continue;
      }
      if (x < 0 || x > chartWidth || y < 0 || y > plotHeight) {
        continue;
      }
      placedMarkers.push({ event, x, y });
    }
    const placements = layoutReviewMarkerPlacements(placedMarkers, chartWidth);
    for (const placement of placements) {
      overlay.appendChild(createMarker(placement.event, placement.x, placement.y, placement.laneOffset, chartWidth, plotHeight, { showTooltip, hideTooltip, onSelectTrade }));
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

type MarkerPlacement = {
  event: MarkerEvent;
  x: number;
  y: number;
  laneOffset: number;
};

export function layoutReviewMarkerPlacements(
  markers: Array<{ event: MarkerEvent; x: number; y: number }>,
  chartWidth: number,
): MarkerPlacement[] {
  void chartWidth;
  return markers.map((marker) => ({ ...marker, laneOffset: 0 }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createMarker(
  event: MarkerEvent,
  x: number,
  y: number,
  laneOffset: number,
  chartWidth: number,
  chartHeight: number,
  handlers: {
    showTooltip: (event: MarkerEvent, x: number, y: number) => void;
    hideTooltip: () => void;
    onSelectTrade?: (trade: TradeRecord) => void;
  },
): HTMLElement {
  const above = sideAbove(event.actionSide);
  const color = SIDE_COLOR[event.actionSide];
  const premiumAmount = markerPremiumAmount(event);
  const dimensions = reviewArrowDimensionsForPlacement(premiumAmount, above, y, chartHeight);
  const box = reviewArrowBox(x, laneOffset, chartWidth, dimensions.width);
  const geometry = reviewArrowGeometry(above, box.targetX, box.stemX, box.width, dimensions);
  const tipY = y;

  const marker = document.createElement("div");
  marker.className = `review-marker ${event.kind} ${above ? "above" : "below"}`;
  marker.style.left = `${box.left}px`;
  marker.style.top = `${tipY - geometry.targetY}px`;
  marker.style.width = `${geometry.width}px`;
  marker.style.height = `${geometry.height}px`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "review-marker-hit";
  button.style.left = `${clamp(box.stemX - dimensions.width / 2, 0, Math.max(0, geometry.width - dimensions.width))}px`;
  button.style.top = `${above ? 0 : dimensions.clearance}px`;
  button.style.width = `${dimensions.width}px`;
  button.style.height = `${dimensions.height}px`;

  const arrowSvg = reviewArrowSvg(event, color, geometry);
  marker.style.setProperty("--review-marker-color", color);
  marker.style.setProperty("--review-marker-stem-width", `${premiumArrowStemWidthFromAmount(premiumAmount)}px`);
  marker.innerHTML = arrowSvg;
  button.setAttribute(
    "aria-label",
    `${event.actionLabel} ${markerActionLabel(event)} ${event.trade.shortStrike ?? ""}/${event.trade.longStrike ?? ""}; ${formatNumber(premiumAmount, 2)} premium units`,
  );
  button.title = markerTitle(event, premiumAmount);

  const tooltipX = box.left + box.stemX;
  const tooltipY = above ? tipY - geometry.height : tipY + geometry.height;
  button.addEventListener("mouseenter", () => handlers.showTooltip(event, tooltipX, tooltipY));
  button.addEventListener("mouseleave", handlers.hideTooltip);
  button.addEventListener("focus", () => handlers.showTooltip(event, tooltipX, tooltipY));
  button.addEventListener("blur", handlers.hideTooltip);
  if (handlers.onSelectTrade) {
    button.addEventListener("click", () => handlers.onSelectTrade?.(event.trade));
  }

  marker.appendChild(button);
  return marker;
}

type ArrowGeometry = {
  width: number;
  height: number;
  targetX: number;
  targetY: number;
  stemX: number;
  headBaseY: number;
  headTipY: number;
  guideEndY: number;
  guideStartY: number;
  stemStartY: number;
  stemEndY: number;
  above: boolean;
};

type ArrowDimensions = {
  clearance: number;
  headHalfWidth: number;
  headLength: number;
  height: number;
  width: number;
};

type ArrowBox = {
  appliedLaneOffset: number;
  left: number;
  stemX: number;
  targetX: number;
  width: number;
};

export function reviewArrowDimensions(premiumAmount: number): ArrowDimensions {
  const scale = premiumArrowScale(premiumAmount);
  const headScale = premiumArrowHeadScale(premiumAmount);
  return {
    clearance: Math.round(ARROW_CANDLE_CLEARANCE + scale * 2),
    headHalfWidth: Number((ARROW_HEAD_HALF_WIDTH * headScale).toFixed(2)),
    headLength: Number((ARROW_HEAD_LENGTH * headScale).toFixed(2)),
    height: Math.round(ARROW_HEIGHT * scale),
    width: Math.round(ARROW_VISUAL_WIDTH * scale),
  };
}

export function reviewArrowDimensionsForPlacement(
  premiumAmount: number,
  above: boolean,
  y: number,
  chartHeight: number,
): ArrowDimensions {
  const dimensions = reviewArrowDimensions(premiumAmount);
  const availableClearance = above
    ? y - dimensions.height - ARROW_EDGE_PADDING
    : chartHeight - y - dimensions.height - ARROW_EDGE_PADDING;
  if (availableClearance >= dimensions.clearance) {
    return dimensions;
  }
  return {
    ...dimensions,
    clearance: Math.min(dimensions.clearance, Math.max(MIN_ARROW_EDGE_CLEARANCE, Math.floor(availableClearance))),
  };
}

export function reviewArrowBox(x: number, laneOffset: number, chartWidth: number, arrowWidth = ARROW_VISUAL_WIDTH): ArrowBox {
  const arrowCenter = arrowWidth / 2;
  const safeChartWidth = Math.max(arrowWidth, chartWidth);
  const targetXInChart = clamp(x, 0, safeChartWidth);
  const stemXInChart =
    laneOffset === 0
      ? targetXInChart
      : clamp(
          targetXInChart + laneOffset,
          arrowCenter + 2,
          Math.max(arrowCenter + 2, safeChartWidth - arrowCenter - 2),
        );
  const desiredLeft = Math.min(targetXInChart - arrowCenter, stemXInChart - arrowCenter);
  const desiredRight = Math.max(targetXInChart + arrowCenter, stemXInChart + arrowCenter);
  const width = Math.min(safeChartWidth, Math.max(arrowWidth, Math.ceil(desiredRight - desiredLeft)));
  const left = clamp(desiredLeft, 0, Math.max(0, safeChartWidth - width));

  return {
    appliedLaneOffset: Number((stemXInChart - targetXInChart).toFixed(2)),
    left: Number(left.toFixed(2)),
    stemX: Number((stemXInChart - left).toFixed(2)),
    targetX: Number((targetXInChart - left).toFixed(2)),
    width,
  };
}

function reviewArrowGeometry(above: boolean, targetX: number, stemX: number, width: number, dimensions: ArrowDimensions): ArrowGeometry {
  const totalHeight = dimensions.height + dimensions.clearance;
  if (above) {
    return {
      above,
      headBaseY: dimensions.height - dimensions.headLength,
      headTipY: dimensions.height,
      height: totalHeight,
      guideEndY: totalHeight - ARROW_GUIDE_CANDLE_GAP,
      guideStartY: dimensions.height + ARROW_GUIDE_HEAD_GAP,
      stemEndY: dimensions.height - dimensions.headLength - 2,
      stemStartY: 2,
      stemX,
      targetX,
      targetY: totalHeight,
      width,
    };
  }
  return {
    above,
    headBaseY: dimensions.clearance + dimensions.headLength,
    headTipY: dimensions.clearance,
    height: totalHeight,
    guideEndY: dimensions.clearance - ARROW_GUIDE_HEAD_GAP,
    guideStartY: ARROW_GUIDE_CANDLE_GAP,
    stemEndY: dimensions.clearance + dimensions.headLength + 2,
    stemStartY: totalHeight - 2,
    stemX,
    targetX,
    targetY: 0,
    width,
  };
}

function reviewArrowSvg(event: MarkerEvent, color: string, geometry: ArrowGeometry): string {
  const filled = event.kind === "entry";
  const premiumAmount = markerPremiumAmount(event);
  const dimensions = reviewArrowDimensions(premiumAmount);
  const headLeftX = clamp(geometry.targetX - dimensions.headHalfWidth, 1, geometry.width - 1);
  const headRightX = clamp(geometry.targetX + dimensions.headHalfWidth, 1, geometry.width - 1);
  const headPoints = `${geometry.targetX},${geometry.headTipY} ${headLeftX},${geometry.headBaseY} ${headRightX},${geometry.headBaseY}`;
  return `<svg width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}" aria-hidden="true" focusable="false">
    <line class="review-arrow-stem" x1="${geometry.stemX}" y1="${geometry.stemStartY}" x2="${geometry.stemX}" y2="${geometry.stemEndY}" stroke="${color}" />
    <line class="review-arrow-leader" x1="${geometry.targetX}" y1="${geometry.guideStartY}" x2="${geometry.targetX}" y2="${geometry.guideEndY}" stroke="${color}" />
    <polygon class="review-arrow-head" points="${headPoints}" fill="${filled ? color : "transparent"}" stroke="${color}" stroke-width="1.35" />
  </svg>`;
}

function tooltipHtml(event: MarkerEvent): string {
  const groupedEvents = markerEvents(event);
  if (groupedEvents.length > 1) {
    const premiumAmount = markerPremiumAmount(event);
    const rows = [
      `<strong>${escapeHtml(event.actionLabel)} - ${escapeHtml(markerActionLabel(event))}</strong>`,
      `<span>${groupedEvents.length} trades on this candle - ${formatNumber(markerContracts(event))} total contracts</span>`,
      `<span>Times ${escapeHtml([...new Set(groupedEvents.map((marker) => marker.timeLabel))].join(", "))}</span>`,
      `<span>Total entry premium ${formatNumber(premiumAmount, 2)}</span>`,
      `<span>SPX candle edge ${formatNumber(event.price, 2)}</span>`,
      `<span class="${(event.groupPnl ?? 0) >= 0 ? "profit" : "loss"}">Combined P/L ${formatSignedCurrency(event.groupPnl ?? 0)}</span>`,
    ];
    return rows.join("");
  }
  const trade = event.trade;
  const kind = event.actionLabel;
  const price = event.kind === "entry" ? trade.entryPrice : trade.exitPrice;
  const rows = [
    `<strong>${kind} - ${escapeHtml(markerActionLabel(event))}</strong>`,
    `<span>${escapeHtml(trade.strategy)}</span>`,
    `<span>${trade.shortStrike ?? "-"}/${trade.longStrike ?? "-"} - ${formatNumber(trade.contracts)} contract${trade.contracts === 1 ? "" : "s"}</span>`,
    `<span>${kind} ${event.timeLabel} EST - ${trade.priceType} ${price === null ? "-" : formatNumber(price, 2)}</span>`,
    `<span>SPX candle edge ${formatNumber(event.price, 2)}</span>`,
    `<span class="${trade.pnl >= 0 ? "profit" : "loss"}">P/L ${formatSignedCurrency(trade.pnl)}</span>`,
  ];
  return rows.join("");
}

function markerEvents(event: MarkerEvent): MarkerEvent[] {
  return event.groupedEvents ?? [event];
}

function markerPremiumAmount(event: MarkerEvent): number {
  return event.premiumAmount ?? entryPremiumAmount(event.trade);
}

function markerContracts(event: MarkerEvent): number {
  return event.totalContracts ?? Math.abs(Number(event.trade.contracts) || 0);
}

function markerTitle(event: MarkerEvent, premiumAmount: number): string {
  const groupedEvents = markerEvents(event);
  if (groupedEvents.length > 1) {
    return `${event.actionLabel} ${event.timeLabel} EST - ${groupedEvents.length} trades - ${formatNumber(premiumAmount, 2)} total premium`;
  }
  return `${event.actionLabel} ${event.timeLabel} EST - ${formatNumber(event.trade.contracts)} x ${formatNumber(Math.abs(event.trade.entryPrice), 2)} premium`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
