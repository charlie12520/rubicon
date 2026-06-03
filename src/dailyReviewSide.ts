import type { TradeRecord } from "../shared/types";

export type DailyReviewActionKind = "entry" | "exit" | "expiration";

export function reviewActionSide(side: TradeRecord["side"], kind: DailyReviewActionKind): TradeRecord["side"] {
  if (kind !== "exit") {
    return side;
  }
  if (side === "Call") {
    return "Put";
  }
  if (side === "Put") {
    return "Call";
  }
  return side;
}

export function reviewActionDirectionLabel(side: TradeRecord["side"]): string {
  if (side === "Put") {
    return "Long";
  }
  if (side === "Call") {
    return "Short";
  }
  return "Mixed";
}
