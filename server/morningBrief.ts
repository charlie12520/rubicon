import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";
import type {
  MorningCompanyProfile,
  MorningDailyBar,
  MorningBriefPayload,
  MorningBriefSource,
  MorningCalendarEvent,
  MorningMajorEvent,
  MorningLiveUpdatesPayload,
  MorningLiveUpdate,
  MorningTc2000Artifact,
  MorningTc2000ArtifactKind,
  MorningTc2000Pulls,
  MorningTc2000Screener,
} from "../shared/types.ts";
import { readGodelLiveNewsSource } from "./godelLiveNews.ts";
import { writeJsonAtomic } from "./jsonStore.ts";
import { isUsMacroMajorEvent, readUsMacroCalendar, usMacroEventKind } from "./morningMacroCalendar.ts";

const ROLLCALL_URL = "https://rollcall.com/factbase/trump/calendar/";
const FIRSTSQUAWK_TIMELINE_URL = "https://nitter.net/FirstSquawk";
const FIRSTSQUAWK_TIMELINE_URLS = ["https://xcancel.com/FirstSquawk", FIRSTSQUAWK_TIMELINE_URL];
const FIRSTSQUAWK_RSS_URL = "https://nitter.net/FirstSquawk/rss";
const FIRSTSQUAWK_RSS_URLS = [FIRSTSQUAWK_RSS_URL];
const FETCH_TIMEOUT_MS = 12_000;
const LIVE_FEED_FETCH_TIMEOUT_MS = Number(process.env.RUBICON_LIVE_FEED_FETCH_TIMEOUT_MS ?? 3_500);
const LIVE_FEED_STALE_MINUTES = 15;
const MONTH_SLUGS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = path.resolve(serverDir, "..");
let lastGoodLiveUpdates: MorningLiveUpdate[] = [];
let lastGoodLiveUpdatesAt: string | null = null;

type FetchResult = {
  text: string;
  status: number;
};

type LiveUpdateCachePayload = {
  cachedAt?: unknown;
  items?: unknown;
};

type MorningBriefLoadOptions = {
  refresh?: boolean;
};

type MorningBriefStatePayload = {
  payload?: unknown;
  savedAt?: unknown;
};

function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(`${date}T12:00:00-04:00`));
}

function cleanText(value: string): string {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\uE000-\uF8FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function parseTimeMinute(label: string): number | null {
  const match = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function sourceStatus(label: string, status: MorningBriefSource["status"], detail: string, url?: string): MorningBriefSource {
  return { label, status, detail, url };
}

function liveUpdateCachePath(): string {
  return process.env.RUBICON_LIVE_UPDATE_CACHE_PATH || path.join(defaultAppRoot, "data", "morning-live-updates-cache.json");
}

function morningBriefStateDir(appRoot = defaultAppRoot): string {
  return process.env.RUBICON_MORNING_BRIEF_STATE_DIR || path.join(appRoot, "data", "morning-brief-state");
}

export function morningBriefStatePath(date: string, appRoot = defaultAppRoot): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Morning brief state date must be YYYY-MM-DD.");
  }
  return path.join(morningBriefStateDir(appRoot), `${date}.json`);
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}

function weekStartMonday(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

function majorEventWindow(date: string): { endExclusive: string; nextWeekStart: string; start: string } {
  const start = weekStartMonday(date);
  const nextWeekStart = addDays(start, 7);
  return {
    endExclusive: addDays(start, 14),
    nextWeekStart,
    start,
  };
}

function windowForDate(date: string, nextWeekStart: string): MorningMajorEvent["window"] {
  return compareIsoDate(date, nextWeekStart) < 0 ? "thisWeek" : "nextWeek";
}

function etTimestampLabel(value: string | null): string {
  if (!value) {
    return "an earlier check";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "an earlier check";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(date);
}

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": "Mozilla/5.0 Rubicon Morning Brief/1.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!text && url.startsWith("https://")) {
      return await fetchTextWithHttps(url, timeoutMs);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return { status: response.status, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithHttps(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "User-Agent": "Mozilla/5.0 Rubicon Morning Brief/1.0",
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status}`));
            return;
          }
          resolve({ status, text });
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("Request timed out"));
    });
    request.on("error", reject);
  });
}

export function parseRollcallCalendar(html: string, date: string): MorningCalendarEvent[] {
  return parseRollcallCalendarWithMeta(html, date).events;
}

type RollcallCalendarParse = {
  events: MorningCalendarEvent[];
  ignoredCount: number;
  rawCount: number;
};

function parseRollcallCalendarWithMeta(html: string, date: string, sourceUrl = ROLLCALL_URL): RollcallCalendarParse {
  const targetDate = formatLongDate(date);
  const headerIndex = html.indexOf(targetDate);
  if (headerIndex < 0) {
    return { events: [], ignoredCount: 0, rawCount: 0 };
  }

  const daySectionStart = Math.max(0, html.lastIndexOf("<!-- Day Header -->", headerIndex));
  const afterTarget = html.slice(headerIndex + targetDate.length);
  const nextHeaderOffset = afterTarget.indexOf("<!-- Day Header -->");
  const daySection = html.slice(daySectionStart, nextHeaderOffset >= 0 ? headerIndex + targetDate.length + nextHeaderOffset : html.length);
  const blocks = daySection.split("<!-- Event Row -->").slice(1);

  const rawEvents = blocks
    .map((block, index): MorningCalendarEvent | null => {
      const timeLabel = cleanText(block.match(/<div class="text-sm font-light">([\s\S]*?)<\/div>/i)?.[1] ?? "") || "Time TBD";
      const type = decodeHtml(block.match(/data-tooltip="([^"]+)"/i)?.[1] ?? "Schedule");
      const detail = cleanText(block.match(/<div class="text-sm font-light text-gray-600 mt-2">\s*([\s\S]*?)\s*<\/div>/i)?.[1] ?? "");
      if (!detail) {
        return null;
      }
      const locationMatch = block.match(/fa-location-dot[\s\S]*?<span class="text-sm font-normal text-\[#333333\]">([\s\S]*?)<\/span>/i);
      const coverageMatch = block.match(/fa-user[\s\S]*?<span class="text-sm font-normal text-\[#333333\]">([\s\S]*?)<\/span>/i);
      const location = cleanText(locationMatch?.[1] ?? "");
      const coverage = cleanText(coverageMatch?.[1] ?? "");
      return {
        id: `rollcall-${date}-${index}-${slug(`${timeLabel}-${detail}`)}`,
        source: "RollCall",
        date,
        timeLabel,
        sortMinute: parseTimeMinute(timeLabel),
        title: detail,
        impact: "political",
        location: location || undefined,
        coverage: coverage || type,
        detail: type,
        url: sourceUrl,
      };
    })
    .filter(Boolean) as MorningCalendarEvent[];
  const events = rawEvents.filter((event) => isActionablePresidentialEvent(event));
  return {
    events,
    ignoredCount: rawEvents.length - events.length,
    rawCount: rawEvents.length,
  };
}

function isActionablePresidentialEvent(event: MorningCalendarEvent): boolean {
  const type = (event.detail ?? event.coverage ?? "").toLowerCase();
  const title = event.title.toLowerCase();
  if (type !== "official schedule") {
    return false;
  }
  if (title.includes("executive time")) {
    return false;
  }
  if (title.includes("pool call") || title.includes("press office") || /\b(lunch|dinner|full) lid\b/.test(title)) {
    return false;
  }
  return true;
}

export function parseFirstSquawkRss(xml: string): MorningLiveUpdate[] {
  return parseTwitterAccountRss(xml, "FirstSquawk", "FirstSquawk", FIRSTSQUAWK_RSS_URL);
}

export function parseFirstSquawkTimeline(html: string): MorningLiveUpdate[] {
  return parseNitterTimeline(html, "FirstSquawk", "FirstSquawk", FIRSTSQUAWK_TIMELINE_URL);
}

export function parseNitterTimeline(
  html: string,
  trackedAccount: string,
  source: MorningLiveUpdate["source"],
  feedUrl?: string,
): MorningLiveUpdate[] {
  const items: MorningLiveUpdate[] = [];
  const blocks = html.split(/<div class="timeline-item\s*/i).slice(1);
  for (const block of blocks) {
    const dataUsername = cleanText(block.match(/data-username="([^"]+)"/i)?.[1] ?? "");
    const link = cleanText(block.match(/<a class="tweet-link" href="([^"]+)"/i)?.[1] ?? "");
    const contentHtml = block.match(/<div class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const text = cleanText(contentHtml);
    if (!text) {
      continue;
    }
    const dateTitle = cleanText(block.match(/<span class="tweet-date">[\s\S]*?<a[^>]*title="([^"]+)"/i)?.[1] ?? "");
    const publishedAt = parseNitterDateTitle(dateTitle);
    const usernameTitle = cleanText(block.match(/<a class="username"[^>]*title="([^"]+)"/i)?.[1] ?? "");
    const author = usernameTitle || (dataUsername ? `@${dataUsername}` : undefined);
    const retweetHeader = cleanText(block.match(/<div class="retweet-header[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const replyTo = cleanText(block.match(/<div class="replying-to">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "");
    const kind: MorningLiveUpdate["kind"] =
      retweetHeader || (dataUsername && dataUsername.toLowerCase() !== trackedAccount.toLowerCase())
        ? "repost"
        : replyTo
          ? "reply"
          : "post";
    const absoluteUrl = absoluteNitterUrl(link, feedUrl);
    items.push({
      author,
      feedUrl,
      id: `${source.toLowerCase()}-${absoluteUrl || slug(`${publishedAt ?? ""}-${text}`)}`,
      kind,
      originalAuthor: kind === "repost" ? author : undefined,
      replyTo: kind === "reply" ? replyTo || undefined : undefined,
      repostedBy: kind === "repost" ? `@${trackedAccount}` : undefined,
      source,
      timeLabel: publishedAt
        ? new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          }).format(new Date(publishedAt))
        : "Time TBD",
      publishedAt,
      text,
      trackedAccount,
      url: absoluteUrl || undefined,
    });
  }
  return items.slice(0, 16);
}

export function parseTwitterAccountRss(
  xml: string,
  trackedAccount: string,
  source: MorningLiveUpdate["source"],
  feedUrl?: string,
): MorningLiveUpdate[] {
  const items: MorningLiveUpdate[] = [];
  const itemMatches = xml.matchAll(/<item\b[\s\S]*?<\/item>/gi);
  for (const itemMatch of itemMatches) {
    const item = itemMatch[0];
    const title = cleanText(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const creator = cleanText(item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/i)?.[1] ?? "");
    const pubDate = cleanText(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    const link = cleanText(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "");
    const guid = cleanText(item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ?? link);
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : null;
    const titleMeta = parseLiveUpdateTitle(title);
    items.push({
      author: creator || undefined,
      feedUrl,
      id: `${source.toLowerCase()}-${guid || slug(title)}`,
      kind: titleMeta.kind,
      originalAuthor: titleMeta.kind === "repost" ? creator || undefined : undefined,
      replyTo: titleMeta.replyTo,
      repostedBy: titleMeta.repostedBy,
      source,
      timeLabel: publishedAt
        ? new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          }).format(new Date(publishedAt))
        : "Time TBD",
      publishedAt,
      text: titleMeta.text,
      trackedAccount,
      url: link || undefined,
    });
  }
  return items.slice(0, 16);
}

function parseNitterDateTitle(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value.replace(/\s*\u00b7\s*/g, " "));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function absoluteNitterUrl(value: string, feedUrl = FIRSTSQUAWK_TIMELINE_URL): string {
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  let origin = "https://nitter.net";
  try {
    origin = new URL(feedUrl).origin;
  } catch {
    origin = "https://nitter.net";
  }
  return `${origin}${value.startsWith("/") ? "" : "/"}${value}`;
}

function parseLiveUpdateTitle(title: string): {
  kind: MorningLiveUpdate["kind"];
  replyTo?: string;
  repostedBy?: string;
  text: string;
} {
  const repost = title.match(/^RT by @([A-Za-z0-9_]+):\s*(.+)$/i);
  if (repost) {
    return {
      kind: "repost",
      repostedBy: `@${repost[1]}`,
      text: repost[2].trim(),
    };
  }

  const reply = title.match(/^R to @([A-Za-z0-9_]+):\s*(.+)$/i);
  if (reply) {
    return {
      kind: "reply",
      replyTo: `@${reply[1]}`,
      text: reply[2].trim(),
    };
  }

  return { kind: "post", text: title };
}

function uniqueMajorEvents(events: MorningMajorEvent[]): MorningMajorEvent[] {
  const seen = new Set<string>();
  const result: MorningMajorEvent[] = [];
  for (const event of events) {
    const key = `${event.source}|${event.date}|${event.timeLabel}|${event.title}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(event);
  }
  return result;
}

function sortCalendarEvents(events: MorningCalendarEvent[]): MorningCalendarEvent[] {
  return [...events].sort((a, b) => {
    const aMinute = a.sortMinute ?? 9_999;
    const bMinute = b.sortMinute ?? 9_999;
    if (aMinute !== bMinute) return aMinute - bMinute;
    return a.title.localeCompare(b.title);
  });
}

function sortMajorEvents(events: MorningMajorEvent[]): MorningMajorEvent[] {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const aMinute = a.sortMinute ?? 9_999;
    const bMinute = b.sortMinute ?? 9_999;
    if (aMinute !== bMinute) return aMinute - bMinute;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.title.localeCompare(b.title);
  });
}

function clusterMajorMacroEvents(events: MorningMajorEvent[]): MorningMajorEvent[] {
  const grouped = new Map<string, MorningMajorEvent[]>();
  for (const event of events) {
    const family = majorEventFamily(event.title, event.detail);
    const key = `${event.date}|${event.timeLabel}|${family.key}`;
    const current = grouped.get(key) ?? [];
    current.push({ ...event, kind: family.kind });
    grouped.set(key, current);
  }

  return [...grouped.values()].map((group) => {
    const first = group[0];
    const detailRows = group.map((event) => `${event.title}${event.coverage ? `: ${event.coverage}` : ""}`);
    const title = group.length === 1 ? first.title : compactMajorEventComponents(group.map((event) => event.title)) || first.title;
    return {
      ...first,
      coverage:
        group.length === 1
          ? first.coverage
          : `${group.length} rows - ${compactMajorEventComponents(group.map((event) => event.detail || event.title))}`,
      detail: detailRows.join(" | "),
      impact: group.some((event) => event.impact === "high") ? "high" : first.impact,
      id: `major-macro-cluster-${first.date}-${slug(`${first.timeLabel}-${title}`)}`,
      title,
    };
  });
}

function majorEventFamily(title: string, detail?: string): {
  key: string;
  kind: MorningMajorEvent["kind"];
  title: string;
} {
  const value = `${title} ${detail ?? ""}`;
  if (/\b(ppi|producer price)\b/i.test(value)) {
    return { key: "ppi", kind: "inflation", title: "PPI" };
  }
  if (/\binflation expectations\b/i.test(value)) {
    return { key: "inflation-expectations", kind: "inflation", title: "Inflation expectations" };
  }
  if (/\b(core\s+)?(cpi|consumer price|inflation rate|core inflation)\b/i.test(value)) {
    return { key: "cpi", kind: "inflation", title: "CPI / inflation" };
  }
  if (/\bpce\b/i.test(value)) {
    return { key: "pce", kind: "inflation", title: "PCE inflation" };
  }
  if (/\b(fomc|federal open market|interest rate decision|fed rate decision|powell)\b/i.test(value)) {
    return { key: "fomc", kind: "fomc", title: "FOMC / Fed" };
  }
  if (/\b(non[-\s]?farm payrolls?|payrolls?|unemployment|u-6|hourly earnings)\b/i.test(value)) {
    return { key: "nfp", kind: "jobs", title: "Jobs report / NFP" };
  }
  if (/\bjolts\b/i.test(value)) {
    return { key: "jolts", kind: "jobs", title: "JOLTs" };
  }
  if (/\badp\b/i.test(value)) {
    return { key: "adp", kind: "jobs", title: "ADP employment" };
  }
  if (/\bjobless|continuing claims\b/i.test(value)) {
    return { key: "jobless", kind: "jobs", title: "Jobless claims" };
  }
  if (/\bism manufacturing\b/i.test(value)) {
    return { key: "ism-manufacturing", kind: "macro", title: "ISM Manufacturing" };
  }
  if (/\bism services|non manufacturing\b/i.test(value)) {
    return { key: "ism-services", kind: "macro", title: "ISM Services" };
  }
  if (/\bgdp\b/i.test(value)) {
    return { key: "gdp", kind: "macro", title: "GDP" };
  }
  if (/\bretail sales\b/i.test(value)) {
    return { key: "retail-sales", kind: "macro", title: "Retail sales" };
  }
  if (/\bdurable goods\b/i.test(value)) {
    return { key: "durable-goods", kind: "macro", title: "Durable goods" };
  }
  if (/\bmichigan\b/i.test(value)) {
    return { key: "michigan", kind: "macro", title: "Michigan sentiment" };
  }
  return { key: slug(title), kind: majorEventKind(value), title };
}

function compactMajorEventComponents(values: string[]): string {
  const seen = new Set<string>();
  const parts = values
    .map((value) =>
      value
        .replace(/\b(?:Actual|Forecast|Previous)\b.*$/i, "")
        .replace(/\bISM\s+(?:Manufacturing|Services)\s+/i, "")
        .replace(/\bInflation Rate\b/i, "Inflation")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((value) => {
      if (!value || seen.has(value.toLowerCase())) {
        return false;
      }
      seen.add(value.toLowerCase());
      return true;
    });
  return parts.slice(0, 5).join(", ") + (parts.length > 5 ? ` +${parts.length - 5}` : "");
}

function majorEventKind(value: string): MorningMajorEvent["kind"] {
  if (/\b(cpi|consumer price|inflation|ppi|producer price|pce)\b/i.test(value)) {
    return "inflation";
  }
  if (/\b(fomc|federal open market|interest rate decision|fed rate decision|powell)\b/i.test(value)) {
    return "fomc";
  }
  if (/\b(non[-\s]?farm|payroll|unemployment|jobless|jolts|adp)\b/i.test(value)) {
    return "jobs";
  }
  return "macro";
}

function monthlyOpexEvents(selectedDate: string): MorningMajorEvent[] {
  const window = majorEventWindow(selectedDate);
  const startMonth = Number.parseInt(window.start.slice(5, 7), 10);
  const startYear = Number.parseInt(window.start.slice(0, 4), 10);
  const events: MorningMajorEvent[] = [];
  for (let offset = 0; offset <= 1; offset += 1) {
    const monthIndex = startMonth - 1 + offset;
    const year = startYear + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const date = thirdFriday(year, month);
    if (compareIsoDate(date, window.start) < 0 || compareIsoDate(date, window.endExclusive) >= 0) {
      continue;
    }
    events.push({
      coverage: "Standard monthly options expiration, generated natively as the third Friday.",
      date,
      detail: "Third-Friday monthly OPEX",
      id: `major-opex-${date}`,
      impact: "market",
      kind: "opex",
      source: "OPEX",
      sortMinute: null,
      timeLabel: "All day",
      title: "Monthly OPEX",
      window: windowForDate(date, window.nextWeekStart),
    });
  }
  return events;
}

function thirdFriday(year: number, zeroBasedMonth: number): string {
  const first = new Date(Date.UTC(year, zeroBasedMonth, 1, 12));
  const firstDay = first.getUTCDay();
  const firstFridayDate = 1 + ((5 - firstDay + 7) % 7);
  const thirdFridayDate = firstFridayDate + 14;
  return new Date(Date.UTC(year, zeroBasedMonth, thirdFridayDate, 12)).toISOString().slice(0, 10);
}

async function readUsMacroBundle(date: string): Promise<{
  dailyItems: MorningCalendarEvent[];
  majorItems: MorningMajorEvent[];
  sources: MorningBriefSource[];
}> {
  const window = majorEventWindow(date);
  if (process.env.RUBICON_US_MACRO_CALENDAR_DISABLED === "1") {
    const major = buildMajorEventsSource(date, []);
    return {
      dailyItems: [],
      majorItems: major.items,
      sources: [
        sourceStatus("US macro calendar", "warning", "US macro calendar is disabled by RUBICON_US_MACRO_CALENDAR_DISABLED."),
        major.source,
      ],
    };
  }

  const calendar = await readUsMacroCalendar(fetchText, window.start, window.endExclusive);
  const dailyItems = calendar.items.filter((event) => event.date === date);
  const major = buildMajorEventsSource(date, calendar.items);
  const todayDetail = dailyItems.length
    ? ` Selected date ${date} has ${dailyItems.length} rated event${dailyItems.length === 1 ? "" : "s"}.`
    : ` Selected date ${date} has no rated SPX macro events.`;
  return {
    dailyItems,
    majorItems: major.items,
    sources: [
      {
        ...calendar.source,
        detail: `${calendar.source.detail}${todayDetail}`,
      },
      major.source,
    ],
  };
}

function buildMajorEventsSource(date: string, macroEvents: MorningCalendarEvent[]): { items: MorningMajorEvent[]; source: MorningBriefSource } {
  const window = majorEventWindow(date);
  const macroMajorEvents = macroEvents
    .filter((event) => isUsMacroMajorEvent(event))
    .filter((event) => compareIsoDate(event.date, window.start) >= 0 && compareIsoDate(event.date, window.endExclusive) < 0)
    .map((event): MorningMajorEvent => ({
      coverage: event.coverage,
      date: event.date,
      detail: event.detail,
      id: `major-macro-${event.source.toLowerCase()}-${event.date}-${slug(`${event.timeLabel}-${event.title}`)}`,
      impact: "high",
      kind: usMacroEventKind(event),
      source: event.source,
      sortMinute: event.sortMinute,
      timeLabel: event.timeLabel,
      title: event.title,
      url: event.url,
      window: windowForDate(event.date, window.nextWeekStart),
    }));
  const items = sortMajorEvents(uniqueMajorEvents([...clusterMajorMacroEvents(macroMajorEvents), ...monthlyOpexEvents(date)]));
  const opexCount = items.filter((event) => event.kind === "opex").length;
  const macroCount = items.length - opexCount;
  return {
    items,
    source: sourceStatus(
      "Major events outlook",
      items.length ? "ok" : "warning",
      items.length
        ? `Pulled ${macroCount} high-importance official macro marker${macroCount === 1 ? "" : "s"} and ${opexCount} native OPEX marker${opexCount === 1 ? "" : "s"} for this week and next week.`
        : "No high-importance official macro rows or monthly OPEX markers found for this week and next week.",
    ),
  };
}

async function readFirstSquawkSource(): Promise<{ items: MorningLiveUpdate[]; source: MorningBriefSource }> {
  const timelineUrls = configuredUrlList("RUBICON_FIRSTSQUAWK_TIMELINE_URL", FIRSTSQUAWK_TIMELINE_URLS);
  const rssUrls = configuredUrlList("RUBICON_FIRSTSQUAWK_RSS_URL", FIRSTSQUAWK_RSS_URLS);
  const timelineErrors: string[] = [];
  for (const timelineUrl of timelineUrls) {
    try {
      const result = await fetchText(timelineUrl, LIVE_FEED_FETCH_TIMEOUT_MS);
      const items = usableFirstSquawkUpdates(parseNitterTimeline(result.text, "FirstSquawk", "FirstSquawk", timelineUrl));
      if (items.length) {
        return firstSquawkSourceResult(items, timelineUrl, "FirstSquawk timeline");
      }
      timelineErrors.push(`${timelineUrl}: timeline returned no parseable items.`);
    } catch (error) {
      timelineErrors.push(`${timelineUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const rssErrors: string[] = [];
  for (const rssUrl of rssUrls) {
    try {
      const result = await fetchText(rssUrl, LIVE_FEED_FETCH_TIMEOUT_MS);
      const items = usableFirstSquawkUpdates(parseTwitterAccountRss(result.text, "FirstSquawk", "FirstSquawk", rssUrl));
      if (items.length) {
        return firstSquawkSourceResult(items, rssUrl, "Nitter RSS");
      }
      rssErrors.push(`${rssUrl}: RSS returned no parseable items.`);
    } catch (error) {
      rssErrors.push(`${rssUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const timelineHint = timelineErrors.length ? `Timeline check: ${timelineErrors.join(" ")} ` : "";
  const rssDetail = rssErrors.length ? rssErrors.join(" ") : "No RSS URLs configured.";
  return {
    items: [],
    source: sourceStatus(
      "FirstSquawk live feed",
      "warning",
      `${timelineHint}RSS fetch failed: ${rssDetail}`,
      rssUrls[0] ?? timelineUrls[0],
    ),
  };
}

function configuredUrlList(envName: string, fallbackUrls: string[]): string[] {
  const configured = process.env[envName]
    ?.split(/[,\s]+/)
    .map((url) => url.trim())
    .filter(Boolean);
  const urls = configured?.length ? configured : fallbackUrls;
  return [...new Set(urls)];
}

function usableFirstSquawkUpdates(items: MorningLiveUpdate[]): MorningLiveUpdate[] {
  return items.filter((item) => !isUnavailableLiveUpdateText(item.text));
}

function isUnavailableLiveUpdateText(text: string): boolean {
  return /rss reader not yet whitelisted|verifying your browser|making sure you'?re not a bot|just a moment/i.test(text);
}

export async function readCachedLiveUpdatesForBrief(): Promise<{
  items: MorningLiveUpdate[];
  sources: MorningBriefSource[];
}> {
  await hydrateLastGoodLiveUpdateCache();
  if (!lastGoodLiveUpdates.length) {
    return {
      items: [],
      sources: [
        sourceStatus(
          "Live update cache",
          "warning",
          "No cached live tape is available yet; Live Updates refresh separately every 10 seconds.",
        ),
      ],
    };
  }

  const cachedAtMs = lastGoodLiveUpdatesAt ? new Date(lastGoodLiveUpdatesAt).getTime() : Number.NaN;
  const ageMinutes = Number.isFinite(cachedAtMs)
    ? Math.max(0, Math.round((Date.now() - cachedAtMs) / 60_000))
    : null;
  const status: MorningBriefSource["status"] =
    ageMinutes !== null && ageMinutes > LIVE_FEED_STALE_MINUTES ? "warning" : "ok";
  const ageText = ageMinutes === null ? "cached earlier" : `cached ${ageMinutes}m ago`;
  return {
    items: lastGoodLiveUpdates,
    sources: [
      sourceStatus(
        "Live update cache",
        status,
        `Loaded ${lastGoodLiveUpdates.length} last-good live update${lastGoodLiveUpdates.length === 1 ? "" : "s"} for the selected date (${ageText}); Live Updates refresh separately every 10 seconds.`,
      ),
    ],
  };
}

function firstSquawkSourceResult(
  items: MorningLiveUpdate[],
  url: string,
  mode: "FirstSquawk timeline" | "Nitter RSS",
): { items: MorningLiveUpdate[]; source: MorningBriefSource } {
  const latest = latestLiveUpdateDate(items);
  const ageMinutes = latest ? Math.max(0, Math.round((Date.now() - latest.getTime()) / 60_000)) : null;
  const repostCount = items.filter((item) => item.kind === "repost").length;
  const status = items.length && ageMinutes !== null && ageMinutes > LIVE_FEED_STALE_MINUTES ? "warning" : items.length ? "ok" : "warning";
  const freshness = ageMinutes === null ? "no timestamped items" : `latest item ${ageMinutes}m old`;
  const repostDetail = repostCount ? `; ${repostCount} repost${repostCount === 1 ? "" : "s"} included` : "";
  const sourceNote =
    mode === "FirstSquawk timeline"
      ? "Rubicon polls this timeline every 10s while Morning is open; configure X API filtered stream for true push delivery."
      : "Rubicon polls every 10s, but the upstream Nitter RSS advertises a 40-minute TTL.";
  return {
    items,
    source: sourceStatus(
      "FirstSquawk live feed",
      status,
      items.length
        ? `Pulled ${items.length} items from ${mode}; ${freshness}${repostDetail}. ${sourceNote}`
        : `${mode} returned no parseable items.`,
      url,
    ),
  };
}

function latestLiveUpdateDate(items: MorningLiveUpdate[]): Date | null {
  const dates = items
    .map((item) => (item.publishedAt ? new Date(item.publishedAt) : null))
    .filter((date): date is Date => date !== null && !Number.isNaN(date.getTime()));
  dates.sort((a, b) => b.getTime() - a.getTime());
  return dates[0] ?? null;
}

function rollcallCalendarUrlForDate(date: string): string {
  const [year, month] = date.split("-").map((part) => Number.parseInt(part, 10));
  const slugMonth = MONTH_SLUGS[month - 1];
  if (!year || !slugMonth) {
    return ROLLCALL_URL;
  }
  return `${ROLLCALL_URL}${slugMonth}-${year}/`;
}

async function readRollcallSource(date: string): Promise<{ items: MorningCalendarEvent[]; source: MorningBriefSource }> {
  const label = "RollCall Factba.se calendar";
  const url = rollcallCalendarUrlForDate(date);
  try {
    const result = await fetchText(url);
    const parsed = parseRollcallCalendarWithMeta(result.text, date, url);
    const foundDay = parsed.rawCount > 0;
    const detail = parsed.events.length
      ? `Pulled ${parsed.events.length} actionable presidential events; ignored ${parsed.ignoredCount} pool/routine rows.`
      : foundDay
        ? `Source loaded; no actionable presidential events after ignoring ${parsed.ignoredCount} pool/routine rows.`
        : `No RollCall events were found for ${formatLongDate(date)}.`;
    return {
      items: parsed.events,
      source: sourceStatus(label, foundDay || parsed.events.length ? "ok" : "warning", detail, url),
    };
  } catch (error) {
    return {
      items: [],
      source: sourceStatus(label, "warning", error instanceof Error ? error.message : String(error), url),
    };
  }
}

function aiStuffRoot(appRoot: string): string {
  return path.resolve(appRoot, "..");
}

async function latestTc2000Dir(appRoot: string): Promise<string | null> {
  const analysisRoot = path.join(aiStuffRoot(appRoot), "analysis");
  try {
    const entries = await fs.readdir(analysisRoot, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && /^tc2000_uis_scanner_\d+$/.test(entry.name))
        .map(async (entry) => {
          const fullPath = path.join(analysisRoot, entry.name);
          const stat = await fs.stat(fullPath);
          return { fullPath, mtimeMs: stat.mtimeMs };
        }),
    );
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

function artifactKind(name: string): MorningTc2000ArtifactKind {
  const lower = name.toLowerCase();
  if (lower.includes("panel_snapshot") && lower.endsWith(".png")) return "snapshot";
  if (lower.endsWith(".ocr.json")) return "ocr";
  if (lower.includes("crop") && lower.endsWith(".png")) return "crop";
  if (lower.endsWith(".csv")) return "csv";
  return "other";
}

async function tc2000InfoFromOcr(filePath: string, artifactName: string): Promise<{ screenerName?: string; symbols: string[] }> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as { items?: unknown; symbols?: unknown };
    const symbols = Array.isArray(parsed.symbols)
      ? uniqueSymbols(parsed.symbols.filter((symbol): symbol is string => typeof symbol === "string" && symbol.length > 0))
      : [];
    return { screenerName: screenerNameFromOcr(parsed.items, artifactName), symbols };
  } catch {
    return { screenerName: screenerNameFromArtifactName(artifactName), symbols: [] };
  }
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function uniqueSymbols(symbols: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of symbols) {
    const symbol = normalizeSymbol(raw);
    if (!symbol || seen.has(symbol)) {
      continue;
    }
    seen.add(symbol);
    result.push(symbol);
  }
  return result;
}

function screenerKey(name: string): string {
  const compact = cleanScreenerName(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (compact.startsWith("three bar rule spike")) {
    return "three-bar-rule-spike";
  }
  if (compact.includes("staircase") || compact.includes("stair step") || compact.includes("stairstep")) {
    return "staircase";
  }
  return compact || "latest";
}

function preferScreenerName(current: string, next: string): string {
  if (!current || current.includes("...")) {
    return next;
  }
  if (next && !next.includes("...") && next.length > current.length) {
    return next;
  }
  return current;
}

async function loadTc2000ExportScreeners(appRoot: string): Promise<MorningTc2000Screener[]> {
  const exportRoot = path.join(aiStuffRoot(appRoot), "IBKR Equity History Pull", "data", "tc2000_exports");
  const grouped = new Map<string, MorningTc2000Screener>();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(exportRoot);
  } catch {
    return [];
  }

  for (const entry of entries.filter((name) => name.toLowerCase().endsWith(".csv"))) {
    const fullPath = path.join(exportRoot, entry);
    let records: Record<string, string>[] = [];
    let stat;
    try {
      stat = await fs.stat(fullPath);
      const text = await fs.readFile(fullPath, "utf8");
      records = parseCsv(text, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
    } catch {
      continue;
    }

    for (const record of records) {
      const symbol = normalizeSymbol(String(record.symbol ?? record.ticker ?? ""));
      if (!symbol) {
        continue;
      }
      const name = cleanScreenerName(String(record.screen ?? record.scan ?? record.easyscan ?? "")) || screenerNameFromArtifactName(entry);
      const key = screenerKey(name);
      const existing = grouped.get(key);
      if (existing) {
        existing.name = preferScreenerName(existing.name, name);
        existing.symbols = uniqueSymbols([...existing.symbols, symbol]);
        if (!existing.updatedAt || Date.parse(stat.mtime.toISOString()) > Date.parse(existing.updatedAt)) {
          existing.updatedAt = stat.mtime.toISOString();
          existing.sourcePath = fullPath;
        }
      } else {
        grouped.set(key, {
          name,
          symbols: [symbol],
          source: "csv",
          sourcePath: fullPath,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    }
  }

  return [...grouped.values()].sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  });
}

async function loadTc2000DailyBars(appRoot: string): Promise<{
  bars: Record<string, MorningDailyBar[]>;
  generatedAt: string | null;
  profiles: Record<string, MorningCompanyProfile>;
  source: string | null;
  note?: string;
}> {
  const filePath = path.join(appRoot, "data", "tc2000-daily-bars.json");
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      barsBySymbol?: unknown;
      dailyBars?: unknown;
      generatedAt?: unknown;
      note?: unknown;
      profiles?: unknown;
      profilesBySymbol?: unknown;
      source?: unknown;
    };
    const rawBars = parsed.barsBySymbol ?? parsed.dailyBars;
    const bars: Record<string, MorningDailyBar[]> = {};
    if (rawBars && typeof rawBars === "object" && !Array.isArray(rawBars)) {
      for (const [rawSymbol, rawRows] of Object.entries(rawBars)) {
        if (!Array.isArray(rawRows)) {
          continue;
        }
        const rows = rawRows
          .map((row) => sanitizeDailyBar(row))
          .filter((row): row is MorningDailyBar => row !== null)
          .sort((a, b) => a.date.localeCompare(b.date));
        if (rows.length) {
          bars[normalizeSymbol(rawSymbol)] = rows;
        }
      }
    }
    const rawProfiles = parsed.profilesBySymbol ?? parsed.profiles;
    const profiles: Record<string, MorningCompanyProfile> = {};
    if (rawProfiles && typeof rawProfiles === "object" && !Array.isArray(rawProfiles)) {
      for (const [rawSymbol, rawProfile] of Object.entries(rawProfiles)) {
        const profile = sanitizeCompanyProfile(rawProfile);
        if (profile) {
          profiles[normalizeSymbol(rawSymbol)] = profile;
        }
      }
    }
    return {
      bars,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
      profiles,
      source: typeof parsed.source === "string" ? parsed.source : filePath,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
  } catch {
    return {
      bars: {},
      generatedAt: null,
      profiles: {},
      source: null,
      note: "Chart preview cache pending.",
    };
  }
}

function sanitizeCompanyProfile(value: unknown): MorningCompanyProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const profile: MorningCompanyProfile = {};
  for (const key of ["description", "industry", "name", "source", "updatedAt"] as const) {
    const text = typeof record[key] === "string" ? record[key].trim() : "";
    if (text) {
      profile[key] = text;
    }
  }
  return Object.keys(profile).length ? profile : null;
}

function sanitizeDailyBar(value: unknown): MorningDailyBar | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const date = typeof record.date === "string" ? record.date : "";
  const open = finiteNumber(record.open);
  const high = finiteNumber(record.high);
  const low = finiteNumber(record.low);
  const close = finiteNumber(record.close);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || open === null || high === null || low === null || close === null) {
    return null;
  }
  return {
    close,
    date,
    high,
    low,
    open,
    volume: finiteNumber(record.volume),
  };
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : null;
}

function mergeScreeners(screeners: MorningTc2000Screener[]): MorningTc2000Screener[] {
  const grouped = new Map<string, MorningTc2000Screener>();
  for (const screener of screeners) {
    const key = screenerKey(screener.name);
    const existing = grouped.get(key);
    if (existing) {
      existing.name = preferScreenerName(existing.name, screener.name);
      existing.symbols = uniqueSymbols([...existing.symbols, ...screener.symbols]);
      existing.note = existing.note ?? screener.note;
      if (existing.source !== "csv" && screener.source === "csv") {
        existing.source = screener.source;
        existing.sourcePath = screener.sourcePath;
      }
      if (!existing.updatedAt || (screener.updatedAt && Date.parse(screener.updatedAt) > Date.parse(existing.updatedAt))) {
        existing.updatedAt = screener.updatedAt;
      }
    } else {
      grouped.set(key, { ...screener, symbols: uniqueSymbols(screener.symbols) });
    }
  }
  return [...grouped.values()].sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  });
}

function screenerNameFromOcr(items: unknown, artifactName: string): string {
  if (Array.isArray(items)) {
    const candidates = items
      .map((item) => {
        const record = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
        return {
          text: cleanScreenerName(String(record.text ?? "")),
          y1: Number(record.y1),
        };
      })
      .filter((item) => item.text.length >= 8)
      .filter((item) => Number.isFinite(item.y1) && item.y1 >= 45 && item.y1 <= 78)
      .filter((item) => !/filter|edit|change symbol|stocks/i.test(item.text))
      .sort((a, b) => b.text.length - a.text.length);
    if (candidates[0]?.text) {
      return candidates[0].text;
    }
  }
  return screenerNameFromArtifactName(artifactName);
}

function screenerNameFromArtifactName(name: string): string {
  const raw = name
    .replace(/^tc2000_/i, "")
    .replace(/_crop_\d{8}_\d{6}(?:\.ocr\.json|\.png)?$/i, "")
    .replace(/\.(?:ocr\.json|png|csv)$/i, "")
    .replace(/_/g, " ");
  return cleanScreenerName(raw) || "Latest TC2000 screener";
}

function cleanScreenerName(value: string): string {
  return value
    .replace(/[_.]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*["']\s*$/g, "")
    .trim()
    .slice(0, 120);
}

export async function loadTc2000Pulls(appRoot = defaultAppRoot): Promise<MorningTc2000Pulls> {
  const sourceDir = await latestTc2000Dir(appRoot);
  const [csvScreeners, dailyBarsSnapshot] = await Promise.all([
    loadTc2000ExportScreeners(appRoot),
    loadTc2000DailyBars(appRoot),
  ]);
  if (!sourceDir) {
    const symbols = uniqueSymbols(csvScreeners.flatMap((screener) => screener.symbols));
    return {
      available: csvScreeners.length > 0,
      sourceDir: null,
      symbols,
      screeners: csvScreeners,
      dailyBars: dailyBarsSnapshot.bars,
      dailyBarsGeneratedAt: dailyBarsSnapshot.generatedAt,
      dailyBarsSource: dailyBarsSnapshot.source,
      dailyBarsNote: dailyBarsSnapshot.note,
      profiles: dailyBarsSnapshot.profiles,
      artifacts: [],
      note: csvScreeners.length
        ? `Loaded ${csvScreeners.length} TC2000 scanner export${csvScreeners.length === 1 ? "" : "s"}; no analysis snapshot directory was found.`
        : "No TC2000 pull directory was found under AI STUFF/analysis.",
    };
  }

  const dirName = path.basename(sourceDir);
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  const artifacts = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry): Promise<MorningTc2000Artifact> => {
        const fullPath = path.join(sourceDir, entry.name);
        const stat = await fs.stat(fullPath);
        return {
          name: entry.name,
          kind: artifactKind(entry.name),
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
          url: `/api/tc2000-artifact/${encodeURIComponent(dirName)}/${encodeURIComponent(entry.name)}`,
        };
      }),
  );
  artifacts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const latestSnapshot = artifacts.find((artifact) => artifact.kind === "snapshot");
  const latestOcr = artifacts.find((artifact) => artifact.kind === "ocr");
  const tc2000Info = latestOcr
    ? await tc2000InfoFromOcr(path.join(sourceDir, latestOcr.name), latestOcr.name)
    : { screenerName: undefined, symbols: [] };
  const ocrScreeners = await Promise.all(
    artifacts
      .filter((artifact) => artifact.kind === "ocr")
      .slice(0, 8)
      .map(async (artifact): Promise<MorningTc2000Screener | null> => {
        const info = await tc2000InfoFromOcr(path.join(sourceDir, artifact.name), artifact.name);
        if (!info.symbols.length) {
          return null;
        }
        return {
          name: info.screenerName ?? screenerNameFromArtifactName(artifact.name),
          source: "ocr",
          sourcePath: path.join(sourceDir, artifact.name),
          symbols: info.symbols,
          updatedAt: artifact.updatedAt,
        };
      }),
  );
  const parsedOcrScreeners = ocrScreeners.filter(Boolean) as MorningTc2000Screener[];
  const csvKeys = new Set(csvScreeners.map((screener) => screenerKey(screener.name)));
  const latestOcrTime = latestOcr ? Date.parse(latestOcr.updatedAt) : 0;
  const usableOcrScreeners = csvScreeners.length
    ? parsedOcrScreeners.filter((screener) => {
        if (csvKeys.has(screenerKey(screener.name))) {
          return true;
        }
        const updatedAt = screener.updatedAt ? Date.parse(screener.updatedAt) : 0;
        return latestOcrTime > 0 && Math.abs(latestOcrTime - updatedAt) <= 10 * 60_000;
      })
    : parsedOcrScreeners;
  const screeners = mergeScreeners([...csvScreeners, ...usableOcrScreeners]);
  const symbols = uniqueSymbols(screeners.length ? screeners.flatMap((screener) => screener.symbols) : tc2000Info.symbols);
  const enrichedArtifacts = artifacts.map((artifact) =>
    artifact.name === latestOcr?.name ? { ...artifact, symbols } : artifact,
  );
  const dailyBarsNote = dailyBarsSnapshot.note;

  return {
    available: true,
    sourceDir,
    screenerName: tc2000Info.screenerName,
    latestSnapshot,
    latestOcr: latestOcr ? { ...latestOcr, symbols } : undefined,
    symbols,
    screeners,
    dailyBars: dailyBarsSnapshot.bars,
    dailyBarsGeneratedAt: dailyBarsSnapshot.generatedAt,
    dailyBarsSource: dailyBarsSnapshot.source,
    dailyBarsNote,
    profiles: dailyBarsSnapshot.profiles,
    artifacts: enrichedArtifacts.slice(0, 12),
    note: screeners.length
      ? `Loaded TC2000 scanner list${screeners.length === 1 ? "" : "s"}.`
      : symbols.length
        ? "Latest OCR pull found visible symbols."
        : "Latest TC2000 artifacts are present, but no OCR symbol list was found.",
  };
}

export function resolveTc2000Artifact(dirName: string, fileName: string, appRoot = defaultAppRoot): string {
  const safeDir = path.basename(dirName);
  const safeFile = path.basename(fileName);
  if (!/^tc2000_uis_scanner_\d+$/.test(safeDir)) {
    throw new Error("Invalid TC2000 artifact directory.");
  }
  const analysisRoot = path.resolve(aiStuffRoot(appRoot), "analysis");
  const targetDir = path.resolve(analysisRoot, safeDir);
  const target = path.resolve(targetDir, safeFile);
  if (!target.startsWith(`${targetDir}${path.sep}`)) {
    throw new Error("Invalid TC2000 artifact path.");
  }
  return target;
}

export async function loadMorningBrief(date: string, appRoot = defaultAppRoot, options: MorningBriefLoadOptions = {}): Promise<MorningBriefPayload> {
  if (!options.refresh) {
    const state = await readMorningBriefState(date, appRoot);
    if (state) {
      const payload = await withTc2000NewSymbolMarkers(state.payload, appRoot);
      return withMorningBriefStateSource(
        payload,
        sourceStatus(
          "Morning brief state",
          "ok",
          `Loaded saved Morning brief state from ${etTimestampLabel(state.savedAt)}.`,
          morningBriefStatePath(date, appRoot),
        ),
      );
    }
  }

  const payload = await withTc2000NewSymbolMarkers(await buildLiveMorningBrief(date, appRoot), appRoot);
  const stateSource = await saveMorningBriefStateSource(payload, appRoot, options.refresh === true);
  return withMorningBriefStateSource(payload, stateSource);
}

async function buildLiveMorningBrief(date: string, appRoot = defaultAppRoot): Promise<MorningBriefPayload> {
  const [macro, rollcall, liveCache, tc2000] = await Promise.all([
    readUsMacroBundle(date),
    readRollcallSource(date),
    readCachedLiveUpdatesForBrief(),
    loadTc2000Pulls(appRoot),
  ]);

  const economicEvents = sortCalendarEvents(macro.dailyItems);
  const trumpEvents = sortCalendarEvents(rollcall.items);
  const combinedEvents = sortCalendarEvents([...economicEvents, ...trumpEvents]);
  const sources: MorningBriefSource[] = [
    ...macro.sources,
    rollcall.source,
    ...liveCache.sources,
    sourceStatus(
      "TC2000 pulls",
      tc2000.available ? "ok" : "warning",
      tc2000.note,
      tc2000.sourceDir ?? undefined,
    ),
  ];

  return {
    date,
    generatedAt: new Date().toISOString(),
    economicEvents,
    trumpEvents,
    combinedEvents,
    majorEvents: macro.majorItems,
    liveUpdates: liveCache.items,
    tc2000,
    sources,
  };
}

async function withTc2000NewSymbolMarkers(payload: MorningBriefPayload, appRoot: string): Promise<MorningBriefPayload> {
  const previous = await readPreviousMorningBriefStatePayload(payload.date, appRoot);
  return {
    ...payload,
    tc2000: markNewTc2000Symbols(payload.tc2000, previous?.date, previous?.tc2000),
  };
}

async function readPreviousMorningBriefStatePayload(date: string, appRoot: string): Promise<MorningBriefPayload | null> {
  const stateDir = morningBriefStateDir(appRoot);
  try {
    const entries = await fs.readdir(stateDir);
    const dates = entries
      .map((entry) => entry.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
      .filter((entryDate): entryDate is string => !!entryDate && entryDate < date)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 7);
    for (const entryDate of dates) {
      const state = await readMorningBriefState(entryDate, appRoot);
      if (state) {
        return state.payload;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function markNewTc2000Symbols(tc2000: MorningTc2000Pulls, previousDate?: string, previousTc2000?: MorningTc2000Pulls): MorningTc2000Pulls {
  const currentScreeners = Array.isArray(tc2000.screeners) ? tc2000.screeners : [];
  const currentSymbols = Array.isArray(tc2000.symbols) ? tc2000.symbols : [];
  if (!previousDate || !previousTc2000) {
    return {
      ...tc2000,
      newSymbols: [],
      screeners: currentScreeners.map((screener) => ({ ...screener, newSymbols: [] })),
    };
  }

  const previousByKey = new Map<string, Set<string>>();
  for (const screener of tc2000ScreenersForComparison(previousTc2000)) {
    previousByKey.set(screenerKey(screener.name), new Set(screener.symbols.map(normalizeSymbol)));
  }

  const screeners = currentScreeners.map((screener) => {
    const previousSymbols = previousByKey.get(screenerKey(screener.name));
    const newSymbols = previousSymbols
      ? screener.symbols.filter((symbol) => !previousSymbols.has(normalizeSymbol(symbol)))
      : [];
    return { ...screener, newSymbols };
  });
  const fallbackNewSymbols =
    screeners.length === 0 && currentSymbols.length
      ? newSymbolsForScreener(
          {
            name: tc2000.screenerName ?? "Latest TC2000 screener",
            source: "ocr",
            symbols: currentSymbols,
          },
          previousByKey,
        )
      : [];
  const newSymbols = uniqueSymbols([
    ...screeners.flatMap((screener) => screener.newSymbols ?? []),
    ...fallbackNewSymbols,
  ]);

  return {
    ...tc2000,
    newSymbols,
    newSymbolsComparedWithDate: previousDate,
    screeners,
  };
}

function newSymbolsForScreener(screener: MorningTc2000Screener, previousByKey: Map<string, Set<string>>): string[] {
  const previousSymbols = previousByKey.get(screenerKey(screener.name));
  return previousSymbols
    ? screener.symbols.filter((symbol) => !previousSymbols.has(normalizeSymbol(symbol)))
    : [];
}

function tc2000ScreenersForComparison(tc2000: MorningTc2000Pulls): MorningTc2000Screener[] {
  const screeners = Array.isArray(tc2000.screeners) ? tc2000.screeners : [];
  const symbols = Array.isArray(tc2000.symbols) ? tc2000.symbols : [];
  if (screeners.length) {
    return screeners;
  }
  if (!symbols.length) {
    return [];
  }
  return [
    {
      name: tc2000.screenerName ?? "Latest TC2000 screener",
      source: "ocr",
      symbols,
    },
  ];
}

async function readMorningBriefState(date: string, appRoot = defaultAppRoot): Promise<{ payload: MorningBriefPayload; savedAt: string } | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(morningBriefStatePath(date, appRoot), "utf8")) as MorningBriefStatePayload;
    const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : null;
    if (!savedAt || !isMorningBriefPayload(parsed.payload) || parsed.payload.date !== date || hasLegacyDailyFxCalendar(parsed.payload)) {
      return null;
    }
    return { payload: withoutMorningBriefStateSource(parsed.payload), savedAt };
  } catch {
    return null;
  }
}

async function saveMorningBriefStateSource(payload: MorningBriefPayload, appRoot: string, refreshed: boolean): Promise<MorningBriefSource> {
  const savedAt = new Date().toISOString();
  const target = morningBriefStatePath(payload.date, appRoot);
  try {
    await writeJsonAtomic(target, {
      schema: "rubicon.morningBriefState",
      version: 1,
      savedAt,
      payload: withoutMorningBriefStateSource(payload),
    });
    return sourceStatus(
      "Morning brief state",
      "ok",
      refreshed ? `Refreshed live Morning sources and saved state at ${etTimestampLabel(savedAt)}.` : `Built live Morning brief and saved state at ${etTimestampLabel(savedAt)}.`,
      target,
    );
  } catch (error) {
    return sourceStatus(
      "Morning brief state",
      "warning",
      `Built live Morning brief, but could not save state: ${error instanceof Error ? error.message : String(error)}`,
      target,
    );
  }
}

function withMorningBriefStateSource(payload: MorningBriefPayload, source: MorningBriefSource): MorningBriefPayload {
  return {
    ...payload,
    sources: [...payload.sources.filter((item) => item.label !== "Morning brief state"), source],
  };
}

function withoutMorningBriefStateSource(payload: MorningBriefPayload): MorningBriefPayload {
  return {
    ...payload,
    sources: payload.sources.filter((item) => item.label !== "Morning brief state"),
  };
}

function isMorningBriefPayload(value: unknown): value is MorningBriefPayload {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  return (
    !!record &&
    typeof record.date === "string" &&
    typeof record.generatedAt === "string" &&
    Array.isArray(record.economicEvents) &&
    Array.isArray(record.trumpEvents) &&
    Array.isArray(record.combinedEvents) &&
    Array.isArray(record.majorEvents) &&
    Array.isArray(record.liveUpdates) &&
    !!record.tc2000 &&
    typeof record.tc2000 === "object" &&
    !Array.isArray(record.tc2000) &&
    Array.isArray(record.sources)
  );
}

function hasLegacyDailyFxCalendar(payload: MorningBriefPayload): boolean {
  return (
    payload.sources.some((source) => /DailyFX/i.test(source.label)) ||
    payload.economicEvents.some((event) => String(event.source) === "DailyFX") ||
    payload.majorEvents.some((event) => String(event.source) === "DailyFX")
  );
}

export async function loadMorningLiveUpdates(): Promise<MorningLiveUpdatesPayload> {
  const [firstSquawk, godel] = await Promise.all([readFirstSquawkSource(), readGodelLiveNewsSource()]);
  const liveUpdates = await liveUpdatesWithLastGoodFallback(sortLiveUpdates(validLiveUpdates([...firstSquawk.items, ...godel.items])));

  return {
    generatedAt: new Date().toISOString(),
    liveUpdates: liveUpdates.items,
    sources: [firstSquawk.source, godel.source, ...liveUpdates.sources],
  };
}

export function resetMorningLiveUpdateCacheForTests(): void {
  lastGoodLiveUpdates = [];
  lastGoodLiveUpdatesAt = null;
}

async function liveUpdatesWithLastGoodFallback(items: MorningLiveUpdate[]): Promise<{
  items: MorningLiveUpdate[];
  sources: MorningBriefSource[];
}> {
  items = validLiveUpdates(items);
  if (items.length) {
    lastGoodLiveUpdates = items;
    lastGoodLiveUpdatesAt = new Date().toISOString();
    await writeLastGoodLiveUpdateCache(items, lastGoodLiveUpdatesAt);
    return { items, sources: [] };
  }
  await hydrateLastGoodLiveUpdateCache();
  if (!lastGoodLiveUpdates.length) {
    return { items, sources: [] };
  }
  return {
    items: lastGoodLiveUpdates,
    sources: [
      sourceStatus(
        "Live update fallback cache",
        "warning",
        `Current live sources returned no rows; showing ${lastGoodLiveUpdates.length} last-good rows from ${etTimestampLabel(lastGoodLiveUpdatesAt)}.`,
      ),
    ],
  };
}

async function writeLastGoodLiveUpdateCache(items: MorningLiveUpdate[], cachedAt: string): Promise<void> {
  const target = liveUpdateCachePath();
  try {
    await writeJsonAtomic(target, { cachedAt, items });
  } catch {
    // A missing cache should not block the morning brief itself.
  }
}

async function hydrateLastGoodLiveUpdateCache(): Promise<void> {
  if (lastGoodLiveUpdates.length) {
    return;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(liveUpdateCachePath(), "utf8")) as LiveUpdateCachePayload;
    const items = Array.isArray(parsed.items) ? validLiveUpdates(parsed.items.filter(isMorningLiveUpdate)) : [];
    if (!items.length) {
      return;
    }
    lastGoodLiveUpdates = sortLiveUpdates(items);
    lastGoodLiveUpdatesAt = typeof parsed.cachedAt === "string" ? parsed.cachedAt : null;
  } catch {
    // No persisted cache yet.
  }
}

function isMorningLiveUpdate(value: unknown): value is MorningLiveUpdate {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return (
    typeof record.id === "string" &&
    (record.source === "FirstSquawk" || record.source === "Godel") &&
    typeof record.timeLabel === "string" &&
    typeof record.text === "string" &&
    (typeof record.publishedAt === "string" || record.publishedAt === null)
  );
}

function validLiveUpdates(items: MorningLiveUpdate[]): MorningLiveUpdate[] {
  return items.filter((item) => item.source !== "Godel" || isValidGodelLiveUpdate(item));
}

function isValidGodelLiveUpdate(item: MorningLiveUpdate): boolean {
  if (isMostlyNumericGodelText(item.text)) {
    return false;
  }
  return (item.author ?? "").trim().toLowerCase() !== "godel dom bridge";
}

function isMostlyNumericGodelText(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 40) {
    return false;
  }
  const alphaChars = (compact.match(/[A-Za-z]/g) ?? []).length;
  const alphaWords = text.match(/\b[A-Za-z][A-Za-z'/-]{2,}\b/g) ?? [];
  const numericTokens = text.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  const allTokens = text.match(/\b[\w.]+\b/g) ?? [];
  const priceLikeTokens = text.match(/\b\d{4,5}\.\d{2}\b/g) ?? [];
  const alphaRatio = alphaChars / Math.max(compact.length, 1);
  const numericRatio = numericTokens.length / Math.max(allTokens.length, 1);
  return alphaWords.length < 3 || alphaRatio < 0.22 || numericRatio > 0.62 || priceLikeTokens.length >= 5;
}

function sortLiveUpdates(items: MorningLiveUpdate[]): MorningLiveUpdate[] {
  return [...items]
    .sort((a, b) => {
      const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, 24);
}
