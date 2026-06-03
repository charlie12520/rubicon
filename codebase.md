# Rubicon — Codebase Map

> Fast orientation for agents (and humans). **Rubicon** is a personal **SPX 0DTE credit-spread morning-intelligence, trade-tracker & replay cockpit** — a Vite/React PWA talking to a small Express API (port 5174) that reads/writes JSON & CSV on disk (no database).
>
> **This is the skim map** — use it to find the right module without reading large files end to end. **For full detail** (every route, type field, component, data file, and script, plus a task→section quick-reference) **see [`detailedcodebase.md`](detailedcodebase.md).** Other root docs: `AGENTS.md` (how-to-operate), `GOAL-perf-safety-fixes.md` (outstanding fixes).

**Top-level layout:** `src/` (frontend) · `server/` (Express API) · `shared/types.ts` (shared contracts) · `scripts/` (refresh/launch jobs) · `data/` (runtime JSON state).

---

## 1. Overview
Local-first cockpit for one SPX 0DTE trader: imports the sibling "AI STUFF" pipeline's data, shows P/L & positions, replays a day bar-by-bar, runs a morning brief (calendars + live squawk + holdings + AI notes), an RRG, and an FPL prediction model. → *detail §1.*

## 2. Running
`npm run dev` (API + client) · `npm run build` then `npm run serve:app` (one port) · `npm test` · `npm run validate:mvp` (typecheck→test→build — the gate). → *detail §2.*

## 3. Architecture
`App` → `src/api.ts` → `/api/*` (Express `server/index.ts`) → `server/*.ts` loaders → read AI STUFF source data + app `data/`. `GET /api/tracker` → `loadTrackerSnapshot()` is the primary read (auto-refresh ~60 s); replay via `GET /api/replay`. → *detail §3.*

## 4. Frontend (`src/`)
- **`App.tsx`** — root shell; two tab strips (Morning / Replay / Rotation; within Replay: Daily Pull / Replay / Daily Review / Journal). Daily Pull/Review/Journal are `*Screen` functions, Replay is inline. Holds ~20 inline components + most state + the polling effects.
- **`components/`** — charts & panels: `MarketChart`, `ReplayCharts`, `ReviewEntryExitChart`, `RrgPanel` / `RelativeRotationGraph`, `FplIndicatorPanel`, `SpreadSpeedPanel`, `MorningDashboard`.
- **`src/*.ts`** — ~30 pure logic modules (each with a co-located test): stats/PnL, RRG (`relativeRotation`), daily-pull/sync, review/journal, morning, formatting/util.
- **`api.ts`** — the only caller of `/api/*`.
→ *detail §4 (full component table, module list, endpoint table).*

## 5. Backend (`server/`)
- **`index.ts`** — 25 `/api/*` routes (port 5174) + static SPA serving; arms the FPL/IBKR auto-refresh schedulers on listen.
- **`dataImporter.ts`** — the data core (builds the tracker + replay payloads; writes `wallet.json` / `review-notes.json`).
- **Other modules:** `morningBrief`, `dailySync`, `fplLive` / `fplIndicator`, `ibkrHoldings` / `ibkrWalletRefresh`, `rrgBars`, `spreadSpeed`, `googleSheetsSnapshot` / `googleSnapshotAutoRefresh`, `godelLiveNews`, `morningAiNotes`, `tradeJournalSnapshot`, `desktopAlert`.
→ *detail §5 (route table + module table with side-effect flags + loaders).*

## 6. Shared types (`shared/types.ts`)
The frontend↔server contracts: `TradeRecord`, `DailySummary`, `TrackerSnapshot`, `SpxBar`, `SpreadMark`, `ReplayPayload`, `WalletSnapshot`, plus the Morning / FPL / RRG families. (The journal-entry type lives in `src/tradeJournal.ts`, not here.) → *detail §6 (key fields).*

## 7. Data on disk
App state in `data/*.json` (wallet, review-notes, trade-journal, sync status, caches); source data per trading day under `AI STUFF/IBKR Equity History Pull/data/ibkr_trades/<date>/` (entries.csv, summaries, tab CSVs). → *detail §7 (file tables, path resolution, env overrides).*

## 8. Scripts (`scripts/`)
Desktop launcher + data-refresh jobs: Google snapshot, IBKR holdings/wallet (Python), TC2000 daily bars, Godel news. → *detail §8 (file → npm-script table).*

## 9. Conventions
Pure logic in `.ts` + co-located `*.test.ts`; charts created once then `setData` (reference: `FplIndicatorPanel`); ET time via `easternDate.ts`; contracts in `shared/types.ts`; `api.ts` is the only `/api/*` caller. → *detail §9.*

## 10. Rough edges
Monoliths to grep within (`App.tsx` ~3k lines, `dataImporter.ts` ~2.2k, `morningBrief.ts` ~1.7k, `MorningDashboard.tsx` ~1.5k); per-component chart-lifecycle differences; no `/api/tracker` caching + non-atomic writes → see `GOAL-perf-safety-fixes.md`; hidden replay dates in `replayDateTabs.ts`; `DailyPnlSimulatorChart` / `morningDiary.ts` tested but unused in render. → *detail §10.*

## 11. Testing
`vitest`, co-located `*.test.ts`; `npm run validate:mvp` is the gate. → *detail §11.*

---
_Skim map — open [`detailedcodebase.md`](detailedcodebase.md) for depth on any line above. Last verified: 2026-06-01._
