import type { TradeRecord } from "../shared/types";

export function tradeClockLabel(value: string | null | undefined, fallback = "-"): string {
  if (!value) {
    return fallback;
  }
  const match = value.match(/[T\s](\d{2}:\d{2})/);
  return match?.[1] ?? fallback;
}

export function tradeTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isSyntheticExpirationExit(trade: TradeRecord): boolean {
  return tradeClockLabel(trade.exitTime, "") === "16:00" && trade.status.toLowerCase().includes("expired");
}

export function tradeExitClockLabel(trade: TradeRecord): string {
  if (!trade.exitTime) {
    return "Open";
  }
  return isSyntheticExpirationExit(trade) ? "EOD" : tradeClockLabel(trade.exitTime);
}

export function tradeHeldLabel(
  trade: TradeRecord,
  options: { expirationAsEod?: boolean } = {},
): string {
  if (!trade.exitTime) {
    return "Open";
  }
  if (options.expirationAsEod && isSyntheticExpirationExit(trade)) {
    return "EOD";
  }

  const entry = tradeTimestamp(trade.entryTime);
  const exit = tradeTimestamp(trade.exitTime);
  if (!entry || !exit || exit < entry) {
    return "-";
  }

  const minutes = Math.round((exit - entry) / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
