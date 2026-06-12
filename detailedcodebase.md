# Rubicon - Detailed Codebase Map

> Full reference for agents and humans. For a fast overview, read [`codebase.md`](codebase.md) first. This file maps routes, modules, scripts, data files, and current rough edges. Last verified against the working tree on 2026-06-12.

## Quick Reference

| Working on | Go to |
|---|---|
| Claiming or merging multi-agent work | `TASKS.md`, then `AGENTS.md` sections 2-3 |
| A server endpoint | Section 5.2 routes, then section 5.3 modules |
| A frontend API call | Section 4.4 API client |
| Morning calendar/live updates/heatmap | Sections 4.2, 5.2, 5.3 |
| Morning > Estimator (cone / live spreads / theta) | Sections 4.2, 4.3 (Estimator subsystem) |
| Daily Pipeline status/run behavior | Sections 4.3, 5.2, 5.3, 8 |
| In-app self-update / "Latest" button | Sections 4.2, 5.2, 5.3 (selfUpdate) |
| Godel news capture | Section 8 (scraper + watcher), 5.3 (godelLiveNews) |
| Trade/replay data loading | Sections 3, 5.4, 7.2 |
| Runtime JSON state | Section 7.1 |
| Scripts and npm commands | Section 8 |

## 1. Overview

- Rubicon is a local-first cockpit for one SPX 0DTE spread trader.
- It imports local AI STUFF trade/market data, shows P/L and position metrics, replays sessions, runs a Morning cockpit, shows an RRG, and serves an FPL per-bar model.
- Morning currently uses a Rubicon-owned SPX macro calendar, RollCall/political rows, FirstSquawk/Godel live updates, native Windows alert paths, IBKR holdings/wallet snapshots, SPX + QQQ Heatmaps, AI notes, TC2000 scanner artifacts, an **Estimator** (live 0DTE spread response + expected-move cone + theta/speed curve), and FPL/speed panels.
- The header carries a guarded **self-updater** (pull/rebuild/relaunch off `origin/main`).
- The app is a Vite/React SPA talking to an Express API. It uses JSON/CSV files on disk, not a database.

## 2. Running And Validating

| Command | What it does |
|---|---|
| `npm run dev` | Runs API + Vite client together. Vite proxies `/api` to `http://127.0.0.1:5174`. |
| `npm run build` | Runs `tsc -b` then `vite build`. |
| `npm run serve:app` | Serves the built SPA and API on one port with `tsx server/index.ts`. |
| `npm test` | Runs Vitest (`vitest run`). |
| `npm run typecheck` | Runs TypeScript build checks (`tsc -b`). |
| `npm run lint` | Runs `eslint .` (zero-tolerance; also gated in CI). |
| `npm run validate:mvp` | Runs typecheck → lint → test → build (the full gate). |
| `npm run desktop` / `npm run desktop:install` | Launches or installs the Rubicon desktop app window. |

The active multi-agent board is `TASKS.md`. Section agents record task validation there; final
merged proof goes in `naive_validation.md`. `archive/VALIDATION.md` is historical/reference detail.
CI (`.github/workflows/ci.yml`, `windows-latest`) runs typecheck/lint/test on push to main + PRs.

## 3. Architecture At A Glance

```text
Browser (React)
  -> src/api.ts
  -> /api/* on Express server/index.ts
  -> server modules
  -> AI STUFF source data + Rubicon data/*.json
  -> Python/ib_insync refresh jobs (holdings, heatmap, live bars, 0DTE chain, RRG, TC2000)
```

Primary tracker path:

`App` -> `fetchTracker()` -> `GET /api/tracker` -> `loadTrackerSnapshot()` -> local daily folders + compact summaries + wallet/review state. The frontend polls this while visible, and the server coalesces/caches immediate tracker reads.

Replay path:

`fetchReplay(date, tradeId?)` -> `GET /api/replay` -> `loadReplayPayload()` -> safe replay state or sidecar-derived chart payload.

Daily Pipeline path:

`Run Daily Pipeline` / `Preflight Pipeline` -> `POST /api/daily-sync/run` -> `server/dailySync.ts` -> AI STUFF PowerShell wrapper. Status reports Data Collection, Rubicon Ingest, Google Upload, review readiness, upload receipt state, lock state, and warning-only TC2000/Qullamaggie sidecar diagnostics.

Live market feeds (each a guarded child process, market-hours-gated, started from the open window): SPX/QQQ Heatmap (`spxHeatmapLive`), spread-speed 0DTE chain (`spreadSpeedLive`), SPX live bars (`spxLiveBars`), FPL (`fplLive`). The Godel news scraper runs as a separate logon-launched process, not a server child.

## 4. Frontend (`src/`)

### 4.1 App Shell

- `main.tsx` mounts `<App />` inside `AppErrorBoundary`.
- `App.tsx` owns most app state, polling, navigation, tracker/replay selection, Daily Pull, Daily Review, Journal, and Replay cockpit behavior.
- Top-level portions are Morning, Replay, and Rotation. Replay has inner tabs for Daily Pull, Replay, Daily Review, and Journal. Morning has inner screens: Brief, Signal Stack, Estimator, Heatmap.

### 4.2 Components

| Component | Purpose |
|---|---|
| `AppErrorBoundary.tsx` | Class error boundary around `<App/>`; recoverable crash screen (Reload / clear saved UI state). |
| `AppUpdateButton.tsx` | Header "Latest" button: version check, then bundle refresh or server self-update + poll-until-restarted hard refresh. |
| `MorningDashboard.tsx` | Morning cockpit: brief/signal stack, SPX macro/political calendar, live updates, alerts, holdings, heatmap, AI notes, TC2000, FPL, Estimator host. |
| `SpxHeatmapPanel.tsx` | Morning SPX/QQQ Heatmap UI, incl. `Start feed` / `Stop feed` backend live feed and `Jump to now` view-follow controls; sector→industry→stock treemap. |
| `LiveSpreadEstimatorPanel.tsx` | Estimator headline: aggregates open live 0DTE spreads into a portfolio response curve + cone + theta/speed curve + live-SPX feed controls. |
| `SpreadResponsePanel.tsx` | Manual single-spread what-if (collapsed, secondary): seed side/strike/width/credit → cost-to-close curve at a target level. |
| `EstimatorSpxChart.tsx` | SPX candles with Target/spot price lines + forward expected-move cone overlay (updated in place). |
| `ThetaSpeedCurvePanel.tsx` | SVG of the U-shaped theta/speed edge-ratio curve across strikes, current spreads dotted on. |
| `MarketChart.tsx` | Generic replay chart for candles, line, and spread bars; full + compact marker modes. |
| `ReplayCharts.tsx` | Replay panel layout: SPX, selected spread, OI, and volume profile (+ per-chart enlarge/theater mode). |
| `ReviewEntryExitChart.tsx` | Daily Review entry/exit chart with P/L overlay. |
| `DailyPnlSimulatorChart.tsx` | SVG total-vs-realized intraday P/L reconstruction (tested; not on the live render path). |
| `SpreadSpeedPanel.tsx` | Net-delta rule spread-speed panel (Signal Stack). |
| `FplIndicatorPanel.tsx` | FPL model chart and live predictor controls. |
| `RrgPanel.tsx` / `RelativeRotationGraph.tsx` | Rotation graph controller and SVG renderer. |
| Chart helpers | `lightweightChartHelpers.ts` (shared theming + candle mappers), `marketChartMarkers.ts` (arrow/MA geometry), `replayChartsData.ts` (replay data prep), `reviewEntryExitChartLogic.ts` (review marker model). |

### 4.3 Pure Logic Modules

- **Estimator subsystem:** `expectedMoveCone.ts` (Phase-5 calibrated intraday cone: non-linear variance accrual × implied/prior scale × per-side multipliers), `spreadEstimator.ts` (pair IBKR legs into live 0DTE SPX verticals), `spreadResponse.ts` (self-calibrated Bachelier vertical model), `portfolioResponse.ts` (sum live spreads on a shared SPX ladder → aggregate P/L curve), `thetaSpeedCurve.ts` (decay-per-hour ÷ $-at-risk edge curve), `sigmaMove.ts` (% → IV-implied σ), `estimatorClock.ts` (ET minutes-to-close), `estimatorLiveState.ts` (LIVE/STALE/PRE_MARKET/CLOSED pill phase), `useSpxMaContext.ts` (hook: cached MA-warmup context per date).
- **Daily pipeline/readiness:** `dailySyncDiagnostics.ts`, `dailySyncReadiness.ts`, `dailySyncRunGuard.ts`, `dailySyncRefresh.ts`, `dailySyncProgress.ts`, `dailyPullChecklist.ts`, `dailyPullReviewModel.ts`, `dateIssueBadges.ts`, `uploadReceiptCheck.ts`.
- **Morning/live alerts:** `morningLiveState.ts`, `morningDiary.ts`, `liveUpdateFilters.ts`, `liveUpdateDisplay.ts`, `liveUpdateAlerts.ts`, `calendarAlerts.ts`, `morningAutoArm.ts`.
- **Replay/review/journal:** `stats.ts`, `quickTrades.ts`, `replayDateTabs.ts`, `dailyReviewExport.ts`, `dailyReviewStats.ts`, `dailyReviewSide.ts`, `dailyPnlSimulator.ts`, `reviewFlags.ts`, `reviewImpact.ts`, `tradeJournal.ts`, `tradeChartEvents.ts`, `tradeSelectors.ts`, `tradeTime.ts`, `marketFreshness.ts`, `dateRanges.ts`.
- **Rotation and heatmap helpers:** `relativeRotation.ts`, `rrgSpline.ts`, `spxTreemap.ts`, `heatmapPeers.ts`, `heatmapWindow.ts`, `earningsOverlay.ts`, `movingAverages.ts`.
- **Utilities:** `easternDate.ts`, `format.ts`, `refreshLogic.ts`, `clipboard.ts`, `appRefresh.ts`.

### 4.4 API Client (`src/api.ts`)

| Function | Method + path |
|---|---|
| `fetchTracker` | `GET /api/tracker` |
| `refreshGoogleSnapshot` | `POST /api/google-snapshot/refresh` |
| `refreshIbkrWallet` | `POST /api/ibkr-wallet/refresh` |
| `fetchIbkrHoldings` / `refreshIbkrHoldings` | `GET` / `POST /api/ibkr-holdings[/refresh]` |
| `fetchDailySyncStatus` / `runDailySync` | `GET /api/daily-sync/status`, `POST /api/daily-sync/run` |
| `runDailyOptionPull` | `POST /api/daily-sync/options/run` |
| `fetchReplay` | `GET /api/replay?date=...&tradeId=...` |
| `fetchSpreadSpeed` | `GET /api/spread-speed?date=...` |
| `fetchLiveSpreadSpeed` / `fetchLiveSpreadSpeedStatus` | `GET /api/spread-speed/live[/status]` |
| `startLiveSpreadSpeed` / `stopLiveSpreadSpeed` | `POST /api/spread-speed/live/start[stop]` |
| `fetchSpxMaContext` | `GET /api/spx-ma-context` |
| `fetchRrgBars` / `fetchSectorRrgBars` | `GET /api/rrg/bars`, `GET /api/rrg/sectors` |
| `fetchHeatmap` / `fetchHeatmapLiveStatus` / `startHeatmapLive` / `stopHeatmapLive` | generic `/api/{index}-heatmap[...]` (spx + qqq) |
| `fetchSpxHeatmap` + spx/qqq live wrappers | `GET /api/spx-heatmap`, live start/stop/status |
| `fetchSpxLiveBars` / `fetchSpxLiveBarsStatus` / start / stop | `GET /api/spx-live-bars[...]`, `POST .../live/start[stop]` |
| `fetchMorningBrief` | `GET /api/morning?date=...` with optional `refresh=1` |
| `fetchMorningLiveUpdates` | `GET /api/morning/live-updates?refresh=...` |
| `fetchMorningAiNotes` | `GET /api/morning/ai-notes?date=...` |
| `triggerCalendarDesktopAlert` / `triggerLiveUpdateDesktopAlert` | `POST /api/desktop-alert/calendar`, `.../live-update` |
| `saveWallet` | `PUT /api/wallet` |
| `saveReviewNote` | `PUT /api/review-notes/:date` |
| `saveTradeJournalSnapshot` | `PUT /api/journal-snapshot` |
| FPL helpers (`fetchFplManifest` / `fetchFplIndicator` / live status/start/stop) | `/api/fpl-indicator/*` |

`src/api.ts` is the only caller of `/api/*`. (The self-update endpoints `/api/app-version` + `/api/app-update` are called directly by `AppUpdateButton.tsx`.)

## 5. Backend (`server/`)

### 5.1 Bootstrap

- `server/index.ts` creates the Express app, serves static `dist` when present, and listens on `PORT ?? 5174`.
- `RUBICON_LISTEN_HOST` / `RUBICON_HOST` override the listen host; default is `127.0.0.1`. A pre-bind port probe makes a second instance on an owned port exit cleanly (single-instance by design).
- On listen it arms FPL live auto-start, IBKR holdings auto-refresh, SPX Heatmap live auto-start, spread-speed + SPX-live-bars feeds, the pre-market index-reconcile, and daily-sync catch-up.

### 5.2 HTTP Routes (registration order)

| Method + path | Handler/module |
|---|---|
| `GET /api/health` | inline health payload (pid/startedAt) |
| `GET /api/app-version` | `getAppVersionStatus` (selfUpdate) |
| `POST /api/app-update` | `runAppUpdate` (selfUpdate) |
| `GET /api/tracker` | Google snapshot auto-refresh + sync catch-up then `loadTrackerSnapshot` |
| `POST /api/google-snapshot/refresh` | `refreshGoogleDriveSnapshot` |
| `POST /api/ibkr-wallet/refresh` | `refreshIbkrWalletSnapshot` then `readWallet` |
| `GET /api/ibkr-holdings` | `readIbkrHoldingsSnapshot` |
| `POST /api/ibkr-holdings/refresh` | `refreshIbkrHoldingsSnapshot` |
| `GET /api/daily-sync/status` | `getDailySyncStatus` + catch-up |
| `POST /api/daily-sync/run` | `startDailySync` |
| `POST /api/daily-sync/options/run` | `startDailyOptionPull` |
| `GET /api/replay` | `loadReplayPayload` |
| `GET /api/spread-speed` | `loadSpreadSpeed` (+ fallback) |
| `GET /api/spread-speed/live[/status]` | `loadLiveSpreadSpeed` / `getSpreadSpeedLiveStatus` |
| `POST /api/spread-speed/live/start[stop]` | `startSpreadSpeedLive` / `stopSpreadSpeedLive` |
| `GET /api/spx-ma-context` | `loadSpxMaContext` |
| `GET /api/rrg/bars` | `loadRrgBars` |
| `GET /api/rrg/sectors` | `loadRrgBars(..., "sector-rrg-bars.json")` |
| `GET /api/spx-heatmap` | `loadSpxHeatmap` |
| `GET/POST /api/spx-heatmap/live/{status,start,stop}` | `getSpxHeatmapLiveStatus` / `startSpxHeatmapLive` / `stopSpxHeatmapLive` |
| `GET /api/qqq-heatmap` + `live/{status,start,stop}` | `loadQqqHeatmap` + shared heatmap-live handlers |
| `GET /api/spx-live-bars` + `live/{status,start,stop}` | `loadSpxLiveBars` / `getSpxLiveBarsStatus` / start / stop |
| `GET /api/morning` | `loadMorningBrief` |
| `GET /api/morning/live-updates` | `loadMorningLiveUpdates` |
| `GET /api/morning/ai-notes` | `loadMorningAiNotes` |
| `POST /api/desktop-alert/calendar` | `showCalendarDesktopAlert` |
| `POST /api/desktop-alert/live-update` | `showLiveUpdateDesktopToast` |
| `GET /api/tc2000-artifact/:dir/:file` | `resolveTc2000Artifact` |
| `GET /api/fpl-indicator/manifest` | `loadFplManifest` |
| `GET /api/fpl-indicator` | `loadFplIndicator` |
| `GET/POST /api/fpl-indicator/live/{status,start,stop}` | `getFplLiveStatus` / `startFplLive` / `stopFplLive` |
| `PUT /api/wallet` | `writeWallet` |
| `PUT /api/review-notes/:date` | `writeReviewNote` |
| `PUT /api/journal-snapshot` | `mergeTradeJournalSnapshot` (merge by tradeId, not full replace) |
| SPA fallback (non-`/api`) | serves `dist/index.html` when built |

### 5.3 Modules

| Module | Purpose |
|---|---|
| `dataImporter.ts` | Tracker/replay data core, compact tracker snapshot cache/coalescing, wallet/review-note state. |
| `trackerSummary.ts` | Builds and reads compact `rubicon_tracker_summary.json` serving summaries. |
| `morningBrief.ts` | Morning payload assembly, saved-state reads/writes, RollCall, TC2000, live-update cache + merge. |
| `morningMacroCalendar.ts` | Rubicon-owned SPX macro calendar from official/free schedule surfaces + generated timing rows + DailyFX-style ratings. |
| `morningAiNotes.ts` | Morning AI-notes payload + journal-backed context. |
| `dailySync.ts` | Daily Pipeline command/status, Data Collection / Rubicon Ingest / Google Upload stage model, lock awareness, derived-state refresh. |
| `dailySyncCatchup.ts` | Startup catch-up status for daily pipeline follow-through. |
| `selfUpdate.ts` | App self-update: `/api/app-version` status vs `origin/main` + guarded pull/rebuild/relaunch gate (dirty/unpushed/market-hours/sync-lock refusals; `data/` churn exempt). |
| `googleAuth.ts` | Google bearer/auth helpers for write-capable upload flows. |
| `googleSheetsUpload.ts` | Google workbook/tracker-row upload + receipt/local-summary refresh. |
| `googleSheetsSnapshot.ts` / `googleSnapshotAutoRefresh.ts` | Google tracker snapshot reads + throttled refresh integration. |
| `spxHeatmap.ts` / `spxHeatmapLive.ts` | Heatmap payload loader (sector→industry→stock, dual-class merge) + live feed child-process management (SPX + QQQ). |
| `spxLiveBars.ts` | Live SPX 1-min RTH bar sidecar (Python, client id 949) for the Estimator backdrop; ~09:28 ET auto-start. |
| `spxMaContext.ts` | Per-timeframe trailing SPX-close warmup window (no look-ahead) for 50/200 MA overlays; per-date cached. |
| `spreadSpeed.ts` / `spreadSpeedLive.ts` | Sidecar-only spread-speed state + live SPXW 0DTE chain feed (Python, client id 948) for the Signal Stack. |
| `rrgBars.ts` | Rotation bars loader (default + sector RRG). |
| `indexReconcile.ts` | Pre-market S&P 500 / Nasdaq-100 reconstitution check; runs the Python reconcile, toasts + forces a fresh heatmap pull on real adds/drops. |
| `fplLive.ts` / `fplIndicator.ts` | FPL live predictor process + per-bar prediction payloads. |
| `ibkrHoldings.ts` / `ibkrWalletRefresh.ts` | Read/refresh IBKR holdings (client id 884, 5-min market-hours cadence) and wallet snapshots via Python/TWS. |
| `godelLiveNews.ts` | Godel live-news capture parsing + defensive legacy-payload filters (fed by the off-screen scraper, §8). |
| `desktopAlert.ts` | Calendar + live-update alerts via the shared native Windows toast (`show-windows-toast.ps1`). |
| `tradeJournalSnapshot.ts` | Journal snapshot persistence (merge-by-tradeId so a stale tab can't wipe entries). |
| `easternClock.ts` | ET wall-clock (date/time/weekday) + daily-window fire decision for schedulers. |
| `jsonStore.ts` | Filesystem JSON helpers: path/mtime/read + atomic write (unique temp + Windows rename-retry). |
| `logRotation.ts` | Append log stream that rotates to `<file>.1` past a max size (default 5 MB); used by all live-feed/launch writers. |
| `normalize.ts` | Loose-value coercion helpers for messy JSON/CSV input. |

### 5.4 Core Data Loaders

- `loadTrackerSnapshot()` returns the dashboard snapshot and uses compact daily summaries where available.
- `loadReplayPayload(date, tradeId?)` returns replay data, preferring per-date safe replay state by default.
- `loadSpreadSpeed(date)` returns sidecar-only spread speed state and avoids reopening giant upload payloads.
- `loadMorningBrief(date, appRoot, { refresh? })` reads saved Morning state on normal loads and refreshes live sources only when requested or scheduled.

## 6. Shared Types (`shared/types.ts`)

Key families: trades, daily summaries, tracker snapshots, replay payloads, wallet/review notes, Morning calendar/live-update/AI/heatmap payloads, daily pipeline stages/status/locks, Google upload/receipt results, FPL, RRG, app-version/self-update, and desktop alert results. `shared/resampleBars.ts` holds shared bar-resampling. The trade-journal entry type lives in `src/tradeJournal.ts`.

## 7. Data And Files On Disk

### 7.1 Rubicon `data/`

| File/folder | Owner |
|---|---|
| `wallet.json`, `review-notes.json` | `dataImporter.ts` |
| `trade-journal.json` | `tradeJournalSnapshot.ts`, `morningAiNotes.ts` |
| `daily-sync-status.json`, `daily-sync-launch.log` | `dailySync.ts` |
| `app-update.log` | `selfUpdate.ts` |
| `google-drive-tracker-snapshot.json`, `google-drive-receipt-checks.json` | Google snapshot/upload paths and importer |
| `morning-brief-state/YYYY-MM-DD.json` | `morningBrief.ts` saved Morning state |
| `morning-live-updates-cache.json` | Morning live-update fallback cache |
| `godel-live-news.json` | Godel scraper capture (read by `godelLiveNews.ts`) |
| `spx-heatmap.json`, `heatmap-classification-auto.json` | `refresh-spx-heatmap.py`, `spxHeatmap.ts`, index-reconcile |
| `spx-live-bars.json`, `spx-0dte-chain.json` | `refresh-spx-live-bars.py`, `refresh-spx-0dte-chain.py` |
| `sector-rrg-bars.json` | `refresh-sector-rrg.py`, `rrgBars.ts` |
| `tc2000-daily-bars.json` | `refresh-tc2000-daily-bars.py`, Morning/RRG |
| `fpl-live.log`, `serve-headless.log`, `desktop-launcher.log` | FPL live, headless server launcher, desktop launcher |

`data/` is live runtime state, written by the app at any time; the self-update gate ignores `data/` churn (A183).

### 7.2 AI STUFF Source Data

`IBKR_TRADES_ROOT = <AI_STUFF_ROOT>/IBKR Equity History Pull/data/ibkr_trades`.

Per trading date, loaders expect files such as `entries.csv`, `daily_sync_summary.json`, `google_sheet_tab_csvs/*`, `spx_daily_upload_<date>.xlsx`, `rubicon_tracker_summary.json`, `rubicon_replay_safe_state.json`, and `rubicon_spread_speed_state.json`.

## 8. Scripts

| File | Purpose | npm script |
|---|---|---|
| `launch-desktop.mjs` | Build/check/start API and open app window. | `desktop` |
| `silent-launch.mjs` | Wraps launch-desktop forcing windowless/detached children (no console flash). | — |
| `install-desktop-shortcut.mjs` | Install `Rubicon.lnk`. | `desktop:install` |
| `serve-headless.mjs` / `serve-headless.vbs` | "Rubicon Server" logon path: rebuild stale `dist/`, then start `tsx server/index.ts` detached + windowless. | — |
| `refresh-google-drive-snapshot.ts` | Read tracker snapshot from Google Sheets API. | `google:snapshot` |
| `upload-spx-google-pipeline.ts` | Upload workbook and update tracker receipt rows. | `google:upload` |
| `rebuild-google-upload-workbook.mjs` | Rebuild the Google-upload workbook (Excel-safe sheet/cell sanitizing). | — |
| `rubicon-ingest-daily.ts` | Refresh Rubicon local summaries + safe state from daily archive output. | `rubicon:ingest` |
| `refresh-spx-heatmap.py` | Build SPX/QQQ Heatmap from sample, Yahoo, disk, or IBKR live feed (live mode does an initial Yahoo backfill). | `spx:heatmap` |
| `refresh-spx-live-bars.py` | ib_insync loop (client id 949): today's RTH 1-min SPX bars → `data/spx-live-bars.json`. | — |
| `refresh-spx-0dte-chain.py` | ib_insync loop (client id 948): SPX spot + ATM±50 SPXW 0DTE marks → `data/spx-0dte-chain.json`. | — |
| `refresh-sector-rrg.py` | Yahoo pull of ~2y daily bars for 11 SPDR sectors + SPY → `data/sector-rrg-bars.json`. | `rrg:sectors` |
| `refresh-ibkr-holdings-snapshot.py` | Read-only holdings/greeks/earnings snapshot (client id 884). | `ibkr:holdings` |
| `refresh-ibkr-wallet-snapshot.py` | Read-only account `NetLiquidation` snapshot. | `ibkr:wallet` |
| `refresh-tc2000-daily-bars.py` | TC2000 scanner/daily bars for Morning/RRG (client id 947). | `tc2000:daily-bars` |
| `reconcile-index-membership.py` | Diff live S&P 500 / Nasdaq-100 vs snapshot, classify new names, changelog (safety-gated). | `index:reconcile` |
| `godel-news-scraper.mjs` | Off-screen headed Edge scrapes Godel Terminal news (DOM + WS) → `data/godel-live-news.json`. | — |
| `godel-news-watcher.vbs` | Logon launcher for the Godel scraper (windowless; scraper holds a single-instance lock). | — |
| `show-windows-toast.ps1` | Native Windows toast for calendar + live-update alerts (bottom-right / Action Center). | called by API |
| `show-calendar-alert.ps1` | WinForms top-most calendar popup alert (legacy desktop alert path). | called by API |

## 9. Conventions

- Coordinate parallel section work in `TASKS.md`. Section agents update task status and handoff
  notes there; final merge agents update `WORKLOG.md`, `naive_acceptance.md`, and
  `naive_validation.md`.
- Keep pure logic in `.ts` modules with co-located `*.test.ts`.
- Use `src/easternDate.ts` (client) / `server/easternClock.ts` (server) for Eastern date keys/time math.
- Keep `src/api.ts` as the single frontend `/api/*` caller.
- Charts: create once then `setData` (`FplIndicatorPanel` / `EstimatorSpxChart` are the create-once references).
- Prefer compact sidecar/safe-state files on dashboard paths; load row-level market data only for explicit replay/review/debug paths.

## 10. Rough Edges And Gotchas

- Large files remain: `App.tsx` (~3k lines), `dataImporter.ts`, `MorningDashboard.tsx`, `shared/types.ts`.
- `MarketChart` and `ReviewEntryExitChart` still have chart lifecycle churn; `FplIndicatorPanel` is the create-once reference.
- JSON writes use `jsonStore.writeJsonAtomic` (unique temp + rename-retry), but concurrent semantic overwrite risks remain in a few state files.
- Hidden replay dates live in `src/replayDateTabs.ts`.
- `DailyPnlSimulatorChart.tsx` and `morningDiary.ts` are tested but not on the live render path.
- Live feeds only re-arm in their morning open window — a midday server restart silently kills them for the day.

## 11. Testing

- `npm run validate:mvp` (typecheck → lint → test → build) is the standard app gate; lint is zero-tolerance and gated in CI (`windows-latest`).
- For documentation-only work, use targeted `rg` checks plus `git diff --check`.
