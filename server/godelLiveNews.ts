import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { MorningBriefSource, MorningLiveUpdate } from "../shared/types.ts";

const DEFAULT_CAPTURE_PATH = path.resolve(process.cwd(), "data", "godel-live-news.json");
const FETCH_TIMEOUT_MS = 12_000;
const GODEL_SOURCE_LABEL = "Godel live feed";
const GODEL_JSON_QUARANTINE_SUFFIX = ".quarantine";

type JsonRecord = Record<string, unknown>;

export async function readGodelLiveNewsSource(): Promise<{ items: MorningLiveUpdate[]; source: MorningBriefSource }> {
  const url = process.env.RUBICON_GODEL_NEWS_URL?.trim();
  const capturePath = process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH || DEFAULT_CAPTURE_PATH;

  if (url) {
    try {
      const text = await fetchGodelNewsText(url);
      const items = parseGodelLiveNews(text, url);
      return {
        items,
        source: sourceStatus(
          items.length ? "ok" : "warning",
          items.length
            ? `Pulled ${items.length} Godel live news item${items.length === 1 ? "" : "s"} from configured source.`
            : "Configured Godel source loaded, but no parseable live news rows were found.",
          url,
        ),
      };
    } catch (error) {
      return {
        items: await readGodelCaptureFallback(capturePath),
        source: sourceStatus("warning", `Godel source fetch failed: ${error instanceof Error ? error.message : String(error)}. Checked capture fallback at ${capturePath}.`, url),
      };
    }
  }

  const fallbackItems = await readGodelCaptureFallback(capturePath);
  if (fallbackItems.length) {
    return {
      items: fallbackItems,
      source: sourceStatus("ok", `Loaded ${fallbackItems.length} staged Godel item${fallbackItems.length === 1 ? "" : "s"} from ${capturePath}.`, capturePath),
    };
  }

  return {
    items: [],
    source: sourceStatus("stub", "Godel feed unavailable."),
  };
}

export function parseGodelLiveNews(input: string, sourceUrl?: string): MorningLiveUpdate[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseGodelJson(trimmed, sourceUrl);
  }
  if (/<item\b/i.test(trimmed)) {
    return parseGodelRss(trimmed, sourceUrl);
  }
  return parseGodelHtml(trimmed, sourceUrl);
}

async function fetchGodelNewsText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json,text/html,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 Rubicon Godel News Capture/1.0",
    };
    if (process.env.RUBICON_GODEL_NEWS_COOKIE) {
      headers.Cookie = process.env.RUBICON_GODEL_NEWS_COOKIE;
    }
    if (process.env.RUBICON_GODEL_NEWS_BEARER) {
      headers.Authorization = `Bearer ${process.env.RUBICON_GODEL_NEWS_BEARER}`;
    }
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function readGodelCaptureFallback(capturePath: string): Promise<MorningLiveUpdate[]> {
  let raw: string;
  try {
    raw = await fs.readFile(capturePath, "utf8");
  } catch (error) {
    // transient read errors (ENOENT, EBUSY mid-rename) are not corruption
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Godel capture read failure at ${capturePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
  try {
    return parseGodelLiveNews(raw, capturePath);
  } catch (error) {
    const parseErrorText = error instanceof Error ? error.message : String(error);
    console.warn(`Godel capture parse failure at ${capturePath}: ${parseErrorText}`);
    await quarantineCorruptGodelCapture(capturePath, parseErrorText);
    return [];
  }
}

async function quarantineCorruptGodelCapture(capturePath: string, reason: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantinePath = `${capturePath}${GODEL_JSON_QUARANTINE_SUFFIX}-${timestamp}.json`;
  try {
    // MOVE the corrupt file aside (a copy would re-quarantine on every 10s
    // poll forever); the writer's next atomic rename recreates a clean one.
    await fs.rename(capturePath, quarantinePath);
    console.warn(`Godel capture quarantined to ${quarantinePath}: ${reason}`);
  } catch {
    return;
  }
}

function stripGodelJsonBOM(input: string): string {
  return input.replace(/^\uFEFF/, "").trim();
}

function parseJsonFromConcatenatedSource(input: string): unknown | null {
  const trimmed = stripGodelJsonBOM(input);
  if (!trimmed) {
    return null;
  }

  const candidates: unknown[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    while (cursor < trimmed.length && /\s/.test(trimmed[cursor])) {
      cursor += 1;
    }
    const startChar = trimmed[cursor];
    if (startChar !== "{" && startChar !== "[") {
      cursor += 1;
      continue;
    }

    const end = jsonValueEndIndex(trimmed, cursor);
    if (end < 0) {
      break;
    }
    const valueText = trimmed.slice(cursor, end + 1);
    try {
      candidates.push(JSON.parse(valueText) as unknown);
    } catch {
      // Skip candidates that are not parseable; scan may still have a later valid payload.
    }
    cursor = end + 1;
  }

  if (!candidates.length) {
    return null;
  }
  return candidates.find((value) => discoverNewsRows(value).length > 0) ?? candidates[0];
}

function jsonValueEndIndex(text: string, start: number): number {
  const opening = text[start];
  const stack: string[] = [opening];
  let inString = false;
  let escaped = false;

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      const open = stack.pop();
      if (!open) {
        return -1;
      }
      if (
        (open === "{" && char !== "}") ||
        (open === "[" && char !== "]")
      ) {
        return -1;
      }
      if (stack.length === 0) {
        return index;
      }
    }
  }
  return -1;
}

function parseGodelJson(input: string, sourceUrl?: string): MorningLiveUpdate[] {
  const parsed = parseJsonFromConcatenatedSource(input);
  if (parsed === null) {
    throw new SyntaxError(`Unable to parse Godel JSON payload from source: ${sourceUrl ?? "unknown"}`);
  }
  const rows = discoverNewsRows(parsed).filter((row) => shouldKeepGodelJsonRow(parsed, row));
  return rows.map((row, index) => godelRowToUpdate(row, index, sourceUrl)).filter((row): row is MorningLiveUpdate => row !== null).slice(0, 24);
}

function parseGodelRss(xml: string, sourceUrl?: string): MorningLiveUpdate[] {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((match, index) => {
      const item = match[0];
      return godelRowToUpdate(
        {
          id: tagText(item, "guid") || tagText(item, "link"),
          publishedAt: tagText(item, "pubDate"),
          sourceName: tagText(item, "source"),
          text: tagText(item, "description"),
          title: tagText(item, "title"),
          url: tagText(item, "link"),
        },
        index,
        sourceUrl,
      );
    })
    .filter((row): row is MorningLiveUpdate => row !== null)
    .slice(0, 24);
}

function parseGodelHtml(html: string, sourceUrl?: string): MorningLiveUpdate[] {
  const jsonLdRows = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((match) => {
      try {
        return discoverNewsRows(JSON.parse(decodeHtml(match[1])));
      } catch {
        return [];
      }
    });
  if (jsonLdRows.length) {
    return jsonLdRows.map((row, index) => godelRowToUpdate(row, index, sourceUrl)).filter((row): row is MorningLiveUpdate => row !== null).slice(0, 24);
  }

  return [...html.matchAll(/<(?:article|li|div)\b[^>]*(?:news|headline|story|item)[^>]*>([\s\S]{20,1200}?)<\/(?:article|li|div)>/gi)]
    .map((match, index) => godelRowToUpdate({ text: stripHtml(match[1]) }, index, sourceUrl))
    .filter((row): row is MorningLiveUpdate => row !== null)
    .slice(0, 24);
}

function godelRowToUpdate(row: unknown, index: number, sourceUrl?: string): MorningLiveUpdate | null {
  const record = asRecord(row);
  const title = firstString(record.title, record.headline, record.name, record.subject);
  const body = firstString(record.text, record.summary, record.description, record.body, record.message);
  const text = cleanNewsText([title, body && body !== title ? body : null].filter(Boolean).join(" - "));
  if (!text) {
    return null;
  }

  const publishedAt = parsePublishedAt(firstString(record.publishedAt, record.published_at, record.pubDate, record.time, record.timestamp, record.date, record.created_at));
  const url = firstString(record.url, record.link, record.href, record.webUrl);
  const id = firstString(record.id, record.guid, record.uuid, record.newsId) || stableId(`${publishedAt ?? ""}|${url ?? ""}|${text}`);
  return {
    author: firstString(record.sourceName, record.source, record.provider, record.publisher),
    feedUrl: sourceUrl,
    id: `godel-${id || index}`,
    kind: "post",
    publishedAt,
    source: "Godel",
    text,
    timeLabel: publishedAt ? formatEtTime(publishedAt) : "Time TBD",
    trackedAccount: "Godel",
    url,
  };
}

function discoverNewsRows(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  for (const key of ["items", "news", "articles", "results", "data", "rows"]) {
    const next = record[key];
    if (Array.isArray(next)) {
      return next;
    }
    const nested = asRecord(next);
    for (const nestedKey of ["items", "news", "articles", "results", "rows"]) {
      if (Array.isArray(nested[nestedKey])) {
        return nested[nestedKey] as unknown[];
      }
    }
  }
  if (record["@graph"] && Array.isArray(record["@graph"])) {
    return record["@graph"] as unknown[];
  }
  return [];
}

function shouldKeepGodelJsonRow(payload: unknown, row: unknown): boolean {
  if (!isGodelDomBridgePayload(payload)) {
    return true;
  }
  const captureKind = firstString(asRecord(row).captureKind, asRecord(row).capture_kind);
  return captureKind === "bottom-right-red-alert" || captureKind === "manual-paste";
}

function isGodelDomBridgePayload(value: unknown): boolean {
  const record = asRecord(value);
  return firstString(record.mode) === "godel-dom-bridge" || firstString(record.sourceUrl) === "Godel DOM bridge";
}

function sourceStatus(status: MorningBriefSource["status"], detail: string, url?: string): MorningBriefSource {
  return { detail, label: GODEL_SOURCE_LABEL, status, url };
}

function parsePublishedAt(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatEtTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function tagText(xml: string, tag: string): string {
  return cleanNewsText(xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "");
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function cleanNewsText(value: string): string {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function stableId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}
