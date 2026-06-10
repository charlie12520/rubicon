# PLAN — Rubicon Improvement Roadmap (2026-06-09)

Full-codebase review + prioritized improvement plan, produced 2026-06-09 evening.
Companion to `RUBICON_CODEBASE_REVIEW_2026-06-03.md` (most of which is still open —
see §2). When an item here is picked up, assign it the next acceptance ID
(A162+) per AGENTS.md before building.

---

## 1. Health snapshot (verified 2026-06-09 ~20:15 ET)

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run test` | PASS — 84 files / 521 tests (suite grew from 323 on 06-03; the old date-dependent reds are gone) |
| `npm run lint` | **FAIL — 66 errors / 6 warnings** (was 45/4 on 06-03 — debt grows because lint is not in `validate:mvp`) |
| Working tree | 9 modified + 1 new file uncommitted — two coherent, already-validated features (§4) |
| Server | Headless task live on 127.0.0.1:5174; `dist/` fresh (built 2026-06-09 19:41) |
| Git | 11 commits since `69bd9fe Initial Rubicon codebase`; .gitignore clean (no logs/screenshots/data tracked; lone stray: `.tmp.patch`) |

Live pipeline observations (today):

- **`data/tc2000-daily-bars.json` last written Fri 2026-06-05 23:52.** Mon 06-08 and
  Tue 06-09 syncs did not rewrite it, while the screener CSVs keep updating →
  newly screened names will render with no chart (the known "pull can't find the
  stock" symptom). Needs diagnosis — top of R0.
- Daily sync for 2026-06-09 completed but `option_intraday=partial`: the 0DTE
  chain-band pull hit the 360s hard timeout with HMDS "no data" spam on band-edge
  strikes (7370P/7385C/7405C/7525C/7530C…). A manual failed/missing retry at
  18:48 ET still ended partial. This looks routine, not exceptional (§3.1-F).
- **Signal Stack live 0DTE feed (client-id 948) is verified working server-side**:
  ran the whole session today — 1,205 writes, real quotes (rows 36–42), clean
  self-stop at 16:00 ET (`data/spx-0dte-chain-feed.log`). Remaining check is
  UI-only: confirm the green "LIVE" pill + live frames during RTH (§R3).

---

## 2. Status of the 2026-06-03 review — 1 of 14 items fixed

Verified against current code 2026-06-09. Keep the 06-03 doc as the detailed
reference; this table is the live scoreboard.

| Item | Verdict | Evidence |
|---|---|---|
| P1-01 dev/proxy loopback mismatch | **FIXED** (code) | `vite.config.ts:9` + server both on 127.0.0.1. Residue: `naive_validation.md` still tells agents to use `[::1]:5174` — align the docs. |
| P1-02 mutation routes unguarded | OPEN | `server/index.ts:66` bare `express.json()`; ~20 unguarded POST/PUT routes |
| P1-03 journal whole-file overwrite | OPEN | `server/tradeJournalSnapshot.ts:86-89`; route at `server/index.ts:655` |
| P1-04 chart recreate during replay scrub | OPEN | `MarketChart.tsx` effect still keyed `[props]` (~line 176, incl. WIP version) |
| P1-05 lint not in gate | OPEN | `validate:mvp` = typecheck+test+build; lint red and growing |
| P2-01 Godel bridge hardcoded host + token in GETs | OPEN | `server/godelAlertBridge.ts:104-108, 186, 290-309` |
| P2-02 `writeJsonAtomic` fixed `.tmp` name | OPEN | `server/jsonStore.ts:43` — and there are MORE writers now |
| P2-03 heatmap stuck on transient load error | OPEN | `SpxHeatmapPanel.tsx` — poll success doesn't clear `loadError`; `reloadHeatmap` (~246) doesn't either |
| P2-04 scripts outside tsc/eslint | OPEN | `tsconfig.node.json:23`, `eslint.config.js:11` |
| P2-05 no CI workflow | OPEN | no `.github/` — AGENTS.md already mandates one |
| P2-08 date-rail duplication ×4 | OPEN | `App.tsx` ~1025/1286/1788/2371 |
| P2-09 sidecar supervisor duplication | OPEN — got worse | now 5: `fplLive`, `spxHeatmapLive`, `spreadSpeedLive`, `spxLiveBars`, `ibkrWalletRefresh`/`ibkrHoldings` |
| P3-01 bare `python` in npm scripts | OPEN | package.json 6 scripts |
| P3-02 Morning sub-tab resets | OPEN | `MorningDashboard.tsx:149` local `useState("brief")` |

Size watch: `App.tsx` 3,097 lines (33 useState / 17 useEffect), `App.css` 7,017,
`dataImporter.ts` 2,023, `morningBrief.ts` 1,703, `server/index.ts` 764.

---

## 3. New findings (2026-06-09 sweep)

### 3.1 Pipeline / ops — threats to the daily loop

- **A. TC2000 bars stale right now** — see §1. Diagnose why the Mon/Tue runs
  didn't rewrite the snapshot (wrapper step status, lock file, log around the
  tc2000 step), then fix.
- **B. TC2000 input hardening still missing.** `scripts/refresh-tc2000-daily-bars.py:153`
  still globs **every** top-level `*.csv` in `tc2000_exports/` and unions
  symbols; `clean_symbol`/`unique_symbols` accept any token. The 2026-06-03
  OCR-junk failure mode (`346P`, `NYSE`, `PINK`) is still fully reproducible.
- **C. IBKR client-id 947 collision (new, from A150).**
  `refresh-spx-live-bars.py:171` defaults to 947 — same as
  `refresh-tc2000-daily-bars.py:363`. The A150 docstring says "distinct from
  heatmap 941 / holdings 884" — TC2000 was forgotten. Normally they don't
  overlap (live bars stop at 16:00; TC2000 runs post-close), but any
  manual/daytime sync rerun while the live-bars sidecar holds 947 reproduces the
  one-connection-per-client-id deadlock (the multi-hour TC2000 crawl from
  2026-06-02). One-line fix: move spx-live-bars to 949 (and update its docstring
  + any spawner env).
- **D. dist staleness for the daily driver.** The "Rubicon Server" scheduled task
  (`scripts/serve-headless.vbs`) serves `dist/` and never builds; only
  `npm run desktop` has `ensureBuildIsFresh()`. Edit source → forget
  `npm run build` → the PWA silently serves the old UI. Fresh today, but
  unguarded.
- **E. No log rotation anywhere.** Append-only: `data/fpl-live.log` (350 KB),
  `data/spx-heatmap-live.log` (109 KB), `data/daily-sync-launch.log` (141 KB),
  `data/spx-0dte-chain-feed.log` (~15 KB/session). Zero rotate/truncate hits in
  scripts/ + server/. Slow burn, cheap to cap.
- **F. Option-sidecar routinely "partial".** Band-edge SPXW strikes time out
  (360s hard cap) with HMDS no-data; availability lands `partial` /
  "usable_with_caution" on normal days. Either trim the band further, fail fast
  on first no-data response per strike, or accept-and-document so `partial`
  stops looking like a problem.
- **G. Daily-sync status truthfulness** (`server/dailySync.ts`):
  idle resolves `ok: persisted?.ok ?? true` (~line 1174) so a never-rerun
  failure can present as ok after restart; stale-"running" detection regexes the
  user-facing message (~1164-69) — fragile; `lockStale?:` optional param can
  silently skip the stale→failed transition (~363).
- **H. Launcher sprawl (Phase 3) still open.** `launch-desktop.mjs` kill-sweep
  coexists with the reuse-policy shortcuts; 4 launch paths; no stop/restart
  helper for the task server (the VBS detaches via WMI, so stopping the task
  does NOT stop the server — kill the 5174 PID then re-run the task).

### 3.2 Server

- `writeJsonAtomic` race (P2-02) now has more concurrent writers than at review
  time (wallet, journal, bridge state, Morning state, heatmap live seed, 0DTE
  chain, live bars…). Unique temp name + test is ~30 min of work.
- Journal overwrite (P1-03) remains the single highest data-loss risk: any stale
  tab can clobber newer entries.
- `forwardFillTileSeries` (`server/spxHeatmap.ts` ~230-258) fills interior nulls
  to the **global** frontier, not per-tile — a tile that stopped printing early
  can be filled past its own last real value.

### 3.3 Client

- **No ErrorBoundary** (`src/main.tsx`): any render throw in the 3,097-line
  `App.tsx` = blank screen, no message, no recovery.
- **~14–16 concurrent polling timers** with Morning open (App.tsx ~6 +
  MorningDashboard ~8-10). Some ignore market hours: the holdings poll
  (`MorningDashboard.tsx` ~447) doesn't consult `estimatorLiveState.shouldPoll`,
  so it can poll IBKR-backed endpoints on weekends/after-hours.
- **Silent failures + invisible staleness.** Several fetches
  `.catch(() => undefined)` (heatmap, Morning panels) → stale data renders
  exactly like live data. Most screens (Brief, Daily Pull screener, Heatmap,
  Estimator, RRG) show no "as of" timestamp. This is precisely how §3.1-A goes
  unnoticed for 4 days.
- Replay chart recreate-per-tick (P1-04) — user-visible jitter/CPU during
  autoplay; do it right after the WIP in `MarketChart.tsx` lands.
- Single 652 KB JS + 124 KB CSS bundle, zero `React.lazy` — Rotation + Heatmap
  always parsed.
- State resets on reload: portion tab, Morning sub-tab, selected date, replay
  index. No keyboard shortcuts for the daily loop.
- No version stamp/update prompt: after a rebuild, an open PWA window keeps the
  old bundle until a manual hard-refresh, with no indication.

### 3.4 Daily-sync state-machine nits (from the new-code review)

- Mixed entry/exit rail groups in the WIP render only one rail
  (`MarketChart.tsx` `assignRailGroups` — `showRail` goes to the first marker
  only; test asserts count, not per-group coverage).
- `previousTradingSessionDate()` (`src/dateRanges.ts`) skips weekends but not
  market holidays — "Yesterday" after a Monday holiday lands on the holiday.
- `windowSigma` guard: confirm `windowMinutes: 0` (Day) can't reach the
  `√(390/w)` division anywhere new callers appear.

---

## 4. Uncommitted WIP — assessment

Two coherent features, both already validated per WORKLOG (23/23 and 14/14
focused tests, typecheck/build clean, browser smoke done); full suite green with
them applied:

1. **Replay "Yesterday" → previous trading session** (`src/dateRanges.ts` + new
   `src/dateRanges.test.ts` + `App.tsx`). Solid; holiday handling is a known
   follow-up (§3.4).
2. **Replay marker rail-grouping** (`MarketChart.tsx/.test.ts`, `App.css`,
   `App.tsx`, `App.test.tsx`, estimator panel touch-ups). Sound; one edge case
   (mixed-kind group → single rail) to fix or accept explicitly.

**Recommendation:** land these as two commits first — everything else in R0+
builds on a clean tree.

---

## 5. Roadmap

Each numbered item ≈ one small commit, narrowest validation first
(per AGENTS.md), acceptance ID assigned at pickup.

### R0 — Protect tomorrow's loop (do first; ~1 day)

1. **Commit the WIP** (two commits, §4). *Validation: focused tests + full suite.*
2. **Diagnose + fix TC2000 staleness** (§3.1-A): trace the 06-08/06-09 wrapper
   runs (tc2000 step status, lock, `daily-sync-launch.log`), fix root cause.
   *Validation: `tc2000-daily-bars.json` generatedAt = today after next sync; if
   bars were already cached, `--no-refresh` rebuild as recovery.*
3. **Split client-id 947** (§3.1-C): spx-live-bars → 949; update docstring +
   spawner. *Validation: grep 947 consumers; live-bars feed starts clean.*
4. **TC2000 input hardening** (§3.1-B): read only `*_latest.csv` (or newest per
   scanner window) + reject non-ticker tokens (digit-bearing like `346P`,
   exchange/tier names `NYSE`/`PINK`/`OTC`). *Validation: unit test with the
   known junk list; missingSymbols stays clean on next run.*
5. **Minimal CI** (P2-05): `.github/workflows/ci.yml` = `npm ci` + typecheck +
   test on push/PR (lint joins later, R4-15). *Validation: green run on push.*
6. **dist-staleness guard** (§3.1-D): simplest = headless launch path runs the
   existing `ensureBuildIsFresh()` via a small node pre-step before `tsx
   server/index.ts`; alternatively `/api/health` exposes dist build time vs
   newest src mtime and the UI badges "UI build stale". *Validation: touch a src
   file, restart task, fresh dist.*

### R1 — Data safety (1–2 days)

7. **`writeJsonAtomic` unique temp** (P2-02): `${target}.${pid}.${rand}.tmp` +
   concurrent-writes test.
8. **Journal merge/upsert by `tradeId`** (P1-03) with `updatedAt` conflict
   resolution + stale-client regression test (write A; stale client writes B
   without A; both survive).
9. **Daily-sync truthfulness** (§3.1-G): idle → `ok: undefined`; replace
   message-regex staleness with an explicit flag; make `lockStale` required.
   *Validation: dailySync unit tests for restart-after-failure + stale-lock.*
10. **Log rotation** (§3.1-E): tiny size-capped append helper (e.g. 5 MB,
    keep 1 archive) used by the 4 live logs (fpl, heatmap-live, sync-launch,
    0dte-feed).

### R2 — Trust the screen (2–3 days)

11. **Freshness badges everywhere** (§3.3): thread `generatedAt`/`asOf` through
    Brief, Signal Stack (EOD amber badge exists — extend), Heatmap, Estimator,
    TC2000 screener panel, RRG; amber when stale (>1 session for dailies,
    >2 min for live feeds). This is the systemic fix for §3.1-A-style silent
    staleness.
12. **ErrorBoundary + error surfacing**: boundary at root + per-portion;
    replace `.catch(() => undefined)` with inline error + retry; fold in the
    heatmap stuck-error fix (P2-03).
13. **After-hours polling gates**: holdings poll honors
    `estimatorLiveState.shouldPoll`; audit the other ~14 timers for
    weekend/after-hours suppression and pause-when-hidden.

### R3 — Close verification gates (next market morning, ~30 min)

14. **Signal Stack live UI check during RTH**: feed already proven (§1) — click
    Go-live / watch auto-start ~09:28, confirm green "LIVE · HH:MM" pill and
    advancing frames, then mark PLAN-morning-signal-stack-live /
    PLAN-phase-b-implementation / TROUBLESHOOT docs resolved.
15. **Option-sidecar "partial" policy** (§3.1-F): pick one — trim band, fail
    fast per no-data strike, or document partial-as-normal in the Daily Pull UI.

### R4 — Debt-down (ongoing; one per session)

16. **Replay chart lifecycle** (P1-04): create chart/series once, `setData` on
    updates (the `EstimatorSpxChart` refactor in A150 is the in-repo pattern);
    regression test = `createChart` called once across replay ticks.
17. **Lint debt → gate** (P1-05): mechanical fixes batch (66 errors), then add
    lint to `validate:mvp` + CI so it can't regrow.
18. **Consolidations** (pick by next touched area, don't big-bang): shared
    polling hook → date-rail component (P2-08) → sidecar manager (P2-09, now 5
    copies) → ET-date utils (P2-06) → route helpers (P2-07) → `App.tsx` hook
    extraction (`useReplayState` / `useDailySyncState` / `useJournalState`).
19. **scripts/ under tsc + eslint** (P2-04) and `RUBICON_PYTHON` resolution
    (P3-01).
20. **Mutation-route guard + Godel bridge hygiene** (P1-02/P2-01): loopback +
    Origin check middleware on POST/PUT; bridge endpoint derived from request
    origin; token out of cacheable GETs; `Cache-Control: no-store`.
21. **Heatmap per-tile frontier** in `forwardFillTileSeries` (§3.2) + holiday
    set for `previousTradingSessionDate` + mixed-rail edge case (§3.4).

### R5 — Polish (pick by appetite)

22. Keyboard shortcuts: Space play/pause, ←/→ scrub, [/] prev/next date,
    1/2/3 portions (skip when an input is focused).
23. Persist UI state in localStorage: portion, Morning sub-tab (P3-02),
    selected date, replay index.
24. Code-split Rotation + Heatmap via `React.lazy` (652 KB → ~400 KB initial).
25. Version stamp: build id in `/api/health` + footer; "new build — reload"
    toast when server ≠ client.
26. **Phase-3 launcher retirement**: single `scripts/rubicon-server.ps1
    start|stop|restart|status` helper for the task server; retire the
    kill-sweep path / demote `desktop:*`; delete `.tmp.patch` from git.
27. Root hygiene: archive the 8 pre-06-03 process docs into `docs/archive/`,
    move `qa-*.png` to `artifacts/`, prune `WORKLOG.md` (>225 KB) into a
    `WORKLOG-archive.md`, align `naive_validation.md` host guidance to
    127.0.0.1 (§2 P1-01 residue).

---

## 6. Suggested first 10 commits

1. `feat: replay Yesterday targets previous trading session` (WIP land)
2. `feat: replay marker rail grouping` (WIP land, after mixed-rail fix)
3. `fix: tc2000 daily-bars refresh — <root cause from R0-2>`
4. `fix: spx-live-bars sidecar moves to client-id 949`
5. `fix: tc2000 export ingest reads latest CSVs only + rejects non-ticker junk`
6. `ci: add GitHub Actions (npm ci, typecheck, test)`
7. `fix: headless server launch rebuilds stale dist before serving`
8. `fix: writeJsonAtomic uses unique temp file per write`
9. `fix: journal snapshot merges by tradeId instead of whole-file replace`
10. `fix: daily-sync status — idle is not ok, explicit stale flag, required lockStale`
