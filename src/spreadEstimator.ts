// Select the trader's current live 0DTE SPX vertical credit spreads from an IBKR
// holdings snapshot. Net option legs do not carry a spread id, so we pair them
// heuristically into width-W verticals (short near the money + long protective
// leg). The aggregate portfolio view (see portfolioResponse.ts) sums all legs
// and does not depend on this grouping; only the per-spread view does.

import type { IbkrHoldingPosition, TradeRecord } from "../shared/types";
import type { SpreadSide } from "./spreadResponse";
import { tradesForDate } from "./tradeSelectors";

export type LiveSpreadLeg = {
  localSymbol: string;
  right: "C" | "P";
  strike: number;
  position: number; // signed contracts
  mark: number | null;
};

export type LiveSpread = {
  id: string;
  side: SpreadSide;
  shortStrike: number;
  longStrike: number;
  width: number;
  contracts: number; // matched quantity (positive)
  creditNow: number | null; // cost-to-close in index points (short mark - long mark)
  spot: number;
  shortLocalSymbol: string;
  longLocalSymbol: string;
};

export type LiveSpreadSelection = {
  spreads: LiveSpread[];
  unpaired: LiveSpreadLeg[];
  spot: number | null;
};

const digitsOnly = (value: string | null | undefined): string => String(value ?? "").replace(/\D/g, "");
const round2 = (value: number): number => Math.round(value * 100) / 100;

function legMark(position: IbkrHoldingPosition): number | null {
  if (position.marketPrice != null && Number.isFinite(position.marketPrice)) return position.marketPrice;
  if (position.bid != null && position.ask != null && Number.isFinite(position.bid) && Number.isFinite(position.ask)) {
    return (position.bid + position.ask) / 2;
  }
  if (position.last != null && Number.isFinite(position.last)) return position.last;
  return null;
}

/** True for an open SPX option (SPXW) expiring on `todayYyyymmdd` (digits, e.g. "20260603"). */
export function isZeroDteSpxOption(position: IbkrHoldingPosition, todayYyyymmdd: string): boolean {
  if ((position.securityType ?? "").toUpperCase() !== "OPT") return false;
  const symbol = (position.symbol ?? "").toUpperCase();
  const tradingClass = (position.tradingClass ?? "").toUpperCase();
  const local = (position.localSymbol ?? "").toUpperCase();
  const isSpx = symbol === "SPX" || tradingClass === "SPXW" || tradingClass === "SPX" || local.startsWith("SPXW");
  if (!isSpx) return false;
  if (digitsOnly(position.expiration) !== todayYyyymmdd) return false;
  const right = (position.right ?? "").toUpperCase();
  if (right !== "C" && right !== "P") return false;
  if (position.strike == null || !Number.isFinite(position.strike)) return false;
  return Math.abs(position.position) > 0;
}

function toLeg(position: IbkrHoldingPosition): LiveSpreadLeg {
  return {
    localSymbol: position.localSymbol || position.symbol || "",
    right: (position.right ?? "").toUpperCase() === "P" ? "P" : "C",
    strike: position.strike as number,
    position: position.position,
    mark: legMark(position),
  };
}

/**
 * Greedily pair short legs (sold) with the nearest protective long leg of the
 * same right into vertical credit spreads. Calls -> long strike above the short;
 * puts -> long strike below the short. Returns matched spreads + leftover legs.
 */
function pairVerticals(side: SpreadSide, legs: LiveSpreadLeg[], spot: number): { spreads: LiveSpread[]; leftover: LiveSpreadLeg[] } {
  const remaining = legs.map((leg) => ({ ...leg, remaining: Math.abs(leg.position) }));
  const shorts = remaining
    .filter((leg) => leg.position < 0)
    .sort((a, b) => (side === "call_credit" ? a.strike - b.strike : b.strike - a.strike));
  const spreads: LiveSpread[] = [];

  for (const short of shorts) {
    while (short.remaining > 0) {
      const candidates = remaining
        .filter((leg) => leg.position > 0 && leg.remaining > 0 && (side === "call_credit" ? leg.strike > short.strike : leg.strike < short.strike))
        .sort((a, b) => Math.abs(a.strike - short.strike) - Math.abs(b.strike - short.strike));
      const long = candidates[0];
      if (!long) break;
      const contracts = Math.min(short.remaining, long.remaining);
      const width = Math.abs(long.strike - short.strike);
      const creditNow = short.mark != null && long.mark != null ? round2(short.mark - long.mark) : null;
      spreads.push({
        id: `${side === "call_credit" ? "CCS" : "PCS"} ${short.strike}/${long.strike}`,
        side,
        shortStrike: short.strike,
        longStrike: long.strike,
        width,
        contracts,
        creditNow,
        spot,
        shortLocalSymbol: short.localSymbol,
        longLocalSymbol: long.localSymbol,
      });
      short.remaining -= contracts;
      long.remaining -= contracts;
    }
  }

  const leftover = remaining
    .filter((leg) => leg.remaining > 0)
    .map(({ remaining: rem, ...leg }) => ({ ...leg, position: leg.position < 0 ? -rem : rem }));
  return { spreads, leftover };
}

function ensureUniqueIds(spreads: LiveSpread[]): LiveSpread[] {
  const seen = new Map<string, number>();
  return spreads.map((spread) => {
    const n = seen.get(spread.id) ?? 0;
    seen.set(spread.id, n + 1);
    return n === 0 ? spread : { ...spread, id: `${spread.id} #${n + 1}` };
  });
}

/**
 * Build the current live 0DTE SPX vertical credit spreads from holdings positions.
 * `todayEt` is the ET trade date as "YYYY-MM-DD".
 */
export function selectOpenZeroDteSpxSpreads(positions: IbkrHoldingPosition[], todayEt: string): LiveSpreadSelection {
  const todayYyyymmdd = digitsOnly(todayEt);
  const legs = positions.filter((position) => isZeroDteSpxOption(position, todayYyyymmdd));
  if (legs.length === 0) {
    return { spreads: [], unpaired: [], spot: null };
  }
  const spot = legs.map((leg) => leg.underlyingPrice).find((value): value is number => value != null && Number.isFinite(value)) ?? null;
  const callLegs = legs.filter((leg) => (leg.right ?? "").toUpperCase() === "C").map(toLeg);
  const putLegs = legs.filter((leg) => (leg.right ?? "").toUpperCase() === "P").map(toLeg);

  const spreads: LiveSpread[] = [];
  const unpaired: LiveSpreadLeg[] = [];
  const effectiveSpot = spot ?? 0;
  for (const [side, sideLegs] of [["call_credit", callLegs], ["put_credit", putLegs]] as const) {
    const paired = pairVerticals(side, sideLegs, effectiveSpot);
    spreads.push(...paired.spreads);
    unpaired.push(...paired.leftover);
  }

  return { spreads: ensureUniqueIds(spreads), unpaired, spot };
}

/**
 * Unified option model for the Estimator's chip rail: a single spread the user
 * can click to focus the estimator on. Open spreads come from the live IBKR
 * holdings pull; closed spreads come from today's TradeRecord history. The
 * `status` distinguishes them; closed spreads are study material and never
 * enter the portfolio aggregate.
 */
export type EstimatorSpreadOption = {
  spread: LiveSpread;
  status: "open" | "closed";
  tradeId?: string;
  // ET wall-clock label of the exit fill, e.g. "13:42" — present only for closed.
  exitTimeLabel?: string;
  // Closed spreads only: realised P/L in dollars (entry credit kept minus close cost).
  realisedPnl?: number;
};

const HHMM_FROM_ISO = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  timeZone: "America/New_York",
});

function exitTimeLabel(iso: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return HHMM_FROM_ISO.format(date);
}

/**
 * True for an exited 0DTE SPX credit vertical we can plot in the estimator —
 * Call or Put (not Mixed), Credit-side, paired short/long strikes, SPXW legs,
 * expiration matching the trade's date, and an exit fill recorded.
 */
export function isClosedZeroDteSpxVertical(trade: TradeRecord, todayYyyymmdd: string): boolean {
  if (trade.side !== "Call" && trade.side !== "Put") return false; // Mixed → not a clean vertical
  if (trade.priceType !== "Credit") return false;
  if (trade.exitTime == null || trade.exitPrice == null) return false;
  if (trade.shortStrike == null || trade.longStrike == null) return false;
  if (!(trade.contracts > 0)) return false;
  // expiration is YYYYMMDD digits (e.g. "20260604"); must equal today's date digits.
  if (digitsOnly(trade.expiration ?? "") !== todayYyyymmdd) return false;
  // Best-effort SPXW check: any leg's localSymbol starts with SPXW.
  if (!trade.legs.some((leg) => (leg.localSymbol ?? "").toUpperCase().startsWith("SPXW"))) return false;
  return true;
}

/**
 * Map a paired vertical TradeRecord to a LiveSpread for the estimator. `creditNow`
 * is set to the trade's `entryPrice` so the Bachelier inversion frames the curve
 * at entry conditions ("what this position looked like when you put it on"),
 * referenced against today's live spot. Returns null for non-vertical trades.
 */
export function liveSpreadFromTradeRecord(trade: TradeRecord, spot: number): LiveSpread | null {
  if (trade.shortStrike == null || trade.longStrike == null) return null;
  if (trade.side !== "Call" && trade.side !== "Put") return null;
  const side: SpreadSide = trade.side === "Call" ? "call_credit" : "put_credit";
  const shortLeg = trade.legs.find((leg) => leg.strike === trade.shortStrike);
  const longLeg = trade.legs.find((leg) => leg.strike === trade.longStrike);
  const tag = side === "call_credit" ? "CCS" : "PCS";
  return {
    id: `${tag} ${trade.shortStrike}/${trade.longStrike} #closed-${trade.id}`,
    side,
    shortStrike: trade.shortStrike,
    longStrike: trade.longStrike,
    width: trade.width || Math.abs(trade.longStrike - trade.shortStrike),
    contracts: trade.contracts,
    creditNow: round2(trade.entryPrice),
    spot,
    shortLocalSymbol: shortLeg?.localSymbol ?? "",
    longLocalSymbol: longLeg?.localSymbol ?? "",
  };
}

/**
 * Build the EstimatorSpreadOption[] for today's already-exited 0DTE SPX credit
 * verticals. `spot` is the current live SPX (the closed spread's curve frames
 * against now, not the entry-time spot — the entry credit handles that).
 */
export function todayClosedSpxSpreads(
  trades: TradeRecord[],
  todayEt: string,
  spot: number,
): EstimatorSpreadOption[] {
  const todayYyyymmdd = digitsOnly(todayEt);
  const out: EstimatorSpreadOption[] = [];
  for (const trade of tradesForDate(trades, todayEt)) {
    if (!isClosedZeroDteSpxVertical(trade, todayYyyymmdd)) continue;
    const spread = liveSpreadFromTradeRecord(trade, spot);
    if (!spread) continue;
    const realisedPnl = trade.exitPrice != null ? Math.round((trade.entryPrice - trade.exitPrice) * trade.contracts * 100) : undefined;
    out.push({
      spread,
      status: "closed",
      tradeId: trade.id,
      exitTimeLabel: trade.exitTime ? exitTimeLabel(trade.exitTime) : undefined,
      realisedPnl,
    });
  }
  // Most-recently exited first — natural reading order for the rail.
  return out.sort((a, b) => (b.tradeId ?? "").localeCompare(a.tradeId ?? ""));
}

/**
 * The spreads array passed to buildPortfolioResponse. In **portfolio** mode the
 * aggregate is the OPEN spreads only (closed never contribute). In **focus**
 * mode it's the one focused spread — same single-element call works for both
 * open and closed because buildPortfolioResponse([oneSpread], …) returns the
 * row as the aggregate. Returns [] when a focused id doesn't resolve.
 */
export function activeSpreadsForResponse(
  openOptions: EstimatorSpreadOption[],
  allOptions: EstimatorSpreadOption[],
  focusedSpreadId: string | null,
): LiveSpread[] {
  if (focusedSpreadId) {
    const focused = allOptions.find((option) => option.spread.id === focusedSpreadId);
    return focused ? [focused.spread] : [];
  }
  return openOptions.map((option) => option.spread);
}
