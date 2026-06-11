import { describe, expect, it } from "vitest";
import type { ReplayPayload, SpreadMark, SpxBar } from "../../shared/types";
import { chartCountLabel } from "./marketChartMarkers";
import { aggregateSpxBars, buildSelectedSpreadMarks, replayCutoffTime, replayEventLabel, takeThrough } from "./replayChartsData";

describe("replay chart visibility", () => {
  it("uses the full session until replay mode is explicitly enabled", () => {
    const replay = replayPayload([bar(100, "09:30"), bar(200, "09:31"), bar(300, "09:32")]);

    const fullDayCutoff = replayCutoffTime(replay, 0, false);
    const replayCutoff = replayCutoffTime(replay, 0, true);

    expect(fullDayCutoff).toBe(Number.MAX_SAFE_INTEGER);
    expect(takeThrough(replay.spxBars, fullDayCutoff)).toHaveLength(3);
    expect(takeThrough(replay.spxBars, replayCutoff)).toHaveLength(1);
  });

  it("does not render raw chart count labels for Replay panels", () => {
    expect(chartCountLabel("candles", [bar(100, "09:30")])).toBe("");
    expect(chartCountLabel("line", [])).toBe("");
    expect(chartCountLabel("spread-bars", [])).toBe("");
  });

  it("dedupes same-spread marks by timestamp for grouped spread replay", () => {
    const marks = [
      spreadMark("trade-a", 100, -0.35),
      spreadMark("trade-b", 100, -0.4),
      spreadMark("trade-b", 160, -0.2),
      spreadMark("other", 160, -0.9),
    ];

    const selected = buildSelectedSpreadMarks(marks, new Set(["trade-a", "trade-b"]));

    expect(selected.map((mark) => `${mark.tradeId}:${mark.time}:${mark.value}`)).toEqual([
      "trade-a:100:-0.35",
      "trade-b:160:-0.2",
    ]);
  });

  it("keeps replay event labels compact in grouped and single-trade modes", () => {
    expect(replayEventLabel("entry", "09:31", 0, true)).toBe("E1 09:31");
    expect(replayEventLabel("exit", "09:57", 0, true)).toBe("X1 09:57");
    expect(replayEventLabel("entry", "09:31", 0, false)).toBe("Entry 09:31");
    expect(replayEventLabel("exit", "09:57", 0, false)).toBe("Exit 09:57");
  });
});

describe("aggregateSpxBars (2-minute candles)", () => {
  it("merges consecutive 1-minute bars into 2-minute OHLC candles", () => {
    // times are epoch seconds; 0/60 share a 2-min bucket, 120/180 the next, 240 is a partial bucket
    const out = aggregateSpxBars(
      [
        ohlcBar(0, 10, 12, 9, 11),
        ohlcBar(60, 11, 15, 10, 14),
        ohlcBar(120, 14, 16, 13, 15),
        ohlcBar(180, 15, 15, 8, 9),
        ohlcBar(240, 9, 11, 9, 10),
      ],
      2,
    );

    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ time: 0, open: 10, high: 15, low: 9, close: 14 });
    expect(out[1]).toMatchObject({ time: 120, open: 14, high: 16, low: 8, close: 9 });
    expect(out[2]).toMatchObject({ time: 240, open: 9, high: 11, low: 9, close: 10 });
  });

  it("keeps each candle's first bar timestamp identity", () => {
    const out = aggregateSpxBars([ohlcBar(0, 1, 1, 1, 1), ohlcBar(60, 1, 1, 1, 1)], 2);
    expect(out[0].timestampEt).toBe("t0");
    expect(out[0].label).toBe("t0");
  });

  it("returns the input untouched for 1-minute or empty input", () => {
    const bars = [ohlcBar(0, 1, 2, 0, 1)];
    expect(aggregateSpxBars(bars, 1)).toBe(bars);
    expect(aggregateSpxBars([], 2)).toEqual([]);
  });

  it("does not mutate the source bars", () => {
    const first = ohlcBar(0, 10, 12, 9, 11);
    aggregateSpxBars([first, ohlcBar(60, 11, 15, 8, 14)], 2);
    expect(first).toMatchObject({ open: 10, high: 12, low: 9, close: 11 });
  });
});

function ohlcBar(time: number, open: number, high: number, low: number, close: number): SpxBar {
  return { time, timestampEt: `t${time}`, label: `t${time}`, open, high, low, close };
}

function replayPayload(spxBars: SpxBar[]): ReplayPayload {
  return {
    date: "2026-05-29",
    openInterest: [],
    quickTrades: [],
    selectedTradeId: null,
    spreadMarks: [],
    spxBars,
    volume: [],
  };
}

function bar(time: number, label: string): SpxBar {
  return {
    close: 1,
    high: 1,
    label,
    low: 1,
    open: 1,
    time,
    timestampEt: `2026-05-29T${label}:00-04:00`,
  };
}

function spreadMark(tradeId: string, time: number, value: number): SpreadMark {
  return {
    entrySequence: 1,
    label: `t${time}`,
    permId: tradeId,
    source: "test",
    time,
    timestampEt: `2026-05-29T09:${time}:00-04:00`,
    tradeId,
    value,
  };
}
