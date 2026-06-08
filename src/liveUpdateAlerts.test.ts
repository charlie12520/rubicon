import { describe, expect, it } from "vitest";
import type { MorningLiveUpdate } from "../shared/types";
import { compileLiveUpdateFilters } from "./liveUpdateFilters";
import { buildLiveUpdateDesktopAlertPayload, triggerLiveUpdateDesktopAlertBatch } from "./liveUpdateAlerts";

function update(overrides: Partial<MorningLiveUpdate>): MorningLiveUpdate {
  return {
    id: overrides.id ?? "u1",
    author: overrides.author,
    kind: overrides.kind,
    originalAuthor: overrides.originalAuthor,
    publishedAt: overrides.publishedAt ?? "2026-06-02T12:00:00.000Z",
    replyTo: overrides.replyTo,
    repostedBy: overrides.repostedBy,
    source: overrides.source ?? "FirstSquawk",
    text: overrides.text ?? "FED SPEAKER COMMENTS ON TARIFF RISKS",
    timeLabel: overrides.timeLabel ?? "8:00 AM",
    trackedAccount: overrides.trackedAccount,
    url: overrides.url,
  };
}

describe("live update desktop alerts", () => {
  it("builds a readable Windows alert payload for matching live updates", () => {
    const filters = compileLiveUpdateFilters(["fed", "tariff"]);
    const payload = buildLiveUpdateDesktopAlertPayload(
      [
        update({ id: "new-1", text: "FED SPEAKER COMMENTS ON TARIFF RISKS", timeLabel: "8:31 AM" }),
        update({ id: "new-2", text: "TARIFF HEADLINE CROSSES", timeLabel: "8:32 AM" }),
      ],
      filters,
    );

    expect(payload).toEqual({
      body: "Fed speaker comments on tariff risks",
      detail: "Matched fed, tariff - 8:31 AM - 2 matching updates",
      title: "FirstSquawk word-filter alert",
    });
  });

  it("stays silent when no matching updates are passed", () => {
    expect(buildLiveUpdateDesktopAlertPayload([], compileLiveUpdateFilters(["fed"]))).toBeNull();
  });

  it("sends one desktop notification for a matching live-update batch", async () => {
    const sent: unknown[] = [];

    await triggerLiveUpdateDesktopAlertBatch(
      [update({ id: "new-1", text: "FED SPEAKER COMMENTS ON TARIFF RISKS" })],
      compileLiveUpdateFilters(["fed"]),
      async (payload) => {
        sent.push(payload);
        return { generatedAt: "2026-06-02T12:00:00.000Z", message: "sent", ok: true };
      },
    );

    expect(sent).toEqual([
      {
        body: "Fed speaker comments on tariff risks",
        detail: "Matched fed - 8:00 AM",
        title: "FirstSquawk word-filter alert",
      },
    ]);
  });
});
