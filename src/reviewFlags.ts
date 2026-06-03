import type { TradeReviewFlag } from "../shared/types";

export type ReviewFlagFilter = "all" | TradeReviewFlag | "unflagged";

export type ReviewFlagCounts = Record<ReviewFlagFilter | "flagged", number>;

type FlaggedTrade = {
  id: string;
};

export type ReviewFlagQueueItem<TTrade extends FlaggedTrade> = {
  flag: TradeReviewFlag;
  trade: TTrade;
};

const EMPTY_FLAG_COUNTS: ReviewFlagCounts = {
  all: 0,
  flagged: 0,
  follow_up: 0,
  mistake: 0,
  quality: 0,
  unflagged: 0,
};

export function countReviewFlags<TTrade extends FlaggedTrade>(
  trades: TTrade[],
  tradeFlags: Record<string, TradeReviewFlag>,
): ReviewFlagCounts {
  const counts = { ...EMPTY_FLAG_COUNTS, all: trades.length };
  for (const trade of trades) {
    const flag = tradeFlags[trade.id];
    if (flag) {
      counts.flagged += 1;
      counts[flag] += 1;
    } else {
      counts.unflagged += 1;
    }
  }
  return counts;
}

export function filterReviewFlagTrades<TTrade extends FlaggedTrade>(
  trades: TTrade[],
  tradeFlags: Record<string, TradeReviewFlag>,
  filter: ReviewFlagFilter,
): TTrade[] {
  if (filter === "all") {
    return trades;
  }
  if (filter === "unflagged") {
    return trades.filter((trade) => !tradeFlags[trade.id]);
  }
  return trades.filter((trade) => tradeFlags[trade.id] === filter);
}

export function reviewFlagQueue<TTrade extends FlaggedTrade>(
  trades: TTrade[],
  tradeFlags: Record<string, TradeReviewFlag>,
): Array<ReviewFlagQueueItem<TTrade>> {
  return trades.flatMap((trade) => {
    const flag = tradeFlags[trade.id];
    return flag ? [{ flag, trade }] : [];
  });
}
