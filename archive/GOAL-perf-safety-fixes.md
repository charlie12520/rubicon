# GOAL — Rubicon performance & safety fixes (items 1–7)

> Historical note: this goal is superseded by the current ledger and codebase maps. Several items here have since changed state, including the lint gate, CI, `jsonStore`, Godel bridge removal, and tracker cache/coalescing. Current startup docs are `AGENTS.md`, `codebase.md`, `WORKLOG.md`, `naive_acceptance.md`, and `naive_validation.md`.

_Created 2026-06-01 from a code review of the Rubicon app. Self-contained: a fresh Claude Code session can execute this against `C:\Users\charl\Desktop\AI STUFF\spx-spread-replay-tracker` without prior context._

## Goal

Eliminate the recurring wasted work and the silent-failure/crash risks surfaced in review, **without changing user-visible behavior** (other than the bug fix in item 7) and **without breaking the existing vitest suite**. All line numbers are as-of the review and may have drifted by a few lines — confirm before editing.

## Definition of done

- `npm run validate:mvp` is green (it runs `typecheck` → `test` → `build`).
- Every symbol currently imported by tests stays exported with the same name/signature (the chart components export many pure helpers consumed by `src/stats.test.ts` and `src/components/ReplayCharts.test.ts` — do not rename or relocate them).
- New tests added where noted below.
- No change to the cockpit UI/design.

## Suggested execution order (each batch independently shippable)

1. **Batch A — pure wins, low risk:** items 3, 4, 7. (No new files, small diffs, easy to test.)
2. **Batch B — backend perf:** item 1.
3. **Batch C — backend safety:** items 5, 6.
4. **Batch D — frontend charts:** item 2. (Largest refactor; do last so the rest is already validated.)

---

## Item 1 — Cache the trade-history reads behind `GET /api/tracker`

**Problem.** `loadTrackerSnapshot` (`server/dataImporter.ts:1794`, the entire body of `GET /api/tracker` at `server/index.ts:33`) re-reads and re-parses the full per-date trade history on every request, with zero caching. The frontend polls this every 60 s (`AUTO_IMPORT_REFRESH_MS`), and cost grows unbounded with each trading day. Same files are also read redundantly within a single request.

**Files.** `server/dataImporter.ts` only.

**Plan.**
1. Add an **mtime-gated** parse cache at the two choke points so every downstream caller benefits with no call-site edits:
   - `readCsv` (`server/dataImporter.ts:95`) and `readJson<T>` (`:270`).
   - Use a module-level `const csvCache = new Map<string, { mtimeMs: number; rows: CsvRow[] }>()` and likewise for JSON. On each call: `await fs.stat(absPath)` once (replaces the existing `pathExists` `fs.access`), compare `stat.mtimeMs` to the cached entry, reuse on hit, otherwise read+parse and store. On `ENOENT`/parse failure, return the existing fallback (`[]` / `fallback`) and **do not** cache.
   - **mtime in the key is mandatory** — it keeps the write-backed files (`review-notes.json`, `wallet.json`) correct (a rewrite bumps mtime → cache miss) and keeps the two write→read round-trip tests in `dataImporter.test.ts` green. A path-only cache would break them.
   - There is no existing module-level cache/Map in this file to collide with (only the constant `TRADE_REVIEW_FLAGS` set at `:1725`).
   - Because `readFirstCsv`, `readCsvOrPayloadTab(Candidates)`, `loadSpxBars`, `loadSpreadMarks`, `loadOpenInterest`, `loadVolume` all bottom out in `readCsv`, and `readPayloadTabRows` + `loadDailySummary` bottom out in `readJson`, caching these two transparently covers the SPX double-read in `loadReplayPayload` (`:2202` vs inside `loadTradesForDate` `:944`), the spread-marks double-read, the `buildSourceHealth` SPX re-read (`:1839`), and `spreadSpeed.ts` (imports `loadSpxBars`/`readFirstCsv`).
2. **Parallelize the independent awaits** in `loadTrackerSnapshot` — `:1801` `readGoogleDriveTrackerSnapshot()`, `:1802` `readGoogleDriveReceiptChecks()`, `:1808` `readWallet()`, `:1809` `readReviewNotes()` are mutually independent; wrap in a single `Promise.all`. (Keep `tradeDates()` first and `buildSourceHealth(...)` last — it consumes `trades`/`summaries`/`wallet`.)
3. **Remove the redundant in-memory transform** in `spxReferenceFromPayload` (`server/dataImporter.ts:504-505`): `payloadTabRecords(payload, "SPX 5s")` is built twice. Hoist to a local: `const fiveS = payloadTabRecords(payload, "SPX 5s"); const rows = fiveS.length ? fiveS : payloadTabRecords(payload, "SPX 1m");`

**Design note.** The snapshot object is still rebuilt per request (so `generatedAt`/`today`/merge logic stay fresh) — only the file *parsing* is cached. That's the intended behavior.

**Tests.**
- Existing `dataImporter.test.ts` already pins value-correctness across repeated `loadTrackerSnapshot()`/`loadReplayPayload()` calls and the two write→read round-trips — keep them green.
- Add one test: call `loadTrackerSnapshot()` twice and deep-equal the `trades`/`dailySummaries`; optionally spy on `fs.readFile` to assert the per-date files are parsed once across the two calls.

**Acceptance.** Second consecutive `/api/tracker` parses no per-date file whose mtime is unchanged; review-notes/wallet round-trip tests still pass.

**Risk.** Low. Main pitfall is caching write-backed JSON without mtime — avoid by keying on mtime as specified.

---

## Item 2 — Stop the chart components recreating the whole chart every render

**Problem.** `MarketChart` (`src/components/MarketChart.tsx`) and `ReviewEntryExitChart` (`src/components/ReviewEntryExitChart.tsx`) build the chart (createChart + addSeries + setData + subscriptions + `chart.remove()`) inside one effect whose deps churn every render:
- `MarketChart` effect deps are `[props]` (`:151`) — `props` is a new object every render; in `ReplayCharts.tsx` the spread chart also gets `toolbar={<SpreadChartToggle … />}` (`:49`, `:58`), a fresh element each render. During replay playback the chart is destroyed/rebuilt several times per second.
- `ReviewEntryExitChart` effect deps `[bars, displayBars, pnlPoints, trades, onSelectTrade]` (`:297`); `onSelectTrade` is a fresh inline arrow from App (`App.tsx:883`) and `pnlPoints` defaults to a fresh `[]` (`:111`), so it rebuilds on essentially every parent render.

**Reference pattern (already correct in this repo):** `src/components/FplIndicatorPanel.tsx` — createChart + addSeries once in a `[]` effect storing refs (`:271-317`), all `setData`/markers/visible-range in a separate data effect keyed on data inputs (`:319-350`). **Mirror this.**

**Files.** `src/components/MarketChart.tsx`, `src/components/ReviewEntryExitChart.tsx`, and small touch to `App.tsx` (stabilize the `onSelectTrade` passed to the review chart).

**Plan — MarketChart.**
- Refs: keep `containerRef`; add `chartRef`, `seriesRef`, and a cleanup ref for the event-cross overlay.
- **Mount effect, deps `[props.kind]`** (series type/options are the only structural input): `createChart(...)` (`:67-93`) → `chartRef`; the one `addSeries` for the active kind → `seriesRef`; keep `chart.remove()` cleanup; null refs.
- **Data effect, deps `[props.data, props.events]`**: map data → `series.setData(...)`; tear down prior event-cross cleanup then re-run `renderEventCrosses(...)` storing the new cleanup; `chart.timeScale().fitContent()`.
- `title`/`toolbar` are pure JSX (`:156-159`) and never touch the chart — no handling needed. `accent` is only read in the `line` branch's `addSeries`; treat as structural (or apply via `series.applyOptions` in the data effect).

**Plan — ReviewEntryExitChart.**
- Refs: keep `containerRef`; add `chartRef`, `candleSeriesRef`, `pnlSeriesRef` (nullable; overlay is conditional), overlay/cleanup refs for the hover readout, P/L-axis overlay, and marker layer, plus `onSelectTradeRef`.
- **Mount effect, deps `[]`**: `createChart(...)` (`:131-162`); candle `addSeries` (`:244-250`); create the hover-readout div once and `subscribeCrosshairMove` once (have the handler read latest `displayBars`/`pnlPoints` via refs). Cleanup: unsubscribe, remove readout, `chart.remove()`, null refs.
- **Data effect, deps `[displayBars, pnlPoints, trades]`** (note: **no `onSelectTrade`**): candle `setData`; lazily create/destroy/`setData` the P/L overlay series + axis overlay based on `hasPnlOverlay = buildReviewPnlLineData(pnlPoints, displayBars).length > 1`; tear down + rebuild markers via `renderMarkers(...)` (the marker click handler calls `onSelectTradeRef.current?.(trade)`); `fitContent()`.
- **Ref-sync effect, deps `[onSelectTrade]`**: `onSelectTradeRef.current = onSelectTrade`.
- Stabilize the default: replace `pnlPoints = []` (`:111`) with a module-level `const EMPTY_PNL_POINTS: DailyPnlSimulationPoint[] = []` used as the default. Drop the redundant `bars` from data-effect deps (keep `displayBars`).
- In `App.tsx`, wrap the inline arrow passed as `onSelectTrade`/`onReplayTrade` (`:883-889`) in `useCallback` (defence-in-depth; the ref makes the chart immune regardless).

**Tests.** Keep every helper currently exported from both files (consumed by `src/stats.test.ts` and `src/components/ReplayCharts.test.ts`) — do not rename/relocate `chartCountLabel`, `SPREAD_HL_BAR_OPTIONS`, `aggregateReviewBars`, `buildReviewMarkers`, `groupReviewMarkers`, `buildReviewPnlLineData`, `reviewHoverReadoutForTime`, etc. No render test exists today; **add** one that mocks `lightweight-charts`' `createChart` and asserts it is called once across data-only prop changes (regression guard for the new lifecycle).

**Acceptance.** Advancing `replayIndex` (replay playback) and toggling unrelated state no longer calls `createChart`/`chart.remove()`; only `series.setData` runs.

**Risk.** Medium (largest refactor). Watch zoom/pan preservation — if you want to keep user zoom, guard `fitContent()` to first-data-only.

---

## Item 3 — Narrow the `App.tsx` memo dependencies off the whole `snapshot`

**Problem.** Core memos depend on the whole `snapshot` object, but each reads only one slice. `refreshSnapshot` calls `setSnapshot(next)` every 60 s with a brand-new object even when data is byte-identical, so every memo recomputes over full history and the tree re-renders. (Lines `App.tsx:215` and `:222` already do this correctly — copy that pattern.)

**Files.** `src/App.tsx`.

**Plan.** Narrow each dependency array to the slice actually read:
- `:200` `visibleTrades` → replace `snapshot` with `snapshot?.trades`.
- `:202` `stats` → `[snapshot?.wallet, visibleTrades]`.
- `:205` `tradesForSelectedDate` → `[selectedDate, snapshot?.trades]`.
- `:213` `selectedSummary` → `[selectedDate, snapshot?.dailySummaries]`.
- `:223` `freshness` — open `src/marketFreshness.ts`, check which `snapshot` fields `marketFreshness` reads; narrow deps to those. If it genuinely needs most of the object, leave it on `snapshot` (it's cheap and low-priority).

**Tests.** No new test (re-render counts aren't unit-tested); rely on `npm run validate:mvp` and a manual check that the dashboard still updates after a refresh.

**Acceptance.** A 60 s refresh that returns identical trade data does not recompute `visibleTrades`/`stats`/`tradesForSelectedDate`/`selectedSummary`.

**Risk.** Very low.

---

## Item 4 — Stabilize `refreshSnapshot` so the polling intervals stop churning

**Problem.** `refreshSnapshot` (`src/App.tsx:225`) lists `[marketToday, range, refreshing, selectedDate]` as deps (`:262`); `refreshing` is toggled by the function itself, so its identity changes every cycle. The auto-import effect (`:341-363`, deps `[refreshSnapshot, snapshot]`) and the 15 s completion-poll effect (`:410-434`, deps `[dailySyncRunning, refreshSnapshot]`) therefore tear down and re-register their `setInterval`/listener every refresh.

**Files.** `src/App.tsx`.

**Plan.**
- Add a `refreshingRef = useRef(false)`; use it for the in-flight guard (`if (refreshingRef.current) return; refreshingRef.current = true; … finally { refreshingRef.current = false }`). Keep the existing `setRefreshing(true/false)` for UI state, but the **guard** reads the ref.
- Add a `latestRef = useRef({ marketToday, range, selectedDate })` and assign `latestRef.current = { marketToday, range, selectedDate }` in the component body (synchronous, every render). Inside `refreshSnapshot`, read these from `latestRef.current` instead of closing over the props/state.
- Then make it `useCallback(async ({ silent = false } = {}) => { … }, [])` (stable identity).

**Tests.** Keep `src/refreshLogic.test.ts` and `src/appRefresh.test.ts` green (they test the pure helpers `selectDateAfterTrackerRefresh`/`marketDateFromSnapshot`, which are unchanged). Validate via `npm run validate:mvp`.

**Acceptance.** The auto-import interval (`:346`) is created once when `snapshot` first loads and is not re-created on subsequent refreshes.

**Risk.** Low. Verify the guard still prevents overlapping refreshes (it does — the ref flips synchronously before the first `await`).

---

## Item 5 — Atomic JSON writes (stop silent data loss)

**Problem.** Several endpoints do a full-overwrite write of shared JSON with no temp+rename; a crash mid-write truncates the file, and the per-module `readJson` helpers then silently return `{}`/`null`/fallback — i.e. all review notes / journal entries / status vanish with no error. There is **no shared write helper** today; every site calls `fs.writeFile` directly.

**Files.** New `server/jsonStore.ts`; edits to `dataImporter.ts`, `tradeJournalSnapshot.ts`, `morningBrief.ts`, `dailySync.ts`, `scripts/refresh-google-drive-snapshot.ts`.

**Plan.**
1. Create `server/jsonStore.ts`:
   ```ts
   import fs from "node:fs/promises";
   import path from "node:path";
   export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
     await fs.mkdir(path.dirname(target), { recursive: true });
     const tmp = `${target}.tmp`;
     await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
     await fs.rename(tmp, target); // atomic on same volume (all targets live in ./data)
   }
   ```
   (Always append `\n`; `JSON.parse` ignores it and the round-trip tests re-parse, so it's harmless. The helper must **not** swallow errors.)
2. Migrate these call sites to `writeJsonAtomic`:
   - `server/dataImporter.ts:1778` `writeReviewNote` (true read-modify-write — highest priority).
   - `server/dataImporter.ts:1790` `writeWallet`.
   - `server/tradeJournalSnapshot.ts:78` `writeTradeJournalSnapshot`.
   - `server/morningBrief.ts:1550` `writeLastGoodLiveUpdateCache` (**keep** the surrounding `try/catch` — it's best-effort by design).
   - `server/dailySync.ts:141` `writeStatus`.
   - `scripts/refresh-google-drive-snapshot.ts:169` `refreshGoogleDriveSnapshot`.
   - Leave the `createWriteStream` **log** sites and test-fixture writes alone. `scripts/capture-godel-news.mjs:30` writes raw (non-JSON) text — optional, lower priority.

**Tests.**
- Existing `dataImporter.test.ts` (review-notes + wallet round-trips) and `morningBrief.test.ts` (live-update cache round-trip) use env-overridable temp paths and re-read — `.tmp`+rename is transparent. Keep green.
- `tradeJournalSnapshot` has **no test** today — add a round-trip test (write then read back via the loader) alongside the migration.

**Acceptance.** A write interrupted before `rename` leaves the original file intact; round-trip tests pass.

**Risk.** Low. `fs.rename` is atomic only within one volume — all targets are under `process.cwd()/data` with `.tmp` in the same dir, so this holds on NTFS.

---

## Item 6 — Add `'error'` handlers so a child/stream failure can't crash the server

**Problem.** Async resources emit `'error'` events that, unhandled, become uncaught exceptions and take down the whole API. The route try/catch does not help — the event fires after the call returns.

**Files.** `server/desktopAlert.ts`, `server/dailySync.ts`, `server/fplLive.ts` (+ optional `server/ibkrHoldings.ts`).

**Plan.**
- `server/desktopAlert.ts:28` — the spawned `powershell.exe` has **no** `child.on("error", …)` (only `child.unref()` at `:49`). Add `child.on("error", (err) => console.error("desktop alert spawn failed", err))` before `unref()`. (This is the only unguarded spawn — the spawns in `dailySync.ts:338` and `fplLive.ts:250` already handle `'error'`.)
- `server/dailySync.ts:335` — the `createWriteStream(DAILY_SYNC_LAUNCH_LOG, …)` has no error handler. Add `logStream.on("error", (err) => console.error("daily-sync log stream error", err))`.
- `server/fplLive.ts:247` — same for the `LIVE_LOG` stream: add `logStream.on("error", …)`.
- **Optional (robustness, not a crash):** the two boot-time `setInterval`s with no disposer and not `.unref()`-ed — `server/fplLive.ts:187` (`autoStartTimer`) and `server/ibkrHoldings.ts:140` (`autoRefreshTimer`). Add `.unref()` and/or expose a disposer for clean shutdown/tests.

**Tests.** `desktopAlert.test.ts` only tests `sanitizeDesktopAlertText`; `dailySync.test.ts` uses `dryRun` and never hits the stream — so these additions are unconstrained and won't break anything. No new test required (a spawn-failure test is hard to make deterministic); the goal is simply "does not crash."

**Acceptance.** Simulating a stream/spawn `'error'` (e.g. point the log at an unwritable path) logs and continues instead of crashing the process.

**Risk.** Very low.

---

## Item 7 — Fix the daily P/L simulator treating an unparseable exit as "open forever" (+ remove the inner-loop re-parse)

**Problem.** In `buildDailyPnlSimulation` (`src/dailyPnlSimulator.ts:62-96`), the inner `for (const trade of trades)` loop re-parses `chartTimestamp(trade.entryTime)` and `chartTimestamp(trade.exitTime)` (`:78-79`) on **every** timeline tick (~4,680 SPX 5 s ticks × N trades). Worse, `chartTimestamp` (`:161`) returns `0` for any unparseable string, so a trade with a present-but-malformed `exitTime` (`exitTime ? chartTimestamp(...) : 0` → 0) fails the `if (exitTime && time >= exitTime)` guard at `:84` and is counted as **perpetually open**, corrupting `openPnl`/`openTradeCount`/`totalPnl` for every later tick.

**Files.** `src/dailyPnlSimulator.ts`.

**Plan.** Precompute per-trade timestamps **once** before the `.map`, and give a present-but-unparseable exit a real fallback (session end), mirroring how `stats.ts` falls back to session end:
```ts
const sessionEndTime = sortedTimes.length ? sortedTimes[sortedTimes.length - 1][0] : 0;
const tradePlan = trades.map((trade) => {
  const entryTime = chartTimestamp(trade.entryTime);
  const rawExit = trade.exitTime ? chartTimestamp(trade.exitTime) : 0;
  // present-but-unparseable exit → realize at session end, not "open forever"
  const exitTime = trade.exitTime && !rawExit ? sessionEndTime : rawExit;
  return { trade, entryTime, exitTime };
});
```
Then the inner loop iterates `tradePlan` and reads the cached `entryTime`/`exitTime` (no `chartTimestamp` calls inside the tick loop). This fixes the correctness bug **and** removes the hundreds-of-thousands of redundant `Date.parse` calls in one change.

**Tests.** Add to `src/dailyPnlSimulator.test.ts`:
- A trade with a present-but-unparseable `exitTime` is realized (not left open) by the last tick — assert final `openTradeCount === 0` and `realizedPnl` includes its `trade.pnl`.
- Keep existing normal-exit and still-open (`exitTime` absent) cases green to prove no regression.

**Acceptance.** New test passes; existing simulator tests unchanged.

**Risk.** Low. Confirm the "genuinely open" case (`trade.exitTime` absent/empty) still yields `exitTime === 0` and is treated as open (it does: `trade.exitTime` is falsy → `rawExit = 0`, and the `trade.exitTime && !rawExit` fallback is skipped).

---

## Final validation

Run `npm run validate:mvp` after each batch. For item 2, additionally launch the app and step through replay playback to confirm the charts no longer flicker/rebuild.
