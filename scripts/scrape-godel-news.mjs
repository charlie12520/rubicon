import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const DEFAULT_SOURCE_URL = "https://app.godelterminal.com/news";
const DEFAULT_OUT_PATH = "data/godel-live-news.json";
const DEFAULT_LIMIT = 80;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_SETTLE_MS = 2_500;
const DEFAULT_LOGIN_WAIT_MS = 120_000;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const headless = Boolean(args.headless) || process.env.RUBICON_GODEL_HEADLESS === "1";
const sourceUrl = args.url || process.env.RUBICON_GODEL_NEWS_URL || DEFAULT_SOURCE_URL;
const outPath = path.resolve(args.out || process.env.RUBICON_GODEL_NEWS_CAPTURE_PATH || DEFAULT_OUT_PATH);
const profileDir = path.resolve(args.profileDir || process.env.RUBICON_GODEL_BROWSER_PROFILE || defaultProfileDir());
const timeoutMs = positiveInt(args.timeoutMs, DEFAULT_TIMEOUT_MS);
const settleMs = positiveInt(args.settleMs, DEFAULT_SETTLE_MS);
const loginWaitMs = positiveInt(args.loginWaitMs, headless ? 0 : DEFAULT_LOGIN_WAIT_MS);
const limit = positiveInt(args.limit, DEFAULT_LIMIT);
const executablePath = args.executablePath || process.env.RUBICON_BROWSER_EXECUTABLE || findBrowserExecutable();
const allowEmpty = Boolean(args.allowEmpty) || process.env.RUBICON_GODEL_ALLOW_EMPTY_CAPTURE === "1";

if (!executablePath) {
  throw new Error("Could not find Edge or Chrome. Set RUBICON_BROWSER_EXECUTABLE or pass --executable-path.");
}

const capturedResponses = [];
const context = await chromium.launchPersistentContext(profileDir, {
  acceptDownloads: false,
  executablePath,
  headless,
  locale: "en-US",
  viewport: { height: 900, width: 1400 },
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("response", async (response) => {
    const contentType = response.headers()["content-type"] ?? "";
    const responseUrl = response.url();
    if (!looksLikeNewsResponse(contentType, responseUrl)) {
      return;
    }
    try {
      const text = await response.text();
      const rows = discoverNewsRows(JSON.parse(text));
      if (rows.length) {
        capturedResponses.push({ rows, url: responseUrl });
      }
    } catch {
      // Many app responses are streaming/chunked or not JSON after all.
    }
  });

  await page.goto(sourceUrl, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) }).catch(() => {});
  await page.waitForTimeout(settleMs);

  let rows = bestNetworkRows(capturedResponses);
  if (!rows.length) {
    rows = await extractDomRows(page);
  }

  let pageState = await readPageState(page);
  let loginLikely = isLoginLikely(pageState);
  let blockedLikely = isBotChallengeLikely(pageState);
  if (!rows.length && loginLikely && loginWaitMs > 0) {
    console.log(
      JSON.stringify({
        ok: false,
        status: "waiting_for_login",
        detail: `Log into Godel in the opened browser window. Scrape will retry for ${Math.round(loginWaitMs / 1000)} seconds.`,
        profileDir,
        sourceUrl: page.url(),
      }),
    );
    await waitForRenderedFeed(page, loginWaitMs);
    rows = bestNetworkRows(capturedResponses);
    if (!rows.length) {
      rows = await extractDomRows(page);
    }
    pageState = await readPageState(page);
    loginLikely = isLoginLikely(pageState);
    blockedLikely = isBotChallengeLikely(pageState);
  }

  if (!rows.length && !allowEmpty) {
    const reason = blockedLikely
      ? "Godel returned a Cloudflare/security verification page instead of the news feed."
      : loginLikely
        ? "Godel appears to require login before the news feed is visible."
        : "No parseable Godel news rows were found on the rendered page.";
    throw new Error(`${reason} Capture not overwritten. Use --allow-empty to write an empty capture intentionally.`);
  }

  const news = normalizeRows(rows, page.url()).slice(0, limit);
  const payload = {
    capturedAt: new Date().toISOString(),
    count: news.length,
    blockedLikely,
    loginLikely,
    news,
    profileDir,
    sourceUrl: page.url(),
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, outPath, count: news.length, blockedLikely, loginLikely, sourceUrl: page.url() }));
} finally {
  await context.close();
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help" || value === "-h") {
      result.help = true;
    } else if (value === "--headless") {
      result.headless = true;
    } else if (value === "--allow-empty") {
      result.allowEmpty = true;
    } else if (value === "--url") {
      result.url = values[index + 1];
      index += 1;
    } else if (value === "--out") {
      result.out = values[index + 1];
      index += 1;
    } else if (value === "--profile-dir") {
      result.profileDir = values[index + 1];
      index += 1;
    } else if (value === "--timeout-ms") {
      result.timeoutMs = values[index + 1];
      index += 1;
    } else if (value === "--settle-ms") {
      result.settleMs = values[index + 1];
      index += 1;
    } else if (value === "--login-wait-ms") {
      result.loginWaitMs = values[index + 1];
      index += 1;
    } else if (value === "--limit") {
      result.limit = values[index + 1];
      index += 1;
    } else if (value === "--executable-path") {
      result.executablePath = values[index + 1];
      index += 1;
    }
  }
  return result;
}

function printHelp() {
  console.log(`Usage: npm run godel:scrape -- [options]

Scrapes the authenticated Godel live news page through a real browser session and writes a Rubicon-compatible capture.

Options:
  --url <url>               Godel page to open. Defaults to ${DEFAULT_SOURCE_URL}
  --out <path>              Capture output. Defaults to ${DEFAULT_OUT_PATH}
  --profile-dir <path>      Persistent browser profile for Godel login cookies.
  --headless                Run without a visible browser window.
  --allow-empty             Write an empty capture when the page has no parseable rows.
  --login-wait-ms <ms>      Time to wait for manual login when needed. Defaults to ${DEFAULT_LOGIN_WAIT_MS}
  --limit <count>           Maximum rows to write. Defaults to ${DEFAULT_LIMIT}
  --executable-path <path>  Edge/Chrome executable override.`);
}

function defaultProfileDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "Rubicon", "Godel Browser Profile");
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function findBrowserExecutable() {
  const candidates = [
    process.env.MSEDGE,
    process.env.CHROME,
    path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fsSync.existsSync(candidate));
}

function looksLikeNewsResponse(contentType, url) {
  if (!/json/i.test(contentType)) {
    return false;
  }
  return /api|feed|news|timeline|live|market|headline/i.test(url);
}

function bestNetworkRows(responses) {
  return responses
    .map((response) => ({ ...response, normalized: normalizeRows(response.rows, response.url) }))
    .sort((left, right) => right.normalized.length - left.normalized.length)[0]?.rows ?? [];
}

async function waitForRenderedFeed(page, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(2_500);
    const rows = await extractDomRows(page);
    if (rows.length) {
      return;
    }
  }
}

async function readPageState(page) {
  return page
    .evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const passwordInputs = document.querySelectorAll('input[type="password"]').length;
      const emailInputs = document.querySelectorAll('input[type="email"], input[name*="email" i]').length;
      return { bodyText: bodyText.slice(0, 3000), emailInputs, passwordInputs, title: document.title, url: location.href };
    })
    .catch(() => ({ bodyText: "", emailInputs: 0, passwordInputs: 0, title: "", url: "" }));
}

function isLoginLikely(pageState) {
  const text = `${pageState.title}\n${pageState.url}\n${pageState.bodyText}`;
  return pageState.passwordInputs > 0 || pageState.emailInputs > 0 || /\b(sign in|sign-in|log in|login|authenticate|password)\b/i.test(text);
}

function isBotChallengeLikely(pageState) {
  const text = `${pageState.title}\n${pageState.url}\n${pageState.bodyText}`;
  return /cloudflare|security verification|just a moment|verify you are not a bot|ray id/i.test(text);
}

async function extractDomRows(page) {
  return page.evaluate(() => {
    const selectors = [
      "article",
      "[role='article']",
      "li",
      "[data-testid*='news' i]",
      "[data-testid*='headline' i]",
      "[class*='news' i]",
      "[class*='headline' i]",
      "[class*='story' i]",
      "[class*='feed' i]",
    ];
    const seen = new Set();
    const rows = [];
    const elements = document.querySelectorAll(selectors.join(","));

    for (const element of elements) {
      if (!(element instanceof HTMLElement) || !isVisible(element)) {
        continue;
      }
      const text = cleanText(element.innerText || element.textContent || "");
      if (!isUsefulNewsText(text) || seen.has(text.toLowerCase())) {
        continue;
      }
      seen.add(text.toLowerCase());
      const anchor = element.querySelector("a[href]");
      const timeElement = element.querySelector("time[datetime], time");
      rows.push({
        headline: text,
        href: anchor?.href || null,
        publishedAt: timeElement?.getAttribute("datetime") || timeElement?.textContent || null,
      });
      if (rows.length >= 120) {
        break;
      }
    }

    return rows;

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    }

    function cleanText(value) {
      return value.replace(/\s+/g, " ").trim();
    }

    function isUsefulNewsText(value) {
      if (value.length < 18 || value.length > 700) {
        return false;
      }
      if (/^(sign in|log in|loading|settings|search|all|latest|home|help|logout)$/i.test(value)) {
        return false;
      }
      return /[a-z]/i.test(value);
    }
  });
}

function normalizeRows(rows, sourceUrl) {
  const seen = new Set();
  return rows
    .map((row, index) => normalizeRow(row, index, sourceUrl))
    .filter((row) => {
      if (!row) {
        return false;
      }
      const key = `${row.publishedAt || ""}|${row.headline}`.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeRow(row, index, sourceUrl) {
  const record = asRecord(row);
  const headline = cleanText(firstString(record.headline, record.title, record.name, record.subject, record.text, record.summary, record.description, record.body, record.message));
  if (!headline || headline.length < 12) {
    return null;
  }
  return {
    id: firstString(record.id, record.guid, record.uuid, record.newsId) || `scrape-${index}`,
    headline,
    publishedAt: parseMaybeDate(firstString(record.publishedAt, record.published_at, record.pubDate, record.time, record.timestamp, record.date, record.created_at)),
    provider: firstString(record.provider, record.publisher, record.sourceName, record.source) || "Godel",
    sourceUrl,
    url: firstString(record.url, record.link, record.href, record.webUrl) || null,
  };
}

function discoverNewsRows(value) {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  for (const key of ["items", "news", "articles", "results", "data", "rows", "edges", "nodes"]) {
    const next = record[key];
    if (Array.isArray(next)) {
      return unwrapEdges(next);
    }
    const nested = asRecord(next);
    for (const nestedKey of ["items", "news", "articles", "results", "rows", "edges", "nodes"]) {
      if (Array.isArray(nested[nestedKey])) {
        return unwrapEdges(nested[nestedKey]);
      }
    }
  }
  if (record["@graph"] && Array.isArray(record["@graph"])) {
    return record["@graph"];
  }
  return [];
}

function unwrapEdges(rows) {
  return rows.map((row) => asRecord(row).node || row);
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseMaybeDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
