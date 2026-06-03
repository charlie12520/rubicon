# Rubicon — Detailed Codebase Map

> Full reference for agents (and humans): every route, type, component, data file, and script. **For a fast overview, read [`codebase.md`](codebase.md) first** — come here for depth. Companion docs at repo root: `AGENTS.md` (how-to-operate / MiniOS), `GOAL-perf-safety-fixes.md` (outstanding fixes), `HEARTBEAT.md`. Most code is concentrated in a few very large files (see [§10](#10-rough-edges--gotchas)) — grep *within* them.

## Quick reference — where to look

| Working on… | Go to |
|---|---|
| A `/api/*` endpoint (server side) | [§5.2 routes](#52-http-routes-in-source-order) → [§5.3 module](#53-modules-non-test-serverts) |
| Calling an endpoint (client side) | [§4.4 api.ts](#44-api-client-srcapits) |
| A chart or chart bug | [§4.2 components](#42-components-srccomponents) + lifecycle note in [§10](#10-rough-edges--gotchas) |
| A UI screen or tab | [§4.1 App shell](#41-entry--the-app-shell) |
| Pure logic + its tests | [§4.3 logic modules](#43-pure-logic-modules-srcts) → [§9 conventions](#9-conventions) |
| A shared type / data contract | [§6 types](#6-shared-types-sharedtypests) |
| Where trade data comes from | [§3](#3-architecture-at-a-glance) → [§5.4 loaders](#54-core-data-loaders-dataimporterts) → [§7.2 source data](#72-source-data--the-ibkr-trades-root-per-trading-day) |
| A `data/` JSON file | [§7.1](#71-app-data-directory-app-state-anchored-on-processcwd--approot) |
| A refresh / launch script | [§8 scripts](#8-scripts-scripts) |
| Run / verify / commands | [§2](#2-running--validating) |
| Known bugs, perf, monoliths | [§10](#10-rough-edges--gotchas) → `GOAL-perf-safety-fixes.md` |

## Contents
1. [Overview](#1-overview)
2. [Running & validating](#2-running--validating)
3. [Architecture at a glance](#3-architecture-at-a-glance)
4. [Frontend (`src/`)](#4-frontend-src) — [4.1 App shell](#41-entry--the-app-shell) · [4.2 Components](#42-components-srccomponents) · [4.3 Logic modules](#43-pure-logic-modules-srcts) · [4.4 API client](#44-api-client-srcapits)
5. [Backend (`server/`)](#5-backend-server) — [5.1 Bootstrap](#51-entry--bootstrap-serverindexts) · [5.2 Routes](#52-http-routes-in-source-order) · [5.3 Modules](#53-modules-non-test-serverts) · [5.4 Loaders](#54-core-data-loaders-dataimporterts)
6. [Shared types](#6-shared-types-sharedtypests)
7. [Data & files on disk](#7-data--files-on-disk) — [7.1 App `data/`](#71-app-data-directory-app-state-anchored-on-processcwd--approot) · [7.2 Source data](#72-source-data--the-ibkr-trades-root-per-trading-day) · [7.3 Path resolution](#73-path-resolution)
8. [Scripts](#8-scripts-scripts)
9. [Conventions](#9-conventions)
10. [Rough edges & gotchas](#10-rough-edges--gotchas)
11. [Testing](#11-testing)

---

## 1. Overview

- **What it is:** a local-first cockpit for one SPX 0DTE spread trader. It imports data produced by a sibling pipeline ("AI STUFF"), shows P/L and position metrics, replays a trading day bar-by-bar, runs a morning brief (calendars + live squawk + holdings + AI notes), shows a Relative Rotation Graph, and serves an FPL per-bar prediction model.
- **Shape:** a Vite/React single-page app (the PWA) talking to a small Express API on the same machine. The API reads/writes JSON & CSV on disk; it does **not** use a database.
- **Two roots of data:** the app's own `data/` directory (app state) and a sibling repo `AI STUFF/IBKR Equity History Pull/data/...` (the imported trade/market source data). See [§7 Data on disk](#7-data--files-on-disk).

## 2. Running & validating

| Command | What it does |
|---|---|
| `npm run dev` | Runs API + Vite client together (`concurrently`). Vite proxies `/api` → `[::1]:5174`; the dev port drifts when others are taken. |
| `npm run build` | `tsc -b` then `vite build` → `dist/`. |
| `npm run serve:app` | Serves the built `dist` + API on ONE port via `tsx server/index.ts` (`PORT=<n>` to pin it). |
| `npm test` | `vitest run`. |
| `npm run typecheck` | `tsc -b`. |
| `npm run lint` | `eslint .`. |
| `npm run validate:mvp` | `typecheck` → `test` → `build`. **Run this before declaring work done.** |
| `npm run desktop` / `desktop:install` | Launch the Edge/Chrome `--app` window / install a Desktop shortcut (see [§8 Scripts](#8-scripts-scripts)). |

Data-refresh npm scripts (`godel:capture`, `google:snapshot`, `ibkr:holdings`, `ibkr:wallet`, `tc2000:daily-bars`) are documented in [§8](#8-scripts-scripts).

## 3. Architecture at a glance

```
Browser (PWA)
  └─ React app  ── src/api.ts (fetch /api/*) ──►  Express server (server/index.ts, port 5174)
                                                     └─ server/*.ts loaders/services
                                                          ├─ read AI STUFF/IBKR Equity History Pull/data/...   (source data)
                                                          ├─ read/write ./data/*.json                          (app state)
                                                          └─ spawn PowerShell / Python for refreshes & alerts
```

**Primary read path:** `App` → `fetchTracker()` → `GET /api/tracker` → `loadTrackerSnapshot()` (in `server/dataImporter.ts`) → reads per-date folders under the IBKR trades root → returns a `TrackerSnapshot` (`trades`, `dailySummaries`, `wallet`, `reviewNotes`, `sourceHealth`). The dashboard auto-refreshes every ~60 s.
**Replay path:** `fetchReplay(date)` → `GET /api/replay` → `loadReplayPayload(date)` → `{ spxBars, spreadMarks, openInterest, volume, quickTrades }`.

Top-level directories: `src/` (frontend) · `server/` (Express API) · `shared/` (types shared by both) · `scripts/` (refresh/launch jobs) · `data/` (runtime JSON state).

---

## 4. Frontend (`src/`)

### 4.1 Entry & the App shell
- **`main.tsx`** — entry; mounts `<App/>` in `<StrictMode>` into `#root`.
- **`App.tsx`** (~3,000+ lines) — the root component; owns almost all state, data fetching, and the replay engine. It also *defines ~20 components inline* (see [§10](#10-rough-edges--gotchas)).
  - **Two tab strips** (string-literal unions, not enums):
    - `AppPortion = "morning" | "replay" | "rotation"` (state `portion`, default `"morning"`) → tabs **Morning · Replay · Rotation**.
    - `ViewMode = "replay" | "pull" | "review" | "journal"` (state `view`, default `"replay"`, shown only when `portion === "replay"`) → tabs **Daily Pull · Replay · Daily Review · Journal**.
  - **Views → implementation:** `pull` → `DailyPullScreen`; `review` → `DailyReviewScreen`; `journal` → `JournalScreen`; **`replay` is inline JSX inside `App()`** (the workspace grid with `TradeTable` + `ReplayCharts` + scrubber + `SpreadSpeedPanel`) — *not* a separate `*Screen` function. `rotation` → `<RrgPanel/>`; `morning` → `<MorningDashboard/>`.
  - **State:** ~31 `useState` groups — snapshot/data (`snapshot`, `replay`, `spreadSpeed`), date/range selection, replay controls (`replayIndex`, `replayMode`, `playing`, `speed`, `replayIntentRef`), daily-sync status, refresh flags, wallet draft, journal (`journalEntries`, localStorage-backed), and navigation.
  - **Polling effects:** auto local-import refresh (`AUTO_IMPORT_REFRESH_MS = 60_000`, visibility-gated); daily-sync status poll (60 s, visibility-gated); daily-sync "running" poll (15 s); replay playback engine (`setInterval` at `max(80, 650/speed)` ms); morning "today" tracker (60 s). All have cleanups.

### 4.2 Components (`src/components/`)

| Component (file) | Purpose | lightweight-charts? |
|---|---|---|
| `MarketChart` (`MarketChart.tsx`) | Generic single-pane chart for the replay grid — `kind: "candles" \| "line" \| "spread-bars"`. Also exports `SPREAD_HL_BAR_OPTIONS`, `chartCountLabel`. | **Yes** — effect dep `[props]`, so it tears down + recreates the chart on most renders (see GOAL doc). |
| `ReplayCharts` (`ReplayCharts.tsx`) | Lays out the replay panels: SPX candles + selected-spread (HL bars/line) via `MarketChart`, plus hand-rolled SVG 0DTE open-interest & volume-profile charts. Exports `buildSpreadRangeBars`, `replayCutoffTime`, `takeThrough`. | Indirect (via `MarketChart`); own profile charts are SVG. |
| `SpreadSpeedPanel` (`SpreadSpeedPanel.tsx`) | "Spread Speed — net-delta rule" panel: recommended PCS/CCS picks + per-side ladders for the frame nearest the current label. | No (HTML/inline-style). |
| `ReviewEntryExitChart` (`ReviewEntryExitChart.tsx`) | Daily-review entry/exit map: SPX candles + left-axis P/L overlay + DOM arrow markers (sized by entry premium) + hover readout. Exports many pure helpers (`aggregateReviewBars`, `buildReviewMarkers`, `groupReviewMarkers`, `buildReviewPnlLineData`, `reviewHoverReadoutForTime`, …). | **Yes** — effect dep `[bars, displayBars, pnlPoints, trades, onSelectTrade]`, recreates on data-input changes (see GOAL doc). |
| `DailyPnlSimulatorChart` (`DailyPnlSimulatorChart.tsx`) | SVG area/line chart of simulated daily P/L (total vs realized). **Tested but not imported in the live render path** — the review map uses `ReviewEntryExitChart`'s own overlay. | No (SVG). |
| `RrgPanel` (`RrgPanel.tsx`) | Rotation-tab controller: fetches RRG bars, owns timeframe/benchmark/window/tail/as-of/selection/playback state, calls `computeRrg`, renders controls + the graph. Autoplay `setInterval` (~380 ms). | No (delegates to SVG graph). |
| `RelativeRotationGraph` (`RelativeRotationGraph.tsx`) | Pure-SVG RRG renderer: quadrants, gridlines, Catmull-Rom tails (`splineSegments`), heads, tooltip, legend. Uses a `ResizeObserver` (created once). | No (SVG). |
| `FplIndicatorPanel` (`FplIndicatorPanel.tsx`) | FPL model panel: SPX candles + cheat-code MA overlays + action markers, four SVG probability "lanes", a session selector, and a live-predictor Start/Stop runner. `POLL_INTERVAL_MS = 10_000`. | **Yes — create-once on mount (`[]`) with refs; data effect only `setData`s. This is the reference pattern.** |
| `MorningDashboard` (`MorningDashboard.tsx`) | Morning cockpit with two screens — **Brief** (macro/political calendar, live squawk feed with word-filter + audio alerts, IBKR holdings, AI notes, TC2000 previews) and **Signal Stack** (recommended spreads + embedded `FplIndicatorPanel`). Owns calendar desktop/browser/audio alerts and auto-arm. | No (SVG mini-charts). |

### 4.3 Pure logic modules (`src/*.ts`)
Non-React, each with a co-located `*.test.ts`.

**Replay, stats & ranges**
- `stats.ts` — `summarizeTrades` (P/L, win rate, max concurrent call/put positions, risk, best/worst), `buildDailyReview` (entry/exit/expiration events + side breakdown); const `REPLAY_SPEEDS = [1,2,4,8,16]`.
- `dailyPnlSimulator.ts` — `buildDailyPnlSimulation` (time-stepped realized+open P/L curve), `summarizeDailyPnlSimulation` (final/high/low/drawdown/max-open).
- `dateRanges.ts` — `rangePresets`, `resolveRange`, `tradesInRange` (today/yesterday/week/MTD/YTD/custom filtering).
- `quickTrades.ts` — labels/aria for the replay quick-trade buttons.
- `replayDateTabs.ts` — `visibleReplayDateTabs` (filters a hardcoded hidden-date set: `2026-05-26`, `2026-05-27`).

**Rotation (RRG)**
- `relativeRotation.ts` — the RRG engine: `computeRrg`, `rollingZScore`, `resampleWeekly`, `buildBasketCloses`, `rrgBounds`, `quadrantOf`; types `DailyBar`/`Timeframe`/`RrgSeries`/`RrgResult`.
- `rrgSpline.ts` — `splineSegments` (centripetal Catmull-Rom → cubic-bézier SVG paths for tails).

**Daily pull / sync readiness**
- `dailyPullChecklist.ts` — `buildDailyPullChecklist` (readiness steps + required-output coverage scoring from a `DailySummary`/`SourceHealth`).
- `dailySyncDiagnostics.ts` — `buildDailySyncDiagnostics` (badges/facts/log-tail from sync status).
- `dailySyncReadiness.ts` — `buildDailySyncReadiness` (human-readable readiness label/tone; cutoff countdown).
- `dailySyncRunGuard.ts` — `buildDailySyncRunGuard` (whether "Run Daily Sync" is disabled + tooltip).
- `dateIssueBadges.ts` — `issueBadgeForSummary`, `buildDateIssueIndex` (red issue-count badges per date).
- `uploadReceiptCheck.ts` — `buildUploadReceiptCheck` (Google upload-receipt gap warning + remediation).
- `reviewImpact.ts` — `coverageImpactSummary`, `issueReviewImpact` ("does this block review?" text).

**Review & journal**
- `tradeJournal.ts` — the per-trade journal model (localStorage key `spx-trade-journal-v1`): `TradeJournalEntry`, Four-Aspects checklist, `filterJournalTrades`, `nextUnreviewedTradeId`, `mergeJournalEntry`, `parse/serializeJournalEntries`, `buildJournalCoverage`. (The journal entry type lives **here**, not in `shared/types.ts`.)
- `reviewFlags.ts` — `countReviewFlags`, `filterReviewFlagTrades`, `reviewFlagQueue` (follow-up/mistake/quality flags).
- `dailyReviewExport.ts` — `buildDailyReviewMarkdown`, `dailyReviewExportFilename` (the daily-review markdown export).
- `marketFreshness.ts` — `marketFreshness` (today-imported vs pending vs weekend banner).

**Morning**
- `morningLiveState.ts` — `countNewLiveUpdates`, `mergeLiveUpdateList`, `preserveMorningBriefLiveUpdates`.
- `liveUpdateFilters.ts` — squawk word-filter matching (`compileLiveUpdateFilters`, `alertableNewLiveUpdates`, …).
- `liveUpdateDisplay.ts` — `formatLiveUpdateDisplayText` (de-shouts ALL-CAPS squawk while preserving acronyms).
- `calendarAlerts.ts` — `calendarAlertTargets`, `nextCalendarAlertTarget`, `formatCalendarAlertStatus`; `CALENDAR_ALERT_LEAD_MS = 60_000`.
- `morningAutoArm.ts` — `morningAutoArmDecision` (auto-arm morning alerts on weekday mornings, default 08:30 ET).
- `morningDiary.ts` — `previousSessionDate`, `buildMorningDiarySummary`. **Tested but not imported in the live render path.**

**Formatting & app utilities**
- `easternDate.ts` — `easternDateOffset`, `easternDateKey` (America/New_York `YYYY-MM-DD` keys). **Use this for all ET math.**
- `format.ts` — `formatCurrency`, `formatNumber`, `formatPercent`, `formatSignedCurrency` (Intl-based; `-` for null/NaN).
- `refreshLogic.ts` — `marketDateFromSnapshot`, `selectDateAfterTrackerRefresh`.
- `clipboard.ts` — `canAttemptClipboardCopy`, `copyTextToClipboard` (with `execCommand` fallback for the embedded browser).
- `appRefresh.ts` — `latestVersionUrl`, `refreshToLatestVersion` (cache-busting reload to the newest bundle).

### 4.4 API client (`src/api.ts`)
All requests go through `readJson<T>` (fetch + error parsing); each `fetch*` accepts an optional `AbortSignal`. Types come from `../shared/types` (except `TradeJournalEntry`, from `./tradeJournal`).

| Function | Method + path |
|---|---|
| `fetchTracker` | `GET /api/tracker` |
| `refreshGoogleSnapshot` | `POST /api/google-snapshot/refresh` |
| `refreshIbkrWallet` | `POST /api/ibkr-wallet/refresh` |
| `fetchIbkrHoldings` | `GET /api/ibkr-holdings` |
| `refreshIbkrHoldings` | `POST /api/ibkr-holdings/refresh` |
| `fetchDailySyncStatus` | `GET /api/daily-sync/status` |
| `runDailySync` | `POST /api/daily-sync/run` (body `{date, dryRun}`) |
| `fetchReplay` | `GET /api/replay?date=…[&tradeId=…]` |
| `fetchSpreadSpeed` | `GET /api/spread-speed?date=…` |
| `fetchRrgBars` | `GET /api/rrg/bars` |
| `fetchMorningBrief` | `GET /api/morning?date=…` |
| `fetchMorningLiveUpdates` | `GET /api/morning/live-updates?refresh=<ts>` |
| `fetchMorningAiNotes` | `GET /api/morning/ai-notes?date=…` |
| `saveTradeJournalSnapshot` | `PUT /api/journal-snapshot` (body `{entries}`) |
| `triggerCalendarDesktopAlert` | `POST /api/desktop-alert/calendar` (body `{body, detail?, title?}`) |
| `saveWallet` | `PUT /api/wallet` (body `{netLiquidation}`) |
| `saveReviewNote` | `PUT /api/review-notes/{date}` (body `{note, tradeFlags}`) |
| `fetchFplManifest` | `GET /api/fpl-indicator/manifest` |
| `fetchFplIndicator` | `GET /api/fpl-indicator?date=…&live=…` |
| `fetchFplLiveStatus` | `GET /api/fpl-indicator/live/status` |
| `startFplLivePredictor` | `POST /api/fpl-indicator/live/start` (body `{port, clientId}`) |
| `stopFplLivePredictor` | `POST /api/fpl-indicator/live/stop` |

---

## 5. Backend (`server/`)

### 5.1 Entry & bootstrap (`server/index.ts`)
- Port `Number(process.env.PORT ?? 5174)`. `app.use(express.json())`.
- Static SPA serving is guarded by `fs.existsSync(distIndex)`: serves `express.static(dist)` + a fallback route `GET /^\/(?!api).*/` → `sendFile(dist/index.html)`.
- Error middleware returns `500 { error }`.
- On `app.listen`, it arms two schedulers: `armFplLiveAutoStart()` and `armIbkrHoldingsAutoRefresh()`.

### 5.2 HTTP routes (in source order)

| Method + path | Handler → | Notes |
|---|---|---|
| `GET /api/health` | inline | `{ ok, app:"rubicon", generatedAt }` |
| `GET /api/tracker` | `maybeAutoRefreshGoogleDriveSnapshot` → `loadTrackerSnapshot` | full snapshot; triggers Google auto-refresh first |
| `POST /api/google-snapshot/refresh` | `refreshGoogleDriveSnapshot` | 409 if no Google credential, else 502 on error |
| `POST /api/ibkr-wallet/refresh` | `refreshIbkrWalletSnapshot` → `readWallet` | refreshes wallet via read-only TWS/Gateway |
| `GET /api/ibkr-holdings` | `readIbkrHoldingsSnapshot` | current holdings snapshot |
| `POST /api/ibkr-holdings/refresh` | `refreshIbkrHoldingsSnapshot` → `readIbkrHoldingsSnapshot` | spawns Python |
| `GET /api/daily-sync/status` | `getDailySyncStatus` | state + last summary + log tail + target plan |
| `POST /api/daily-sync/run` | `startDailySync({date, dryRun})` | launches/dry-runs the sync wrapper |
| `GET /api/replay` | `loadReplayPayload(date, tradeId)` | validates `date=YYYY-MM-DD` |
| `GET /api/spread-speed` | `loadSpreadSpeed(date)` | validates `date` |
| `GET /api/rrg/bars` | `loadRrgBars(appRoot)` | TC2000 daily bars for the RRG |
| `GET /api/morning` | `loadMorningBrief(date, appRoot)` | calendars, major events, live updates, TC2000 pulls |
| `GET /api/morning/live-updates` | `loadMorningLiveUpdates` | sets `Cache-Control: no-store, max-age=0` |
| `GET /api/morning/ai-notes` | `loadMorningAiNotes(date)` | AI diary notes or pending shell |
| `POST /api/desktop-alert/calendar` | `showCalendarDesktopAlert` | spawns PowerShell toast |
| `GET /api/tc2000-artifact/:dir/:file` | `resolveTc2000Artifact` → `sendFile` | path-validated artifact file |
| `GET /api/fpl-indicator/manifest` | `loadFplManifest` | `{dates, count, root}` |
| `GET /api/fpl-indicator` | `loadFplIndicator(date, live)` | per-bar predictions; validates `date` |
| `GET /api/fpl-indicator/live/status` | `getFplLiveStatus` | live predictor process status |
| `POST /api/fpl-indicator/live/start` | `startFplLive({port, clientId})` | spawns Python |
| `POST /api/fpl-indicator/live/stop` | `stopFplLive` | |
| `PUT /api/wallet` | `writeWallet` | requires finite `netLiquidation >= 0` |
| `PUT /api/review-notes/:date` | `writeReviewNote(date, note, tradeFlags)` | validates `:date` |
| `PUT /api/journal-snapshot` | `writeTradeJournalSnapshot` | persists journal snapshot for the Codex automation |

### 5.3 Modules (non-test `server/*.ts`)
Side-effect flags: **⏱ setInterval** · **⚙ spawns child process** · **💾 writes files**.

| Module | Purpose | Flags |
|---|---|---|
| `dataImporter.ts` (~2,200 lines, ~100 fns) | The data core: reads the AI STUFF mirror, normalizes trades, builds the tracker & replay payloads. Writes `data/review-notes.json` & `data/wallet.json`. | 💾 (review-notes.json, wallet.json) |
| `morningBrief.ts` (~1,700 lines) | Aggregates the morning brief: DailyFX/IG/RollCall calendars, major events, FirstSquawk live updates (RSS/timeline via nitter), TC2000 pulls. Caches last-good live updates. | 💾 (live-update cache) |
| `dailySync.ts` | Launches the daily SPX/IBKR sync PowerShell wrapper and tracks status; writes status JSON + launch log. | ⚙ (powershell) 💾 |
| `fplLive.ts` | Manages the out-of-band FPL live-predictor child process + daily auto-start; appends a log. | ⏱ (30 s arm) ⚙ (python; powershell/ps for discovery) 💾 (log) |
| `ibkrHoldings.ts` | Reads/refreshes the IBKR holdings snapshot via Python; daily auto-refresh. | ⏱ (30 s arm) ⚙ (python) |
| `ibkrWalletRefresh.ts` | TCP-probes TWS/Gateway and refreshes the IBKR wallet snapshot via Python. | ⚙ (python) |
| `googleSnapshotAutoRefresh.ts` | Timestamp-gated decision to refresh the Google Drive snapshot (default 30 min); called from `GET /api/tracker`. | — |
| `googleSheetsSnapshot.ts` | Google Sheets API helpers + credential/source-health reporting. | — |
| `fplIndicator.ts` | Serves FPL per-bar prediction CSVs + manifest. | — |
| `spreadSpeed.ts` | Computes per-minute net-delta ("speed") frames for the SPXW 0DTE chain (Black-Scholes N(d1)/CDF math). | — |
| `rrgBars.ts` | Loads/normalizes `data/tc2000-daily-bars.json` for the RRG. | — |
| `godelLiveNews.ts` | Fetches/parses the "Godel" live-news feed (JSON/RSS/HTML) with a capture-file fallback. | — |
| `morningAiNotes.ts` | Serves Codex AI diary notes, or a "pending" shell built from journal/review snapshots. | — |
| `tradeJournalSnapshot.ts` | Persists the sanitized trade-journal snapshot to `data/trade-journal.json`. | 💾 |
| `desktopAlert.ts` | Fires a Windows desktop alert via PowerShell (`scripts/show-calendar-alert.ps1`). | ⚙ (powershell) |

> Note: the Python/PowerShell-backed modules mostly **read** the snapshot files; the spawned scripts are what **write** the IBKR snapshots. The atomic-write & error-handler gaps in `dataImporter`/`dailySync`/`fplLive`/`desktopAlert` are tracked in `GOAL-perf-safety-fixes.md`.

### 5.4 Core data loaders (`dataImporter.ts`)
- `loadTrackerSnapshot({googleAutoRefreshStatus?})` → `TrackerSnapshot` — enumerates `tradeDates()`, loads every date's trades + daily summary, merges Google-Drive connector rows + receipt checks, reads wallet + review notes, builds `sourceHealth`.
- `loadReplayPayload(date, selectedTradeId?)` → `ReplayPayload` — SPX bars, spread marks (+ reconstructed pre-entry marks when missing), open interest, volume, quick trades.
- `loadTradesForDate(date)` (internal) → `TradeRecord[]` — reads `entries.csv`, normalizes, filters to SPXW spreads, annotates entry-chart deviation + SPX entry/exit.
- `loadDailySummary(date)` (internal) → `DailySummary` — per-date availability/upload rollup + `issues`.
- `loadSpxBars(date)` → `SpxBar[]`; `loadSpreadMarks(date)` (internal) → `SpreadMark[]`.

---

## 6. Shared types (`shared/types.ts`)
All `export type` (no interfaces). Domain types and their key fields:

- **`TradeRecord`** — one normalized SPX vertical spread: `id` (`IBKR-{permId}-{entrySequence}`), `account`, `date`, `status`, `side: "Call"|"Put"|"Mixed"`, `strategy`, `bias`, `entryTime`, `exitTime: string|null`, `expiration`, `shortStrike`/`longStrike`/`width`, `contracts`, `positionBefore`/`positionAfter`, `entryPrice`, entry-chart deviation fields, `exitPrice`, `priceType: "Credit"|"Debit"`, `fees`/`maxRisk`/`maxProfit`/`pnl`/`returnOnRisk`, `winLoss: "Win"|"Loss"|"Flat"|"Open"`, `spxEntry`/`spxExit`, `legs: SpreadLeg[]`, `notes`, `source`.
- **`SpreadLeg`** — `localSymbol`, `right: "C"|"P"|""`, `strike`, `ratio`.
- **`DailySummary`** — large per-date sync/availability/upload rollup: counts (`tradeCount`/`fillCount`/`spreadCount`/`entryCount`/`optionContractCount`), per-stage statuses (`spxStatus`, `tradeStatus`, `optionIntradayStatus`, `availabilityStatus`, `uploadStatus`, …), expected/actual row counts, `issueCount`, `issues: DataIssue[]`, `payloadRows`, paths, and upload-receipt evidence.
- **`TrackerSnapshot`** — `generatedAt`, `aiStuffRoot`, `googleSheetUrl`, `today`, `availableDates: string[]`, `latestTradeDate`, `trades: TradeRecord[]`, `dailySummaries: DailySummary[]`, `wallet: WalletSnapshot`, `reviewNotes: Record<string, DailyReviewNote>`, `sourceHealth: SourceHealth[]`.
- **`SpxBar`** — `time` (unix sec), `timestampEt`, `label` (HH:MM), `open/high/low/close`.
- **`SpreadMark`** — per-trade spread price marks: `tradeId`, `permId`, `entrySequence`, `time`, `value`, optional `open/high/low/close/vwap`, leg liquidity counts, `legSymbols`, `source`.
- **`ReplayPayload`** — `date`, `selectedTradeId: string|null`, `spxBars`, `spreadMarks`, `openInterest: OpenInterestPoint[]`, `volume: VolumePoint[]`, `quickTrades: TradeRecord[]`.
- **`WalletSnapshot`** — `netLiquidation: number|null`, `source`, `updatedAt`, `account?`.
- **`SourceHealth`** — `label`, `status: "ok"|"warning"|"missing"`, `detail`, `count?`, `url?`.
- **`DataIssue`** — `stage: "pull"|"upload"|"availability"`, `severity: "info"|"warning"|"error"`, `title`, `detail`, `count?`.
- **`DailyReviewNote`** — `date`, `note`, `tradeFlags: Record<string, TradeReviewFlag>`, `updatedAt`; `TradeReviewFlag = "follow_up"|"mistake"|"quality"`.

Other type families (names only): IBKR holdings (`IbkrHolding*`), daily-sync orchestration (`DailySync*`), upload receipts (`UploadReceiptCheckEvidence`), refresh results (`GoogleSnapshotRefreshResult`/`IbkrWalletRefreshResult`/`DesktopAlertResult`), spread-speed (`SpreadSpeed*`), morning brief (`Morning*`), FPL (`Fpl*`), and `RrgBarsPayload`. The trade-journal entry shape is **not** here — it lives in `src/tradeJournal.ts` (only `TradeJournalSnapshotSaveResult` is shared).

---

## 7. Data & files on disk

### 7.1 App `data/` directory (app state, anchored on `process.cwd()` / `appRoot`)
| File | Written / read by |
|---|---|
| `wallet.json` | `writeWallet` / `readWallet` (`dataImporter.ts`) |
| `review-notes.json` | `writeReviewNote` / `readReviewNotes` (`dataImporter.ts`); also read by `morningAiNotes.ts` |
| `trade-journal.json` | `tradeJournalSnapshot.ts`; read by `morningAiNotes.ts` |
| `daily-sync-status.json`, `daily-sync-launch.log` | `dailySync.ts` |
| `google-drive-tracker-snapshot.json`, `google-drive-receipt-checks.json` | written by `scripts/refresh-google-drive-snapshot.ts`; read by `dataImporter.ts` |
| `morning-ai-notes.json` | read by `morningAiNotes.ts` (produced by the Codex automation) |
| `morning-live-updates-cache.json` | `morningBrief.ts` (last-good live updates) |
| `godel-live-news.json` | written by `scripts/capture-godel-news.mjs`; read by `godelLiveNews.ts` |
| `tc2000-daily-bars.json` | written by `scripts/refresh-tc2000-daily-bars.py`; read by `morningBrief.ts` + `rrgBars.ts` |
| `fpl-live.log`, `desktop-launcher.log` | `fplLive.ts` / `scripts/launch-desktop.mjs` |

Most paths have an env override (e.g. `REVIEW_NOTES_PATH`, `RUBICON_JOURNAL_SNAPSHOT_PATH`, `RUBICON_LIVE_UPDATE_CACHE_PATH`, `SPX_GOOGLE_DRIVE_TRACKER_SNAPSHOT_PATH`).

### 7.2 Source data — the IBKR trades root (per trading day)
`IBKR_TRADES_ROOT = <AI_STUFF_ROOT>/IBKR Equity History Pull/data/ibkr_trades`. `tradeDates()` enumerates immediate subdirs matching `^\d{4}-\d{2}-\d{2}$`. Per `<date>/`:
- `entries.csv` (trades), `contracts.csv` (underlyings)
- `daily_sync_summary.json`, `google_sheet_upload_payload.json`, `spx_daily_upload_<date>.xlsx`
- `google_sheet_tab_csvs/` → `SPX_5s.csv`/`SPX_1m.csv`, `IBKR_Spread_Trade_Marks.csv`, `IBKR_0DTE_SPX_Open_Interest.csv`, `IBKR_0DTE_SPX_Cumulative_Volume_Profile_5s.csv`/`_1m.csv`
- `ibkr_option_intraday/` → `option_leg_trades_5s.csv`/`_1m.csv`, `underlying_1m_summary.json`, `underlying_1m.csv`

When a tab CSV is missing, loaders fall back to the matching tab inside `google_sheet_upload_payload.json`.

### 7.3 Path resolution
- `AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..")` (`dataImporter.ts`, same in `dailySync.ts`).
- IBKR wallet/holdings snapshots live under `<AI_STUFF_ROOT>/IBKR Equity History Pull/data/` (`ibkr_account_snapshot.json`, `ibkr_holdings_snapshot.json`, …), many with env overrides.
- FPL predictions are separate: `FPL_PREDICTIONS_ROOT ?? <cwd>/../analysis/fpl_perbar_indicator/stage6_production/predictions_by_date` → `predictions_<date>.csv` + `_manifest.csv`.

---

## 8. Scripts (`scripts/`)

| File | Purpose | npm script |
|---|---|---|
| `launch-desktop.mjs` | Ensure a build exists, start the server on a free port (`5174/5184/5194/5196/5198`), poll `/api/health`, then open an Edge/Chrome `--app` window (dedicated profile `%LocalAppData%\Rubicon App`). | `desktop` |
| `install-desktop-shortcut.mjs` | Create a Desktop `Rubicon.lnk` that runs `launch-desktop.ps1` hidden. | `desktop:install` |
| `launch-desktop.ps1` | PowerShell wrapper the shortcut runs (sets `GOOGLE_SERVICE_ACCOUNT_PATH`, starts the launcher hidden). | — (called by the shortcut) |
| `capture-godel-news.mjs` | Fetch a Godel news URL and write the raw response to `data/godel-live-news.json`. | `godel:capture` |
| `refresh-google-drive-snapshot.ts` | Auth to the Google Sheets API, pull metadata + the "Daily Sync Runs" range, write `data/google-drive-tracker-snapshot.json`. | `google:snapshot` |
| `refresh-ibkr-holdings-snapshot.py` | Read-only connect to TWS/Gateway (`ib_insync`), pull positions + greeks, enrich with earnings, write the holdings JSON. | `ibkr:holdings` |
| `refresh-ibkr-wallet-snapshot.py` | Read-only connect to TWS/Gateway, read `NetLiquidation`, write the account snapshot. | `ibkr:wallet` |
| `refresh-tc2000-daily-bars.py` | Read TC2000 scanner export CSVs, pull/cache daily stock bars via IBKR, write compact `data/tc2000-daily-bars.json` for Morning previews + RRG. | `tc2000:daily-bars` |
| `rebuild-google-upload-workbook.mjs` | Standalone util: rebuild an `.xlsx` workbook from a `google_sheet_upload_payload.json`. | — (manual CLI) |
| `show-calendar-alert.ps1` | WinForms toast popup; invoked by `server/desktopAlert.ts`. | — |

---

## 9. Conventions

- **Pure logic lives in `.ts` modules, separate from `.tsx` components, and always has a co-located `*.test.ts`. Add/extend tests with any logic change** (`vitest`).
- **Charts:** create the chart ONCE in a `useEffect(…, [])` with refs, then push updates via `series.setData(...)` in a separate data effect. **`components/FplIndicatorPanel.tsx` is the reference**; `MarketChart` and `ReviewEntryExitChart` don't follow it yet (see GOAL doc).
- **US-Eastern market time** goes through `src/easternDate.ts` — don't hand-roll UTC offsets.
- **Server state** is plain JSON under `data/`; most paths are env-overridable.
- **Frontend ↔ server contracts** live in `shared/types.ts`; `src/api.ts` is the only place that calls `/api/*`.

## 10. Rough edges & gotchas

- **Monolith files** (grep within them; don't expect one file per thing): `src/App.tsx` (~3,000+ lines, ~20 inline components incl. `JournalScreen`/`DailyPullScreen`/`DailyReviewScreen`/`TradeTable`/`SourceLedger`/`SessionHealth`); `server/dataImporter.ts` (~2,200 lines, ~100 functions); `server/morningBrief.ts` (~1,700 lines); `src/components/MorningDashboard.tsx` (~1,500 lines); `shared/types.ts` (~680 lines).
- **Chart lifecycle** differs by component (see [§4.2](#42-components-srccomponents)) — `MarketChart`/`ReviewEntryExitChart` recreate the chart on prop/data changes; `FplIndicatorPanel` is the create-once reference.
- **Tested-but-unused-in-render:** `src/components/DailyPnlSimulatorChart.tsx` and `src/morningDiary.ts` have tests but aren't on the live render path.
- **Hardcoded hidden replay dates** (`2026-05-26`, `2026-05-27`) in `src/replayDateTabs.ts`.
- **No caching of `/api/tracker`** (re-reads all history per request) and **non-atomic JSON writes / missing child-process & stream `error` handlers** — all enumerated with fixes in `GOAL-perf-safety-fixes.md`.

## 11. Testing
- `vitest`, co-located `*.test.ts`. Logic modules and the chart components' exported pure helpers are well covered; React render/DOM behavior and the chart lifecycles are largely not. `npm run validate:mvp` is the gate (typecheck → test → build).

---

_Last verified against the source: 2026-06-01._
