import { describe, expect, it } from "vitest";
import { parseGodelLiveNews, readGodelLiveNewsSource } from "./godelLiveNews.ts";

describe("Godel live news ingestion", () => {
  it("keeps missing-source fallback detail terse", async () => {
    const previousUrl = process.env.RUBICON_GODEL_NEWS_URL;
    const previousCapturePath = process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH;
    delete process.env.RUBICON_GODEL_NEWS_URL;
    process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH = "C:/rubicon-test/missing-godel-live-news.json";
    try {
      const result = await readGodelLiveNewsSource();

      expect(result.items).toEqual([]);
      expect(result.source.detail).toBe("Godel feed unavailable.");
      expect(result.source.detail).not.toMatch(/RUBICON_GODEL_NEWS_URL|godel:scrape|capture-godel-news/i);
    } finally {
      if (previousUrl === undefined) {
        delete process.env.RUBICON_GODEL_NEWS_URL;
      } else {
        process.env.RUBICON_GODEL_NEWS_URL = previousUrl;
      }
      if (previousCapturePath === undefined) {
        delete process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH;
      } else {
        process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH = previousCapturePath;
      }
    }
  });

  it("normalizes JSON news rows into Morning live updates", () => {
    const updates = parseGodelLiveNews(
      JSON.stringify({
        news: [
          {
            headline: "Fed governor says policy remains restrictive",
            id: "g1",
            publishedAt: "2026-05-31T14:03:00-04:00",
            source: "Wire",
            url: "https://example.test/news/g1",
          },
        ],
      }),
      "https://app.godelterminal.com/news",
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      author: "Wire",
      feedUrl: "https://app.godelterminal.com/news",
      id: "godel-g1",
      publishedAt: "2026-05-31T18:03:00.000Z",
      source: "Godel",
      text: "Fed governor says policy remains restrictive",
      trackedAccount: "Godel",
      url: "https://example.test/news/g1",
    });
  });

  it("normalizes browser scrape capture payloads", () => {
    const updates = parseGodelLiveNews(
      JSON.stringify({
        capturedAt: "2026-06-02T13:00:00.000Z",
        count: 1,
        news: [
          {
            captureKind: "bottom-right-red-alert",
            headline: "Treasury desk flags a jump in auction concession",
            id: "scrape-3",
            provider: "Godel red alert",
            publishedAt: "2026-06-02T08:59:00-04:00",
            sourceUrl: "https://app.godelterminal.com/news",
            url: null,
          },
        ],
        sourceUrl: "https://app.godelterminal.com/news",
      }),
      "data/godel-live-news.json",
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      author: "Godel red alert",
      feedUrl: "data/godel-live-news.json",
      id: "godel-scrape-3",
      publishedAt: "2026-06-02T12:59:00.000Z",
      source: "Godel",
      text: "Treasury desk flags a jump in auction concession",
    });
  });

  it("normalizes the godel-news-scraper capture shape (items[], ISO time, ticker)", () => {
    // exact output of scripts/godel-news-scraper.mjs -> data/godel-live-news.json:
    // the scraper converts the DOM's local-naive stamp to ISO at write time, so
    // the contract here is timezone-independent and pinned exactly
    const updates = parseGodelLiveNews(
      JSON.stringify({
        generatedAt: "2026-06-11T21:00:00.000Z",
        items: [
          {
            id: "202606111501BENZINGANEWSOPEN_53153136.xml",
            headline: "Nvidia Millionaires Can't Afford To Sell, ETFs May Be Their Escape Route",
            time: "2026-06-11T19:01:28.000Z",
            ticker: "NVDA",
            source: "Benzinga Lightning Feed",
          },
          {
            id: "202606111430BENZINGANEWSOPEN_53152453.xml",
            headline: "Stock Market Whipsawed on Trump Statements, ECB Rate Hike, Hotter PPI",
            time: "2026-06-11T18:32:24.000Z",
            ticker: "SPY",
            source: "Benzinga Lightning Feed",
          },
        ],
      }),
      "data/godel-live-news.json",
    );

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      id: "godel-202606111501BENZINGANEWSOPEN_53153136.xml",
      source: "Godel",
      author: "Benzinga Lightning Feed",
      text: "Nvidia Millionaires Can't Afford To Sell, ETFs May Be Their Escape Route",
      publishedAt: "2026-06-11T19:01:28.000Z",
      timeLabel: "3:01 PM",
    });
    expect(updates.every((u) => u.source === "Godel")).toBe(true);
  });

  it("normalizes banner-only Godel Breaking captures without a ticker", () => {
    const updates = parseGodelLiveNews(
      JSON.stringify({
        generatedAt: "2026-06-12T17:45:00.000Z",
        items: [
          {
            id: "breaking-2026-06-12-e7f0d5c0a4f3b9aa",
            headline: "ADOBE (ADBE.O) SHARES FELL 10%, HITTING THEIR LOWEST LEVEL SINCE 2018.",
            time: "2026-06-12T17:43:18.000Z",
            source: "Godel Breaking",
          },
        ],
      }),
      "data/godel-live-news.json",
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      author: "Godel Breaking",
      id: "godel-breaking-2026-06-12-e7f0d5c0a4f3b9aa",
      publishedAt: "2026-06-12T17:43:18.000Z",
      source: "Godel",
      text: "ADOBE (ADBE.O) SHARES FELL 10%, HITTING THEIR LOWEST LEVEL SINCE 2018.",
      timeLabel: "1:43 PM",
    });
  });

  it("still accepts a legacy local-naive time stamp without crashing", () => {
    // transition safety: captures written before the ISO change carry
    // "M/D/YY H:M:S"; the parsed instant depends on the server's local tz, so
    // only existence is pinned here
    const updates = parseGodelLiveNews(
      JSON.stringify({ items: [{ id: "x1", headline: "Some headline text here", time: "6/11/26 15:01:28", source: "Wire" }] }),
      "data/godel-live-news.json",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].publishedAt).not.toBeNull();
    expect(updates[0].timeLabel).not.toBe("Time TBD");
  });

  it("drops unmarked broad DOM bridge rows from Godel live updates", () => {
    const updates = parseGodelLiveNews(
      JSON.stringify({
        capturedAt: "2026-06-02T13:00:00.000Z",
        count: 1,
        mode: "godel-dom-bridge",
        news: [
          {
            headline: "Broad chat row that should not enter red alert tape",
            id: "old-chat",
            provider: "Godel DOM bridge",
            publishedAt: "2026-06-02T08:59:00-04:00",
            sourceUrl: "https://app.godelterminal.com/news",
            url: "https://app.godelterminal.com/news",
          },
        ],
        sourceUrl: "Godel DOM bridge",
      }),
      "data/godel-live-news.json",
    );

    expect(updates).toEqual([]);
  });

  it("recovers the first JSON payload from concatenated JSON captures", () => {
    const updates = parseGodelLiveNews(
      JSON.stringify({ ping: "unused" }) + JSON.stringify({
        news: [
          {
            text: "Front-end futures bid in a sharp rebound.",
            publishedAt: "2026-06-02T09:00:00-04:00",
            id: "concat-1",
            source: "Widget",
          },
        ],
      }),
      "data/godel-live-news.json",
    );

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      author: "Widget",
      id: "godel-concat-1",
      publishedAt: "2026-06-02T13:00:00.000Z",
      source: "Godel",
      text: "Front-end futures bid in a sharp rebound.",
      trackedAccount: "Godel",
    });
  });

  it("normalizes RSS-like Godel rows", () => {
    const updates = parseGodelLiveNews(`
      <rss><channel>
        <item>
          <title>Oil reverses after headline</title>
          <description>Energy desk cites supply comments.</description>
          <pubDate>Sun, 31 May 2026 18:10:00 GMT</pubDate>
          <guid>rss-1</guid>
          <link>https://example.test/rss-1</link>
        </item>
      </channel></rss>
    `);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "godel-rss-1",
      publishedAt: "2026-05-31T18:10:00.000Z",
      text: "Oil reverses after headline - Energy desk cites supply comments.",
    });
  });
});
