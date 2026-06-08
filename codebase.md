# Rubicon - Codebase Map

> Fast orientation for agents (and humans). **Rubicon** is a personal **SPX 0DTE credit-spread morning-intelligence, trade-tracker and replay cockpit**: a Vite/React PWA talking to a small Express API (port 5174) that reads/writes JSON and CSV on disk (no database).
>
> **This is the skim map**: use it to find the right module without reading large files end to end. **For full detail** (routes, types, components, data files, scripts, and task-to-section quick reference) see [`detailedcodebase.md`](detailedcodebase.md). Other root docs: `AGENTS.md` (how to operate), `GOAL-perf-safety-fixes.md` (outstanding fixes).

**Top-level layout:** `src/` (frontend) - `server/` (Express API) - `shared/types.ts` (shared contracts) - `scripts/` (refresh/launch jobs) - `data/` (runtime JSON state).

---

## 1. Overview
Local-first cockpit for one SPX 0DTE trader: imports the sibling "AI STUFF" pipeline's data, shows P/L and positions, replays a day bar-by-bar, runs a morning brief (Rubicon SPX macro calendar + political calendar + live squawk + holdings + heatmap + AI notes), an RRG, and an FPL prediction model. See detail section 1.

## 2. Running
`npm run dev` (API + client) - `npm run build` then `npm run serve:app` (one port) - `npm test` - `npm run validate:mvp` (typecheck -> test -> build gate). See detail section 2.

## 3. Architecture
`App` -> `src/api.ts` -> `/api/*` (Express `server/index.ts`) -> `server/*.ts` loaders -> read AI STUFF source data + app `data/`. `GET /api/tracker` -> `loadTrackerSnapshot()` is the primary read (auto-refresh ~60 s, short in-memory cache/coalescing); replay via `GET /api/replay`. See detail section 3.

## 4. Frontend (`src/`)
- **`App.tsx`** - root shell; two tab strips (Morning / Replay / Rotation; within Replay: Daily Pull / Replay / Daily Review / Journal). Daily Pull/Review/Journal are `*Screen` functions; Replay is inline. Holds ~20 inline components plus most state and polling effects.
- **`components/`** - charts and panels: `MarketChart`, `ReplayCharts`, `ReviewEntryExitChart`, `RrgPanel` / `RelativeRotationGraph`, `FplIndicatorPanel`, `SpreadSpeedPanel`, `MorningDashboard`, `SpxHeatmapPanel`.
- **`src/*.ts`** - pure logic modules with co-located tests: stats/PnL, RRG (`relativeRotation`), daily-pull/sync, review/journal, morning, heatmap treemap, formatting/util.
- **`api.ts`** - the only caller of `/api/*`.

## 5. Backend (`server/`)
- **`index.ts`** - 30+ `/api/*` routes (port 5174) + static SPA serving; arms FPL, IBKR holdings, SPX Heatmap, and daily-sync catch-up schedulers on listen.
- **`dataImporter.ts`** - the data core (builds tracker + replay payloads; writes `wallet.json` / `review-notes.json`).
- **Other modules:** `morningBrief`, `morningMacroCalendar`, `dailySync` / `dailySyncCatchup`, `spxHeatmap` / `spxHeatmapLive`, `fplLive` / `fplIndicator`, `ibkrHoldings` / `ibkrWalletRefresh`, `rrgBars`, `spreadSpeed`, `googleAuth` / `googleSheetsUpload` / `googleSheetsSnapshot` / `googleSnapshotAutoRefresh`, `godelLiveNews` / `godelAlertBridge`, `morningAiNotes`, `tradeJournalSnapshot`, `desktopAlert`.

## 6. Shared types (`shared/types.ts`)
The frontend/server contracts: `TradeRecord`, `DailySummary`, `TrackerSnapshot`, `SpxBar`, `SpreadMark`, `ReplayPayload`, `WalletSnapshot`, plus the Morning / FPL / RRG / SPX Heatmap / daily pipeline families. The journal-entry type lives in `src/tradeJournal.ts`, not here.

## 7. Data on disk
App state in `data/*.json` (wallet, review-notes, trade-journal, sync status, caches, heatmap state); source data per trading day under `AI STUFF/IBKR Equity History Pull/data/ibkr_trades/<date>/` (entries.csv, summaries, tab CSVs, safe replay/spread-speed state).

## 8. Scripts (`scripts/`)
Desktop launcher + data-refresh jobs: Google snapshot/upload, Rubicon ingest, SPX Heatmap, IBKR holdings/wallet (Python), TC2000 daily bars, Godel news, Windows alerts.

## 9. Conventions
Pure logic in `.ts` + co-located `*.test.ts`; charts created once then `setData` (reference: `FplIndicatorPanel`); ET time via `easternDate.ts`; contracts in `shared/types.ts`; `api.ts` is the only `/api/*` caller.

## 10. Rough Edges
Monoliths to grep within (`App.tsx` ~3k lines, `dataImporter.ts` ~2.2k, `MorningDashboard.tsx` ~1.5k); per-component chart-lifecycle differences; `/api/tracker` now has short cache/coalescing but lower-level JSON write concurrency remains a known watch item; hidden replay dates in `replayDateTabs.ts`; `DailyPnlSimulatorChart` / `morningDiary.ts` tested but unused in render.

## 11. Testing
`vitest`, co-located `*.test.ts`; `npm run validate:mvp` is the gate.

---
_Skim map. Open [`detailedcodebase.md`](detailedcodebase.md) for depth on any line above. Last verified: 2026-06-03._
