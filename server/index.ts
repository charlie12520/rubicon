// New to this codebase? Read codebase.md at the repo root first — it maps the whole project.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import express from "express";
import { invalidateTrackerSnapshotCache, loadReplayPayload, loadTrackerSnapshot, readWallet, writeReviewNote, writeWallet } from "./dataImporter.ts";
import { loadFplIndicator, loadFplManifest } from "./fplIndicator.ts";
import { armFplLiveAutoStart, getFplLiveStatus, startFplLive, stopFplLive } from "./fplLive.ts";
import { refreshGoogleDriveSnapshot } from "../scripts/refresh-google-drive-snapshot.ts";
import { refreshIbkrWalletSnapshot } from "./ibkrWalletRefresh.ts";
import { armIbkrHoldingsAutoRefresh, readIbkrHoldingsSnapshot, refreshIbkrHoldingsSnapshot } from "./ibkrHoldings.ts";
import { getDailySyncStatus, startDailyOptionPull, startDailySync } from "./dailySync.ts";
import { armDailySyncAutoRun, getDailySyncAutoRunStatus } from "./dailySyncAutoRun.ts";
import { getAppVersionStatus, runAppUpdate } from "./selfUpdate.ts";
import { getDailySyncCatchupStatus, maybeRunDailySyncCatchup } from "./dailySyncCatchup.ts";
import { maybeAutoRefreshGoogleDriveSnapshot } from "./googleSnapshotAutoRefresh.ts";
import { loadSpreadSpeed, loadSpreadSpeedWithFallback } from "./spreadSpeed.ts";
import {
  armSpreadSpeedLiveAutoStart,
  getSpreadSpeedLiveStatus,
  loadLiveSpreadSpeed,
  startSpreadSpeedLive,
  stopSpreadSpeedLive,
} from "./spreadSpeedLive.ts";
import { loadSpxMaContext } from "./spxMaContext.ts";
import { loadRrgBars } from "./rrgBars.ts";
import { loadSpxHeatmap, loadQqqHeatmap } from "./spxHeatmap.ts";
import { armSpxHeatmapLiveAutoStart, getSpxHeatmapLiveStatus, startSpxHeatmapLive, stopSpxHeatmapLive } from "./spxHeatmapLive.ts";
import { armSpxLiveBarsAutoStart, getSpxLiveBarsStatus, loadSpxLiveBars, startSpxLiveBars, stopSpxLiveBars } from "./spxLiveBars.ts";
import { armIndexReconcileAutoRun } from "./indexReconcile.ts";
import { loadMorningBrief, loadMorningLiveUpdates, resolveTc2000Artifact } from "./morningBrief.ts";
import { loadMorningAiNotes } from "./morningAiNotes.ts";
import { mergeTradeJournalSnapshot } from "./tradeJournalSnapshot.ts";
import { showCalendarDesktopAlert, showLiveUpdateDesktopToast } from "./desktopAlert.ts";

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

app.get("/api/app-version", async (request, response, next) => {
  try {
    const refresh = String(request.query.refresh ?? "1") !== "0";
    response.json(await getAppVersionStatus({ refresh }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/app-update", async (request, response) => {
  try {
    const force = Boolean(request.body?.force);
    const result = await runAppUpdate({ force });
    response.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response.status(400).json({ ok: false, message, generatedAt: new Date().toISOString() });
  }
});

app.get("/api/tracker", async (_request, response, next) => {
  try {
    const catchupStatus = await maybeRunDailySyncCatchup();
    if (catchupStatus.refreshedDates.length) {
      invalidateTrackerSnapshotCache();
    }
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
    const status = await getDailySyncStatus();
    response.json({
      ...status,
      autoRun: getDailySyncAutoRunStatus(),
      catchup: getDailySyncCatchupStatus(),
    });
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

app.post("/api/daily-sync/options/run", async (request, response) => {
  try {
    const date = String(request.body?.date ?? "");
    const scope = String(request.body?.scope ?? "failed-or-missing");
    if (scope !== "failed-or-missing") {
      response.status(400).json({
        ok: false,
        state: "failed",
        message: "Manual option retry only supports failed-or-missing scope.",
        generatedAt: new Date().toISOString(),
      });
      return;
    }
    const result = await startDailyOptionPull({ date, scope: "failed-or-missing" });
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
    const refreshSafeState = String(request.query.refresh ?? "") === "1";
    const payload =
      String(request.query.fallback ?? "") === "1"
        ? await loadSpreadSpeedWithFallback(date, { refreshSafeState })
        : await loadSpreadSpeed(date, { refreshSafeState });
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/spread-speed/live", async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(await loadLiveSpreadSpeed(appRoot));
  } catch (error) {
    next(error);
  }
});

app.get("/api/spread-speed/live/status", async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(await getSpreadSpeedLiveStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/spread-speed/live/start", async (request, response, next) => {
  try {
    const clientId = request.body?.clientId ? Number(request.body.clientId) : undefined;
    const ports = request.body?.ports ? String(request.body.ports) : undefined;
    response.json(await startSpreadSpeedLive({ clientId, ports }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/spread-speed/live/stop", async (_request, response, next) => {
  try {
    response.json(await stopSpreadSpeedLive());
  } catch (error) {
    next(error);
  }
});

app.get("/api/spx-ma-context", async (request, response, next) => {
  try {
    const date = String(request.query.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      response.status(400).json({ error: "date query must be YYYY-MM-DD" });
      return;
    }
    response.json(await loadSpxMaContext(date));
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

app.get("/api/rrg/sectors", async (_request, response, next) => {
  try {
    response.json(await loadRrgBars(appRoot, "sector-rrg-bars.json"));
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

// QQQ (Nasdaq-100) heatmap — same payload shape as SPX, projected onto the QQQ
// universe + weights by the SAME large-cap feed process (one IBKR pull writes both
// files), so the live controls proxy to the shared spxHeatmapLive manager.
app.get("/api/qqq-heatmap", async (_request, response, next) => {
  try {
    response.json(await loadQqqHeatmap(appRoot));
  } catch (error) {
    next(error);
  }
});

app.get("/api/qqq-heatmap/live/status", async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(await getSpxHeatmapLiveStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/qqq-heatmap/live/start", async (request, response, next) => {
  try {
    const clientId = request.body?.clientId ? Number(request.body.clientId) : undefined;
    const ports = request.body?.ports ? String(request.body.ports) : undefined;
    response.json(await startSpxHeatmapLive({ clientId, ports }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/qqq-heatmap/live/stop", async (_request, response, next) => {
  try {
    response.json(await stopSpxHeatmapLive());
  } catch (error) {
    next(error);
  }
});

app.get("/api/spx-live-bars", async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(await loadSpxLiveBars(appRoot));
  } catch (error) {
    next(error);
  }
});

app.get("/api/spx-live-bars/live/status", async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.json(await getSpxLiveBarsStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/spx-live-bars/live/start", async (request, response, next) => {
  try {
    const clientId = request.body?.clientId ? Number(request.body.clientId) : undefined;
    const ports = request.body?.ports ? String(request.body.ports) : undefined;
    response.json(await startSpxLiveBars({ clientId, ports }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/spx-live-bars/live/stop", async (_request, response, next) => {
  try {
    response.json(await stopSpxLiveBars());
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

app.post("/api/desktop-alert/live-update", (request, response) => {
  try {
    response.json(
      showLiveUpdateDesktopToast(
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
    // Merge (not replace): a stale tab or another browser profile must not
    // clobber entries it never loaded.
    response.json(await mergeTradeJournalSnapshot(request.body?.entries ?? request.body));
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
  const server = app.listen(port, listenHost, () => {
    console.log(`Rubicon API listening on ${formatListenUrl(listenHost, port)}`);
    armFplLiveAutoStart();
    armIbkrHoldingsAutoRefresh();
    armSpxHeatmapLiveAutoStart();
    armSpxLiveBarsAutoStart();
    armSpreadSpeedLiveAutoStart();
    armIndexReconcileAutoRun();
    armDailySyncAutoRun();
    void maybeRunDailySyncCatchup().then((status) => {
      if (status.refreshedDates.length) {
        invalidateTrackerSnapshotCache();
      }
    });
  });
  // Single-instance guard (backstop): if another Rubicon grabs the port in the
  // race between the pre-bind probe (see entry point below) and this listen,
  // bow out cleanly (exit 0) instead of crashing or drifting to another port.
  // NOTE: Express 5 fires the listen() success callback even on a failed bind,
  // so the PRIMARY protection is the probe — not this handler. See the
  // launch-conflicts notes.
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.warn(
        `Rubicon already running on ${formatListenUrl(listenHost, port)}; this instance is exiting (single-instance guard).`,
      );
      process.exit(0);
    }
    console.error("Rubicon server failed to start:", error);
    process.exit(1);
  });
  return server;
}

function isDirectRun(): boolean {
  const entryPoint = process.argv[1];
  return Boolean(entryPoint && path.resolve(entryPoint) === currentFilePath);
}

function isPortInUse(host: string, candidatePort: number, timeoutMs = 1500): Promise<boolean> {
  // Pre-bind probe: resolves true if something is already listening on the
  // port. We must check BEFORE app.listen(), because Express 5 invokes the
  // listen success callback (which arms the live-data schedulers) even when the
  // bind ultimately fails with EADDRINUSE. Probing first means a duplicate
  // launch exits without ever arming IBKR feeds or touching data/*.json.
  const probeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const settle = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
    socket.connect(candidatePort, probeHost);
  });
}

if (isDirectRun()) {
  const listenHost = resolveRubiconListenHost();
  void isPortInUse(listenHost, port).then((inUse) => {
    if (inUse) {
      console.warn(
        `Rubicon already running on ${formatListenUrl(listenHost, port)}; not starting a second instance (single-instance guard).`,
      );
      process.exit(0);
    }
    startRubiconServer();
  });
}
