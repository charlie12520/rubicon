import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  LineStyle,
  type AutoscaleInfoProvider,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SpxBar, TradeRecord } from "../../shared/types";
import { buildWarmedCheatOverlays } from "../movingAverages";
import type { DailyPnlSimulationPoint } from "../dailyPnlSimulator";
import { reviewActionDirectionLabel } from "../dailyReviewSide";
import { formatNumber, formatSignedCurrency } from "../format";
import { rubiconChartOptions, toCandlestickData } from "./lightweightChartHelpers";
import {
  aggregateReviewBars,
  ARROW_GUIDE_CANDLE_GAP,
  ARROW_GUIDE_HEAD_GAP,
  buildReviewMarkers,
  buildReviewPnlLineData,
  clamp,
  compactReviewPnlAxisTicks,
  entryPremiumAmount,
  expandReviewPnlAutoscaleInfo,
  formatCompactPnlAxis,
  groupReviewMarkers,
  layoutReviewMarkerPlacements,
  premiumArrowStemWidthFromAmount,
  reviewArrowBox,
  reviewArrowDimensions,
  reviewArrowDimensionsForPlacement,
  reviewHoverReadoutForTime,
  sideAbove,
  type ArrowDimensions,
  type MarkerEvent,
  type ReviewHoverReadout,
} from "./reviewEntryExitChartLogic";

const SIDE_COLOR: Record<TradeRecord["side"], string> = {
  Call: "#ef4444",
  Put: "#22c55e",
  Mixed: "#f59e0b",
};

const REVIEW_TIME_AXIS_HEIGHT = 28;
const TOOLTIP_AWAY_OFFSET = 28;
const PNL_AUTOSCALE_PROVIDER: AutoscaleInfoProvider = (baseImplementation) => expandReviewPnlAutoscaleInfo(baseImplementation());

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
