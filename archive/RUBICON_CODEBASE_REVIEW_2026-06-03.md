# Rubicon Codebase Review - 2026-06-03

> Point-in-time review artifact. This file preserves the read-only review findings from 2026-06-03 and should not be treated as the current codebase map or active validation ledger. For current orientation, read `codebase.md` and `detailedcodebase.md`; for current status, read `WORKLOG.md`, `naive_acceptance.md`, and `naive_validation.md`.

## Executive Summary

This was a read-only review of Rubicon source, tests, scripts, configs, and docs. It excluded raw trade-data contents and generated/runtime folders such as `node_modules`, `dist`, `data`, `artifacts`, `output`, screenshots, and logs.

Four read-only subagents reviewed frontend, backend, tooling/tests, and maintainability/duplicates. I also ran the validation ladder locally and verified the highest-risk claims directly.

Overall state:

- `npm run typecheck`, `npm run test`, `npm run build`, and `npm audit --audit-level=moderate` passed.
- `npm run lint` failed with 45 errors and 4 warnings.
- Browser smoke passed on `http://127.0.0.1:5174` across Morning, Heatmap, Replay, Daily Pull, Daily Review, Journal, and Rotation, with no console/page errors and no horizontal overflow.
- `http://[::1]:5174/api/health` did not answer in the review run, while `http://127.0.0.1:5174/api/health` did.
- The visible Morning smoke showed `HTTP 401 Unauthorized` for the DailyFX/IG major-event source. This was a source/config warning, not an app crash.

Protected working tree changes at review start:

- Modified: `AGENTS.md`
- Modified: `src/App.tsx`
- Modified: `src/components/MorningDashboard.tsx`
- Modified: `src/components/SpxHeatmap.css`
- Modified: `src/components/SpxHeatmapPanel.tsx`
- Untracked: `scripts/_shot_grid.mjs`

## Findings Ordered By Severity

### P1-01 - Dev/proxy host mismatch can reproduce local fetch failures

References:

- `server/index.ts:41-42`
- `vite.config.ts:7-10`
- `package.json:7-9`

Why it matters:

Rubicon's local workflow depends on the browser fetching `/api/*`. The server defaults to `127.0.0.1`, but the Vite dev proxy points to `http://[::1]:5174`. In this review run, `[::1]:5174` did not answer and `127.0.0.1:5174` did. That mismatch can make `npm run dev` look like "Rubicon failed to fetch" even when the API is healthy on the other loopback address.

Evidence:

- `Invoke-RestMethod http://[::1]:5174/api/health` failed.
- `Invoke-RestMethod http://127.0.0.1:5174/api/health` returned `ok: true` and the correct Rubicon `appRoot`.
- `server/index.ts` defaults `resolveRubiconListenHost()` to `127.0.0.1`.
- `vite.config.ts` proxies `/api` to `[::1]`.

Suggested fix:

Pick one default loopback host and use it consistently in `server/index.ts`, `vite.config.ts`, desktop launch docs, and `AGENTS.md`. If IPv6 `[::1]` is preferred, make `npm run dev:server` set `RUBICON_LISTEN_HOST=::1`; otherwise point the Vite proxy to `127.0.0.1`.

Suggested validation:

- `npm run dev`
- Browser smoke `http://[::1]:5173` or the chosen dev URL.
- API health on the chosen host.

### P1-02 - Mutating local endpoints have no auth, CSRF, or origin guard

References:

- `server/index.ts:54`
- `server/index.ts:76`
- `server/index.ts:96`
- `server/index.ts:126`
- `server/index.ts:155`
- `server/index.ts:240`
- `server/index.ts:250`
- `server/index.ts:352`
- `server/index.ts:411`
- `server/index.ts:421`
- `server/index.ts:429`
- `server/index.ts:443`
- `server/index.ts:456`

Why it matters:

Any browser page or local process that can reach Rubicon can attempt state-changing requests. Some routes can launch Daily Sync, start/stop live sidecars, refresh broker snapshots, write wallet/review/journal state, or trigger desktop alerts. This is especially risky if the bind host is widened with `RUBICON_LISTEN_HOST=0.0.0.0`, which the server supports.

Evidence:

- The only global middleware is `app.use(express.json())`.
- The mutating routes do not share an origin/session/secret guard.
- Some actions do not require a JSON body to have an effect, such as daily sync defaulting to `auto`.

Suggested fix:

Add a shared mutation guard for every `POST`/`PUT` route. Minimum local-first version: require loopback remote address plus same-origin or a local admin token for mutation routes. Reject missing/foreign `Origin` on browser requests. Add `Cache-Control: no-store` where mutation setup pages expose tokens.

Suggested validation:

- Route tests for allowed loopback same-origin mutation.
- Route tests rejecting missing/foreign origin or missing token.
- Browser smoke to confirm normal app buttons still work.

### P1-03 - Journal snapshot save can overwrite newer server state from a stale tab

References:

- `src/App.tsx:143-147`
- `src/App.tsx:2893-2897`
- `server/index.ts:456-458`
- `server/tradeJournalSnapshot.ts:86-89`

Why it matters:

Rubicon's core loop includes local journal persistence. The app sends the entire client-side `journalEntries` object whenever it changes, and the server rewrites the whole journal snapshot from that payload. A stale tab or partial client state can replace the server file with fewer entries.

Evidence:

- `App.tsx` saves the whole journal snapshot in a `useEffect`.
- `writeTradeJournalSnapshot()` sanitizes only the caller payload and writes that complete map.
- Existing tests cover sanitization, not stale-client overwrite/merge behavior.

Suggested fix:

Change the server route from whole-file replacement to upsert/merge by `tradeId`, using `updatedAt` to resolve conflicts. Keep full replacement only behind an explicit maintenance route if needed.

Suggested validation:

- Two-client regression test: write entry A, then stale client writes entry B without A; final snapshot contains A and B.
- Existing journal tests.
- `npm run test -- server/tradeJournalSnapshot.test.ts src/tradeJournal.test.ts`

### P1-04 - Replay charts recreate chart instances during scrub/autoplay

References:

- `src/components/MarketChart.tsx:56-66`
- `src/components/ReplayCharts.tsx:21-27`
- `src/components/ReplayCharts.tsx:40-60`

Why it matters:

Replay is the central product workflow. `ReplayCharts` derives new visible arrays as `replayIndex` advances, and `MarketChart` creates/removes the chart inside an effect keyed by the whole `props` object. That means playback can rebuild charts repeatedly instead of updating existing series, causing CPU waste, state reset risk, and visible jitter.

Evidence:

- Frontend subagent traced `ReplayCharts` changing `visibleSpx`/`visibleSpread` every tick.
- `MarketChart` creates the chart inside `useEffect`.
- Prior codebase docs already call out chart lifecycle drift and recommend the `FplIndicatorPanel` set-data pattern.

Suggested fix:

Refactor chart components to create chart/series once per kind/container and update data through refs with `series.setData`. Move overlay/event rendering behind a targeted update path.

Suggested validation:

- Component test that rerenders `ReplayCharts` across replay index changes and asserts `createChart` is called once per chart.
- Manual Replay autoplay smoke for smooth chart updates.

### P1-05 - Lint is red but the green gate does not run lint

References:

- `package.json:18`
- `package.json:23-25`
- `eslint.config.js:8-22`

Why it matters:

Rubicon can pass the documented MVP gate while known static defects remain. This undercuts CI readiness and makes future cleanup harder.

Evidence:

- `npm run lint` failed with 45 errors and 4 warnings.
- `npm run typecheck`, `npm run test`, and `npm run build` passed.
- `validate:mvp` is `typecheck && test && build`, so lint is excluded.

Representative lint failures:

- Unused parameters in `server/desktopAlert.test.ts`.
- `no-control-regex` in `server/desktopAlert.ts`.
- `preserve-caught-error` in API/client error handling.
- React `set-state-in-effect` findings in `src/App.tsx`, `FplIndicatorPanel`, and current heatmap code.
- `react-refresh/only-export-components` in chart modules.

Suggested fix:

First decide whether lint is a release gate. If yes, fix or explicitly baseline the current failures, then add `npm run lint` to `validate:mvp` and CI. If not, document lint as advisory and create a separate debt ticket.

Suggested validation:

- `npm run lint`
- `npm run validate:mvp`

### P2-01 - Godel bridge hardcodes `127.0.0.1:5174` and exposes a reusable token through GET pages

References:

- `server/godelAlertBridge.ts:104-108`
- `server/godelAlertBridge.ts:184-187`
- `server/godelAlertBridge.ts:303-309`
- `server/index.ts:293-298`

Why it matters:

Morning live-update capture can silently post to the wrong local host/port when Rubicon runs on `[::1]` or another port. Also, the setup/bookmarklet pages expose a reusable bridge token, which is risky if the server is bound beyond loopback or another local process can read it.

Evidence:

- Bookmarklet endpoint is hardcoded to `http://127.0.0.1:5174/api/godel-alert-bridge/ingest`.
- The setup HTML and bookmarklet include the token.
- The ingest authorization accepts token from header, query, or body.
- This review observed `[::1]:5174` failing while `127.0.0.1:5174` worked, proving host sensitivity.

Suggested fix:

Generate the bridge endpoint from the incoming request origin or active listen URL. Restrict setup/bookmarklet GETs to loopback, add `Cache-Control: no-store`, stop accepting query/body tokens, and prefer a short-lived local session token.

Suggested validation:

- Regression tests for `[::1]`, `127.0.0.1`, and non-default ports.
- Tests proving reusable token is not exposed in cacheable GET responses.

### P2-02 - `writeJsonAtomic()` uses a fixed temp filename per target

References:

- `server/jsonStore.ts:41-45`
- `server/dataImporter.ts:1292-1301`
- `server/dataImporter.ts:1307-1315`
- `server/tradeJournalSnapshot.ts:86-89`
- `server/godelAlertBridge.ts:358-366`
- `server/morningBrief.ts:1836-1844`

Why it matters:

The helper is atomic only for a single writer. Concurrent writes to the same target share `${target}.tmp`; one rename can consume the other writer's temp file or leave the newer payload lost. Review notes have an explicit queue, but wallet, journal, bridge status, and Morning state writes call the helper directly.

Evidence:

- `writeJsonAtomic()` always writes `${target}.tmp`.
- Review notes have a local queue, implying this race was already recognized for one file.

Suggested fix:

Use a unique temp filename per write, such as `${target}.tmp.${process.pid}.${randomUUID()}`, and optionally fsync before rename for higher durability. Add per-target write queues where semantic merging is needed.

Suggested validation:

- Concurrency unit test that launches multiple writes to the same file and verifies final valid JSON without ENOENT.

### P2-03 - Heatmap can remain stuck on a transient load error

References:

- `src/components/SpxHeatmapPanel.tsx:123-125`
- `src/components/SpxHeatmapPanel.tsx:145-155`
- `src/components/SpxHeatmapPanel.tsx:296-300`

Why it matters:

The new Morning Heatmap is part of current WIP. If the first load fails and a later poll succeeds, the component can still render the error branch first because `loadError` is not cleared on successful load. The trader sees a dead Heatmap until remount.

Evidence:

- Render returns `loadError` before checking `payload`.
- Frontend review found successful polls update payload but do not clear the old error.
- Lint also flags a heatmap `set-state-in-effect` pattern.

Suggested fix:

Clear `loadError` on every successful heatmap load and add a retry control. Keep polling state separate from terminal load state.

Suggested validation:

- Component test: first `fetchSpxHeatmap()` rejects, next poll resolves, UI recovers without remount.
- Browser smoke of Morning -> Heatmap after simulated API failure.

### P2-04 - Scripts are partly outside lint/typecheck despite feeding live server paths

References:

- `eslint.config.js:11`
- `tsconfig.node.json:23`
- `package.json:11-17`
- `server/index.ts:9`

Why it matters:

Scripts drive desktop launch, Google snapshot refresh, IBKR refresh, TC2000, Godel, and heatmap. Some script code is imported into the live server path, but `scripts/**/*.ts` is excluded from `tsc -b`, and `.mjs` scripts are not linted.

Evidence:

- ESLint config only targets `**/*.{ts,tsx}`.
- Node tsconfig includes `vite.config.ts`, `server`, and `shared`, not `scripts`.
- `server/index.ts` imports `../scripts/refresh-google-drive-snapshot.ts`.

Suggested fix:

Add `tsconfig.scripts.json` or include `scripts/**/*.ts` in the node build. Extend lint to `.js`/`.mjs` with Node globals. Add dependency-injected tests for launch and refresh scripts.

Suggested validation:

- `npm run typecheck`
- `npm run lint`
- Focused script tests.

### P2-05 - No tracked GitHub Actions workflow

References:

- `package.json:23-25`
- `AGENTS.md` engineering behavior now says CI should run `npm ci`, `npm run typecheck`, and `npm run test`.

Why it matters:

The repo was created on GitHub, but there is no tracked CI workflow yet. Release safety depends on local manual checks.

Evidence:

- `git ls-files '.github/*'` returned nothing.

Suggested fix:

Add a minimal `.github/workflows/ci.yml` that runs `npm ci`, `npm run typecheck`, and `npm run test` on push/PR. Add build and lint after lint debt is resolved.

Suggested validation:

- Push/PR CI green.
- Local `npm ci && npm run typecheck && npm run test`.

### P2-06 - ET date/time logic is duplicated across frontend and backend

References:

- `src/easternDate.ts:1`
- `server/easternClock.ts:15`
- `src/App.tsx:888-892`
- `src/dateRanges.ts:15`
- `src/components/MorningDashboard.tsx:1410`
- `server/morningBrief.ts:85`

Why it matters:

Rubicon is date/session-driven. Duplicated ET date math and labels increase the chance of DST, host-timezone, or "yesterday" drift between Morning, Replay, Daily Pull, and Review.

Evidence:

- App-level "yesterday" is hand-rolled with a `Date` and `toLocaleDateString("en-CA")`.
- Date range and Morning formatting helpers repeat logic despite existing ET helper modules.

Suggested fix:

Consolidate date-key, add-days, range, and display helpers into canonical frontend/backend utilities. Keep tests around DST boundaries and session transitions.

Suggested validation:

- `npm run test -- src/easternDate.test.ts server/easternClock.test.ts src/dateRanges.test.ts`

### P2-07 - Route validation/error envelopes are repeated and under-tested

References:

- `server/index.ts:76-93`
- `server/index.ts:96-115`
- `server/index.ts:126-144`
- `server/index.ts:172-179`
- `server/index.ts:198-203`
- `server/index.ts:258-263`
- `server/index.ts:339-344`
- `server/index.ts:443-450`
- `server/index.test.ts:1`

Why it matters:

Core endpoints validate dates and map dependency failures inconsistently. As routes grow, one endpoint can drift from another and return different shapes/statuses for the same class of problem.

Evidence:

- ISO date validation is repeated inline.
- Refresh success/error blocks are repeated.
- `server/index.test.ts` mainly covers host/full-replay policy, not route validation or dependency failure mapping.

Suggested fix:

Add shared route helpers such as `parseIsoDateParam`, `parseIsoDateQuery`, and `sendRefreshResult`. Add route tests for one valid date, one invalid date, and one dependency failure.

Suggested validation:

- `npm run test -- server/index.test.ts`

### P2-08 - Date rails are duplicated across Replay, Journal, Daily Pull, and Daily Review

References:

- `src/App.tsx:914-930`
- `src/App.tsx:1163-1182`
- `src/App.tsx:1602-1625`
- `src/App.tsx:2123-2142`
- `src/App.tsx:2459-2470`

Why it matters:

Date switching is the spine of Rubicon's Replay/Pull/Review/Journal workflow. Badge, ARIA, title, and issue-acceptance behavior now require edits in multiple render blocks.

Evidence:

- Four similar date-list render maps share the same helpers and markup shape.

Suggested fix:

Extract a shared `DateRail`/`DateButton` component with an optional action slot for Daily Pull's "Issues fine" button.

Suggested validation:

- Shared component tests for selected state, issue badge, accepted issue title, trade count, and optional action slot.
- Existing App tests.

### P2-09 - Live sidecar supervisor logic is duplicated

References:

- `server/fplLive.ts`
- `server/spxHeatmapLive.ts`
- `server/ibkrWalletRefresh.ts`
- `server/ibkrHoldings.ts`

Why it matters:

Morning depends on live sidecars for FPL, heatmap, IBKR wallet/holdings, and similar refresh paths. Scheduler/process fixes will drift if every sidecar owns its own spawn/status/log/cleanup code.

Evidence:

- Review found near-identical auto-start, external-process discovery, log tailing, stop semantics, host/port/Python command assembly, timeout handling, and error normalization.
- FPL has tests, while SPX heatmap live supervision lacks a matching test file.

Suggested fix:

Extract a small `managedSidecar` helper and a shared IBKR Python runner. Keep feature-specific config in each module.

Suggested validation:

- Tests for weekday auto-start window, existing external PID, child exit/error cleanup, missing Python/runtime failure.

### P3-01 - Bare `python` scripts are machine-dependent

References:

- `package.json:16-17`
- `package.json:21-22`

Why it matters:

IBKR, TC2000, and SPX heatmap refreshes depend on whatever `python` resolves to on the local Windows machine. Missing or wrong interpreter selection can make Morning/heatmap refresh fail before app code runs.

Evidence:

- NPM scripts call `python` directly.

Suggested fix:

Support `RUBICON_PYTHON` or a Node wrapper that finds `py -3`, `python`, or a configured venv and returns a clear error.

Suggested validation:

- Script smoke with valid Python.
- Script smoke with missing Python that prints an actionable setup error.

### P3-02 - Morning Heatmap tab selection is not preserved when leaving Morning

References:

- `src/components/MorningDashboard.tsx:73`
- `src/components/MorningDashboard.tsx:528-538`
- `src/App.tsx:772-780`

Why it matters:

With Heatmap moved under Morning, a trader who checks Heatmap, jumps to Replay, and returns to Morning lands back on Brief. This is not data loss, but it is a workflow paper cut.

Suggested fix:

Hoist Morning sub-screen state into `App` or persist it in local storage.

Suggested validation:

- Select Heatmap, switch to Replay, return to Morning, assert Heatmap remains active.

## Duplicate-Code And Use-Case Consolidation Candidates

High-value consolidations:

1. Chart lifecycle helper
   - Examples: `MarketChart`, `ReviewEntryExitChart`, `FplIndicatorPanel`.
   - Goal: create chart once, update series/data through refs, centralize resize cleanup.

2. Visibility-aware polling hook
   - Examples: `App.tsx` tracker/status polling, `MorningDashboard` live polling, `SpxHeatmapPanel` status/payload polling.
   - Goal: one `useVisibleInterval`/`usePollingResource` pattern with AbortController cleanup.

3. Date rail component
   - Examples: Replay, Journal, Daily Pull, Daily Review date lists.
   - Goal: one tested date button/rail behavior with optional per-screen action.

4. Server route helpers
   - Examples: ISO date parsing, refresh response envelopes, dependency error mapping.
   - Goal: consistent status codes and JSON shapes.

5. JSON state persistence layer
   - Examples: review notes, wallet, journal, Morning state, Godel bridge state, tracker/spread caches.
   - Goal: unique temp files, optional queues, merge/upsert semantics where needed.

6. Live sidecar manager
   - Examples: FPL live, SPX heatmap live, IBKR wallet/holdings refresh.
   - Goal: common spawn/status/log/cleanup/timeout handling.

7. ET date/time utilities
   - Examples: `easternDate.ts`, `easternClock.ts`, `dateRanges.ts`, Morning date label helpers.
   - Goal: one tested ET date-key and display strategy.

8. Script helper library
   - Examples: duplicated argument parsing, Google credential discovery, IBKR Python setup.
   - Goal: shared CLI parsing, credential discovery, and runtime checks.

## Quick Wins

1. Align server/Vite loopback host defaults.
2. Add minimal GitHub Actions CI for typecheck and tests.
3. Clear heatmap `loadError` on successful reload and add a retry button.
4. Fix the highest-noise lint failures that are pure mechanical cleanup.
5. Add `Cache-Control: no-store` to Godel setup/bookmarklet responses.
6. Add `RUBICON_PYTHON` support or clearer Python-not-found messages.

## Larger Refactor Candidates

1. Secure local mutation routes with one shared guard.
2. Convert journal snapshot replacement into server-side merge/upsert.
3. Refactor chart lifecycle to stable chart instances plus data updates.
4. Create a JSON persistence helper with unique temp files and optional merge/queue semantics.
5. Split `App.tsx`, `App.css`, `morningBrief.ts`, and `dataImporter.ts` only along active-change boundaries, not as a broad rewrite.
6. Build a shared sidecar manager for live processes.

## Test And CI Gaps

Missing or weak coverage:

- No tracked GitHub Actions workflow.
- Lint is configured but not green and not in `validate:mvp`.
- `scripts/**/*.ts` and `scripts/**/*.mjs` are under-covered by typecheck/lint.
- Mutating route auth/CSRF behavior has no tests.
- Journal stale-client overwrite behavior has no regression test.
- Heatmap tab, resize, load-failure recovery, and live status polling have little/no frontend coverage.
- Replay chart lifecycle has no regression test proving chart instances are stable across playback.
- SPX heatmap live supervisor lacks coverage comparable to FPL live.
- Date/session DST boundaries need shared utility tests.

## Commands Run

Baseline:

```text
git status --short --branch
git diff --stat
git diff -- AGENTS.md src/App.tsx src/components/MorningDashboard.tsx src/components/SpxHeatmap.css src/components/SpxHeatmapPanel.tsx
rg --files -g exclusions
```

Validation:

```text
npm run lint
```

Result: failed with 45 errors and 4 warnings.

```text
npm run typecheck
```

Result: passed.

```text
npm run test
```

Result: passed, 60 test files and 323 tests.

```text
npm run build
```

Result: passed, with Vite large-chunk warning for `dist/assets/index-*.js` at about 606 kB minified.

```text
npm audit --audit-level=moderate
```

Result: passed, 0 vulnerabilities.

Runtime/API:

```text
Invoke-RestMethod http://[::1]:5174/api/health
```

Result: failed to connect.

```text
Invoke-RestMethod http://127.0.0.1:5174/api/health
```

Result: passed with `ok: true` and correct Rubicon `appRoot`.

Browser smoke:

```text
Headless Playwright at http://127.0.0.1:5174/
```

Result: passed through Morning, Heatmap, Replay, Daily Pull, Daily Review, Journal, and Rotation. No console/page errors and no horizontal overflow. DailyFX/IG major events showed `HTTP 401 Unauthorized` as visible source status.

## Recommended Fix Order With Small Commit Boundaries

1. Commit 1: Align loopback host defaults
   - Fix Vite/server/docs host mismatch.
   - Validate with health checks and `npm run dev` smoke.

2. Commit 2: Add minimal CI
   - Add GitHub Actions for `npm ci`, `npm run typecheck`, `npm run test`.
   - Do not add lint yet while lint is red.

3. Commit 3: Protect mutation routes
   - Add shared local mutation guard.
   - Add route tests for allowed/rejected mutation.

4. Commit 4: Fix journal merge semantics
   - Change journal snapshot route to upsert/merge by `tradeId`.
   - Add stale-client overwrite regression test.

5. Commit 5: Make JSON writes concurrency-safe
   - Unique temp paths in `writeJsonAtomic()`.
   - Add concurrent write tests.

6. Commit 6: Heatmap reliability
   - Clear error on successful load, add retry, add Heatmap tab/recovery tests.

7. Commit 7: Replay chart lifecycle
   - Stabilize chart instances and update series data through refs.
   - Add chart lifecycle regression tests and manual Replay autoplay smoke.

8. Commit 8: Lint debt batch
   - Fix mechanical lint errors.
   - Add lint to validation only after it is green.

9. Commit 9: Consolidate date rails
   - Extract shared `DateRail`/`DateButton`.
   - Test date badge/count/accepted issue behavior once.

10. Commit 10: Consolidate sidecars/scripts
    - Add shared sidecar runner and Python runtime detection.
    - Add focused process/runtime tests.
