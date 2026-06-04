# naive_acceptance.md

```yaml
core_loop_status: GREEN
active_acceptance_id: A144
green_count: 142
green_id_summary: "A01-A12, A14-A19, A21-A144"
yellow_count: 0
red_count: 0
deferred_count: 2
deferred_ids: ["A13", "A20"]
blocked_count: 0
```

## Use This File

- Keep this file short. Put detailed run history in `WORKLOG.md`.
- Add only the current acceptance slice plus the last few relevant deltas.
- A criterion is GREEN only with command, browser, API, data, or artifact proof.

## Current Acceptance

| ID | Requirement | Status | Proof |
|---|---|---:|---|
| A144 | Morning SPX Heatmap nests sector → industry → stock on the Finviz taxonomy, with dual-class holdings merged into one tile | GREEN | New `data/finviz-classification.json` (500 S&P 500 names, 11 Finviz sectors, transcribed from Finviz's map and reconciled vs the live SPY-holdings universe). `server/spxHeatmap.ts` folds GOOG→GOOGL / FOX→FOXA / NWS→NWSA into one weight-summed, %-blended tile (503→500) via `mergeDualClassTiles`, overlays Finviz sector+industry per tile via `applyClassification`, and re-derives sector aggregates via `computeSectors`; `SpxHeatmapTile` gains `industry`; `src/components/SpxHeatmapPanel.tsx` renders a 3-level squarified treemap (sector → industry sub-block/caption → stock). `npm run typecheck` clean, Vitest 377/377 (incl. 2 new loader tests), `npm run build` passed; served `:5183` → `/api/spx-heatmap` returns 500 Finviz-sectored tiles and the treemap renders sector→industry→stock with GOOGL as one merged tile. |

## Recent Deltas

| ID | Requirement | Status | Proof |
|---|---|---:|---|
| A143 | Morning > Estimator centers on live IBKR 0DTE SPX spreads with a per-spread move and an aggregate portfolio response | GREEN | New `src/spreadEstimator.ts` selects 0DTE SPXW verticals from the live holdings pull; `src/portfolioResponse.ts` runs each through the existing Bachelier model on a shared SPX ladder and sums an aggregate P/L curve; `src/components/LiveSpreadEstimatorPanel.tsx` shows live spreads + aggregate as primary with the custom what-if demoted to a collapsed disclosure; `server/ibkrHoldings.ts` adds a 5-minute market-hours live pull. Full Vitest 375/375 and `vite build` passed; typecheck clean for new code. |
| A142 | Morning macro calendar pulls/generates public-source timing for previously rated rows | GREEN | US macro calendar now emits MBA, ADP weekly/monthly, API crude, NAR existing-home sales, UMich preliminary sentiment, NY Empire State, and NAHB HMI timing events. Macro/Morning focused tests, typecheck, and build passed. |
| A141 | FirstSquawk word-filter notifications use native Windows toast notifications | GREEN | Live update alert payloads now call `/api/desktop-alert/live-update`, which launches `scripts/show-windows-toast.ps1` through the existing `Rubicon.RubiconApp` AppUserModelID. Focused tests, PowerShell parser/script smoke, typecheck, build, browser smoke, and API smoke passed. |
| A140 | Daily Pull separates Data Collection, Rubicon Ingest, and Google Upload pipeline stages | GREEN | Status now carries run id, target date, stage rows, review-ready and Google-uploaded verdicts, cross-process lock state, and catch-up state. The wrapper runs Data Collection -> Rubicon Ingest -> Google Upload, with Google failures non-blocking for local review. Focused/full tests, typecheck, build, IBKR pytest, and syntax checks passed. |
| A139 | Morning hides event subheaders and routine Godel, AI Notes, and TC2000 status text | GREEN | Calendar event rows no longer render metadata subheaders, the old Godel setup paragraph is filtered/shortened, AI Notes hides generated empty-state message text, and TC2000 hides the latest-pulls subtitle plus scanner-list count. Focused tests, typecheck, build, and browser smoke passed. |
| A138 | Rubicon shortcuts and app metadata keep the Rubicon icon instead of Edge | GREEN | Desktop and Start Menu shortcuts now use generated `public\favicon.ico`, the launcher/build path ensures the ICO exists, and the app advertises `/favicon.ico` for Edge app-mode. Focused icon tests, shortcut reinstall/inspection, typecheck, and build passed. |
| A137 | Replay and Daily Pull hide routine count/status narration while preserving actionable failure state | GREEN | Replay now avoids pending-today explanation, "full day" wording, trade-count-in-view copy, and chart raw counts; Daily Pull uses terse date/status copy and hides successful source/readiness chatter. Focused tests, typecheck, build, and browser smoke passed. |
| A136 | Calendar notifications work at the computer level, not only inside the app | GREEN | Backend calendar alerts now launch `wscript.exe` with an auto-closing Windows Script Host popup. Focused desktop-alert tests, typecheck, build, live API trigger, and screenshot proof passed. |
| A135 | Morning dashboard hides routine source/success/readiness text while keeping failures visible | GREEN | Morning now shows a date-only header, hides ok source pills/details, strips calendar source metadata and high-importance time/source metadata, uses source-agnostic Live Updates status, suppresses successful IBKR refresh messages, removes AI-note ready copy, and drops TC2000 hit/daily-bar readiness counters. Focused tests, typecheck, build, and browser smoke passed. |
| A134 | Pull Dates can suppress accepted issue-count badges without hiding diagnostics | GREEN | Daily Pull date rows now show a separate `Issues fine` button when a date has a visible issue badge. Accepted dates persist in localStorage and remove only the Pull Dates badge/count; detailed diagnostics remain visible. The Pull Dates rail is wider on desktop and stays before the main panel on narrow screens. Typecheck and build passed. |
| A133 | Old visible-screen Godel watcher is deleted and Morning uses only the minimized-safe DOM bridge | GREEN | Removed watcher server module, Python watcher/test scripts, watcher npm command, shared watcher types, API helpers, Express routes, and Morning Start/Stop watcher controls. Bridge status/setup remains available; focused tests, typecheck, build, stale-reference sweep, and temporary API smoke passed. |
| A132 | TC2000 scanner list highlights stocks that are new versus the prior saved scanner state | GREEN | Morning payloads now carry optional `newSymbols` metadata per TC2000 scanner list, computed from the most recent prior saved Morning state. Scanner stock buttons get a `new` class/accessible label/title and a warm highlight/dot; focused tests, typecheck, build, and browser smoke passed. |
| A131 | Spread Speed uses sidecar-only saved state and cannot reopen the giant upload payload | GREEN | `loadSpreadSpeed()` now reads/rebuilds `rubicon_spread_speed_state.json` through `loadSafeSpxBars()` and option-leg sidecar CSV candidates, with stat-only cache validation and one frame per minute. Daily sync completion refreshes this state with tracker, Replay, and Morning derived state. `/api/spread-speed` no longer forwards `full=1`, and stale full-mode callers stay on the safe-state path. Focused tests, typecheck, build, desktop relaunch, heavy-date timing probes, and live API probes passed. |
| A130 | Explicit Replay uses a per-date safe replay state by default | GREEN | `rubicon_replay_safe_state.json` is written beside each date archive and default `/api/replay` reads it before raw artifacts. Daily sync completion refreshes this safe state with tracker and Morning derived state. Safe Replay avoids the 449MB sheet payload, keeps SPX bars, quick-trade spread marks, OI, and five-minute volume profile rows, while `/api/replay?full=1` remains available for raw-detail audit. Focused importer/sync/summary tests, typecheck, build, desktop relaunch, and heavy-date timing probes passed. |
| A129 | Daily sync completion refreshes derived state and Morning auto-refreshes after the 8:30 ET data window | GREEN | Sync completion now refreshes both `rubicon_tracker_summary.json` and saved Morning state for the completed summary date. App status polling refreshes tracker state once when it observes a new completed sync. Morning auto-refreshes saved state once per ET date at or after 8:30 when showing today's date. Targeted tests, affected Morning/server tests, full Vitest, typecheck, build, desktop relaunch, and live health/status probes passed. |
| A128 | Morning startup avoids row-level Replay/Spread Speed hydration | GREEN | `/api/tracker` now marks replay readiness from compact daily summary fields instead of reading SPX rows from the 449MB `google_sheet_upload_payload.json`, and `App.tsx` fetches `/api/replay` or selected-date `/api/spread-speed` only when Replay/Daily Review views need them. Focused importer/summary tests, typecheck, build, desktop relaunch, one-off timing/memory probes, and live `/api/tracker` probes passed. |
| A127 | Morning brief reads saved per-date state on normal loads and refreshes live sources only on explicit refresh | GREEN | `data\morning-brief-state\YYYY-MM-DD.json` stores the dashboard-ready Morning payload. Normal `/api/morning?date=...` reads saved state; `/api/morning?date=...&refresh=1` pulls live DailyFX/RollCall/TC2000 inputs and rewrites state. The Morning refresh button sends `refresh=1`, while initial loads/polls stay on saved state. Focused Morning-state tests, Morning server/dashboard tests, full Vitest, typecheck, build, desktop relaunch, and live API probes passed. |
| A126 | Tracker dashboard reads compact validated daily summaries instead of giant row-level artifacts | GREEN | `rubicon_tracker_summary.json` is written beside each daily pull folder, `/api/tracker` prefers those compact summaries, coalesces/caches immediate tracker reads, replay/detail still loads chart marks on demand, daily sync refreshes the compact summary after completion, and Google connector rows can confirm upload receipts without downgrading local IBKR counts/statuses. Focused backend tests passed 3 files / 40 tests; typecheck/build passed; one-off loader proof returned June 1 with option status `partial`, 540,996 option/volume rows, and about 1.2s load time. |
| A125 | Godel bottom-right blips can be captured while the Godel window is minimized | GREEN | Live Updates now shows a minimized-safe Godel DOM bridge setup/status strip. The setup page provides a bookmarklet that arms a MutationObserver inside the Godel page, watches bottom-right/toast-like DOM changes, posts headline-like blips back to Rubicon, and rejects numeric ladder rows. Focused bridge/Morning/Godel tests, typecheck, build, setup/status/ingest API probes, and live-update API probe passed. |
| A124 | Godel alert watcher can be started/stopped from Morning and rejects numeric false positives | GREEN | Live Updates shows a visible-screen Godel watcher strip with Start/Stop/status. The watcher calibrates from a visible `v4.4.9`-style Godel chat anchor to the right edge above the bottom bar, reports `anchor-not-found` when Godel is not visible, and rejects mostly numeric ladder rows. Focused Python/test checks, Morning/Godel Vitest files, typecheck, build, desktop relaunch, and API probes passed. |
| A123 | Desktop launcher restarts stale Rubicon backends before opening | GREEN | `npm run desktop` now rebuilds stale `dist`, restarts existing Rubicon servers by health PID, cleans up detached non-watch `server/index.ts` Rubicon processes including stale ports like `5187`, and starts the API with a configurable 16GB default heap. Health proof returned PID/start/appRoot, and the June 8 Morning probe returned `inflationExpectationsCount=0`. Syntax check, typecheck, and build passed. |
| A122 | Daily Review counts regular exits by closing action side | GREEN | CCS exits now map to Long/Put action side and PCS exits map to Short/Call action side in `buildDailyReview()` and `buildReviewMarkers()`. Timeline pills show Long/Short, the chart legend explains Long = PCS entries / CCS exits and Short = CCS entries / PCS exits, focused `src/stats.test.ts` passed 24 tests, typecheck passed, and build passed. |
| A121 | Morning high-importance events match live DailyFX/IG rows and preserve source names | GREEN | Live DailyFX/IG probe for `2026-06-01` through `2026-06-15` returned only `importance: 3` U.S. rows; direct `loadMorningBrief("2026-06-02")` matched those rows with no extras. Visible titles now preserve exact source names for single-row events and source-name clusters for simultaneous rows. Focused tests, typecheck, and build passed. |
| A120 | Morning Calendar splits today's agenda left and High-only major events right | GREEN | `MorningAgendaSection` renders today's DailyFX/RollCall agenda first and `Major events` second; desktop CSS splits into equal columns and mobile stacks. `parseIgMajorCalendarEvents()` keeps only DailyFX/IG `importance >= 3` rows while preserving monthly OPEX. Focused tests passed; Browser proof at `http://[::1]:5174/?qa=calendar-split-high-only` showed left/right columns, no medium major text, clean console, and no mobile overflow. |

## Core Loop Summary

Rubicon is GREEN for the local MVP loop:

Trader opens Rubicon -> Morning shows macro/live/model prep -> Replay imports local SPX tracker data -> trader reviews P/L and session health -> trader selects a trade -> replay charts advance through the day -> journal/review state persists locally.

## Deferred

| ID | Reason |
|---|---|
| A13 | Separate admin/operator view is outside the local MVP. |
| A20 | Full AI feature fallback remains deferred unless made core product scope. |

## Evidence Standard

Use the narrowest proof first:

1. Focused unit tests for logic.
2. `npm run typecheck` for TypeScript.
3. `npm run build` for shipped bundle proof.
4. Browser/API smoke only when UI, layout, or runtime wiring changed.

Full historical proof lives in `WORKLOG.md`; do not paste old acceptance rows back into this file.
