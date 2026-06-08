# Rubicon - Detailed Codebase Map

> Full reference for agents and humans. For a fast overview, read [`codebase.md`](codebase.md) first. This file maps routes, modules, scripts, data files, and current rough edges. Last verified against the working tree on 2026-06-03.

## Quick Reference

| Working on | Go to |
|---|---|
| A server endpoint | Section 5.2 routes, then section 5.3 modules |
| A frontend API call | Section 4.4 API client |
| Morning calendar/live updates/heatmap | Sections 4.2, 5.2, 5.3 |
| Daily Pipeline status/run behavior | Sections 4.3, 5.2, 5.3, 8 |
| Trade/replay data loading | Sections 3, 5.4, 7.2 |
| Runtime JSON state | Section 7.1 |
| Scripts and npm commands | Section 8 |

## 1. Overview

- Rubicon is a local-first cockpit for one SPX 0DTE spread trader.
- It imports local AI STUFF trade/market data, shows P/L and position metrics, replays sessions, runs a Morning cockpit, shows an RRG, and serves an FPL per-bar model.
- Morning currently uses a Rubicon-owned SPX macro calendar, RollCall/political rows, FirstSquawk/Godel live updates, native Windows alert paths, IBKR holdings/wallet snapshots, SPX Heatmap, AI notes, TC2000 scanner artifacts, and FPL/speed panels.
- The app is a Vite/React SPA talking to an Express API. It uses JSON/CSV files on disk, not a database.

## 2. Running And Validating

| Command | What it does |
|---|---|
| `npm run dev` | Runs API + Vite client together. Vite proxies `/api` to `http://127.0.0.1:5174`. |
| `npm run build` | Runs `tsc -b` then `vite build`. |
| `npm run serve:app` | Serves the built SPA and API on one port with `tsx server/index.ts`. |
| `npm test` | Runs Vitest. |
| `npm run typecheck` | Runs TypeScript build checks. |
| `npm run validate:mvp` | Runs typecheck, full Vitest, then build. |
| `npm run desktop` / `npm run desktop:install` | Launches or installs the Rubicon desktop app window. |

The compact current validation source is `naive_validation.md`; `VALIDATION.md` is historical/reference detail.

## 3. Architecture At A Glance

```text
Browser (React)
  -> src/api.ts
  -> /api/* on Express server/index.ts
  -> server modules
  -> AI STUFF source data + Rubicon data/*.json
```

Primary tracker path:

`App` -> `fetchTracker()` -> `GET /api/tracker` -> `loadTrackerSnapshot()` -> local daily folders + compact summaries + wallet/review state. The frontend polls this while visible, and the server coalesces/caches immediate tracker reads.

Replay path:

`fetchReplay(date, tradeId?)` -> `GET /api/replay` -> `loadReplayPayload()` -> safe replay state or sidecar-derived chart payload.

Daily Pipeline path:

`Run Daily Pipeline` / `Preflight Pipeline` -> `POST /api/daily-sync/run` -> `server/dailySync.ts` -> AI STUFF PowerShell wrapper. Status reports Data Collection, Rubicon Ingest, Google Upload, review readiness, upload receipt state, lock state, and warning-only TC2000/Qullamaggie sidecar diagnostics.

## 4. Frontend (`src/`)

### 4.1 App Shell

- `main.tsx` mounts `<App />`.
- `App.tsx` owns most app state, polling, navigation, tracker/replay selection, Daily Pull, Daily Review, Journal, and Replay cockpit behavior.
- Top-level portions are Morning, Replay, and Rotation. Replay has inner tabs for Daily Pull, Replay, Daily Review, and Journal.

### 4.2 Components

| Component | Purpose |
|---|---|
| `MorningDashboard.tsx` | Morning cockpit: brief/signal stack, SPX macro/political calendar, live updates, alerts, holdings, heatmap, AI notes, TC2000, FPL. |
| `SpxHeatmapPanel.tsx` | Morning SPX Heatmap UI, including `Start feed` / `Stop feed` backend live feed controls and `Jump to now` view-follow control. |
| `MarketChart.tsx` | Generic replay chart for candles, line, and spread bars. |
| `ReplayCharts.tsx` | Replay panel layout: SPX, selected spread, OI, and volume profile. |
| `ReviewEntryExitChart.tsx` | Daily Review entry/exit chart with P/L overlay. |
| `SpreadSpeedPanel.tsx` | Net-delta rule spread speed panel. |
| `FplIndicatorPanel.tsx` | FPL model chart and live predictor controls. |
| `RrgPanel.tsx` / `RelativeRotationGraph.tsx` | Rotation graph controller and SVG renderer. |

### 4.3 Pure Logic Modules

- Daily pipeline/readiness: `dailySyncDiagnostics.ts`, `dailySyncReadiness.ts`, `dailySyncRunGuard.ts`, `dailySyncRefresh.ts`, `dailyPullChecklist.ts`.
- Morning/live alerts: `morningLiveState.ts`, `liveUpdateFilters.ts`, `liveUpdateDisplay.ts`, `liveUpdateAlerts.ts`, `calendarAlerts.ts`, `morningAutoArm.ts`.
- Replay/review/journal: `stats.ts`, `quickTrades.ts`, `replayDateTabs.ts`, `dailyReviewExport.ts`, `reviewFlags.ts`, `tradeJournal.ts`, `marketFreshness.ts`.
- Rotation and heatmap helpers: `relativeRotation.ts`, `rrgSpline.ts`, `spxTreemap.ts`.
- Utilities: `easternDate.ts`, `format.ts`, `refreshLogic.ts`, `clipboard.ts`, `appRefresh.ts`.

### 4.4 API Client (`src/api.ts`)

| Function | Method + path |
|---|---|
| `fetchTracker` | `GET /api/tracker` |
| `refreshGoogleSnapshot` | `POST /api/google-snapshot/refresh` |
| `refreshIbkrWallet` | `POST /api/ibkr-wallet/refresh` |
| `fetchIbkrHoldings` / `refreshIbkrHoldings` | `GET` / `POST /api/ibkr-holdings[/refresh]` |
| `fetchDailySyncStatus` / `runDailySync` | `GET /api/daily-sync/status`, `POST /api/daily-sync/run` |
| `fetchReplay` | `GET /api/replay?date=...&tradeId=...` |
| `fetchSpreadSpeed` | `GET /api/spread-speed?date=...` |
| `fetchRrgBars` | `GET /api/rrg/bars` |
| `fetchSpxHeatmap` | `GET /api/spx-heatmap` |
| `fetchSpxHeatmapLiveStatus` | `GET /api/spx-heatmap/live/status` |
| `startSpxHeatmapLive` / `stopSpxHeatmapLive` | `POST /api/spx-heatmap/live/start`, `POST /api/spx-heatmap/live/stop` |
| `fetchMorningBrief` | `GET /api/morning?date=...` with optional `refresh=1` |
| `fetchMorningLiveUpdates` | `GET /api/morning/live-updates?refresh=...` |
| `fetchGodelAlertBridgeStatus` | `GET /api/godel-alert-bridge/status` |
| `fetchMorningAiNotes` | `GET /api/morning/ai-notes?date=...` |
| `triggerCalendarDesktopAlert` | `POST /api/desktop-alert/calendar` |
| `triggerLiveUpdateDesktopAlert` | `POST /api/desktop-alert/live-update` |
| `saveWallet` | `PUT /api/wallet` |
| `saveReviewNote` | `PUT /api/review-notes/:date` |
| `saveTradeJournalSnapshot` | `PUT /api/journal-snapshot` |
| FPL helpers | `/api/fpl-indicator/*` |

## 5. Backend (`server/`)

### 5.1 Bootstrap

- `server/index.ts` creates the Express app, serves static `dist` when present, and listens on `PORT ?? 5174`.
- `RUBICON_LISTEN_HOST` / `RUBICON_HOST` override the listen host; default is `127.0.0.1`.
- On listen it arms FPL live auto-start, IBKR holdings auto-refresh, SPX Heatmap live auto-start, and daily-sync catch-up.

### 5.2 HTTP Routes

| Method + path | Handler/module |
|---|---|
| `GET /api/health` | inline health payload |
| `GET /api/tracker` | Google snapshot auto-refresh then `loadTrackerSnapshot` |
| `POST /api/google-snapshot/refresh` | `refreshGoogleDriveSnapshot` |
| `POST /api/ibkr-wallet/refresh` | `refreshIbkrWalletSnapshot` then `readWallet` |
| `GET /api/ibkr-holdings` | `readIbkrHoldingsSnapshot` |
| `POST /api/ibkr-holdings/refresh` | `refreshIbkrHoldingsSnapshot` |
| `GET /api/daily-sync/status` | `getDailySyncStatus` |
| `POST /api/daily-sync/run` | `startDailySync` |
| `GET /api/replay` | `loadReplayPayload` |
| `GET /api/spread-speed` | `loadSpreadSpeed` |
| `GET /api/rrg/bars` | `loadRrgBars` |
| `GET /api/spx-heatmap` | `loadSpxHeatmap` |
| `GET /api/spx-heatmap/live/status` | `getSpxHeatmapLiveStatus` |
| `POST /api/spx-heatmap/live/start` | `startSpxHeatmapLive` |
| `POST /api/spx-heatmap/live/stop` | `stopSpxHeatmapLive` |
| `GET /api/morning` | `loadMorningBrief` |
| `GET /api/morning/live-updates` | `loadMorningLiveUpdates` |
| `GET /api/godel-alert-bridge/status` | `getGodelAlertBridgeStatus` |
| `GET /api/godel-alert-bridge/bookmarklet` | bridge bookmarklet HTML/JS |
| `GET /api/godel-alert-bridge/setup` | bridge setup page |
| `OPTIONS /api/godel-alert-bridge/ingest` | CORS preflight for bridge |
| `POST /api/godel-alert-bridge/ingest` | `ingestGodelAlertBridgeText` |
| `GET /api/morning/ai-notes` | `loadMorningAiNotes` |
| `POST /api/desktop-alert/calendar` | `showCalendarDesktopAlert` |
| `POST /api/desktop-alert/live-update` | `showLiveUpdateDesktopToast` |
| `GET /api/tc2000-artifact/:dir/:file` | `resolveTc2000Artifact` |
| `GET /api/fpl-indicator/manifest` | `loadFplManifest` |
| `GET /api/fpl-indicator` | `loadFplIndicator` |
| `GET /api/fpl-indicator/live/status` | `getFplLiveStatus` |
| `POST /api/fpl-indicator/live/start` | `startFplLive` |
| `POST /api/fpl-indicator/live/stop` | `stopFplLive` |
| `PUT /api/wallet` | `writeWallet` |
| `PUT /api/review-notes/:date` | `writeReviewNote` |
| `PUT /api/journal-snapshot` | `writeTradeJournalSnapshot` |

### 5.3 Modules

| Module | Purpose |
|---|---|
| `dataImporter.ts` | Tracker/replay data core, compact tracker snapshot cache/coalescing, wallet/review-note state. |
| `trackerSummary.ts` | Builds and reads compact `rubicon_tracker_summary.json` serving summaries. |
| `morningBrief.ts` | Morning payload assembly, saved-state reads/writes, RollCall, TC2000, live-update cache. |
| `morningMacroCalendar.ts` | Rubicon-owned SPX macro calendar from official/free schedule surfaces plus generated timing rows and DailyFX-style importance ratings. |
| `dailySync.ts` | Daily Pipeline command/status, Data Collection/Rubicon Ingest/Google Upload stage model, lock awareness, derived-state refresh. |
| `dailySyncCatchup.ts` | Startup catch-up status for daily pipeline follow-through. |
| `googleAuth.ts` | Google bearer/auth helpers for write-capable upload flows. |
| `googleSheetsUpload.ts` | Google Drive workbook upload, tracker row updates, and receipt/local summary refresh. |
| `googleSheetsSnapshot.ts` / `googleSnapshotAutoRefresh.ts` | Google tracker snapshot reads and throttled tracker refresh integration. |
| `spxHeatmap.ts` / `spxHeatmapLive.ts` | Heatmap payload loader and live feed child-process management. |
| `desktopAlert.ts` | Calendar + live-update alerts both via the shared `launchWindowsToast` native Windows toast (`show-windows-toast.ps1`, bottom-right / Action Center). |
| `godelAlertBridge.ts` / `godelLiveNews.ts` | Minimized-safe Godel DOM bridge and Godel live-news capture parsing. |
| `fplLive.ts` / `fplIndicator.ts` | FPL live predictor process and per-bar prediction payloads. |
| `ibkrHoldings.ts` / `ibkrWalletRefresh.ts` | Read/refresh IBKR holdings and wallet snapshots via Python/TWS. |
| `rrgBars.ts` / `spreadSpeed.ts` | Rotation bars and sidecar-only spread-speed state. |
| `morningAiNotes.ts` / `tradeJournalSnapshot.ts` | AI notes payload and journal snapshot persistence. |

### 5.4 Core Data Loaders

- `loadTrackerSnapshot()` returns the dashboard snapshot and uses compact daily summaries where available.
- `loadReplayPayload(date, tradeId?)` returns replay data, preferring per-date safe replay state by default.
- `loadSpreadSpeed(date)` returns sidecar-only spread speed state and avoids reopening giant upload payloads.
- `loadMorningBrief(date, appRoot, { refresh? })` reads saved Morning state on normal loads and refreshes live sources only when requested or scheduled.

## 6. Shared Types (`shared/types.ts`)

Key families: trades, daily summaries, tracker snapshots, replay payloads, wallet/review notes, Morning calendar/live-update/AI/heatmap payloads, daily pipeline stages/status/locks, Google upload/receipt results, FPL, RRG, and desktop alert results. The trade-journal entry type lives in `src/tradeJournal.ts`.

## 7. Data And Files On Disk

### 7.1 Rubicon `data/`

| File/folder | Owner |
|---|---|
| `wallet.json`, `review-notes.json` | `dataImporter.ts` |
| `trade-journal.json` | `tradeJournalSnapshot.ts`, `morningAiNotes.ts` |
| `daily-sync-status.json`, `daily-sync-launch.log` | `dailySync.ts` |
| `google-drive-tracker-snapshot.json`, `google-drive-receipt-checks.json` | Google snapshot/upload paths and importer |
| `morning-brief-state/YYYY-MM-DD.json` | `morningBrief.ts` saved Morning state |
| `morning-live-updates-cache.json` | Morning live-update fallback cache |
| `godel-live-news.json`, Godel bridge status files | Godel capture/bridge paths |
| `spx-heatmap.json` | `refresh-spx-heatmap.py`, `spxHeatmap.ts` |
| `tc2000-daily-bars.json` | `refresh-tc2000-daily-bars.py`, Morning/RRG |
| `fpl-live.log`, `desktop-launcher.log` | FPL live and desktop launcher |

### 7.2 AI STUFF Source Data

`IBKR_TRADES_ROOT = <AI_STUFF_ROOT>/IBKR Equity History Pull/data/ibkr_trades`.

Per trading date, loaders expect files such as `entries.csv`, `daily_sync_summary.json`, `google_sheet_tab_csvs/*`, `spx_daily_upload_<date>.xlsx`, `rubicon_tracker_summary.json`, `rubicon_replay_safe_state.json`, and `rubicon_spread_speed_state.json`.

## 8. Scripts

| File | Purpose | npm script |
|---|---|---|
| `launch-desktop.mjs` | Build/check/start API and open app window. | `desktop` |
| `install-desktop-shortcut.mjs` | Install `Rubicon.lnk`. | `desktop:install` |
| `refresh-google-drive-snapshot.ts` | Read tracker snapshot from Google Sheets API. | `google:snapshot` |
| `upload-spx-google-pipeline.ts` | Upload raw workbook and update tracker receipt rows. | `google:upload` |
| `rubicon-ingest-daily.ts` | Refresh Rubicon local summaries and safe state from daily archive output. | `rubicon:ingest` |
| `refresh-spx-heatmap.py` | Build SPX Heatmap from sample, Yahoo, disk, or IBKR live feed; live mode does an initial Yahoo backfill unless disabled. | `spx:heatmap` |
| `refresh-ibkr-holdings-snapshot.py` | Read-only holdings/greeks/earnings snapshot. | `ibkr:holdings` |
| `refresh-ibkr-wallet-snapshot.py` | Read-only account `NetLiquidation` snapshot. | `ibkr:wallet` |
| `refresh-tc2000-daily-bars.py` | TC2000 scanner/daily bars for Morning/RRG. | `tc2000:daily-bars` |
| `capture-godel-news.mjs`, `scrape-godel-news.mjs` | Godel staged source helpers. | `godel:capture`, `godel:scrape` |
| `show-windows-toast.ps1` | Native Windows toast helper for calendar + live-update alerts (bottom-right / Action Center). | called by API |

## 9. Conventions

- Keep pure logic in `.ts` modules with co-located `*.test.ts`.
- Use `src/easternDate.ts` for Eastern date keys/time math.
- Keep `src/api.ts` as the single frontend `/api/*` caller.
- Prefer compact sidecar/safe-state files on dashboard paths; load row-level market data only for explicit replay/review/debug paths.

## 10. Rough Edges And Gotchas

- Large files remain: `App.tsx`, `dataImporter.ts`, `MorningDashboard.tsx`, and `shared/types.ts`.
- `MarketChart` and `ReviewEntryExitChart` still have chart lifecycle churn; `FplIndicatorPanel` is the create-once reference.
- JSON writes use shared helpers, but concurrent semantic overwrite risks remain in a few state files.
- Hidden replay dates live in `src/replayDateTabs.ts`.
- `DailyPnlSimulatorChart.tsx` and `morningDiary.ts` are tested but not on the live render path.

## 11. Testing

- `npm run validate:mvp` remains the standard app gate.
- For documentation-only work, use targeted `rg` checks plus `git diff --check`.
