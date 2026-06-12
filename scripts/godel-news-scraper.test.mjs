import { describe, expect, it } from "vitest";
import {
  bannerRowsToNewsItems,
  bannerTimeOfDayToIso,
  parseGodelBannerText,
  stableBannerId,
} from "./godel-news-scraper.mjs";

describe("Godel breaking banner scraper helpers", () => {
  it("splits the time-pipe banner text and ignores non-banner text", () => {
    expect(parseGodelBannerText(" 1:43:18 PM | ADOBE (ADBE.O) SHARES FELL 10% ")).toEqual({
      headline: "ADOBE (ADBE.O) SHARES FELL 10%",
      timeOfDay: "1:43:18 PM",
    });
    expect(parseGodelBannerText("ADOBE (ADBE.O) SHARES FELL 10%")).toBeNull();
  });

  it("attaches today's local date and rolls far-future times back to yesterday", () => {
    const afternoonNow = new Date(2026, 5, 12, 14, 0, 0);
    expect(bannerTimeOfDayToIso("1:43:18 PM", afternoonNow)).toBe(new Date(2026, 5, 12, 13, 43, 18).toISOString());

    const afterMidnight = new Date(2026, 5, 13, 0, 30, 0);
    expect(bannerTimeOfDayToIso("11:59:00 PM", afterMidnight)).toBe(new Date(2026, 5, 12, 23, 59, 0).toISOString());
  });

  it("uses same-day headline identity instead of seconds-precision identity", () => {
    const headline = "IRNA REPORTED THAT AN IRANIAN FOREIGN MINISTRY SPOKESPERSON SAID TALKS REMAIN POSSIBLE";
    const first = stableBannerId(headline, new Date(2026, 5, 12, 13, 41, 52).toISOString());
    const second = stableBannerId(headline, new Date(2026, 5, 12, 13, 41, 55).toISOString());
    const nextDay = stableBannerId(headline, new Date(2026, 5, 13, 13, 41, 52).toISOString());

    expect(first).toBe(second);
    expect(first).not.toBe(nextDay);
  });

  it("maps all matched banners to Godel Breaking rows without a ticker", () => {
    const now = new Date(2026, 5, 12, 13, 45, 0);
    const rows = bannerRowsToNewsItems(
      [
        { headline: "ADOBE (ADBE.O) SHARES FELL 10%, HITTING THEIR LOWEST LEVEL SINCE 2018.", isRed: false, timeOfDay: "1:43:18 PM" },
        { fullText: "1:44:01 PM | FED'S LOGAN: POLICY REMAINS RESTRICTIVE", isRed: true },
      ],
      now,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      headline: "ADOBE (ADBE.O) SHARES FELL 10%, HITTING THEIR LOWEST LEVEL SINCE 2018.",
      severity: "standard",
      source: "Godel Breaking",
      time: new Date(2026, 5, 12, 13, 43, 18).toISOString(),
      timeLabel: "1:43:18 PM",
    });
    expect(rows[1]).toMatchObject({
      headline: "FED'S LOGAN: POLICY REMAINS RESTRICTIVE",
      severity: "red",
      source: "Godel Breaking",
      time: new Date(2026, 5, 12, 13, 44, 1).toISOString(),
    });
    expect(rows.some((row) => Object.hasOwn(row, "ticker"))).toBe(false);
  });
});
