import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { GodelAlertBridgeStatus } from "../shared/types.ts";
import { writeJsonAtomic } from "./jsonStore.ts";

// Own file — the scraper (scripts/godel-news-scraper.mjs) now owns
// data/godel-live-news.json; sharing it caused mutual clobbering.
const DEFAULT_CAPTURE_PATH = path.join(process.cwd(), "data", "godel-bridge-alerts.json");
const DEFAULT_STATUS_PATH = path.join(process.cwd(), "data", "godel-alert-bridge-status.json");
const BRIDGE_TOKEN_HEADER = "X-Rubicon-Bridge-Token";
const MAX_ROWS = 80;
let generatedBridgeToken: string | null = null;

type BridgeAlertRow = {
  captureKind?: "bottom-right-red-alert" | "manual-paste";
  headline: string;
  id: string;
  provider: string;
  publishedAt: string;
  sourceUrl: string | null;
  url: string | null;
};

type BridgeStatusFile = {
  lastAlert?: BridgeAlertRow | null;
  lastRejected?: GodelAlertBridgeStatus["lastRejected"];
  validCount?: number;
};

export type GodelBridgeAuthorizationResult =
  | { ok: true }
  | { message: string; ok: false; status: 401 | 403 };

export async function getGodelAlertBridgeStatus(): Promise<GodelAlertBridgeStatus> {
  const status = await readJsonFile<BridgeStatusFile>(bridgeStatusPath());
  const validCount = Number(status?.validCount ?? (await readCaptureRows()).length);
  return {
    bookmarkletUrl: "/api/godel-alert-bridge/bookmarklet",
    generatedAt: new Date().toISOString(),
    lastAlert: status?.lastAlert
      ? {
          headline: status.lastAlert.headline,
          publishedAt: status.lastAlert.publishedAt,
          sourceUrl: status.lastAlert.sourceUrl,
        }
      : null,
    lastRejected: status?.lastRejected ?? null,
    message: validCount
      ? `DOM bridge captured ${validCount} alert${validCount === 1 ? "" : "s"}.`
      : "DOM bridge idle. Open setup and arm it once; the source window can be minimized.",
    mode: "dom-bridge",
    setupUrl: "/api/godel-alert-bridge/setup",
    validCount,
  };
}

export async function ingestGodelBridgeAlert(body: unknown): Promise<GodelAlertBridgeStatus> {
  const record = parseBodyRecord(body);
  const rawText = firstString(record.text, record.headline, record.title, record.message);
  const headline = cleanAlertText(rawText);
  const sourceUrl = firstString(record.sourceUrl, record.href, record.url) || null;
  const captureKind = bridgeCaptureKind(record, sourceUrl);
  if (!captureKind) {
    await writeBridgeStatus({
      lastRejected: {
        at: new Date().toISOString(),
        reason: "not-bottom-right-alert",
        text: headline || rawText.slice(0, 240),
      },
      validCount: (await readCaptureRows()).length,
    });
    return getGodelAlertBridgeStatus();
  }
  const reason = classifyBridgeAlertText(headline);
  if (reason !== "ok") {
  await writeBridgeStatus({
      lastRejected: {
        at: new Date().toISOString(),
        reason,
        text: headline || rawText.slice(0, 240),
      },
      validCount: (await readCaptureRows()).length,
    });
    return getGodelAlertBridgeStatus();
  }

  const rows = await readCaptureRows();
  const id = firstString(record.id) || stableId(`${sourceUrl ?? ""}|${headline}`);
  const publishedAt = new Date().toISOString();
  const row: BridgeAlertRow = {
    captureKind,
    headline,
    id,
    provider: captureKind === "manual-paste" ? "Godel manual alert" : "Godel red alert",
    publishedAt,
    sourceUrl,
    url: sourceUrl,
  };
  const nextRows = dedupeRows([row, ...rows]).slice(0, MAX_ROWS);
  await writeCaptureRows(nextRows);
  await writeBridgeStatus({ lastAlert: row, lastRejected: null, validCount: nextRows.length });
  return getGodelAlertBridgeStatus();
}

export function godelBridgeBookmarklet(): string {
  const bridgeToken = getGodelBridgeToken();
  return `javascript:${encodeURIComponent(`(() => {
  const endpoint = "http://127.0.0.1:5174/api/godel-alert-bridge/ingest";
  const bridgeToken = ${JSON.stringify(bridgeToken)};
  const seen = new Set();
  const headlineLike = (text) => {
    const cleaned = String(text || "").replace(/\\s+/g, " ").trim();
    if (cleaned.length < 18 || cleaned.length > 700) return "";
    const compact = cleaned.replace(/\\s+/g, "");
    const alphaChars = (compact.match(/[A-Za-z]/g) || []).length;
    const alphaWords = cleaned.match(/\\b[A-Za-z][A-Za-z'/-]{2,}\\b/g) || [];
    const numericTokens = cleaned.match(/\\b\\d+(?:\\.\\d+)?\\b/g) || [];
    const allTokens = cleaned.match(/\\b[\\w.]+\\b/g) || [];
    const priceLike = cleaned.match(/\\b\\d{4,5}\\.\\d{2}\\b/g) || [];
    if (alphaWords.length < 3) return "";
    if (alphaChars / Math.max(compact.length, 1) < 0.22) return "";
    if (numericTokens.length / Math.max(allTokens.length, 1) > 0.62 || priceLike.length >= 5) return "";
    return cleaned;
  };
  const post = (text, el) => {
    const headline = headlineLike(text);
    if (!headline) return;
    const key = headline.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const payload = {
      id: "dom-" + Array.from(headline).reduce((hash, ch) => ((hash * 31 + ch.charCodeAt(0)) >>> 0), 2166136261).toString(16),
      text: headline,
      sourceUrl: location.href,
      title: document.title,
      bridgeToken,
      rect: el ? (() => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      })() : null,
      capturedAt: new Date().toISOString(),
      captureKind: "bottom-right-red-alert",
    };
    fetch(endpoint, {
      method: "POST",
      mode: "cors",
      keepalive: true,
      headers: { "Content-Type": "application/json", "${BRIDGE_TOKEN_HEADER}": bridgeToken },
      body: JSON.stringify(payload)
    }).catch(() => {
      try {
        navigator.sendBeacon(endpoint, new Blob([JSON.stringify(payload)], { type: "text/plain" }));
      } catch {}
    });
  };
  const scan = (root) => {
    const nodes = root instanceof Element ? [root, ...root.querySelectorAll("*")] : [];
    for (const el of nodes) {
      const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      const bottomRight = r.right > innerWidth * 0.52 && r.bottom > innerHeight * 0.42;
      const marker = [el.className, el.id, el.getAttribute("role"), el.getAttribute("data-testid"), el.getAttribute("aria-live"), el.getAttribute("style")]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      const toastLike = /toast|alert|notification|headline|news|snack|message/i.test(marker);
      const redHint = /red|danger|error|warn|urgent|critical|headline/i.test(marker);
      const alertHint = /\\balert\\b/i.test(text);
      if (bottomRight && (toastLike || redHint || alertHint)) post(text, el);
    }
  };
  if (window.__rubiconGodelBridgeObserver) window.__rubiconGodelBridgeObserver.disconnect();
  window.__rubiconGodelBridgeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) scan(node);
      if (mutation.target) scan(mutation.target);
    }
  });
  window.__rubiconGodelBridgeObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  scan(document.body);
  console.log("Rubicon Godel DOM bridge armed. You can minimize the Godel window.");
})()` )}`;
}

export function godelBridgeSetupHtml(): string {
  const bookmarklet = godelBridgeBookmarklet();
  const bridgeToken = getGodelBridgeToken();
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Rubicon Godel Bridge</title>
  <style>
    body { background:#070b10; color:#dce7f5; font:14px system-ui, sans-serif; max-width:760px; margin:40px auto; line-height:1.45; }
    a, button { color:#99f6e4; }
    .card { border:1px solid rgba(143,155,173,.22); border-radius:10px; padding:18px; background:rgba(18,25,34,.72); }
    .helper { border-color:rgba(148,163,184,.35); background:rgba(37,52,75,.7); margin-top:16px; }
    code, textarea { width:100%; box-sizing:border-box; background:#05070a; color:#dce7f5; border:1px solid rgba(143,155,173,.24); border-radius:8px; padding:10px; }
    button { margin-top: 8px; border:1px solid rgba(132,204,22,.45); border-radius:8px; background:#1f2937; color:#dce7f5; padding:9px 12px; }
    .surface { margin-top: 10px; display: flex; flex-direction: column; gap: 10px; }
    .note { margin-top: 12px; color:#9fb0c6; font-size:12px; }
    textarea { min-height:120px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Rubicon Godel DOM Bridge</h1>
    <p>This path reads Godel page events from inside the tab, so the Godel window can be minimized after the bridge is armed.</p>
    <ol>
      <li>Drag this link to Firefox bookmarks: <a href="${bookmarklet}">Arm Rubicon Godel Bridge</a></li>
      <li>Open Godel Terminal and click that bookmark once.</li>
      <li>After the console says the bridge is armed, you can minimize Godel.</li>
    </ol>
    <p>If dragging is awkward, copy the bookmarklet below into a new bookmark URL.</p>
    <textarea readonly>${bookmarklet}</textarea>
    <section class="card helper">
      <h2>Manual alert capture (fallback)</h2>
      <p class="note">If a red alert is missed, paste OCR/screenshot text here to ingest one row manually.</p>
      <div class="surface">
        <textarea id="godelManualText" placeholder="Paste alert text from screenshot or chat excerpt."></textarea>
        <button id="godelManualSubmit" type="button">Ingest pasted Godel alert</button>
        <code id="godelManualState"></code>
      </div>
    </section>
  </div>
<script>
  (function () {
    const submitButton = document.getElementById("godelManualSubmit");
    const input = document.getElementById("godelManualText");
    const status = document.getElementById("godelManualState");
    const endpoint = "/api/godel-alert-bridge/ingest?bridgeToken=${bridgeToken}";
    const bridgeTokenHeader = "${BRIDGE_TOKEN_HEADER}";
    const report = (message, ok) => {
      if (!status) return;
      status.textContent = message;
      status.style.color = ok ? "#86efac" : "#fca5a5";
    };
    submitButton?.addEventListener("click", async () => {
      const text = String(input?.value || "").trim();
      if (!text) {
        report("Paste text first before submitting.", false);
        return;
      }
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            [bridgeTokenHeader]: ${JSON.stringify(bridgeToken)},
          },
          body: JSON.stringify({
            text,
            sourceUrl: "manual-paste:godel-setup",
            headline: text,
            captureKind: "manual-paste",
            bridgeToken: ${JSON.stringify(bridgeToken)},
          }),
        });
        if (!response.ok) {
          const payload = await response.text();
          report("Manual ingest failed (" + response.status + "): " + (payload || response.statusText), false);
          return;
        }
        const parsed = await response.json();
        if (parsed?.ok === false) {
          report(parsed.message || "Manual ingest returned warning.", false);
          return;
        }
        if (input) input.value = "";
        report("Manual alert captured for Godel.", true);
      } catch (error) {
        report("Manual ingest request failed: " + (error instanceof Error ? error.message : String(error)), false);
      }
    });
  })();
</script>
</body>
</html>`;
}

export function setGodelBridgeCorsHeaders(origin: string | undefined, response: { setHeader(name: string, value: string): void }): void {
  response.setHeader("Vary", "Origin");
  if (origin && isGodelBridgeOriginAllowed(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
  }
  response.setHeader("Access-Control-Allow-Headers", `Content-Type, ${BRIDGE_TOKEN_HEADER}`);
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Max-Age", "600");
}

export function authorizeGodelBridgeRequest(input: {
  body?: unknown;
  origin?: string;
  queryToken?: unknown;
  token?: unknown;
}): GodelBridgeAuthorizationResult {
  if (input.origin && !isGodelBridgeOriginAllowed(input.origin)) {
    return {
      message: "Godel bridge origin is not allowed.",
      ok: false,
      status: 403,
    };
  }
  const token = firstString(input.token, input.queryToken, bridgeTokenFromBody(input.body));
  if (!bridgeTokensMatch(token, getGodelBridgeToken())) {
    return {
      message: "Godel bridge token is required.",
      ok: false,
      status: 401,
    };
  }
  return { ok: true };
}

export function isGodelBridgeOriginAllowed(origin: string): boolean {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "godelterminal.com" ||
      hostname.endsWith(".godelterminal.com")
    );
  } catch {
    return false;
  }
}

function getGodelBridgeToken(): string {
  const envToken = String(process.env.RUBICON_GODEL_BRIDGE_TOKEN ?? "").trim();
  if (envToken) {
    return envToken;
  }
  generatedBridgeToken ??= randomBytes(24).toString("base64url");
  return generatedBridgeToken;
}

function bridgeTokenFromBody(body: unknown): string {
  const record = parseBodyRecord(body);
  return firstString(record.bridgeToken, record.bridge_token, record.rubiconBridgeToken);
}

function bridgeTokensMatch(candidate: string, expected: string): boolean {
  if (!candidate || !expected) {
    return false;
  }
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

async function readCaptureRows(): Promise<BridgeAlertRow[]> {
  const payload = await readJsonFile<{ news?: BridgeAlertRow[] }>(bridgeCapturePath());
  return Array.isArray(payload?.news) ? payload.news.filter(isStoredAlertRow) : [];
}

async function writeCaptureRows(rows: BridgeAlertRow[]): Promise<void> {
  const capturePath = bridgeCapturePath();
  await writeJsonAtomic(capturePath, { capturedAt: new Date().toISOString(), count: rows.length, mode: "godel-dom-bridge", news: rows, sourceUrl: "Godel DOM bridge" });
}

async function writeBridgeStatus(update: BridgeStatusFile): Promise<void> {
  const statusPath = bridgeStatusPath();
  const current = await readJsonFile<BridgeStatusFile>(statusPath);
  await writeJsonAtomic(statusPath, { ...current, ...update, generatedAt: new Date().toISOString() });
}

function bridgeCapturePath(): string {
  // No RUBICON_GODEL_NEWS_CAPTURE_PATH fallback: that env points the NEWS
  // reader at the scraper file, which the bridge must never write.
  return process.env.RUBICON_GODEL_BRIDGE_CAPTURE_PATH || DEFAULT_CAPTURE_PATH;
}

function bridgeStatusPath(): string {
  return process.env.RUBICON_GODEL_BRIDGE_STATUS_PATH || DEFAULT_STATUS_PATH;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function parseBodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return { text: body };
    }
  }
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

function bridgeCaptureKind(record: Record<string, unknown>, sourceUrl: string | null): BridgeAlertRow["captureKind"] | null {
  const explicitKind = firstString(record.captureKind, record.capture_kind);
  if (explicitKind === "manual-paste" || sourceUrl?.startsWith("manual-paste:")) {
    return "manual-paste";
  }
  if (explicitKind === "bottom-right-red-alert") {
    return "bottom-right-red-alert";
  }
  return null;
}

function isStoredAlertRow(row: BridgeAlertRow): boolean {
  return (
    typeof row.headline === "string" &&
    (row.captureKind === "bottom-right-red-alert" || row.captureKind === "manual-paste")
  );
}

function classifyBridgeAlertText(text: string): string {
  if (!text) return "empty";
  const compact = text.replace(/\s+/g, "");
  const alphaChars = (compact.match(/[A-Za-z]/g) ?? []).length;
  const alphaWords = text.match(/\b[A-Za-z][A-Za-z'/-]{2,}\b/g) ?? [];
  const numericTokens = text.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  const allTokens = text.match(/\b[\w.]+\b/g) ?? [];
  const priceLikeTokens = text.match(/\b\d{4,5}\.\d{2}\b/g) ?? [];
  if (text.length < 18) return "too-short";
  if (alphaWords.length < 3) return "not-enough-words";
  if (alphaChars / Math.max(compact.length, 1) < 0.22) return "mostly-numeric";
  if (numericTokens.length / Math.max(allTokens.length, 1) > 0.62 || priceLikeTokens.length >= 5) return "market-ladder-like";
  return "ok";
}

function cleanAlertText(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\b(notification|dismiss|close)\b/gi, "").trim().slice(0, 700);
}

function dedupeRows(rows: BridgeAlertRow[]): BridgeAlertRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.headline.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableId(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstString(...value);
      if (nested) return nested;
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}
