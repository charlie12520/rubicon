import type { TradeRecord } from "../shared/types";
import { parseChartTimestampSeconds } from "./easternDate";
import { isSyntheticExpirationExit, tradeClockLabel } from "./tradeTime";

export type TimedPoint = {
  time: number;
};

export type TradeBoundaryEvent = {
  kind: "entry" | "exit";
  time: number;
  timeLabel: string;
  trade: TradeRecord;
};

export function tradeBoundaryEvents(
  trade: TradeRecord,
  options: { includeSyntheticExpirationExit?: boolean } = {},
): TradeBoundaryEvent[] {
  const events: TradeBoundaryEvent[] = [];
  const entryTime = parseChartTimestampSeconds(trade.entryTime);
  if (entryTime) {
    events.push({
      kind: "entry",
      time: entryTime,
      timeLabel: tradeClockLabel(trade.entryTime),
      trade,
    });
  }

  if (trade.exitTime && (options.includeSyntheticExpirationExit || !isSyntheticExpirationExit(trade))) {
    const exitTime = parseChartTimestampSeconds(trade.exitTime);
    if (exitTime) {
      events.push({
        kind: "exit",
        time: exitTime,
        timeLabel: tradeClockLabel(trade.exitTime),
        trade,
      });
    }
  }

  return events;
}

export function nearestPoint<T extends TimedPoint>(points: T[], time: number): T | null {
  if (!points.length || !time) {
    return null;
  }

  let closest = points[0];
  let distance = Math.abs(closest.time - time);
  for (const point of points) {
    const nextDistance = Math.abs(point.time - time);
    if (nextDistance < distance) {
      closest = point;
      distance = nextDistance;
    }
  }
  return closest;
}

export function pointAtOrBefore<T extends TimedPoint>(points: T[], time: number): T | null {
  if (!points.length || !time) {
    return null;
  }

  let selected = points[0];
  for (const point of points) {
    if (point.time <= time) {
      selected = point;
    } else {
      break;
    }
  }
  return selected;
}

export function pointValue(point: ({ close?: number; value?: number } & TimedPoint) | null): number | null {
  if (!point) {
    return null;
  }
  if (typeof point.value === "number" && Number.isFinite(point.value)) {
    return point.value;
  }
  return typeof point.close === "number" && Number.isFinite(point.close) ? point.close : null;
}
