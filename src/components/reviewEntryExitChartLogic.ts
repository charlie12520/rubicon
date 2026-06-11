import type { AutoscaleInfo, LineData, UTCTimestamp } from "lightweight-charts";
import type { SpxBar, TradeRecord } from "../../shared/types";
import { resampleBars } from "../../shared/resampleBars";
import type { DailyPnlSimulationPoint } from "../dailyPnlSimulator";
import { reviewActionSide } from "../dailyReviewSide";
import { formatNumber } from "../format";
import { pointAtOrBefore, tradeBoundaryEvents } from "../tradeChartEvents";

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

const ARROW_HEIGHT = 22;
const ARROW_VISUAL_WIDTH = 22;
const ARROW_HEAD_LENGTH = 8;
const ARROW_HEAD_HALF_WIDTH = 5.4;
const ARROW_CANDLE_CLEARANCE = 28;
export const ARROW_GUIDE_CANDLE_GAP = 5;
export const ARROW_GUIDE_HEAD_GAP = 2;
const ARROW_EDGE_PADDING = 4;
const FULL_SIZE_ARROW_HEAD_PREMIUM = 16;
const MIN_ARROW_EDGE_CLEARANCE = ARROW_GUIDE_CANDLE_GAP + ARROW_GUIDE_HEAD_GAP + 1;
const MIN_ARROW_HEAD_SIZE_RATIO = 0.68;
const MIN_ARROW_STEM_WIDTH = 1.2;
const MAX_ARROW_STEM_WIDTH = 5.2;

// Action side drives marker placement: CCS entries and PCS exits are short; PCS entries and CCS exits are long.
export function sideAbove(side: TradeRecord["side"]): boolean {
  return side !== "Put";
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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type ArrowDimensions = {
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
