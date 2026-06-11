import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadMorningBrief,
  loadMorningLiveUpdates,
  loadTc2000Pulls,
  parseFirstSquawkRss,
  parseFirstSquawkTimeline,
  parseRollcallCalendar,
  readCachedLiveUpdatesForBrief,
  resetMorningLiveUpdateCacheForTests,
  morningBriefStatePath,
} from "./morningBrief.ts";

describe("morning brief parsers", () => {
  it("loads saved Morning state for normal app reads without pulling live sources", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-morning-state-"));
    const appRoot = path.join(tempDir, "app");
    const stateDir = path.join(tempDir, "state");
    const originalStateDir = process.env.RUBICON_MORNING_BRIEF_STATE_DIR;
    process.env.RUBICON_MORNING_BRIEF_STATE_DIR = stateDir;
    await fs.mkdir(appRoot, { recursive: true });

    const statePayload = {
      date: "2026-06-02",
      generatedAt: "2026-06-02T11:00:00.000Z",
      economicEvents: [
        {
          date: "2026-06-02",
          id: "cached-event",
          impact: "high",
          sortMinute: 600,
          source: "BLS",
          timeLabel: "10:00 AM",
          title: "Cached US macro event",
        },
      ],
      trumpEvents: [],
      combinedEvents: [],
      majorEvents: [],
      liveUpdates: [],
      tc2000: emptyTc2000State(),
      sources: [{ detail: "Cached state source.", label: "US macro calendar", status: "ok" }],
    };
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(morningBriefStatePath("2026-06-02", appRoot), JSON.stringify({ savedAt: "2026-06-02T11:01:00.000Z", payload: statePayload }, null, 2), "utf8");

    try {
      const loaded = await loadMorningBrief("2026-06-02", appRoot);

      expect(loaded.economicEvents.map((event) => event.title)).toEqual(["Cached US macro event"]);
      expect(loaded.generatedAt).toBe("2026-06-02T11:00:00.000Z");
      expect(loaded.sources.some((source) => source.label === "Morning brief state" && source.status === "ok")).toBe(true);
    } finally {
      restoreEnv("RUBICON_MORNING_BRIEF_STATE_DIR", originalStateDir);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("marks TC2000 scanner symbols that are new versus the previous saved Morning state", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-morning-tc2000-new-"));
    const appRoot = path.join(tempDir, "app");
    const stateDir = path.join(tempDir, "state");
    const originalStateDir = process.env.RUBICON_MORNING_BRIEF_STATE_DIR;
    process.env.RUBICON_MORNING_BRIEF_STATE_DIR = stateDir;
    await fs.mkdir(stateDir, { recursive: true });

    const previousPayload = {
      date: "2026-06-01",
      generatedAt: "2026-06-01T11:00:00.000Z",
      economicEvents: [],
      trumpEvents: [],
      combinedEvents: [],
      majorEvents: [],
      liveUpdates: [],
      tc2000: {
        ...emptyTc2000State(),
        available: true,
        note: "Previous scanner list.",
        screeners: [
          {
            name: "Three Bar Rule Spike/Base BO",
            source: "csv",
            symbols: ["SPCE", "NTAP"],
          },
        ],
        symbols: ["SPCE", "NTAP"],
      },
      sources: [],
    };
    const currentPayload = {
      ...previousPayload,
      date: "2026-06-02",
      generatedAt: "2026-06-02T11:00:00.000Z",
      tc2000: {
        ...emptyTc2000State(),
        available: true,
        note: "Current scanner list.",
        screeners: [
          {
            name: "Three Bar Rule Spike/Base BO",
            source: "csv",
            symbols: ["SPCE", "NTAP", "UIS"],
          },
        ],
        symbols: ["SPCE", "NTAP", "UIS"],
      },
    };
    await fs.writeFile(morningBriefStatePath("2026-06-01", appRoot), JSON.stringify({ savedAt: "2026-06-01T11:01:00.000Z", payload: previousPayload }, null, 2), "utf8");
    await fs.writeFile(morningBriefStatePath("2026-06-02", appRoot), JSON.stringify({ savedAt: "2026-06-02T11:01:00.000Z", payload: currentPayload }, null, 2), "utf8");

    try {
      const loaded = await loadMorningBrief("2026-06-02", appRoot);

      expect(loaded.tc2000.newSymbols).toEqual(["UIS"]);
      expect(loaded.tc2000.newSymbolsComparedWithDate).toBe("2026-06-01");
      expect(loaded.tc2000.screeners[0].newSymbols).toEqual(["UIS"]);
    } finally {
      restoreEnv("RUBICON_MORNING_BRIEF_STATE_DIR", originalStateDir);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("carries stale TC2000 screener source metadata into Morning pulls", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-morning-tc2000-stale-"));
    const appRoot = path.join(tempDir, "app");
    const exportRoot = path.join(tempDir, "IBKR Equity History Pull", "data", "tc2000_exports");
    await fs.mkdir(path.join(appRoot, "data"), { recursive: true });
    await fs.mkdir(exportRoot, { recursive: true });
    const exportPath = path.join(exportRoot, "qullamaggie_latest.csv");
    await fs.writeFile(exportPath, "symbol,screen\nUIS,Three Bar Rule Spike\n", "utf8");
    await fs.writeFile(
      path.join(appRoot, "data", "tc2000-daily-bars.json"),
      JSON.stringify(
        {
          barsBySymbol: {
            UIS: [{ close: 20, date: "2026-06-01", high: 21, low: 19, open: 20, volume: 1000 }],
          },
          generatedAt: "2026-06-02T12:00:00.000Z",
          note: "Daily bars available for 1 / 1 TC2000 symbols. TC2000 screener sources are stale.",
          screenerFreshnessStatus: "stale",
          source: "cache",
          sourceDetails: [
            {
              fresh: false,
              keptCount: 1,
              path: exportPath,
              rowCount: 1,
              updatedAt: "2026-06-01T12:00:00.000Z",
            },
          ],
          staleSourceCount: 1,
          symbols: ["UIS"],
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      const pulls = await loadTc2000Pulls(appRoot);

      expect(pulls.dailyBarsScreenerFreshnessStatus).toBe("stale");
      expect(pulls.dailyBarsStaleSourceCount).toBe(1);
      expect(pulls.dailyBarsSourceDetails?.[0]).toMatchObject({ fresh: false, keptCount: 1, path: exportPath });
      expect(pulls.note).toContain("TC2000 scanner CSV sources are stale");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refreshes live Morning data and saves it as state for later normal reads", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-morning-refresh-state-"));
    const appRoot = path.join(tempDir, "app");
    const stateDir = path.join(tempDir, "state");
    const originalStateDir = process.env.RUBICON_MORNING_BRIEF_STATE_DIR;
    const originalMacroDisabled = process.env.RUBICON_US_MACRO_CALENDAR_DISABLED;
    const originalRollcall = process.env.RUBICON_ROLLCALL_URL;
    process.env.RUBICON_MORNING_BRIEF_STATE_DIR = stateDir;
    process.env.RUBICON_US_MACRO_CALENDAR_DISABLED = "1";
    process.env.RUBICON_ROLLCALL_URL = "http://127.0.0.1:1/rollcall";
    await fs.mkdir(path.join(appRoot, "data"), { recursive: true });

    try {
      const refreshed = await loadMorningBrief("2026-06-02", appRoot, { refresh: true });
      const state = JSON.parse(await fs.readFile(morningBriefStatePath("2026-06-02", appRoot), "utf8"));
      const cached = await loadMorningBrief("2026-06-02", appRoot);

      expect(refreshed.date).toBe("2026-06-02");
      expect(state.payload.date).toBe("2026-06-02");
      expect(cached.generatedAt).toBe(refreshed.generatedAt);
      expect(cached.sources.some((source: { label?: string }) => source.label === "Morning brief state")).toBe(true);
    } finally {
      restoreEnv("RUBICON_MORNING_BRIEF_STATE_DIR", originalStateDir);
      restoreEnv("RUBICON_US_MACRO_CALENDAR_DISABLED", originalMacroDisabled);
      restoreEnv("RUBICON_ROLLCALL_URL", originalRollcall);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("parses actionable presidential events from a selected RollCall day", () => {
    const events = parseRollcallCalendar(
      `
      <!-- Day Header --><span>Saturday,</span><span>May 30, 2026</span>
      <!-- Event Row --><tr><td><div class="text-sm font-light">7:00 AM</div><div class="text-sm font-light text-gray-600 mt-2">Prior event</div></td></tr>
      <!-- Day Header --><span>Sunday,</span><span>May 31, 2026</span>
      <!-- Event Row --><tr><td>
        <div data-tooltip="Official Schedule"></div>
        <div class="text-sm font-light">8:00 AM</div>
        <div class="text-sm font-light text-gray-600 mt-2">The President participates in Executive Time</div>
        <i class="fa-solid fa-location-dot mr-2 text-[#333333]"></i><span class="text-sm font-normal text-[#333333]">The White House</span>
        <i class="fa-solid fa-user mr-2 text-[#333333]"></i><span class="text-sm font-normal text-[#333333]">Closed Press</span>
      </td></tr>
      <!-- Event Row --><tr><td>
        <div data-tooltip="Pool Call Time"></div>
        <div class="text-sm font-light">9:00 AM</div>
        <div class="text-sm font-light text-gray-600 mt-2">In-Town Pool Call Time</div>
      </td></tr>
      <!-- Event Row --><tr><td>
        <div data-tooltip="Official Schedule"></div>
        <div class="text-sm font-light">11:00 AM</div>
        <div class="text-sm font-light text-gray-600 mt-2">The President receives his Intelligence Briefing</div>
        <i class="fa-solid fa-location-dot mr-2 text-[#333333]"></i><span class="text-sm font-normal text-[#333333]">The White House</span>
        <i class="fa-solid fa-user mr-2 text-[#333333]"></i><span class="text-sm font-normal text-[#333333]">Closed Press</span>
      </td></tr>
      <!-- Event Row --><tr><td>
        <div data-tooltip="Pool Report"></div>
        <div class="text-sm font-light">12:14 PM</div>
        <div class="text-sm font-light text-gray-600 mt-2">White House Press Office: Lunch lid until 1:15 PM</div>
      </td></tr>
      <!-- Day Header --><span>Monday,</span><span>June 1, 2026</span>
      `,
      "2026-05-31",
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      timeLabel: "11:00 AM",
      title: "The President receives his Intelligence Briefing",
      location: "The White House",
      coverage: "Closed Press",
    });
  });

  it("parses FirstSquawk RSS items into live updates", () => {
    const updates = parseFirstSquawkRss(`
      <rss><channel>
        <item>
          <title>Fed speaker: policy remains restrictive.</title>
          <pubDate>Sun, 31 May 2026 17:12:15 GMT</pubDate>
          <guid isPermaLink="false">123</guid>
          <link>https://nitter.net/FirstSquawk/status/123#m</link>
        </item>
      </channel></rss>
    `);

    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("firstsquawk-123");
    expect(updates[0].text).toBe("Fed speaker: policy remains restrictive.");
    expect(updates[0].publishedAt).toBe("2026-05-31T17:12:15.000Z");
    expect(updates[0].kind).toBe("post");
  });

  it("marks Nitter reposts from tracked accounts as repost live updates", () => {
    const updates = parseFirstSquawkRss(`
      <rss><channel>
        <item>
          <title>RT by @FirstSquawk: Bond desk notes heavy buying in front-end futures.</title>
          <dc:creator>@MacroDesk</dc:creator>
          <pubDate>Sun, 31 May 2026 17:18:15 GMT</pubDate>
          <guid isPermaLink="false">456</guid>
          <link>https://nitter.net/MacroDesk/status/456#m</link>
        </item>
      </channel></rss>
    `);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      author: "@MacroDesk",
      kind: "repost",
      originalAuthor: "@MacroDesk",
      repostedBy: "@FirstSquawk",
      text: "Bond desk notes heavy buying in front-end futures.",
      trackedAccount: "FirstSquawk",
    });
  });

  it("parses the Nitter timeline page so FirstSquawk can refresh faster than RSS", () => {
    const updates = parseFirstSquawkTimeline(`
      <div class="timeline">
        <div class="timeline-item " data-username="FirstSquawk">
          <a class="tweet-link" href="/FirstSquawk/status/789#m"></a>
          <span class="tweet-date"><a href="/FirstSquawk/status/789#m" title="Jun 1, 2026 &#183; 6:01 PM UTC">32m</a></span>
          <a class="username" href="/FirstSquawk" title="@FirstSquawk">@FirstSquawk</a>
          <div class="tweet-content media-body" dir="auto">WE WILL NOT STRIKE BEIRUT - AL HADATH.</div>
        </div>
      </div>
    `);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: "firstsquawk-https://nitter.net/FirstSquawk/status/789#m",
      kind: "post",
      publishedAt: "2026-06-01T18:01:00.000Z",
      text: "WE WILL NOT STRIKE BEIRUT - AL HADATH.",
      url: "https://nitter.net/FirstSquawk/status/789#m",
    });
  });

  it("falls back from an empty FirstSquawk timeline URL to the next mirror", async () => {
    resetMorningLiveUpdateCacheForTests();
    const originalTimeline = process.env.RUBICON_FIRSTSQUAWK_TIMELINE_URL;
    const originalRss = process.env.RUBICON_FIRSTSQUAWK_RSS_URL;
    const originalCapture = process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH;
    const originalCache = process.env.RUBICON_LIVE_UPDATE_CACHE_PATH;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-firstsquawk-mirror-"));
    const server = http.createServer((request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      if (request.url === "/good") {
        response.end(`
          <div class="timeline">
            <div class="timeline-item " data-username="FirstSquawk">
              <a class="tweet-link" href="/FirstSquawk/status/900#m"></a>
              <span class="tweet-date"><a href="/FirstSquawk/status/900#m" title="Jun 2, 2026 &#183; 8:09 PM UTC">1m</a></span>
              <a class="username" href="/FirstSquawk" title="@FirstSquawk">@FirstSquawk</a>
              <div class="tweet-content media-body" dir="auto">PALO ALTO NETWORKS RAISES FY REVENUE OUTLOOK.&#xE056;&#xE03B;</div>
            </div>
          </div>
        `);
        return;
      }
      response.end("<html><body>No timeline items here.</body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const emptyUrl = `http://127.0.0.1:${port}/empty`;
    const goodUrl = `http://127.0.0.1:${port}/good`;
    process.env.RUBICON_FIRSTSQUAWK_TIMELINE_URL = `${emptyUrl},${goodUrl}`;
    process.env.RUBICON_FIRSTSQUAWK_RSS_URL = `http://127.0.0.1:${port}/rss`;
    process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH = path.join(tempDir, "missing-godel.json");
    process.env.RUBICON_LIVE_UPDATE_CACHE_PATH = path.join(tempDir, "live-cache.json");
    try {
      const payload = await loadMorningLiveUpdates();
      const firstSquawkSource = payload.sources.find((source) => source.label === "FirstSquawk live feed");

      expect(payload.liveUpdates).toHaveLength(1);
      expect(payload.liveUpdates[0]).toMatchObject({
        source: "FirstSquawk",
        text: "PALO ALTO NETWORKS RAISES FY REVENUE OUTLOOK.",
        url: `http://127.0.0.1:${port}/FirstSquawk/status/900#m`,
      });
      expect(firstSquawkSource).toMatchObject({ url: goodUrl });
      expect(firstSquawkSource?.detail).toContain("Pulled 1 items from FirstSquawk timeline");
    } finally {
      server.close();
      restoreEnv("RUBICON_FIRSTSQUAWK_TIMELINE_URL", originalTimeline);
      restoreEnv("RUBICON_FIRSTSQUAWK_RSS_URL", originalRss);
      restoreEnv("RUBICON_GODEL_NEWS_CAPTURE_PATH", originalCapture);
      restoreEnv("RUBICON_LIVE_UPDATE_CACHE_PATH", originalCache);
      resetMorningLiveUpdateCacheForTests();
    }
  });

  it("keeps the last good live update list when all live sources temporarily return empty", async () => {
    resetMorningLiveUpdateCacheForTests();
    const originalTimeline = process.env.RUBICON_FIRSTSQUAWK_TIMELINE_URL;
    const originalRss = process.env.RUBICON_FIRSTSQUAWK_RSS_URL;
    const originalCapture = process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH;
    const originalCache = process.env.RUBICON_LIVE_UPDATE_CACHE_PATH;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-live-cache-"));
    const capturePath = path.join(tempDir, "godel.json");
    const cachePath = path.join(tempDir, "live-cache.json");
    process.env.RUBICON_FIRSTSQUAWK_TIMELINE_URL = "http://127.0.0.1:1/firstsquawk";
    process.env.RUBICON_FIRSTSQUAWK_RSS_URL = "http://127.0.0.1:1/firstsquawk/rss";
    process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH = capturePath;
    process.env.RUBICON_LIVE_UPDATE_CACHE_PATH = cachePath;
    try {
      await fs.writeFile(
        capturePath,
        JSON.stringify([{ id: "g1", title: "Treasury auction tail draws desk attention", publishedAt: "2026-06-01T14:00:00Z" }]),
        "utf8",
      );
      const first = await loadMorningLiveUpdates();
      expect(first.liveUpdates).toHaveLength(1);
      expect(first.liveUpdates[0].source).toBe("Godel");

      await fs.rm(capturePath);
      resetMorningLiveUpdateCacheForTests();
      const second = await loadMorningLiveUpdates();
      expect(second.liveUpdates).toEqual(first.liveUpdates);
      expect(second.sources.some((source) => source.label === "Live update fallback cache")).toBe(true);
    } finally {
      restoreEnv("RUBICON_FIRSTSQUAWK_TIMELINE_URL", originalTimeline);
      restoreEnv("RUBICON_FIRSTSQUAWK_RSS_URL", originalRss);
      restoreEnv("RUBICON_GODEL_NEWS_CAPTURE_PATH", originalCapture);
      restoreEnv("RUBICON_LIVE_UPDATE_CACHE_PATH", originalCache);
      resetMorningLiveUpdateCacheForTests();
    }
  });

  it("reports FirstSquawk timeline and RSS failures when both live paths are unreachable", async () => {
    resetMorningLiveUpdateCacheForTests();
    const originalTimeline = process.env.RUBICON_FIRSTSQUAWK_TIMELINE_URL;
    const originalRss = process.env.RUBICON_FIRSTSQUAWK_RSS_URL;
    const originalCapture = process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH;
    const originalCache = process.env.RUBICON_LIVE_UPDATE_CACHE_PATH;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-firstsquawk-diagnostics-"));
    process.env.RUBICON_FIRSTSQUAWK_TIMELINE_URL = "http://127.0.0.1:1/firstsquawk";
    process.env.RUBICON_FIRSTSQUAWK_RSS_URL = "http://127.0.0.1:1/firstsquawk/rss";
    process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH = path.join(tempDir, "missing-godel.json");
    process.env.RUBICON_LIVE_UPDATE_CACHE_PATH = path.join(tempDir, "live-cache.json");
    try {
      const payload = await loadMorningLiveUpdates();
      const firstSquawkSource = payload.sources.find((source) => source.label === "FirstSquawk live feed");

      expect(firstSquawkSource).toMatchObject({ status: "warning" });
      expect(firstSquawkSource?.detail).toContain("Timeline check:");
      expect(firstSquawkSource?.detail).toContain("RSS fetch failed:");
    } finally {
      restoreEnv("RUBICON_FIRSTSQUAWK_TIMELINE_URL", originalTimeline);
      restoreEnv("RUBICON_FIRSTSQUAWK_RSS_URL", originalRss);
      restoreEnv("RUBICON_GODEL_NEWS_CAPTURE_PATH", originalCapture);
      restoreEnv("RUBICON_LIVE_UPDATE_CACHE_PATH", originalCache);
      resetMorningLiveUpdateCacheForTests();
    }
  });

  it("loads brief live tape from cache without requiring live-source network fetches", async () => {
    resetMorningLiveUpdateCacheForTests();
    const originalCache = process.env.RUBICON_LIVE_UPDATE_CACHE_PATH;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-brief-live-cache-"));
    const cachePath = path.join(tempDir, "live-cache.json");
    process.env.RUBICON_LIVE_UPDATE_CACHE_PATH = cachePath;
    try {
      await fs.writeFile(
        cachePath,
        JSON.stringify({
          cachedAt: new Date().toISOString(),
          items: [
            {
              id: "firstsquawk-cached-1",
              publishedAt: "2026-06-01T14:00:00Z",
              source: "FirstSquawk",
              text: "Cached desk headline.",
              timeLabel: "10:00 AM",
            },
          ],
        }),
        "utf8",
      );

      const cached = await readCachedLiveUpdatesForBrief();

      expect(cached.items).toHaveLength(1);
      expect(cached.items[0].text).toBe("Cached desk headline.");
      expect(cached.sources[0]).toMatchObject({
        label: "Live update cache",
        status: "ok",
      });
      expect(cached.sources[0].detail).toContain("Live Updates refresh separately");
      expect(cached.sources[0].detail).not.toContain("FirstSquawk and Godel");
    } finally {
      restoreEnv("RUBICON_LIVE_UPDATE_CACHE_PATH", originalCache);
      resetMorningLiveUpdateCacheForTests();
    }
  });

  it("drops numeric Godel DOM bridge rows from the live-update cache", async () => {
    resetMorningLiveUpdateCacheForTests();
    const originalCache = process.env.RUBICON_LIVE_UPDATE_CACHE_PATH;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-godel-cache-filter-"));
    const cachePath = path.join(tempDir, "live-cache.json");
    process.env.RUBICON_LIVE_UPDATE_CACHE_PATH = cachePath;
    try {
      await fs.writeFile(
        cachePath,
        JSON.stringify({
          cachedAt: new Date().toISOString(),
          items: [
            {
              id: "godel-bad-numbers",
              publishedAt: "2026-06-02T16:36:00Z",
              source: "Godel",
              text: "2945 2747 1878 1270 2515 7619.75 7619.50 7619.25 7619.00 7618.75 7618.50 7618.25",
              timeLabel: "12:36 PM",
            },
            {
              author: "Godel DOM bridge",
              id: "godel-old-chat",
              publishedAt: "2026-06-02T16:36:30Z",
              source: "Godel",
              text: "Broad chat row that should not enter the red alert tape.",
              timeLabel: "12:36 PM",
            },
            {
              id: "firstsquawk-good",
              publishedAt: "2026-06-02T16:37:00Z",
              source: "FirstSquawk",
              text: "Fed speaker says policy remains restrictive.",
              timeLabel: "12:37 PM",
            },
          ],
        }),
        "utf8",
      );

      const cached = await readCachedLiveUpdatesForBrief();

      expect(cached.items).toHaveLength(1);
      expect(cached.items[0]).toMatchObject({
        id: "firstsquawk-good",
        source: "FirstSquawk",
      });
    } finally {
      restoreEnv("RUBICON_LIVE_UPDATE_CACHE_PATH", originalCache);
      resetMorningLiveUpdateCacheForTests();
    }
  });

  it("loads TC2000 screener name and hits without needing the panel snapshot", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-tc2000-"));
    const appRoot = path.join(tempDir, "app");
    const pullDir = path.join(tempDir, "analysis", "tc2000_uis_scanner_20260531");
    const exportDir = path.join(tempDir, "IBKR Equity History Pull", "data", "tc2000_exports");
    await fs.mkdir(appRoot, { recursive: true });
    await fs.mkdir(pullDir, { recursive: true });
    await fs.mkdir(path.join(appRoot, "data"), { recursive: true });
    await fs.mkdir(exportDir, { recursive: true });
    await fs.writeFile(
      path.join(pullDir, "tc2000_Three_Bar_Rule_Spike..._crop_20260531_133301.ocr.json"),
      JSON.stringify({
        items: [
          { text: "US Stocks No Biotech", y1: 35 },
          { text: "Three Bar Rule Spike/Base BO", y1: 57 },
        ],
        symbols: ["SPCE", "NTAP"],
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(exportDir, "three_bar_latest.csv"),
      "symbol,screen,source_image,extracted_at\nSPCE,Three Bar Rule Spike...,crop.png,2026-05-31T13:33:10\nNTAP,Three Bar Rule Spike...,crop.png,2026-05-31T13:33:10\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(exportDir, "staircase_latest.csv"),
      "symbol,screen,source_image,extracted_at\nONON,Staircase 5of6,crop.png,2026-05-31T16:30:14\nGE,Staircase 5of6,crop.png,2026-05-31T16:30:14\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(appRoot, "data", "tc2000-daily-bars.json"),
      JSON.stringify({
        barsBySymbol: {
          ONON: [{ close: 40, date: "2026-05-29", high: 41, low: 39, open: 39.5, volume: 1000 }],
          SPCE: [{ close: 8, date: "2026-05-29", high: 8.5, low: 7.5, open: 7.75, volume: 2000 }],
        },
        generatedAt: "2026-05-31T20:30:00.000Z",
        profilesBySymbol: {
          ONON: {
            description: "On Holding AG develops and distributes sports products.",
            industry: "Footwear & Accessories",
            name: "On Holding AG",
            source: "test",
          },
        },
        source: "test-cache",
      }),
      "utf8",
    );

    const tc2000 = await loadTc2000Pulls(appRoot);

    expect(tc2000.screenerName).toBe("Three Bar Rule Spike/Base BO");
    expect(tc2000.symbols).toEqual(["ONON", "GE", "SPCE", "NTAP"]);
    expect(tc2000.screeners.map((screener) => screener.name)).toEqual(["Staircase 5of6", "Three Bar Rule Spike/Base BO"]);
    expect(tc2000.dailyBars.ONON[0].close).toBe(40);
    expect(tc2000.dailyBarsGeneratedAt).toBe("2026-05-31T20:30:00.000Z");
    expect(tc2000.profiles.ONON).toMatchObject({
      description: "On Holding AG develops and distributes sports products.",
      industry: "Footwear & Accessories",
      name: "On Holding AG",
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function emptyTc2000State() {
  return {
    artifacts: [],
    available: false,
    dailyBars: {},
    dailyBarsGeneratedAt: null,
    dailyBarsSource: null,
    note: "Cached test state.",
    profiles: {},
    screeners: [],
    sourceDir: null,
    symbols: [],
  };
}
