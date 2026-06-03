import type { SpxBar, SpreadMark, TradeRecord } from "../shared/types";
import { parseChartTimestampSeconds } from "./easternDate";
import { tradeClockLabel } from "./tradeTime";

export type DailyPnlSimulationPoint = {
  time: number;
  timestampEt: string;
  label: string;
  realizedPnl: number;
  openPnl: number;
  totalPnl: number;
  openTradeCount: number;
  missingOpenMarkCount: number;
};

export type DailyPnlSimulationSummary = {
  finalPnl: number;
  highPnl: number;
  lowPnl: number;
  maxDrawdown: number;
  maxOpenTrades: number;
  missingOpenMarkObservations: number;
  pointCount: number;
};

export function buildDailyPnlSimulation(
  trades: TradeRecord[],
  spreadMarks: SpreadMark[],
  spxBars: SpxBar[] = [],
): DailyPnlSimulationPoint[] {
  const selectedTradeIds = new Set(trades.map((trade) => trade.id));
  const marksByTrade = new Map<string, SpreadMark[]>();
  const timeline = new Map<number, { label: string; timestampEt: string }>();

  for (const bar of spxBars) {
    timeline.set(bar.time, { label: bar.label, timestampEt: bar.timestampEt });
  }

  for (const trade of trades) {
    addTradeTime(timeline, trade.entryTime);
    if (trade.exitTime) {
      addTradeTime(timeline, trade.exitTime);
    }
  }

  for (const mark of spreadMarks) {
    if (!selectedTradeIds.has(mark.tradeId)) {
      continue;
    }
    const marks = marksByTrade.get(mark.tradeId) ?? [];
    marks.push(mark);
    marksByTrade.set(mark.tradeId, marks);
    timeline.set(mark.time, { label: mark.label, timestampEt: mark.timestampEt });
  }

  for (const marks of marksByTrade.values()) {
    marks.sort((left, right) => left.time - right.time);
  }

  const sortedTimes = [...timeline.entries()].sort(([left], [right]) => left - right);
  const markPointers = new Map<string, number>();
  const latestMarks = new Map<string, SpreadMark>();

  return sortedTimes.map(([time, timeInfo]) => {
    for (const [tradeId, marks] of marksByTrade.entries()) {
      let pointer = markPointers.get(tradeId) ?? 0;
      while (pointer < marks.length && marks[pointer].time <= time) {
        latestMarks.set(tradeId, marks[pointer]);
        pointer += 1;
      }
      markPointers.set(tradeId, pointer);
    }

    let realizedPnl = 0;
    let openPnl = 0;
    let openTradeCount = 0;
    let missingOpenMarkCount = 0;

    for (const trade of trades) {
      const entryTime = parseChartTimestampSeconds(trade.entryTime);
      const exitTime = trade.exitTime ? parseChartTimestampSeconds(trade.exitTime) : 0;
      if (!entryTime || time < entryTime) {
        continue;
      }

      if (exitTime && time >= exitTime) {
        realizedPnl += trade.pnl;
        continue;
      }

      openTradeCount += 1;
      const mark = latestMarks.get(trade.id);
      const markValue = mark && mark.time >= entryTime ? spreadMarkValue(mark) : null;
      if (markValue === null) {
        missingOpenMarkCount += 1;
      }
      openPnl += modeledOpenPnl(trade, markValue ?? trade.entryPrice);
    }

    return {
      label: timeInfo.label,
      missingOpenMarkCount,
      openPnl: roundCurrency(openPnl),
      openTradeCount,
      realizedPnl: roundCurrency(realizedPnl),
      time,
      timestampEt: timeInfo.timestampEt,
      totalPnl: roundCurrency(realizedPnl + openPnl),
    };
  });
}

export function summarizeDailyPnlSimulation(points: DailyPnlSimulationPoint[]): DailyPnlSimulationSummary {
  if (!points.length) {
    return {
      finalPnl: 0,
      highPnl: 0,
      lowPnl: 0,
      maxDrawdown: 0,
      maxOpenTrades: 0,
      missingOpenMarkObservations: 0,
      pointCount: 0,
    };
  }

  let peak = points[0].totalPnl;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.totalPnl);
    maxDrawdown = Math.max(maxDrawdown, peak - point.totalPnl);
  }

  return {
    finalPnl: points.at(-1)?.totalPnl ?? 0,
    highPnl: Math.max(...points.map((point) => point.totalPnl)),
    lowPnl: Math.min(...points.map((point) => point.totalPnl)),
    maxDrawdown: roundCurrency(maxDrawdown),
    maxOpenTrades: Math.max(...points.map((point) => point.openTradeCount)),
    missingOpenMarkObservations: points.reduce((sum, point) => sum + point.missingOpenMarkCount, 0),
    pointCount: points.length,
  };
}

function modeledOpenPnl(trade: TradeRecord, markValue: number): number {
  const contracts = Math.abs(Number(trade.contracts) || 0);
  const fees = Math.abs(Number(trade.fees) || 0);
  return (markValue - trade.entryPrice) * contracts * 100 - fees;
}

function spreadMarkValue(mark: SpreadMark): number | null {
  const value = typeof mark.close === "number" && Number.isFinite(mark.close) ? mark.close : mark.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function addTradeTime(timeline: Map<number, { label: string; timestampEt: string }>, value: string): void {
  const time = parseChartTimestampSeconds(value);
  if (!time) {
    return;
  }
  timeline.set(time, { label: tradeClockLabel(value), timestampEt: value });
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}
