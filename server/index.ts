// New to this codebase? Read codebase.md at the repo root first — it maps the whole project.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { invalidateTrackerSnapshotCache, loadReplayPayload, loadTrackerSnapshot, readWallet, writeReviewNote, writeWallet } from "./dataImporter.ts";
import { loadFplIndicator, loadFplManifest } from "./fplIndicator.ts";
import { armFplLiveAutoStart, getFplLiveStatus, startFplLive, stopFplLive } from "./fplLive.ts";
import { refreshGoogleDriveSnapshot } from "../scripts/refresh-google-drive-snapshot.ts";
import { refreshIbkrWalletSnapshot } from "./ibkrWalletRefresh.ts";
import { armIbkrHoldingsAutoRefresh, readIbkrHoldingsSnapshot, refreshIbkrHoldingsSnapshot } from "./ibkrHoldings.ts";
import { getDailySyncStatus, startDailySync } from "./dailySync.ts";
import { maybeAutoRefreshGoogleDriveSnapshot } from "./googleSnapshotAutoRefresh.ts";
import { loadSpreadSpeed } from "./spreadSpeed.ts";
import { loadRrgBars } from "./rrgBars.ts";
import { loadSpxHeatmap } from "./spxHeatmap.ts";
import { armSpxHeatmapLiveAutoStart, getSpxHeatmapLiveStatus, startSpxHeatmapLive, stopSpxHeatmapLive } from "./spxHeatmapLive.ts";
import { loadMorningBrief, loadMorningLiveUpdates, resolveTc2000Artifact } from "./morningBrief.ts";
import { loadMorningAiNotes } from "./morningAiNotes.ts";
import { writeTradeJournalSnapshot } from "./tradeJournalSnapshot.ts";
import { showCalendarDesktopAlert } from "./desktopAlert.ts";
import {
  getGodelAlertBridgeStatus,
  godelBridgeBookmarklet,
  godelBridgeSetupHtml,
  authorizeGodelBridgeRequest,
  ingestGodelBridgeAlert,
  isGodelBridgeOriginAllowed,
  setGodelBridgeCorsHeaders,
} from "./godelAlertBridge.ts";

export const app = express();
const port = Number(process.env.PORT ?? 5174);
const currentFilePath = fileURLToPath(import.meta.url);
const serverDir = path.dirname(currentFilePath);
const appRoot = path.resolve(serverDir, "..");
const distDir = path.join(appRoot, "dist");
const distIndex = path.join(distDir, "index.html");
const serverStartedAt = new Date().toISOString();

export function resolveRubiconListenHost(env: Record<string, string | undefined> = process.env): string {
  return String(env.RUBICON_LISTEN_HOST ?? env.RUBICON_HOST ?? "").trim() || "127.0.0.1";
}

export function formatListenUrl(host: string, listenPort: number): string {
  const displayHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${displayHost}:${listenPort}`;
}

export function fullReplayEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.RUBICON_ENABLE_FULL_REPLAY ?? "").trim() === "1";
}

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    app: "rubicon",
    appRoot,
    generatedAt: new Date().toISOString(),
    pid: process.pid,
    startedAt: serverStartedAt,
  });
});

app.get("/api/tracker", async (_request, response, next) => {
  try {
    const googleAutoRefreshStatus = await maybeAutoRefreshGoogleDriveSnapshot();
    response.json(await loadTrackerSnapshot({ googleAutoRefreshStatus }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/google-snapshot/refresh", async (_request, response) => {
  try {
    const outPath = await refreshGoogleDriveSnapshot();
    invalidateTrackerSnapshotCache();
    response.json({
      ok: true,
      message: `Refreshed Google tracker snapshot at ${outPath}.`,
      outPath,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message.includes("No Google Sheets credential configured") ? 409 : 502).json({
      ok: false,
      message,
      generatedAt: new Date().toISOString(),
    });
  }
});

app.post("/api/ibkr-wallet/refresh", async (_request, response) => {
  try {
    const refreshed = await refreshIbkrWalletSnapshot();
    invalidateTrackerSnapshotCache();
    const wallet = await readWallet();
    response.json({
      ok: true,
      message: `Refreshed IBKR wallet from read-only TWS/Gateway API${refreshed.port ? ` on port ${refreshed.port}` : ""}.`,
      wallet,
      outPath: refreshed.outPath,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message.includes("Could not refresh IBKR wallet") ? 409 : 502).json({
      ok: false,
      message,
      generatedAt: new Date().toISOString(),
    });
  }
});

app.get("/api/ibkr-holdings", async (_request, response, next) => {
  try {
    response.json(await readIbkrHoldingsSnapshot());
  } catch (error) {
    next(error);
  }
});

app.post("/api/ibkr-holdings/refresh", async (_request, response) => {
  try {
    const refreshed = await refreshIbkrHoldingsSnapshot();
    invalidateTrackerSnapshotCache();
    response.json({
      ok: true,
      message: `Refreshed IBKR live holdings${refreshed.port ? ` from port ${refreshed.port}` : ""}.`,
      snapshot: await readIbkrHoldingsSnapshot(),
      outPath: refreshed.outPath,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(message.includes("Could not refresh IBKR holdings") ? 409 : 502).json({
      ok: false,
      message,
      generatedAt: new Date().toISOString(),
    });
  }
});

app.get("/api/daily-sync/status", async (_request, response, next) => {
  try {
    response.json(await getDailySyncStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/daily-sync/run", async (request, response) => {
  try {
    const date = request.body?.date ? String(request.body.date) : "auto";
    const dryRun = Boolean(request.body?.dryRun);
    const result = await startDailySync({ date, dryRun });
    response.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(400).json({
      ok: false,
      state: "failed",
      message,
      generatedAt: new Date().toISOString(),
    });
  }
});

app.get("/api/replay", async (request, response, next) => {
  try {
    const date = String(request.query.date ?? "");
    const tradeId = request.query.tradeId ? String(request.query.tradeId) : undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      response.status(400).json({ error: "date query must be YYYY-MM-DD" });
      return;
    }
    const requestedFullReplay = String(request.query.full ?? "") === "1";
    if (requestedFullReplay && !fullReplayEnabled()) {
      response.status(403).json({
        error: "Full replay payloads are disabled by default. Set RUBICON_ENABLE_FULL_REPLAY=1 to enable raw-detail audit mode.",
      });
      return;
    }
    response.json(
      await loadReplayPayload(date, tradeId, {
        mode: requestedFullReplay ? "full" : "safe",
        refreshSafeState: String(request.query.refresh ?? "") === "1",
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/spread-speed", async (request, response, next) => {
  try {
    const date = String(request.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      response.status(400).json({ error: "date query must be YYYY-MM-DD" });
      return;
    }
    response.json(
      await loadSpreadSpeed(date, {
        refreshSafeState: String(request.query.refresh ?? "") === "1",
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/rrg/bars", async (_request, response, next) => {
  try {
    response.json(await loadRrgBars(appRoot));
  } catch (error) {
    next(error);
  }
});

app.get("/api/spx-heatmap", async (_request, response, next) => {
  try {
    response.json(await loadSpxHeatmap(appRoot));
  } catch (error) {
    next(error);
  }
});

app.get("/api/spx-heatmap/live/status", async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(await getSpxHeatmapLiveStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/spx-heatmap/live/start", async (request, response, next) => {
  try {
    const clientId = request.body?.clientId ? Number(request.body.clientId) : undefined;
    const ports = request.body?.ports ? String(request.body.ports) : undefined;
    response.json(await startSpxHeatmapLive({ clientId, ports }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/spx-heatmap/live/stop", async (_request, response, next) => {
  try {
    response.json(await stopSpxHeatmapLive());
  } catch (error) {
    next(error);
  }
});

app.get("/api/morning", async (request, response, next) => {
  try {
    const date = String(request.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      response.status(400).json({ error: "date query must be YYYY-MM-DD" });
      return;
    }
    const refresh = ["1", "true", "yes"].includes(String(request.query.refresh ?? "").toLowerCase());
    if (refresh) {
      response.setHeader("Cache-Control", "no-store, max-age=0");
    }
    response.json(await loadMorningBrief(date, appRoot, { refresh }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/morning/live-updates", async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(await loadMorningLiveUpdates());
  } catch (error) {
    next(error);
  }
});

app.get("/api/godel-alert-bridge/status", async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(await getGodelAlertBridgeStatus());
  } catch (error) {
    next(error);
  }
});

app.get("/api/godel-alert-bridge/bookmarklet", (_request, response) => {
  response.type("text/plain").send(godelBridgeBookmarklet());
});

app.get("/api/godel-alert-bridge/setup", (_request, response) => {
  response.type("html").send(godelBridgeSetupHtml());
});

app.options("/api/godel-alert-bridge/ingest", (request, response) => {
  const origin = firstHeader(request.headers.origin);
  setGodelBridgeCorsHeaders(origin, response);
  if (origin && !isGodelBridgeOriginAllowed(origin)) {
    response.status(403).json({
      generatedAt: new Date().toISOString(),
      message: "Godel bridge origin is not allowed.",
      ok: false,
    });
    return;
  }
  response.sendStatus(204);
});

app.post("/api/godel-alert-bridge/ingest", express.text({ type: "text/plain" }), async (request, response, next) => {
  try {
    const origin = firstHeader(request.headers.origin);
    setGodelBridgeCorsHeaders(origin, response);
    const authorization = authorizeGodelBridgeRequest({
      body: request.body,
      origin,
      queryToken: firstQueryValue(request.query.bridgeToken),
      token: firstHeader(request.headers["x-rubicon-bridge-token"]),
    });
    if (!authorization.ok) {
      response.status(authorization.status).json({
        generatedAt: new Date().toISOString(),
        message: authorization.message,
        ok: false,
      });
      return;
    }
    response.json(await ingestGodelBridgeAlert(request.body));
  } catch (error) {
    next(error);
  }
});

app.get("/api/morning/ai-notes", async (request, response, next) => {
  try {
    const date = String(request.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      response.status(400).json({ error: "date query must be YYYY-MM-DD" });
      return;
    }
    response.json(await loadMorningAiNotes(date));
  } catch (error) {
    next(error);
  }
});

app.post("/api/desktop-alert/calendar", (request, response) => {
  try {
    response.json(
      showCalendarDesktopAlert(
        {
          body: request.body?.body,
          detail: request.body?.detail,
          title: request.body?.title,
        },
        appRoot,
      ),
    );
  } catch (error) {
    response.status(400).json({
      generatedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    });
  }
});

app.get("/api/tc2000-artifact/:dir/:file", (request, response, next) => {
  try {
    response.sendFile(resolveTc2000Artifact(request.params.dir, request.params.file, appRoot));
  } catch (error) {
    next(error);
  }
});

app.get("/api/fpl-indicator/manifest", async (_request, response, next) => {
  try {
    response.json(await loadFplManifest());
  } catch (error) {
    next(error);
  }
});

app.get("/api/fpl-indicator", async (request, response, next) => {
  try {
    const date = String(request.query.date ?? "");
    const live = String(request.query.live ?? "false") === "true";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      response.status(400).json({ error: "date query must be YYYY-MM-DD" });
      return;
    }
    response.json(await loadFplIndicator(date, live));
  } catch (error) {
    next(error);
  }
});

app.get("/api/fpl-indicator/live/status", async (_request, response, next) => {
  try {
    response.json(await getFplLiveStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/fpl-indicator/live/start", async (request, response, next) => {
  try {
    const port = request.body?.port ? Number(request.body.port) : undefined;
    const clientId = request.body?.clientId ? Number(request.body.clientId) : undefined;
    response.json(await startFplLive({ port, clientId }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/fpl-indicator/live/stop", async (_request, response, next) => {
  try {
    response.json(await stopFplLive());
  } catch (error) {
    next(error);
  }
});

app.put("/api/wallet", async (request, response, next) => {
  try {
    const netLiquidation = Number(request.body?.netLiquidation);
    const account = request.body?.account ? String(request.body.account) : undefined;
    if (!Number.isFinite(netLiquidation) || netLiquidation < 0) {
      response.status(400).json({ error: "netLiquidation must be a positive number" });
      return;
    }
    response.json(await writeWallet(netLiquidation, account));
  } catch (error) {
    next(error);
  }
});

app.put("/api/review-notes/:date", async (request, response, next) => {
  try {
    const date = String(request.params.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      response.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    response.json(await writeReviewNote(date, String(request.body?.note ?? ""), request.body?.tradeFlags));
  } catch (error) {
    next(error);
  }
});

app.put("/api/journal-snapshot", async (request, response, next) => {
  try {
    response.json(await writeTradeJournalSnapshot(request.body?.entries ?? request.body));
  } catch (error) {
    next(error);
  }
});

if (fs.existsSync(distIndex)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api).*/, (_request, response) => {
    response.sendFile(distIndex);
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({
    error: error instanceof Error ? error.message : "Unknown server error",
  });
});

export function startRubiconServer(): ReturnType<typeof app.listen> {
  const listenHost = resolveRubiconListenHost();
  return app.listen(port, listenHost, () => {
    console.log(`Rubicon API listening on ${formatListenUrl(listenHost, port)}`);
    armFplLiveAutoStart();
    armIbkrHoldingsAutoRefresh();
    armSpxHeatmapLiveAutoStart();
  });
}

function isDirectRun(): boolean {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && path.resolve(entryPoint) === currentFilePath);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.find((item) => item.trim());
  }
  return value?.trim() || undefined;
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).find(Boolean);
  }
  const text = String(value ?? "").trim();
  return text || undefined;
}

if (isDirectRun()) {
  startRubiconServer();
}
