import { describe, expect, it } from "vitest";
import type { MorningBriefPayload, MorningLiveUpdate } from "../shared/types";
import { countNewLiveUpdates, mergeLiveUpdateList, preserveMorningBriefLiveUpdates } from "./morningLiveState";

function update(id: string): MorningLiveUpdate {
  return {
    id,
    publishedAt: "2026-05-31T16:00:00.000Z",
    source: "FirstSquawk",
    text: id,
    timeLabel: "12:00 PM",
  };
}

function brief(liveUpdates: MorningLiveUpdate[]): MorningBriefPayload {
  return {
    combinedEvents: [],
    date: "2026-05-31",
    economicEvents: [],
    generatedAt: "2026-05-31T16:00:00.000Z",
    liveUpdates,
    majorEvents: [],
    sources: [],
    tc2000: {
      artifacts: [],
      available: false,
      dailyBars: {},
      dailyBarsGeneratedAt: null,
      dailyBarsSource: null,
      note: "",
      profiles: {},
      screeners: [],
      sourceDir: null,
      symbols: [],
    },
    trumpEvents: [],
  };
}

describe("morning live update state", () => {
  it("counts only unseen updates in a refreshed live payload", () => {
    expect(countNewLiveUpdates([update("old")], [update("new"), update("old")])).toBe(1);
  });

  it("keeps existing live updates when a refresh comes back empty", () => {
    expect(mergeLiveUpdateList([update("old")], [])).toEqual([update("old")]);
  });

  it("replaces existing live updates when a refresh has rows", () => {
    expect(mergeLiveUpdateList([update("old")], [update("new")])).toEqual([update("new")]);
  });

  it("preserves live updates during a full brief refresh with an empty transient live feed", () => {
    expect(preserveMorningBriefLiveUpdates(brief([update("old")]), brief([])).liveUpdates).toEqual([update("old")]);
  });
});
