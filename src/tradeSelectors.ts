import type { TradeRecord } from "../shared/types";
import { tradeTimestamp } from "./tradeTime";

export function countTradesByDate(trades: TradeRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const trade of trades) {
    counts.set(trade.date, (counts.get(trade.date) ?? 0) + 1);
  }
  return counts;
}

export function tradesForDate(trades: TradeRecord[], date: string): TradeRecord[] {
  return trades.filter((trade) => trade.date === date);
}

export function selectTradeById(trades: TradeRecord[], id?: string | null): TradeRecord | null {
  return id ? trades.find((trade) => trade.id === id) ?? null : null;
}

export function selectTradeByIdOrFirst(trades: TradeRecord[], id?: string | null): TradeRecord | null {
  return selectTradeById(trades, id) ?? trades[0] ?? null;
}

export function sortTradesByEntryTime(trades: TradeRecord[]): TradeRecord[] {
  return [...trades].sort((left, right) => tradeTimestamp(left.entryTime) - tradeTimestamp(right.entryTime));
}

export function mapTradesById(trades: TradeRecord[]): Map<string, TradeRecord> {
  return new Map(trades.map((trade) => [trade.id, trade]));
}
