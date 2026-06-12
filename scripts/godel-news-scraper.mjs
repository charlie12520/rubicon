// Godel Terminal news scraper — windowless-in-practice.
//
// Cloudflare blocks every headless and raw-HTTP route to godelterminal.com,
// but a real headed Edge parked OFF-SCREEN (-32000,-32000) passes the managed
// challenge automatically and stays cleared. So: one invisible browser, a
// dedicated profile under godel-news/profile, and two capture layers:
//   1. DOM poll of the news feed rows (tr[id*="streaming-table"]) — reliable.
//   2. Raw frames from wss://api.godelterminal.com/events (STOMP) — logged for
//      the breaking ticker / future reverse-engineering.
// Current DOM payload is banner-only; streaming-table rows are heartbeat only.
// Output (append-only, deduped across restarts):
//   godel-news/news.jsonl     one JSON object per headline
//   godel-news/latest.json    most recent 50, newest first (easy to consume)
//   godel-news/breaking.jsonl anything captured from a breaking banner
//   godel-news/ws-raw.log     raw text WS frames (size-capped)
//
// Usage (from the spx-spread-replay-tracker repo root):
//   node scripts/godel-news-scraper.mjs --once     capture current rows, exit
//   node scripts/godel-news-scraper.mjs            watch forever (Ctrl+C stops)

import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = "C:/Users/charl/Desktop/AI STUFF/godel-news";
const PROFILE = path.join(ROOT, "profile");
const NEWS_JSONL = path.join(ROOT, "news.jsonl");
const LATEST_JSON = path.join(ROOT, "latest.json");
const BREAKING_JSONL = path.join(ROOT, "breaking.jsonl");
const WS_RAW_LOG = path.join(ROOT, "ws-raw.log");
const WS_RAW_CAP_BYTES = 5 * 1024 * 1024;

// Rubicon integration: the server's readGodelLiveNewsSource() reads
// data/godel-live-news.json by default and feeds it into the Morning > Live
// Updates panel (merged with FirstSquawk). Writing there makes the scraped
// feed appear in Rubicon with no server config — replacing the old manual
// DOM-bridge bookmarklet as the Godel source. Rows here are mapped by the
// reader: headline->title, time->publishedAt, source->author.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUBICON_CAPTURE = path.join(REPO_ROOT, "data", "godel-live-news.json");
const RUBICON_CAPTURE_MAX = 24;

const POLL_MS = 3_000;
// --login: show the window on-screen so you can sign in to Godel (and arrange
// the news panel you want scraped); the layout/session persist in the profile.
const LOGIN = process.argv.includes("--login");
// --once contradicts --login (it would exit before you can sign in) — login wins.
const ONCE = process.argv.includes("--once") && !LOGIN;
// Zero banners is normal; relaunch only if the persistent Godel app shell
// disappears, or Cloudflare returns after the session was already up.
const SHELL_MISSING_POLLS_BEFORE_RELAUNCH = 60;
// Observed repeatedly: a hard-killed profile gets re-challenged by Cloudflare
// and STAYS stuck, while a fresh profile clears in seconds. After this many
// consecutive interstitial failures, reset the profile — but never one that
// holds a login session (marker written by --login).
const CF_FAILURES_BEFORE_PROFILE_RESET = 3;
const LOGIN_MARKER = path.join(ROOT, "profile-logged-in.flag");
const SEEN_CAP = 10_000;
const SEEN_BREAKING_CAP = 500;

const WATCHER_LOG = path.join(ROOT, "watcher.log");
const WATCHER_LOCK = path.join(ROOT, "watcher.lock.json");

const seen = new Set();
const latest = [];

// FIFO-capped Set add: prevents unbounded growth over multi-week watches.
function addCapped(set, value, cap) {
  set.add(value);
  if (set.size > cap) {
    set.delete(set.values().next().value);
  }
}

const TIME_PIPE_TEXT_RE = /^\s*(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s*\|\s*(.+)$/i;
const BANNER_SOURCE = "Godel Breaking";

export function parseGodelBannerText(text) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  const match = TIME_PIPE_TEXT_RE.exec(normalized);
  if (!match) {
    return null;
  }
  return {
    timeOfDay: match[1].replace(/\s+/g, " ").trim().toUpperCase(),
    headline: match[2].trim(),
  };
}

function parseTimeOfDayParts(timeOfDay) {
  const match = /^\s*(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)\s*$/i.exec(timeOfDay);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  const meridiem = match[4].toUpperCase();
  if (hour < 1 || hour > 12 || minute > 59 || second > 59) {
    return null;
  }
  if (meridiem === "PM" && hour !== 12) {
    hour += 12;
  }
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }
  return { hour, minute, second };
}

export function bannerTimeOfDayToIso(timeOfDay, now = new Date()) {
  const parts = parseTimeOfDayParts(timeOfDay);
  if (!parts) {
    return null;
  }
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parts.hour, parts.minute, parts.second, 0);
  if (candidate.getTime() - now.getTime() > 2 * 60 * 60 * 1000) {
    candidate.setDate(candidate.getDate() - 1);
  }
  return candidate.toISOString();
}

function normalizeHeadlineForId(headline) {
  return String(headline ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function stableBannerId(headline, timeIso) {
  const normalizedHeadline = normalizeHeadlineForId(headline);
  const day = typeof timeIso === "string" && /^\d{4}-\d{2}-\d{2}/.test(timeIso) ? timeIso.slice(0, 10) : "unknown-day";
  const digest = createHash("sha1").update(normalizedHeadline).digest("hex").slice(0, 16);
  return `breaking-${day}-${digest}`;
}

export function bannerRowsToNewsItems(rows, now = new Date()) {
  const items = [];
  for (const row of rows) {
    const parsed = row?.headline && row?.timeOfDay ? { headline: String(row.headline), timeOfDay: String(row.timeOfDay) } : parseGodelBannerText(row?.text ?? row?.fullText ?? "");
    if (!parsed) {
      continue;
    }
    const time = bannerTimeOfDayToIso(parsed.timeOfDay, now);
    if (!time) {
      continue;
    }
    items.push({
      id: stableBannerId(parsed.headline, time),
      headline: parsed.headline,
      time,
      source: BANNER_SOURCE,
      severity: row?.isRed ? "red" : "standard",
      timeLabel: parsed.timeOfDay,
    });
  }
  return items;
}

function isBreakingNewsItem(item) {
  return item && typeof item === "object" && item.source === BANNER_SOURCE;
}

// Console + file: the logon launcher (godel-news-watcher.vbs) starts node with
// no console at all, so the file is the only place the log survives.
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(WATCHER_LOG, `${line}\n`, "utf8");
  } catch {
    // logging must never kill the watcher
  }
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Single-instance guard: a second watcher would fight the first over the Edge
// profile ("profile already in use" relaunch loops). Stale locks (dead pid)
// are taken over silently — e.g. after a reboot or a hard kill.
function acquireSingleInstanceLock() {
  try {
    const lock = JSON.parse(fs.readFileSync(WATCHER_LOCK, "utf8"));
    if (typeof lock.pid === "number" && lock.pid !== process.pid && pidIsAlive(lock.pid)) {
      console.log(`another watcher is already running (pid ${lock.pid}) — exiting.`);
      process.exit(0);
    }
  } catch {
    // missing/corrupt lock — take it
  }
  fs.writeFileSync(WATCHER_LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
}

function loadSeenFromDisk() {
  try {
    const lines = fs.readFileSync(NEWS_JSONL, "utf8").split("\n").filter(Boolean).slice(-3000);
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (isBreakingNewsItem(item) && item.id) {
          addCapped(seen, item.id, SEEN_CAP);
          latest.push(item);
        }
      } catch {
        // skip corrupt line
      }
    }
    latest.splice(0, Math.max(0, latest.length - 50));
    // file order is oldest-first; runtime unshifts newest-first — normalize so
    // latest[0] is always the newest and splice(50) evicts the oldest
    latest.reverse();
    log(`warm start: ${seen.size} known ${BANNER_SOURCE} ids from news.jsonl`);
  } catch {
    log("cold start: no existing news.jsonl");
  }
}

function appendJsonl(file, item) {
  fs.appendFileSync(file, `${JSON.stringify(item)}\n`, "utf8");
}

function recordNews(items) {
  let fresh = 0;
  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      continue;
    }
    item.capturedAtMs = Date.now();
    try {
      appendJsonl(NEWS_JSONL, item);
    } catch (error) {
      // transient lock (OneDrive/AV on the Desktop folder): do NOT mark seen,
      // so the headline retries next poll instead of vanishing forever
      log(`news append failed (will retry): ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    addCapped(seen, item.id, SEEN_CAP);
    latest.unshift(item);
    fresh += 1;
    log(`NEWS ${item.time ?? ""} [${item.symbol ?? "-"}] ${item.headline}`);
  }
  if (fresh > 0) {
    latest.splice(50);
    writeJsonAtomic(LATEST_JSON, latest);
    writeRubiconCapture();
  }
  return fresh;
}

function newsTimeMs(item) {
  const ms = Date.parse(item.time);
  // unparseable times fall back to capture wall-clock, NOT 0 — a 0 would sort
  // the newest headline below everything and silently drop it from the capture
  return Number.isNaN(ms) ? (item.capturedAtMs ?? 0) : ms;
}

function writeJsonAtomic(target, value) {
  try {
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 1), "utf8");
    renameWithRetry(tmp, target);
  } catch (error) {
    log(`atomic write failed for ${path.basename(target)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renameWithRetry(from, to, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = error?.code;
      if (attempt >= attempts || !["EPERM", "EACCES", "EBUSY"].includes(code)) {
        try {
          fs.unlinkSync(from);
        } catch {
          // leave the tmp; next write reuses the same name
        }
        throw error;
      }
      // Windows: rename onto a file the server is reading throws transiently
      const waitMs = 50 * attempt;
      const end = Date.now() + waitMs;
      while (Date.now() < end) {
        // tiny sync spin — callers are sync and the wait is <=200ms total
      }
    }
  }
}

// Atomic write of the newest items into the Rubicon capture file. Sorts by
// timestamp desc itself, so it's correct regardless of whether `latest` is in
// warm-start (oldest-first) or runtime (newest-first) order. Atomic rename so
// the server (polling every 10s) never reads a half-written array.
function writeRubiconCapture() {
  try {
    fs.mkdirSync(path.dirname(RUBICON_CAPTURE), { recursive: true });
    const rows = [...latest]
      .sort((a, b) => newsTimeMs(b) - newsTimeMs(a))
      .slice(0, RUBICON_CAPTURE_MAX)
      .map((item) => {
        // emit ISO when parseable: this machine's local tz is the only place
        // the DOM's naive "6/11/26 15:01:28" stamp is authoritative — the
        // server must not have to share our timezone to get publishedAt right
        const ms = Date.parse(item.time);
        return {
          id: item.id,
          headline: item.headline,
          time: Number.isNaN(ms) ? item.time : new Date(ms).toISOString(),
          ticker: item.symbol || undefined,
          source: item.source,
        };
      });
    writeJsonAtomic(RUBICON_CAPTURE, { generatedAt: new Date().toISOString(), items: rows });
  } catch (error) {
    log(`rubicon capture write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function appendWsRaw(text) {
  try {
    const stats = fs.existsSync(WS_RAW_LOG) ? fs.statSync(WS_RAW_LOG) : null;
    if (stats && stats.size > WS_RAW_CAP_BYTES) {
      fs.renameSync(WS_RAW_LOG, `${WS_RAW_LOG}.1`);
    }
    fs.appendFileSync(WS_RAW_LOG, `[${new Date().toISOString()}] ${text}\n`, "utf8");
  } catch {
    // raw logging must never kill the scraper
  }
}

async function scrapeOnce(page) {
  return page.evaluate(() => {
    const TIME_PIPE = /^\s*(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s*\|\s*(.+)$/i;

    function collectBanners() {
      const banners = [];
      for (const el of document.querySelectorAll("div.truncate")) {
        const fullText = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        const match = TIME_PIPE.exec(fullText);
        if (!match) {
          continue;
        }
        const parent = el.closest(".fade-in-animation") ?? el.parentElement;
        const bg = parent ? getComputedStyle(parent).backgroundColor : "";
        const color = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
        const isRed = !!(color && Number(color[1]) > 200 && Number(color[2]) < 60 && Number(color[3]) < 60);
        banners.push({
          key: `${match[1].replace(/\s+/g, " ").trim().toUpperCase()}|${match[2].trim()}`,
          fullText,
          timeOfDay: match[1].replace(/\s+/g, " ").trim().toUpperCase(),
          headline: match[2].trim(),
          isRed,
          hasFadeInAncestor: !!el.closest(".fade-in-animation"),
          parentClass: parent?.className ? String(parent.className).slice(0, 200) : "",
        });
      }
      return banners;
    }

    const win = window;
    if (!Array.isArray(win.__rubiconGodelBannerBuffer)) {
      win.__rubiconGodelBannerBuffer = [];
      win.__rubiconGodelBannerObservedKeys = new Set();
      const enqueue = () => {
        for (const banner of collectBanners()) {
          if (win.__rubiconGodelBannerObservedKeys.has(banner.key)) {
            continue;
          }
          win.__rubiconGodelBannerObservedKeys.add(banner.key);
          win.__rubiconGodelBannerBuffer.push(banner);
        }
      };
      win.__rubiconGodelBannerObserver = new MutationObserver(enqueue);
      win.__rubiconGodelBannerObserver.observe(document.body ?? document.documentElement, {
        characterData: true,
        childList: true,
        subtree: true,
      });
      enqueue();
    }

    const buffered = win.__rubiconGodelBannerBuffer.splice(0);
    const merged = new Map();
    for (const banner of [...buffered, ...collectBanners()]) {
      merged.set(banner.key, banner);
    }
    const appShellRowCount = document.querySelectorAll('tr[id*="streaming-table"]').length;
    return {
      appShellPresent: appShellRowCount > 0,
      appShellRowCount,
      banners: [...merged.values()].map(({ key: _key, ...banner }) => banner),
      title: document.title,
    };
  });
}

const seenBreaking = new Set();

function recordBreaking(items) {
  for (const item of items) {
    const key = item.id;
    if (seenBreaking.has(key)) {
      continue;
    }
    addCapped(seenBreaking, key, SEEN_BREAKING_CAP);
    try {
      appendJsonl(BREAKING_JSONL, {
        capturedAt: new Date().toISOString(),
        headline: item.headline,
        id: item.id,
        severity: item.severity,
        source: item.source,
        time: item.time,
        timeLabel: item.timeLabel,
      });
    } catch (error) {
      log(`breaking append failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    log(`BREAKING ${item.timeLabel ?? item.time ?? ""} ${item.headline.slice(0, 160)}`);
  }
}

async function tryTurnstileClick(page) {
  // Interactive Turnstile renders inside a closed shadow root in a cross-origin
  // iframe — locators can't reach the checkbox, but a raw mouse click at the
  // widget's checkbox position (≈28px from its left edge) works.
  try {
    const iframe = page.locator('iframe[src*="challenges.cloudflare.com"]').first();
    const box = await iframe.boundingBox({ timeout: 2_000 });
    if (box) {
      await page.mouse.click(box.x + 28, box.y + box.height / 2);
      log(`clicked Turnstile at ${Math.round(box.x + 28)},${Math.round(box.y + box.height / 2)}`);
      return;
    }
    // some variants render the widget inline without a visible iframe yet
    await page.screenshot({ path: path.join(ROOT, "challenge-debug.png") });
  } catch {
    // not interactive (or not clickable yet) — the wait loop continues
  }
}

async function launchSession() {
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: "msedge",
    headless: false,
    viewport: { width: 1600, height: 900 },
    args: [LOGIN ? "--window-position=80,60" : "--window-position=-32000,-32000", "--disable-session-crashed-bubble"],
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());

    page.on("websocket", (ws) => {
      if (!ws.url().includes("godelterminal")) {
        return;
      }
      ws.on("framereceived", (frame) => {
        if (typeof frame.payload === "string" && frame.payload.length > 4) {
          appendWsRaw(`${ws.url().slice(0, 60)} :: ${frame.payload.slice(0, 1500)}`);
        }
      });
    });

    await page.goto("https://app.godelterminal.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    for (let i = 0; i < 36; i++) {
      const title = await page.title();
      if (!/just a moment/i.test(title)) {
        break;
      }
      if (i >= 4 && i % 4 === 0) {
        await tryTurnstileClick(page);
      }
      await page.waitForTimeout(2_500);
    }
    if (/just a moment/i.test(await page.title())) {
      throw new Error("stuck on the Cloudflare interstitial");
    }
    if (LOGIN) {
      log("LOGIN MODE: window is on-screen — sign in / arrange your panels, then Ctrl+C here. Scraping continues meanwhile.");
    }
    // LOGIN: no deadline — a 2min timeout here would close the window while
    // the user is mid-sign-in and relaunch-loop over them
    await page.waitForSelector('tr[id*="streaming-table"]', { timeout: LOGIN ? 0 : 120_000 });
    log("session up: Godel app loaded, news rows present");
    if (LOGIN) {
      // this profile now (presumably) holds a signed-in session — the
      // CF-stuck self-heal must never delete it
      fs.writeFileSync(LOGIN_MARKER, new Date().toISOString(), "utf8");
    }
    return { context, page };
  } catch (error) {
    // never leak the browser: a zombie keeps the profile locked for relaunch
    await context.close().catch(() => {});
    throw error;
  }
}

function isMainModule() {
  return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
fs.mkdirSync(PROFILE, { recursive: true });
acquireSingleInstanceLock();
// fresh log per run — this file describes the CURRENT watcher only
try {
  fs.writeFileSync(WATCHER_LOG, "", "utf8");
} catch {
  // non-fatal
}
loadSeenFromDisk();

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
  log("stopping...");
});

let cfStuckCount = 0;
let resetProfilePending = false;

while (!stopping) {
  let context = null;
  if (resetProfilePending) {
    resetProfilePending = false;
    cfStuckCount = 0;
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
      fs.mkdirSync(PROFILE, { recursive: true });
      log("profile reset: Cloudflare kept challenging it and it held no login session — fresh profiles clear instantly");
    } catch (error) {
      log(`profile reset failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    const session = await launchSession();
    context = session.context;
    const { page } = session;
    cfStuckCount = 0;
    // refresh the Rubicon capture from the warm-started snapshot at boot, so the
    // panel has current rows even before the next new headline lands
    writeRubiconCapture();
    let missingShellPolls = 0;
    for (;;) {
      const { appShellPresent, appShellRowCount, banners, title } = await scrapeOnce(page);
      const bannerItems = bannerRowsToNewsItems(banners);
      const fresh = recordNews(bannerItems);
      recordBreaking(bannerItems);
      if (ONCE) {
        log(`once mode: ${banners.length} banner(s), shell rows ${appShellRowCount}, ${fresh} new -> ${NEWS_JSONL}`);
        stopping = true;
        break;
      }
      if (stopping) {
        break;
      }
      if (/just a moment/i.test(title)) {
        throw new Error("Cloudflare interstitial returned after session start");
      }
      missingShellPolls = appShellPresent ? 0 : missingShellPolls + 1;
      if (missingShellPolls >= SHELL_MISSING_POLLS_BEFORE_RELAUNCH) {
        throw new Error(`Godel app shell absent for ${Math.round((SHELL_MISSING_POLLS_BEFORE_RELAUNCH * POLL_MS) / 60000)}min (last row count ${appShellRowCount})`);
      }
      await page.waitForTimeout(POLL_MS);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ONCE) {
      // --once promises capture-or-fail, never an infinite relaunch loop
      process.exitCode = 1;
      stopping = true;
      log(`once mode failed: ${message}`);
    } else {
      if (message.includes("Cloudflare interstitial")) {
        cfStuckCount += 1;
        if (cfStuckCount >= CF_FAILURES_BEFORE_PROFILE_RESET) {
          if (fs.existsSync(LOGIN_MARKER)) {
            log(`CF-stuck x${cfStuckCount} but the profile holds a login session — keeping it; backing off 5min`);
            cfStuckCount = 0;
            await new Promise((resolve) => setTimeout(resolve, 270_000));
          } else {
            resetProfilePending = true;
          }
        }
      }
      log(`session error: ${message}${stopping ? "" : " — relaunching in 30s"}`);
      if (!stopping) {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
      }
    }
  } finally {
    try {
      await context?.close();
    } catch {
      // already gone
    }
  }
}
log("scraper stopped.");
}
