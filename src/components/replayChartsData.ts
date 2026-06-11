import type { ReplayPayload, SpxBar, SpreadMark, SpreadRangeBar } from "../../shared/types";
import { resampleBars } from "../../shared/resampleBars";

export function replayEventLabel(kind: "entry" | "exit", timeLabel: string, tradeIndex: number, grouped: boolean): string {
  if (grouped) {
    return `${kind === "entry" ? "E" : "X"}${tradeIndex + 1} ${timeLabel}`;
  }
  return `${kind === "entry" ? "Entry" : "Exit"} ${timeLabel}`;
}

export function buildSelectedSpreadMarks(spreadMarks: SpreadMark[], selectedTradeIds: Set<string>): SpreadMark[] {
  if (!selectedTradeIds.size) {
    return [];
  }
  const selectedMarks = spreadMarks.filter((mark) => selectedTradeIds.has(mark.tradeId));
  if (selectedTradeIds.size <= 1) {
    return selectedMarks;
  }

  const marksByTime = new Map<number, SpreadMark>();
  for (const mark of selectedMarks) {
    if (!marksByTime.has(mark.time)) {
      marksByTime.set(mark.time, mark);
    }
  }
  return Array.from(marksByTime.values()).sort((a, b) => a.time - b.time);
}

export function buildSpreadRangeBars(marks: SpreadMark[]): SpreadRangeBar[] {
  return marks.map((mark, index) => {
    const hasSourceRange = [mark.open, mark.high, mark.low, mark.close].every((value) => Number.isFinite(value));
    const previous = marks[index - 1]?.value ?? mark.value;
    const open = finiteOr(mark.open, previous);
    const close = finiteOr(mark.close, mark.value);
    const high = Math.max(finiteOr(mark.high, Math.max(open, close)), open, close);
    const low = Math.min(finiteOr(mark.low, Math.min(open, close)), open, close);
    return {
      tradeId: mark.tradeId,
      timestampEt: mark.timestampEt,
      label: mark.label,
      time: mark.time,
      open,
      high,
      low,
      close,
      source: mark.source,
      constructed: !hasSourceRange,
    };
  });
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function replayCutoffTime(replay: ReplayPayload | null, replayIndex: number, replayMode: boolean): number {
  if (!replayMode) {
    return Number.MAX_SAFE_INTEGER;
  }
  return replay?.spxBars[replayIndex]?.time ?? Number.MAX_SAFE_INTEGER;
}

export function takeThrough<T extends { time: number }>(items: T[], time: number): T[] {
  return items.filter((item) => item.time <= time);
}

/**
 * Aggregate 1-minute SPX bars into `minutes`-minute OHLC candles for display.
 * Thin wrapper around the shared resampler (used by the Daily Review chart and the
 * server warmup feed too) so every surface buckets identically.
 */
export function aggregateSpxBars(bars: SpxBar[], minutes: number): SpxBar[] {
  return resampleBars(bars, minutes);
}
