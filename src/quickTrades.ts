import type { TradeRecord } from "../shared/types";
import { formatNumber } from "./format";
import { tradeClockLabel } from "./tradeTime";

export type QuickSpreadGroup = {
  key: string;
  date: string;
  side: TradeRecord["side"];
  shortStrike: number | null;
  longStrike: number | null;
  trades: TradeRecord[];
  contracts: number;
  pnl: number;
};

export function quickSpreadKey(trade: Pick<TradeRecord, "date" | "side" | "shortStrike" | "longStrike">): string {
  return `${trade.date}:${trade.side}:${trade.shortStrike ?? "?"}:${trade.longStrike ?? "?"}`;
}

export function buildQuickSpreadGroups(trades: TradeRecord[]): QuickSpreadGroup[] {
  const groups = new Map<string, QuickSpreadGroup>();
  for (const trade of trades) {
    const key = quickSpreadKey(trade);
    const existing = groups.get(key);
    if (existing) {
      existing.trades.push(trade);
      existing.contracts += trade.contracts;
      existing.pnl += trade.pnl;
      continue;
    }
    groups.set(key, {
      key,
      date: trade.date,
      side: trade.side,
      shortStrike: trade.shortStrike,
      longStrike: trade.longStrike,
      trades: [trade],
      contracts: trade.contracts,
      pnl: trade.pnl,
    });
  }

  return Array.from(groups.values()).sort((a, b) => a.trades[0].entryTime.localeCompare(b.trades[0].entryTime));
}

export function quickSpreadLabel(group: QuickSpreadGroup): string {
  const side = group.side === "Call" ? "Call" : group.side === "Put" ? "Put" : "Mixed";
  const entryLabel = `${group.trades.length} ${group.trades.length === 1 ? "entry" : "entries"}`;
  return `${side} ${group.shortStrike}/${group.longStrike} - ${entryLabel}`;
}

export function quickSpreadAriaLabel(group: QuickSpreadGroup): string {
  return [
    "Replay spread",
    group.side,
    `${group.shortStrike}/${group.longStrike}`,
    `${group.trades.length} ${group.trades.length === 1 ? "entry" : "entries"}`,
    `${formatNumber(group.contracts)} total contracts`,
  ].join(" ");
}

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
