import type { SpxBar, TradeRecord } from "../shared/types";
import { CONE_PRIOR_A } from "./expectedMoveCone";

// Compact statistics for the Daily Review page, rendered directly under the
// entry/exit chart. Everything here is intentionally NON-duplicative with the
// metric cards above the chart (entries/exits, net, avg, risk carried) and the
// P/L overlay summary (final / high / low / drawdown).

export type ReviewStatTone = "good" | "bad" | "neutral";

export type ReviewStatItem = {
  key: string;
  label: string;
  value: string;
  detail?: string;
  tone?: ReviewStatTone;
};

const SESSION_END_FALLBACK_MINUTES = 390;

function parseTimeMs(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatPts(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)} pts`;
}

function formatMinutes(minutes: number): string {
  if (minutes >= 90) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return `${hours}h ${rest}m`;
  }
  return `${Math.round(minutes)}m`;
}

/**
 * Realized session diffusion rate in pts/sqrt-MINUTE from bar closes. The
 * replay payload serves 5-second bars while other surfaces use 1-minute bars,
 * so the per-bar RMS move is normalized by the actual bar spacing.
 */
export function realizedSessionRate(spxBars: SpxBar[]): number | null {
  if (spxBars.length < 30) {
    return null;
  }
  const spacings: number[] = [];
  for (let i = 1; i < Math.min(spxBars.length, 60); i++) {
    const dt = spxBars[i].time - spxBars[i - 1].time;
    if (dt > 0) {
      spacings.push(dt);
    }
  }
  if (!spacings.length) {
    return null;
  }
  spacings.sort((a, b) => a - b);
  const barSeconds = spacings[Math.floor(spacings.length / 2)];
  if (!(barSeconds > 0)) {
    return null;
  }

  let sumSq = 0;
  let count = 0;
  for (let i = 1; i < spxBars.length; i++) {
    const diff = spxBars[i].close - spxBars[i - 1].close;
    if (Number.isFinite(diff)) {
      sumSq += diff * diff;
      count += 1;
    }
  }
  if (!count) {
    return null;
  }
  return Math.sqrt(sumSq / count) / Math.sqrt(barSeconds / 60);
}

/**
 * Worst (smallest) distance from SPX to a trade's short strike while the trade
 * was open. Negative = the short strike was breached. Calls measure against bar
 * highs, puts against bar lows.
 */
export function closestStrikeApproach(
  trades: TradeRecord[],
  spxBars: SpxBar[],
): { worstPts: number; worstLabel: string; breachedCount: number } | null {
  if (!spxBars.length) {
    return null;
  }
  const sessionEndMs = parseTimeMs(spxBars[spxBars.length - 1].timestampEt) ?? Number.POSITIVE_INFINITY;
  let worstPts = Number.POSITIVE_INFINITY;
  let worstLabel = "";
  let breachedCount = 0;

  for (const trade of trades) {
    if (trade.side === "Mixed" || trade.shortStrike === null || !Number.isFinite(trade.shortStrike)) {
      continue;
    }
    const entryMs = parseTimeMs(trade.entryTime);
    if (entryMs === null) {
      continue;
    }
    const exitMs = parseTimeMs(trade.exitTime) ?? sessionEndMs;
    let tradeMin = Number.POSITIVE_INFINITY;
    for (const bar of spxBars) {
      const barMs = parseTimeMs(bar.timestampEt);
      if (barMs === null || barMs < entryMs || barMs > exitMs) {
        continue;
      }
      const distance = trade.side === "Call" ? trade.shortStrike - bar.high : bar.low - trade.shortStrike;
      if (distance < tradeMin) {
        tradeMin = distance;
      }
    }
    if (!Number.isFinite(tradeMin)) {
      continue;
    }
    if (tradeMin < 0) {
      breachedCount += 1;
    }
    if (tradeMin < worstPts) {
      worstPts = tradeMin;
      worstLabel = `${trade.side} ${trade.shortStrike}`;
    }
  }

  if (!Number.isFinite(worstPts)) {
    return null;
  }
  return { worstPts, worstLabel, breachedCount };
}

export function buildDailyReviewStatItems({
  trades,
  spxBars,
}: {
  trades: TradeRecord[];
  spxBars: SpxBar[];
}): ReviewStatItem[] {
  if (!trades.length) {
    return [];
  }
  const items: ReviewStatItem[] = [];

  // --- session character ------------------------------------------------------
  if (spxBars.length >= 2) {
    const open = spxBars[0].open;
    const close = spxBars[spxBars.length - 1].close;
    const high = Math.max(...spxBars.map((bar) => bar.high));
    const low = Math.min(...spxBars.map((bar) => bar.low));
    const changePts = close - open;
    const changePct = open > 0 ? (changePts / open) * 100 : 0;
    items.push({
      key: "session-move",
      label: "SPX session",
      value: `${formatPts(changePts)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`,
      detail: `O ${open.toFixed(0)} → C ${close.toFixed(0)}`,
      tone: "neutral",
    });
    const rangePts = high - low;
    items.push({
      key: "session-range",
      label: "Range",
      value: `${rangePts.toFixed(1)} pts`,
      detail: `H ${high.toFixed(0)} / L ${low.toFixed(0)} · ${close > 0 ? ((rangePts / close) * 100).toFixed(2) : "0.00"}%`,
      tone: "neutral",
    });
    const rate = realizedSessionRate(spxBars);
    if (rate !== null) {
      const ratio = rate / CONE_PRIOR_A;
      items.push({
        key: "session-vol",
        label: "Vol vs typical",
        value: `${ratio.toFixed(2)}×`,
        detail: `${rate.toFixed(2)} pts/√min realized · typical ${CONE_PRIOR_A.toFixed(1)}`,
        tone: ratio >= 1.5 ? "bad" : "neutral",
      });
    }
  }

  // --- premium economics ------------------------------------------------------
  const terminal = trades.filter((trade) => trade.winLoss === "Win" || trade.winLoss === "Loss" || trade.winLoss === "Flat");
  const grossWin = terminal.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = terminal.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0);
  if (terminal.length) {
    const profitFactor = grossLoss < 0 ? grossWin / Math.abs(grossLoss) : null;
    items.push({
      key: "profit-factor",
      label: "Profit factor",
      value: profitFactor === null ? (grossWin > 0 ? "∞" : "—") : profitFactor.toFixed(2),
      detail: `won $${Math.round(grossWin).toLocaleString()} / lost $${Math.round(Math.abs(grossLoss)).toLocaleString()}`,
      tone: profitFactor === null ? (grossWin > 0 ? "good" : "neutral") : profitFactor >= 1 ? "good" : "bad",
    });
  }

  const creditTrades = trades.filter((trade) => trade.priceType === "Credit" && Number.isFinite(trade.entryPrice));
  if (creditTrades.length) {
    const totalCreditDollars = creditTrades.reduce((sum, t) => sum + Math.abs(t.entryPrice) * t.contracts * 100, 0);
    const avgCredit = creditTrades.reduce((sum, t) => sum + Math.abs(t.entryPrice), 0) / creditTrades.length;
    const netPnl = terminal.reduce((sum, t) => sum + t.pnl, 0);
    if (totalCreditDollars > 0 && terminal.length) {
      const capture = (netPnl / totalCreditDollars) * 100;
      items.push({
        key: "credit-capture",
        label: "Credit captured",
        value: `${capture >= 0 ? "+" : ""}${capture.toFixed(0)}%`,
        detail: `of $${Math.round(totalCreditDollars).toLocaleString()} collected`,
        tone: capture >= 0 ? "good" : "bad",
      });
    }
    items.push({
      key: "avg-credit",
      label: "Avg credit",
      value: `${avgCredit.toFixed(2)} pts`,
      detail: `${creditTrades.length} credit spread${creditTrades.length === 1 ? "" : "s"}`,
      tone: "neutral",
    });
  }

  // --- timing ------------------------------------------------------------------
  const holds: number[] = [];
  let expiredCount = 0;
  for (const trade of trades) {
    const entryMs = parseTimeMs(trade.entryTime);
    const exitMs = parseTimeMs(trade.exitTime);
    if (entryMs !== null && exitMs !== null && exitMs >= entryMs) {
      holds.push((exitMs - entryMs) / 60_000);
    } else if (entryMs !== null && trade.winLoss !== "Open") {
      expiredCount += 1;
    }
  }
  if (holds.length || expiredCount) {
    const avgHold = holds.length ? holds.reduce((sum, h) => sum + h, 0) / holds.length : SESSION_END_FALLBACK_MINUTES;
    const longest = holds.length ? Math.max(...holds) : SESSION_END_FALLBACK_MINUTES;
    items.push({
      key: "avg-hold",
      label: "Avg hold",
      value: formatMinutes(avgHold),
      detail: `longest ${formatMinutes(longest)}${expiredCount ? ` · ${expiredCount} held to expiry` : ""}`,
      tone: "neutral",
    });
  }

  // --- risk / execution ----------------------------------------------------------
  const approach = closestStrikeApproach(trades, spxBars);
  if (approach) {
    items.push({
      key: "strike-approach",
      label: "Closest strike approach",
      value: approach.worstPts < 0 ? `breached ${Math.abs(approach.worstPts).toFixed(1)} pts` : `${approach.worstPts.toFixed(1)} pts`,
      detail: `${approach.worstLabel}${approach.breachedCount ? ` · ${approach.breachedCount} short${approach.breachedCount === 1 ? "" : "s"} breached` : " · no shorts breached"}`,
      tone: approach.worstPts < 0 ? "bad" : approach.worstPts < 10 ? "neutral" : "good",
    });
  }

  const slippageFlags = trades.filter((trade) => trade.entryChartDeviationFlag).length;
  items.push({
    key: "entry-slippage",
    label: "Entry slippage flags",
    value: String(slippageFlags),
    detail: slippageFlags ? "entry fills diverged from the chart mark" : "all entries matched the chart",
    tone: slippageFlags ? "bad" : "good",
  });

  return items;
}
