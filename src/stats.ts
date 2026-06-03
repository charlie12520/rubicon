import type { TradeRecord, WalletSnapshot } from "../shared/types";
import { reviewActionSide } from "./dailyReviewSide";
import { isSyntheticExpirationExit, tradeClockLabel, tradeExitClockLabel, tradeTimestamp } from "./tradeTime";

export const REPLAY_SPEEDS = [1, 2, 4, 8, 16] as const;

export type TradeStats = {
  totalTrades: number;
  terminalTrades: number;
  netPnl: number;
  avgPnl: number;
  winRate: number | null;
  callMaxPosition: number;
  putMaxPosition: number;
  callMaxRisk: number;
  putMaxRisk: number;
  totalRisk: number;
  bestTrade: number | null;
  worstTrade: number | null;
  wallet: WalletSnapshot;
};

export type DailyReviewEvent = {
  kind: "entry" | "exit" | "expiration";
  tradeId: string;
  time: number;
  timeLabel: string;
  side: TradeRecord["side"];
  strategy: string;
  strikes: string;
  contracts: number;
  price: number | null;
  spx: number | null;
  pnl: number;
  status: string;
};

export type DailyReview = {
  totalEntries: number;
  totalExits: number;
  totalExpirations: number;
  openTrades: number;
  closedTrades: number;
  expiredTrades: number;
  netPnl: number;
  maxRisk: number;
  maxProfit: number;
  bestTrade: number | null;
  worstTrade: number | null;
  events: DailyReviewEvent[];
  sideBreakdown: Record<TradeRecord["side"], { count: number; pnl: number }>;
};

export function summarizeTrades(trades: TradeRecord[], wallet: WalletSnapshot): TradeStats {
  const terminal = trades.filter((trade) => trade.winLoss !== "Open");
  const netPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = terminal.filter((trade) => trade.winLoss === "Win").length;
  const callTrades = trades.filter((trade) => trade.side === "Call");
  const putTrades = trades.filter((trade) => trade.side === "Put");
  const pnlValues = trades.map((trade) => trade.pnl);
  const callMaxPosition = maxConcurrentContracts(callTrades);
  const putMaxPosition = maxConcurrentContracts(putTrades);

  return {
    totalTrades: trades.length,
    terminalTrades: terminal.length,
    netPnl,
    avgPnl: trades.length ? netPnl / trades.length : 0,
    winRate: terminal.length ? wins / terminal.length : null,
    callMaxPosition,
    putMaxPosition,
    callMaxRisk: maxOf(callTrades, "maxRisk"),
    putMaxRisk: maxOf(putTrades, "maxRisk"),
    totalRisk: trades.reduce((sum, trade) => sum + trade.maxRisk, 0),
    bestTrade: pnlValues.length ? Math.max(...pnlValues) : null,
    worstTrade: pnlValues.length ? Math.min(...pnlValues) : null,
    wallet,
  };
}

export function buildDailyReview(trades: TradeRecord[]): DailyReview {
  const sortedTrades = [...trades].sort((a, b) => tradeTimestamp(a.entryTime) - tradeTimestamp(b.entryTime));
  const terminal = sortedTrades.filter((trade) => trade.exitTime);
  const expirations = terminal.filter(isSyntheticExpirationExit);
  const regularExits = terminal.filter((trade) => !isSyntheticExpirationExit(trade));
  const pnlValues = sortedTrades.map((trade) => trade.pnl);
  const sideBreakdown: DailyReview["sideBreakdown"] = {
    Call: { count: 0, pnl: 0 },
    Mixed: { count: 0, pnl: 0 },
    Put: { count: 0, pnl: 0 },
  };
  const events: DailyReviewEvent[] = [];

  for (const trade of sortedTrades) {
    sideBreakdown[trade.side].count += 1;
    sideBreakdown[trade.side].pnl += trade.pnl;

    events.push({
      kind: "entry",
      tradeId: trade.id,
      time: tradeTimestamp(trade.entryTime),
      timeLabel: tradeClockLabel(trade.entryTime),
      side: trade.side,
      strategy: trade.strategy,
      strikes: strikeLabel(trade),
      contracts: trade.contracts,
      price: trade.entryPrice,
      spx: trade.spxEntry,
      pnl: trade.pnl,
      status: trade.status,
    });

    if (trade.exitTime) {
      const isExpiration = isSyntheticExpirationExit(trade);
      events.push({
        kind: isExpiration ? "expiration" : "exit",
        tradeId: trade.id,
        time: tradeTimestamp(trade.exitTime),
        timeLabel: tradeExitClockLabel(trade),
        side: reviewActionSide(trade.side, isExpiration ? "expiration" : "exit"),
        strategy: trade.strategy,
        strikes: strikeLabel(trade),
        contracts: trade.contracts,
        price: trade.exitPrice,
        spx: trade.spxExit,
        pnl: trade.pnl,
        status: trade.status,
      });
    }
  }

  events.sort((a, b) => a.time - b.time || (a.kind === "entry" ? -1 : 1));

  return {
    totalEntries: sortedTrades.length,
    totalExits: regularExits.length,
    totalExpirations: expirations.length,
    openTrades: sortedTrades.length - terminal.length,
    closedTrades: terminal.length,
    expiredTrades: expirations.length,
    netPnl: sortedTrades.reduce((sum, trade) => sum + trade.pnl, 0),
    maxRisk: sortedTrades.reduce((sum, trade) => sum + trade.maxRisk, 0),
    maxProfit: sortedTrades.reduce((sum, trade) => sum + trade.maxProfit, 0),
    bestTrade: pnlValues.length ? Math.max(...pnlValues) : null,
    worstTrade: pnlValues.length ? Math.min(...pnlValues) : null,
    events,
    sideBreakdown,
  };
}

function maxConcurrentContracts(trades: TradeRecord[]): number {
  const events = trades.flatMap((trade) => {
    const entry = tradeTimestamp(trade.entryTime);
    if (!entry) {
      return [];
    }
    const exit = tradeTimestamp(trade.exitTime) || sessionEndTimestamp(trade);
    const contracts = Math.abs(trade.contracts || 0);
    return [
      { contracts, order: 1, time: entry },
      { contracts: -contracts, order: 0, time: Math.max(exit, entry) },
    ];
  });

  let open = 0;
  let maxOpen = 0;
  for (const event of events.sort((a, b) => a.time - b.time || a.order - b.order)) {
    open = Math.max(0, open + event.contracts);
    maxOpen = Math.max(maxOpen, open);
  }
  return maxOpen;
}

function sessionEndTimestamp(trade: TradeRecord): number {
  const offset = trade.entryTime.match(/([+-]\d{2}:\d{2})$/)?.[1] ?? "-05:00";
  const parsed = Date.parse(`${trade.date}T16:15:00${offset}`);
  return Number.isFinite(parsed) ? parsed : tradeTimestamp(trade.entryTime);
}

function maxOf(trades: TradeRecord[], key: keyof Pick<TradeRecord, "positionAfter" | "maxRisk">): number {
  if (!trades.length) {
    return 0;
  }
  return Math.max(...trades.map((trade) => Math.abs(Number(trade[key]) || 0)));
}

function strikeLabel(trade: TradeRecord): string {
  if (trade.shortStrike === null || trade.longStrike === null) {
    return "Unmapped";
  }
  return `${trade.shortStrike}/${trade.longStrike}`;
}
