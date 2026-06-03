import { describe, expect, it } from "vitest";
import type { MorningLiveUpdate } from "../shared/types";
import {
  alertableNewLiveUpdates,
  alertableNewLiveUpdatesCompiled,
  compileLiveUpdateFilters,
  liveUpdateMatchesFilter,
  matchingCompiledLiveUpdateFilters,
  matchingLiveUpdateFilters,
  parseLiveUpdateFilterText,
} from "./liveUpdateFilters";

function update(overrides: Partial<MorningLiveUpdate>): MorningLiveUpdate {
  return {
    id: overrides.id ?? "u1",
    author: overrides.author,
    kind: overrides.kind,
    originalAuthor: overrides.originalAuthor,
    publishedAt: overrides.publishedAt ?? "2026-05-31T12:00:00.000Z",
    replyTo: overrides.replyTo,
    repostedBy: overrides.repostedBy,
    source: overrides.source ?? "FirstSquawk",
    text: overrides.text ?? "Fed speaker says policy is restrictive",
    timeLabel: overrides.timeLabel ?? "8:00 AM",
    trackedAccount: overrides.trackedAccount,
    url: overrides.url,
  };
}

describe("live update word filters", () => {
  it("parses comma, semicolon, and newline separated terms", () => {
    expect(parseLiveUpdateFilterText(" Fed, tariff\nIRAN; fed ")).toEqual(["fed", "tariff", "iran"]);
  });

  it("matches simple words without matching inside longer words", () => {
    const item = update({ text: "Fed speaker comments on rates" });

    expect(liveUpdateMatchesFilter(item, ["fed"])).toBe(true);
    expect(liveUpdateMatchesFilter(update({ text: "Confederation headline" }), ["fed"])).toBe(false);
  });

  it("matches regardless of Caps Lock in either filter or post text", () => {
    expect(liveUpdateMatchesFilter(update({ text: "FED SPEAKER COMMENTS ON RATES" }), ["fed"])).toBe(true);
    expect(liveUpdateMatchesFilter(update({ text: "Fed speaker comments on rates" }), ["FED"])).toBe(true);
  });

  it("matches phrases and reports matching filter terms", () => {
    const item = update({ text: "White House discusses a possible rate cut path" });

    expect(liveUpdateMatchesFilter(item, ["rate cut"])).toBe(true);
    expect(matchingLiveUpdateFilters(item, ["fed", "rate cut"])).toEqual(["rate cut"]);
  });

  it("keeps empty filters silent for live-update alarms", () => {
    expect(liveUpdateMatchesFilter(update({ text: "Any new update" }), [])).toBe(false);
    expect(alertableNewLiveUpdates([update({ id: "new" })], new Set(), [])).toEqual([]);
  });

  it("returns only new updates that match the configured filter", () => {
    const previousIds = new Set(["old"]);
    const updates = [
      update({ id: "old", text: "Fed comments again" }),
      update({ id: "new-match", text: "Tariff headline crosses" }),
      update({ id: "new-ignore", text: "Weather headline crosses" }),
    ];

    expect(alertableNewLiveUpdates(updates, previousIds, ["tariff"]).map((item) => item.id)).toEqual(["new-match"]);
  });

  it("matches repost metadata as well as update text", () => {
    const item = update({
      author: "@MacroDesk",
      kind: "repost",
      repostedBy: "@FirstSquawk",
      text: "Bond desk notes heavy buying.",
    });

    expect(liveUpdateMatchesFilter(item, ["repost"])).toBe(true);
    expect(liveUpdateMatchesFilter(item, ["macrodesk"])).toBe(true);
  });

  it("can reuse compiled filters for fast repeated update checks", () => {
    const filters = compileLiveUpdateFilters(["FED", "rate cut", "fed"]);
    const item = update({ id: "new-match", text: "White House discusses a possible rate cut path" });

    expect(filters.map((filter) => filter.term)).toEqual(["fed", "rate cut"]);
    expect(matchingCompiledLiveUpdateFilters(item, filters).map((filter) => filter.term)).toEqual(["rate cut"]);
    expect(alertableNewLiveUpdatesCompiled([item], new Set(), filters).map((next) => next.id)).toEqual(["new-match"]);
  });
});
