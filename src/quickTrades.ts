import type { TradeRecord } from "../shared/types";
import { formatNumber } from "./format";
import { tradeClockLabel } from "./tradeTime";

export function quickTradeLabel(trade: TradeRecord): string {
  return [
    tradeClockLabel(trade.entryTime),
    trade.side[0],
    `${trade.shortStrike}/${trade.longStrike}`,
    `x${formatNumber(trade.contracts)}`,
  ].join(" ");
}

export function quickTradeAriaLabel(trade: TradeRecord): string {
  return [
    "Replay",
    tradeClockLabel(trade.entryTime),
    trade.side,
    trade.strategy,
    `${trade.shortStrike}/${trade.longStrike}`,
    `${formatNumber(trade.contracts)} contracts`,
    trade.entryChartDeviationFlag ? "entry price alert" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function quickTradeCountLabel(trades: TradeRecord[]): string {
  return `${trades.length} quick ${trades.length === 1 ? "check" : "checks"}`;
}
