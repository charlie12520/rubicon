import { describe, expect, it } from "vitest";
import { visibleReplayDateTabs } from "./replayDateTabs";

describe("replay date tabs", () => {
  it("hides the retired May 26 and May 27 tabs without mutating available dates", () => {
    const availableDates = ["2026-06-01", "2026-05-29", "2026-05-28", "2026-05-27", "2026-05-26"];

    expect(visibleReplayDateTabs(availableDates)).toEqual(["2026-06-01", "2026-05-29", "2026-05-28"]);
    expect(availableDates).toEqual(["2026-06-01", "2026-05-29", "2026-05-28", "2026-05-27", "2026-05-26"]);
  });
});
