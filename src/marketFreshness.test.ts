import { describe, expect, it } from "vitest";
import { marketFreshness } from "./marketFreshness";

describe("market freshness", () => {
  it("reports today's archive as imported when today exists in available dates", () => {
    const result = marketFreshness(
      {
        availableDates: ["2026-05-28", "2026-05-29"],
        latestTradeDate: "2026-05-29",
        today: "2026-05-29",
      },
      "2026-05-29",
    );

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error("Expected market freshness result");
    }
    expect(result.tone).toBe("ok");
    expect(result.label).toBe("Today imported");
    expect(result.detail).toContain("viewing 2026-05-29");
  });

  it("stays quiet when today's archive is missing", () => {
    const result = marketFreshness(
      {
        availableDates: ["2026-05-26", "2026-05-27", "2026-05-28"],
        latestTradeDate: "2026-05-28",
        today: "2026-05-29",
      },
      "2026-05-28",
    );

    expect(result).toBeNull();
  });

  it("does not show a today-pending warning on weekends", () => {
    const result = marketFreshness(
      {
        availableDates: ["2026-05-28", "2026-05-29"],
        latestTradeDate: "2026-05-29",
        today: "2026-05-30",
      },
      "2026-05-29",
    );

    expect(result).toBeNull();
  });
});
