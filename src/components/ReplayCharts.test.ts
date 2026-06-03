import { describe, expect, it } from "vitest";
import type { ReplayPayload, SpxBar } from "../../shared/types";
import { chartCountLabel } from "./MarketChart";
import { replayCutoffTime, takeThrough } from "./ReplayCharts";

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
});

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
