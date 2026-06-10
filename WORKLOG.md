# WORKLOG.md

```yaml
current_phase: "Local MVP delivered"
current_acceptance_id: "A161"
core_loop_status: "GREEN"
last_validation_result: "GREEN"
same_blocker_count: 0
blocked: false
last_green_ids: ["A01","A02","A03","A04","A05","A06","A07","A08","A09","A10","A11","A12","A14","A15","A16","A17","A18","A19","A21","A22","A23","A24","A25","A26","A27","A28","A29","A30","A31","A32","A33","A34","A35","A36","A37","A38","A39","A40","A41","A42","A43","A44","A45","A46","A47","A48","A49","A50","A51","A52","A53","A54","A55","A56","A57","A58","A59","A60","A61","A62","A63","A64","A65","A66","A67","A68","A69","A70","A71","A72","A73","A74","A75","A76","A77","A78","A79","A80","A81","A82","A83","A84","A85","A86","A87","A88","A89","A90","A91","A92","A93","A94","A95","A96","A97","A98","A99","A100","A101","A102","A103","A104","A105","A106","A107","A108","A109","A110","A111","A112","A113","A114","A115","A116","A117","A118","A119","A120","A121","A122","A123","A124","A125","A126","A127","A128","A129","A130","A131","A132","A133","A134","A135","A136","A137","A138","A139","A140","A141","A142","A143","A144","A145","A146","A147","A148","A149","A150","A151","A152","A153","A154","A155","A156","A157","A158","A159","A160","A161"]
last_yellow_ids: []
last_red_ids: []
last_deferred_ids: ["A13","A20"]
last_blocker_signature: ""
```

## Current Objective

Ship the first validated local MVP loop:

Trader opens Rubicon -> Morning shows the macro/live/model premarket brief -> Replay imports AI STUFF/SPX tracker data -> trader reviews today's or a selected range's P/L and position metrics -> trader selects a session/trade -> replay charts advance through the day with scrub/autoplay -> optional wallet size persists locally.

## Current Repo Status

- Framework: React + TypeScript + Vite
- Package manager: npm
- API: Express on port `5174` when available; the desktop launcher verifies `/api/health` reports `rubicon` and can use `http://[::1]:5174` when `127.0.0.1:5174` belongs to another project.
- Data layer: local CSV/JSON importer in `server/dataImporter.ts`
- Database/local storage: AI STUFF trade archive plus app-local `data/wallet.json` and `data/review-notes.json`
- Auth: none for local MVP
- Styling: custom dark/futuristic CSS in `src/App.css`
- Charting: lightweight-charts for SPX/spread replay, custom SVG profiles for OI/volume
- Test framework: Vitest
- E2E framework: Browser plugin manual QA; Playwright CLI fallback when Browser runtime is unavailable
- Dev command: `npm run dev`
- Validation command: `npm run validate:mvp`
- Seed/demo-data command: real local archive load from `..\IBKR Equity History Pull\data\ibkr_trades`

## Acceptance Progress Summary

- Green: A01-A12, A14-A19, A21-A161
- Yellow: none
- Red: none
- Deferred: A13 separate admin view, A20 AI feature fallback
- Blocked: none

## Last Completed Change

- A162/A163/A164 — Roadmap R0 batch: TC2000 staleness root-caused + fixed, ingest hardened, client-id collision split. **Root cause** of `tc2000-daily-bars.json` frozen at 06-05: the Jun-8 full sync died right after launch (unexplained — 5 log lines, no error; watch the next runs) and Jun-9 aborted at the wrapper's "Data Collection blocked local review" throw (band-edge SPXW HMDS timeouts → blockers), skipping every downstream step incl. the independent TC2000 ones; the option retry then marks them "Skipped". Plus the TC2000 export had been failing since 06-04: the app wasn't running and the cold-launch resolver missed the per-user `%APPDATA%\Worden Brothers, Inc\TC2000\` install (and would have picked the MSI icon-cache `TC2000_1.exe`). **Fixes:** (1) wrapper (`IBKR Equity History Pull/run_daily_spx_ibkr_sync_with_sheet_payload.ps1`, OUTSIDE git — backup `Documents\rubicon_r0_wrapper_backup_20260609`): TC2000 block extracted into `Invoke-Tc2000Steps` (`$script:`-scoped messages), called in the normal flow AND in the blocked-review branch before the throw (try/catch so TC2000 can't mask the blocker); parser 0 errors; `server/dailySyncWrapper.test.ts` 3/3 incl. a new ordering assert. (2) `AI STUFF/scripts/run_tc2000_qullamaggie_export.ps1`: resolver adds the Worden per-user candidates + skips `\Microsoft\Installer\` DisplayIcon paths; verified by a real cold launch (TC2000 left running for tomorrow's export). (3) `scripts/refresh-tc2000-daily-bars.py`: reads `*_latest.csv` only (newest-CSV fallback; `--all-exports` legacy), `is_plausible_ticker` rejects OCR junk (346P/NYSE/PINK/headers), `rejectedSymbols` in payload + stderr; new stdlib `scripts/test_refresh_tc2000_daily_bars.py` 8/8; real refresh against TWS wrote a fresh snapshot (38/38 bars through 2026-06-09, sources = the four `*_latest.csv`, rejected []). (4) `refresh-spx-live-bars.py` + `server/spxLiveBars.ts`: client id 947→**949** (947 = TC2000; IBKR allows one connection per id) — id map now 884 holdings / 941 heatmap / 947 tc2000 / 948 0dte / 949 spx-live-bars; typecheck clean, `spxLiveBars.test.ts` 3/3.

- Docs: full-codebase improvement review + roadmap written to `PLAN-improvement-roadmap-2026-06-09.md` (no code changes). Verified 2026-06-03 review status (1/14 fixed — only the 127.0.0.1 loopback alignment), gates (typecheck PASS, tests 84 files/521 PASS, lint FAIL 66 errors), and live-pipeline state: `tc2000-daily-bars.json` stale since Fri 06-05 (needs diagnosis), option sidecar routinely `partial` on band-edge HMDS timeouts, Signal Stack 0DTE live feed (client 948) verified working server-side (1,205 writes, clean 16:00 stop). New headline findings: client-id 947 collision between `refresh-spx-live-bars.py` and `refresh-tc2000-daily-bars.py`; headless task serves `dist/` with no staleness guard; no log rotation on the 4 append-only live logs; TC2000 junk-ticker filter still missing. Roadmap R0–R5 with first-10-commit sequence in the plan doc; uncommitted WIP (Yesterday preset + marker rails) assessed safe to land first.

- Replay Yesterday preset now targets the previous trading session instead of calendar yesterday. `src/dateRanges.ts` adds `previousTradingSessionDate()` and `resolveRange("yesterday")` uses it, so Monday/weekend dates roll back to Friday; `src/App.tsx` uses the same helper for the visible Replay "Yesterday" button. Validation: `npm run test -- --run src/dateRanges.test.ts src/App.test.tsx` passed 23/23, `npm run typecheck` clean, `npm run build` clean, and in-app browser smoke on `http://[::1]:5173/` confirmed clicking Yesterday from Monday `2026-06-08` selects `2026-06-05` with no console warnings/errors.

- Replay cockpit entry/exit rail grouping follow-up - Dense replay event rails now collapse by overlapping x-cluster instead of drawing one full-height rail per event. Individual entry/exit arrows and anchor dots still render once per event at the exact chart coordinate, but nearby rails share one faint band, including a mixed band when entry and exit rails collide. Validation: focused `MarketChart` + `ReplayCharts` tests passed 14/14, `npm run typecheck` clean, `npm run build` clean, and 1920x1080 Chrome Playwright QA on Replay -> `2026-06-05` -> Put `7475/7470` passed in both Line and HL modes with 28 event arrows reduced to 17 rails and 4 grouped rail bands.

- A161 — **The heatmap timeframe selector gains two more options: "Gap" (the opening gap) and "4H" (a trailing 4-hour window)** (the user: "add the initial gap and 4h as timeframe options"). The selector is now **Gap · Day · 4H · 1H · 30M · 5M**. **Gap** colours each tile by its *opening gap* — the first printed minute's % vs the prior close (the overnight jump) — a value fixed for the day that ignores the scrubbed minute, so you see which names gapped up/down at the open. **4H** is just another trailing window (240 min) like the existing ones. Frontend-only, still zero new data (everything derived from the existing `pctByTime` series). `src/heatmapWindow.ts`: `HEATMAP_TIMEFRAMES` gains `{key:"gap", gap:true, cap:3}` (ordered first) and `{key:"4h", minutes:240, cap:2.5}`; new pure `openingGapPct(series)` (first non-null reading = the open); `timeframeDef` now falls back to the Day entry explicitly (so an unknown key still resolves to Day even though Gap is now element 0). `SpxHeatmapPanel.tsx`: a `tileTfPct(tile,index,lastIndex,tf)` dispatcher — `tf.gap ? openingGapPct(tile.pctByTime) : tileWindowPctAt(...)` — replaces the four direct `tileWindowPctAt` calls (tile fill, frame aggregates, hover head, peers), plus `sigmaMinutes = tf.gap ? 0 : windowMinutes` so a Gap σ is measured in daily-σ units (the overnight gap is a daily-scale move) while the windows keep their √(390/w) scaling; the frame memo now deps on `tf`, and the selector tooltip is gap-aware. Selector buttons, legend, and caps all flow automatically from `HEATMAP_TIMEFRAMES`. Validation: `npm run typecheck` clean; `heatmapWindow.test.ts` **10/10** (+3 `openingGapPct` cases; order assertion updated to `[gap,day,4h,1h,30m,5m]` + 4h/gap def checks) and the full suite's **500 pass** (lone red is the unrelated `dateIssueBadges` daily-pull WIP); `npm run build` OK; built + served a fresh server on `:5196` against the **live** SPY feed and drove msedge: the toggle shows all six buttons; **Gap** → legend ±3%, index pill **+0.98%** with NVDA **+2.43%** / AVGO **+3.89%** gapped up and GOOGL **−0.83%** down (the opening-gap map); **4H** → legend ±2.5%, index **+0.00%** (the 4-hour window clamps to the 09:30 open since we're <4h into the session, so it reads "since open" — a nice coherent cross-check that the day's **+1.00%** was essentially *all* opening gap: Gap 0.98% + flat-since-open ≈ Day 1.00%); each timeframe recolours the map, **0 console errors** (Gap screenshot). Gap stays fixed while scrubbing (it's a single event); works identically for SPY and QQQ. Client-only (JSX) → **hard-refresh**; no server/feed/backend change. Concurrent A160 reconstitution work untouched.
- A160 — **The heatmap now auto-updates on S&P 500 / Nasdaq-100 reconstitutions** (the EPAM→FDXF kind of swap): a new constituent is detected, auto-placed under its correct sector, the universe + weights refresh, and a toast fires — no more manual "Other"-bucket edits to `finviz-classification.json`. Two gaps were closed: (a) a new name sat in the top-level **"Other"** bucket until hand-classified, and (b) more subtly it often never entered the **universe** at all on a normal day — the live feed reuses the prior payload (`load_universe_from_existing`) and the daily Yahoo backfill is a no-op when the payload is already "filled" *and* is SPX-only. **Decision (from the user): auto sector, manual industry** — new names get their sector via a GICS→Finviz crosswalk (no Finviz scraping) and sit in an **"Unclassified"** industry sub-block under that sector, with a toast nudge to place the exact industry. **New `scripts/reconcile-index-membership.py`** (stdlib-only; loads the feed's `build_index_configs`/`write_json_atomic` via `importlib` so it reuses the *exact* SSGA/Slickcharts loaders — zero edits to the contended `refresh-spx-heatmap.py`): per index it diffs fresh membership vs a snapshot `data/heatmap-membership.json` on `norm()` keys (dot/dash safe), classifies adds by sector into an auto-overlay `data/heatmap-classification-auto.json`, drops departed names, appends `data/heatmap-membership-changelog.json`, and emits one stdout JSON line; `--source live|sample`, `--apply`/`--dry-run` (default dry), exit 0/10/20. **Safety gate:** per-index floor (spx<480, qqq<95) + a 5% churn cap → a garbage/truncated fetch aborts (exit 20) and writes nothing, so a flaky source can never nuke the universe. **`server/spxHeatmap.ts`** adds `loadClassificationMerged` (base `finviz-classification.json` + the auto-overlay, **base always wins**) swapped in at the single classification seam (`:301`) → both the SPX and QQQ loaders pick up new names with no signature change; once you hand-place the real industry in the base file it overrides the auto "Unclassified". **`server/indexReconcile.ts`** (new; armed in `index.ts` beside `armSpxHeatmapLiveAutoStart`, fires ~09:15 ET weekdays via the same 30s-tick/once-per-day pattern) runs the reconcile, and ONLY on a real, gate-passed change fires a `showLiveUpdateDesktopToast` ("S&P 500: +FDXF (Industrials) −EPAM") **and** forces a fresh `refresh-spx-heatmap.py --source yahoo --indexes spx,qqq` pull so the new member actually lands in the payload the 09:28 live feed reuses (the load-bearing freshness fix); a gate trip fires a distinct "review manually" toast and no pull. The decision logic is the pure, injected-dependency `planReconcileActions`/`runIndexReconcileOnce` (toast + freshPull are deps) so it's unit-testable without spawning python. `.gitignore` commits the overlay (seeded `{}`) like the curated base; snapshot/changelog stay ignored. `package.json` adds `index:reconcile` for a manual run. Validation: `npm run typecheck` clean; **new `server/indexReconcile.test.ts` 10/10** (planner: real-diff toast+pull, no-sector flag, empty/bootstrap → nothing, gate-blocked + script-error → review-toast+no-pull; runner wiring with `vi.fn` deps) + a **`spxHeatmap.test.ts` overlay-merge case** (overlay-only add nests by sector under "Unclassified"; a base/overlay conflict → base wins) + the full suite's **497 pass** (lone red is the unrelated `dateIssueBadges`); `python -m py_compile` OK; `npm run build` OK. Functionally proven offline + live: a simulated NVDA re-add → overlay `{"Technology":{"Unclassified":["NVDA"]}}` + a changelog row; a 30-name drop → `churn 30 > 5.0% of 503`, exit 20, nothing written; and a real **live dry-run** fetched fresh SSGA (504) + Slickcharts (101) via the importlib path and bootstrapped clean. The user must **restart the Rubicon server** to arm the daily run; `npm run index:reconcile` runs it on demand. Concurrent A159 σ-window work untouched.
- A159 — **The Heatmap's σ (IV-normalized) view now works on every timeframe with *window-scaled* standard deviations, not just Day** (the user asked to "make a plan for window scaled stdev and execute") — superseding A158's Day-only σ. The σ view answers "how unusual is this move *for this window*": a +0.3% blip is a yawn on the day but can be a multi-σ event over 5 minutes. **Math**: intraday variance accrues ~linearly with time, so a w-minute move's expected 1σ is the daily 1σ × √(w/390) (a full RTH session = 390 min), and the move's σ over that window is the daily σ × √(390/w). **New `windowSigma(pct, iv, windowMinutes)` in `src/sigmaMove.ts`** (+ `RTH_MINUTES`): reuses the existing `sigmaMove` (daily σ) and multiplies by √(390/windowMinutes); `windowMinutes 0` (Day) = the whole session → the daily σ unchanged, so the Day view is byte-identical. +4 `sigmaMove.test.ts` cases (Day-equals-daily at 0/390; the √(390/w) scaling relationship; a move equal to the window's own 1σ reads exactly ±1σ; null-guards) → `sigmaMove.test.ts` 8/8. **`SpxHeatmapPanel.tsx`**: the three σ shade sites (tile fill, sub-industry peer dots, the hover IV/σ row) now call `windowSigma(pct, iv, windowMinutes)` instead of `sigmaMove(pct, iv)` (the `pct` is already the timeframe's windowed %), and the σ button is **re-enabled on all timeframes** — reverted A158's off-Day `disabled` + the σ→% force-reset effect, so σ stays on through a timeframe switch. The ±2σ legend is unchanged because σ is already normalized (a 2σ move is 2σ for any window — timeframe-independent), and `sigmaMove` is no longer directly imported by the panel (windowSigma replaces every call). σ still requires live IV (the σ button disables only when no tile carries `iv`, e.g. a yahoo-only QQQ payload). Validation: `npm run typecheck` clean; `sigmaMove.test.ts` **8/8** and the full suite's **479 pass** (lone red is the unrelated `dateIssueBadges` concurrent daily-pull WIP); `npm run build` OK; built + served a fresh server on `:5197` and drove msedge on **SPY** (the live feed populates IV for 501/503 tiles, e.g. NVDA 0.41 / AAPL 0.25): turning on σ then switching **Day → 5M** keeps σ **active + enabled** (it previously auto-reverted to %), the legend stays **±2σ**, and the map recolours to the windowed σ — e.g. **GOOGL −0.5σ (day) → +1.3σ (last 5 min)**, **NVDA +0.7σ → +0.1σ** — surfacing names moving unusually in the last 5 minutes rather than on the day, with **0 console errors** (Day-σ vs 5M-σ screenshots). Client-only (JSX) → **hard-refresh**; no server/feed/backend change. Direct parent is A158's timeframes; A157 QQQ untouched.
- A158 — **The Heatmap can now show each stock's % change over a trailing window — the last 5 min, 30 min, or 1 hour — not just the full-day move** (the user asked to "add 5 minute, 30 minute, and 1 hour timeframes ... so i can see the % change during that time"). Frontend-only with zero new data: the per-minute `pctByTime` series is already each name's % vs the **prior close**, so the move over a window of *w* minutes ending at minute *i* is `price[i]/price[i−w] − 1 = (1 + pᵢ/100)/(1 + pⱼ/100) − 1` (j = i−w) — recoverable from the two prior-close readings. **New pure `src/heatmapWindow.ts`** (mirrors `sigmaMove.ts`): `windowPct(pctNow, pctStart)` (null `now` → null; null `start`, i.e. the window predates the stock's first print → degrade to the since-first-print move; else the ratio formula) + `HEATMAP_TIMEFRAMES` = ordered `Day(0, cap 3) · 1H(60, 1.5) · 30M(30, 1.0) · 5M(5, 0.5)` (the colour-saturation cap shrinks with the window so a tiny 5-min move still spreads across green↔red instead of all-grey) + `timeframeDef`; `heatmapWindow.test.ts` 7/7. **`SpxHeatmapPanel.tsx`**: a `timeframe` state + a local `tileWindowPctAt(tile, index, lastIndex, windowMinutes)` that resolves both endpoints through the existing single `tilePctAt` seam (preserving the sample-mode `tile.pct` fallback) and clamps the window-start index *forward* to the tile's first printed minute (a name that began mid-window measures from its first quote); `windowMinutes 0` returns the day value unchanged. All **four** per-tile-% consumers — tile fill, the `frame` memo (index %, advancers/decliners, sector tints), the hover head, and the sub-industry peer rows — now route through it, so the whole map (including the index pill + breadth) reflects the selected window. The colour cap at each `heatmapColor` site (tiles, sector-chip dots, peer dots) and the legend rescale to the timeframe's cap; a new **Day · 1H · 30M · 5M** segmented selector sits beside the existing `%/σ` toggle. **σ stays a Day-only lens** (its denominator is a *daily* IV move): it's force-reset to `%` and the σ button is disabled whenever a trailing window is active (the tooltip's σ row keeps using the day move so it stays meaningful). `src/components/SpxHeatmap.css` adds `.heatmap-timeframe-toggle` (same segmented styling as the metric toggle). Validation: `npm run typecheck` clean; new `heatmapWindow.test.ts` **7/7** and the full suite's **475 pass** (lone red is the unrelated `dateIssueBadges` concurrent daily-pull WIP); `npm run build` OK; built + served a fresh server on `:5198` and drove msedge — switching **Day → 5M → 1H** rescales the legend (±3% → ±0.5% → ±1.5%), recolours every tile (verified via fill-hash change), and moves the index pill to the windowed move (+0.91% on the day vs **+0.05%** in the last 5 min vs +0.13% in the last hour — realistic), σ greys out off-Day, **0 console errors**; Day-vs-5M screenshots show e.g. NVDA +1.56% (day) → +0.23% (last 5 min). Works identically for SPY and QQQ. Client-only (JSX/CSS) → **hard-refresh** to pick up the new bundle; no server restart, no feed/backend change. Concurrent A157 QQQ + the Replay-marks fix left untouched.
- Replay spread recreation fix - The 2026-06-05 Replay cockpit no longer serves impossible 5-wide vertical marks. Root cause was upstream: the IBKR option sidecar combined sparse 5-second TRADES prints with independent leg forward-fill, creating stale-leg synthetic spread values outside the vertical width. `daily_spx_ibkr_sync.py` now accepts quote/midpoint mark bars as the preferred source, treats zero-volume/zero-count trade bars as non-print evidence, bounds fallback trade marks to each vertical's valid price range, and records mark-quality diagnostics in `ibkr_option_intraday_summary.json`. Rubicon now defensively sanitizes replay spread marks against each `TradeRecord.width`, bumps the safe replay cache schema, and rebuilds/clamps old unsafe caches. Regenerated the 2026-06-05 option marks and Rubicon ingest: `/api/replay?date=2026-06-05` reports 6,480 spread marks and 0 marks with `abs(value) > width + 0.01`; Playwright smoke of the Replay cockpit completed with no console errors. Validation: IBKR pytest 29/29, Rubicon focused importer tests 32/32, `npm run typecheck` clean, `npm run build` clean; full Rubicon suite remains blocked by the pre-existing unrelated `src/dateIssueBadges.test.ts` daily-pull WIP red.

- A157 — **The Heatmap tab now has a QQQ (Nasdaq-100) market map alongside SPX, with every feature, sharing ONE IBKR data pull** (the user asked to replicate the heatmap for QQQ "and reuse data sources if possible — if AAPL is pulled for SPY, don't pull it again"). Because the Nasdaq-100 is ~entirely a subset of the S&P 500, one large-cap feed pulls the **SPY∪QQQ union** once and projects two payloads, so a shared stock (AAPL, MSFT, NVDA…) is fetched a single time. **Feed** (`scripts/refresh-spx-heatmap.py`) is now index-aware: new `load_universe_qqq` (primary = Slickcharts Nasdaq-100 ticker+weight table; fallback = Wikipedia Nasdaq-100 — Invesco's `action=download` returns an SPA HTML wrapper, not CSV, so it's unusable via GET), an `INDEX_SPECS` registry + `build_index_configs` (loads each index's members/weights, builds the union, and *skips* a failed index so a QQQ-source outage never breaks SPX), a `--indexes spx,qqq` CLI arg, and the old `assemble` refactored into `pull_bars` (fetch each union symbol once → `{prevClose,last,series}`) + `build_index_payload` (project the shared bars onto one index's members+weights+label). The live loop (`run_ibkr_live`) keeps its snapshot / rolling-IV (`iv_cursor`) / Nasdaq-earnings / forward-fill exactly as-is over the union, then writes one payload per index each minute; `_seed_live_state` + the Yahoo backfill now seed/fill every index; `finalize_payload` gained a `label` param. **Backend**: `server/spxHeatmap.ts` extracts a parameterized `loadHeatmapPayload(appRoot, dataFile, indexLabel)` core (reusing `mergeDualClassTiles` — GOOG→GOOGL folds for QQQ too — `applyClassification`, `computeSectors`, `forwardFillTileSeries` unchanged) behind `loadSpxHeatmap`/`loadQqqHeatmap`; `server/index.ts` adds `GET /api/qqq-heatmap` + `/api/qqq-heatmap/live/{status,start,stop}` (proxied to the existing `spxHeatmapLive` — one process serves both files); `server/spxHeatmapLive.ts` launches the feed with `--indexes spx,qqq` (still one IBKR client id 941). **Classification**: the 13 Nasdaq-only names not in the S&P 500 (ARM, ASML, MRVL, SHOP, PDD, MELI, FER, MSTR, CCEP, ALNY, TRI, ZS, INSM) appended to the right existing Finviz industries in `data/finviz-classification.json` (GOOG needs none — it folds into GOOGL). **Frontend**: `SpxHeatmapPanel` takes an `index?: "spx"|"qqq"` prop (endpoints + labels by index, reset-on-switch, drops the hardcoded "S&P 500" strings); `src/api.ts` adds generic `fetchHeatmap`/`fetchHeatmapLiveStatus`/`startHeatmapLive`/`stopHeatmapLive` (`/api/${index}-heatmap…`) with back-compat SPX wrappers; `MorningDashboard` adds a `heatmapIndex` state + a single SPY⇄QQQ toggle button above the panel (shows both tickers, the active one bright, click flips the index). The pure helpers (`spxTreemap`, `sigmaMove`, `earningsOverlay`, `heatmapPeers`) + CSS are reused untouched, and the shared types were already index-agnostic. **Reuse proven** (in-memory harness): the union is 517 symbols (504 SPX + 13 QQQ-only), `pull_bars` fetches all 517 once, AAPL's `pctByTime` is byte-identical across the SPX and QQQ projections while its weight differs (SPX 7.0% vs QQQ 11.7%), and each payload's weights sum to ~100%. Validation: `npm run typecheck` clean; `server/spxHeatmap.test.ts` **11/11** (added 2 `loadQqqHeatmap` cases — QQQ dual-class fold + shared-classification overlay for a Nasdaq-only name + Nasdaq label + missing-file wording) and the full suite's **459 pass** (lone red is the unrelated `dateIssueBadges` concurrent daily-pull WIP); `python -m py_compile` OK; generated real Friday QQQ data via `--source yahoo --indexes qqq` (101 tiles, weights sum 100%, NVDA 12.9 / AAPL 11.72 / MSFT 8.04 — *not* SPY weights) **without touching** `spx-heatmap.json`; `npm run build` OK; built + served a fresh server on `:5199` and drove msedge — the **SPY↔QQQ toggle** flips the title to "Nasdaq-100 Market Map", the index pill to "Nasdaq-100 (QQQ weights)", and renders ~100 tiles with GOOGL dual-class-merged, sector→industry→stock nesting, the sub-industry hover panel, and the %/σ + earnings + scrubber controls, with **0 console errors** (screenshot). **The user must restart their Rubicon server** (new routes + `--indexes spx,qqq` feed args) **and hard-refresh** (new bundle with the toggle); live QQQ data populates on the next feed start (weekday ~09:28 auto-start or a manual heatmap-feed restart). Note: Slickcharts weights Alphabet (GOOGL+GOOG) at ~11.6% of the Nasdaq-100 — higher than Invesco's capped methodology, but it's the best parseable free source and the per-index weights sum to 100%. IWM deferred. Concurrent A156 cone work left untouched.
- A156 — **The Estimator now overlays a forward SPX expected-move CONE on the 2-min intraday chart** (±1σ / ±1.645σ = the ~0.05Δ short-strike "frontier" a credit seller targets / ±2σ, from the live spot out to 16:00 ET), and it was **validated on 745 historical SPX days before any UI was written** (the user asked to "validate it with previous SPX data"). **Phase 0 (gate) — backtest** `AI STUFF/analysis/expected_move_cone/backtest_cone.py` over the 1-min SPX history (2023-05→2026-05): confirmed the √t diffusion shape (Var(move) ~ slope·Δt, R²=0.991) but surfaced that (a) the app's `SPREAD_RESPONSE_A_PRIOR=1.21` is **stale** for this regime (measured A_global≈2.13; per-time-of-day 2.38 at the open → 1.75 mid-afternoon), (b) daily vol varies enormously (per-day realized scale ~0.5→5+) with extreme fat tails (excess kurtosis≈39) and a downside skew, so a flat constant cone over-covers calm days and under-covers wild ones — but (c) **per-day scaling fixes it**: standardizing each day's close-move by the early-session realized vol (Spearman 0.62 with the day's true scale — a stand-in for the live implied scale the feature uses) pulls 1.645σ/2σ coverage to ~91%/95% (≈nominal 90/95), and with the oracle daily scale the standardized move is ~Gaussian (kurtosis 35→4.8, the irreducible jump risk). Verdict (`AI STUFF/analysis/expected_move_cone/JOURNAL.md`): the cone is real and useful **only when scaled to the day's vol** — which the estimator already does via `impliedScale` on the live 0DTE credits. Deliberately did NOT change spreadResponse's `A_PRIOR` (it's the P/L-inversion fallback, separately validated); the cone module carries its own per-time-of-day prior from the backtest. **Build (Phases 1-4)** — new pure `src/expectedMoveCone.ts`: `expectedMoveCone({anchorSpot, anchorMinutesToClose, scale})` returns the `k·r·√elapsed` band per level on a step grid (rate `r` = implied `s0/√sourceMtc` or the time-of-day prior); `coneScaleFromSpreads` collapses the on-screen spreads to one move-scale (median of `impliedScale` per spread — the same vol that drives the P/L curve), falling back to the prior; + `expectedMoveCone.test.ts` **10/10** (width-at-close, pinch/monotone narrowing, implied↔prior parity, linear k-scaling, √t additivity, priorRate clamps, frontier identity `1−normCdf(1.645)≈0.05`). `EstimatorSpxChart.tsx` adds **6 paired lightweight-charts v5 line series** (±1σ sky / ±1.645σ amber **dashed** frontier / ±2σ slate), created once in the mount effect and `setData` in a `[bars,cone]` effect on a forward **120s-aligned epoch grid** from the last bar to the 16:00 epoch (adding future points extends the time axis — that *is* the visible cone), with a one-time fit when the cone first appears so the forward region shows. `LiveSpreadEstimatorPanel.tsx` derives `coneScale`→`cone` (replay-aware: anchors minutes-to-close to the last bar's `label` when not live), adds a `ConeControls` on/off pill + legend whose ±1.645σ swatch is labelled the 0.05Δ frontier, and passes `cone` to the chart. Validation: `npm run typecheck` clean; cone+panel **12/12** and the full suite's **448 pass** (lone red is the unrelated `dateIssueBadges` concurrent daily-pull WIP); `npm run build` OK; an **isolated lightweight-charts v5 harness screenshot** confirms the forward cone renders correctly (candles left, band pinches at spot and widens to the close, axis extends past the last candle); the real estimator screen loads with **zero console errors**. Client-only (JSX) → hard-refresh; the cone uses **live implied vol** whenever spreads are on screen (market hours) and the typical-day prior otherwise. Follow-ups (noted, out of scope): asymmetric wider-down cone, an event-kink at scheduled macro minutes (calendar already in app), half-day (≈13:00) close handling, an optional 09:30-anchored static day-range mode. Concurrent A155 heatmap work left untouched.
- A155 — **SPX heatmap no longer goes fully grey for one minute every ~11 min.** Root cause (confirmed in both the data and the live log): `run_ibkr_live()` in `scripts/refresh-spx-heatmap.py` runs one iteration per minute — snapshot ~503 quotes (~36s), write the payload, then `ib.sleep(61 − clock.second)` to the next boundary. Every ~10 min the per-stock **IV sweep** (`sweep_iv`, generic tick 106 over the whole universe ≈ **48s**) ran first, so that iteration took ~84s — it overran the minute and the boundary-sleep landed ~2 min later, **skipping a whole minute index** entirely; nothing ever wrote `series[sym][skipped_idx]`, so all 503 tiles stayed `null` → a grey blank minute. `data/spx-heatmap.json` had **13** such 503/503-null interior minutes and `data/spx-heatmap-live.log` showed the counter jumping (`11:10 → 11:12`, `11:21 → 11:23`, …), matching null minutes 11:11/11:22/…. The within-iteration per-name forward-fill couldn't help — a skipped minute had no iteration at all. **Two complementary fixes.** (1) **Loader (primary, server-side, fixes existing + future data):** new pure exported `forwardFillTileSeries(tiles)` in `server/spxHeatmap.ts` computes the global frontier (max last-non-null index across tiles) and, per tile, carries the last non-null `pctByTime` value forward across *interior* nulls (first print → frontier), leaving **leading** nulls (not yet printed) and **trailing** nulls (future minutes past the frontier — the panel's scrubber is already frontier-capped) untouched; wired into `loadSpxHeatmap` right after `applyClassification(mergeDualClassTiles(...))`. A blank minute now renders as the prior minute's colours (≤1-min-stale %, imperceptible) instead of grey, and it restores that minute's breadth/index summary (was effectively 0/0/0). (2) **Root cause (Python, makes the data real):** the IV sweep is now a **per-minute rolling slice** — `iv_cursor` walks the universe `iv_slice=64` names at a time (`order[iv_cursor:iv_cursor+iv_slice]`, wrapping mod `len(order)`; env `IBKR_HEATMAP_IV_SLICE`), so per-iteration IV cost drops from ~48s to ~one batch and each iteration stays well under 60s → no minute is skipped (the whole universe still refreshes every ~8 min; IV barely moves intraday). Dropped the old `last_iv_sweep`/`IBKR_HEATMAP_IV_REFRESH_MIN` 10-min gate. Validation: `npm run typecheck` clean; `server/spxHeatmap.test.ts` **9/9** (added a `makeTile` helper + 5 `forwardFillTileSeries` cases — interior null, whole-map blank minute, stopped-printing tile up to the frontier, leading/trailing untouched, all-null unchanged — and updated the existing loader test's NVDA assertion since AAPL now extends the frontier to its index); running the patched loader over the **real** `data/spx-heatmap.json` reported **0** all-null interior minutes (was 13); `python -m py_compile scripts/refresh-spx-heatmap.py` OK; full suite **431 pass / 2 fail** — the two reds are the same unrelated concurrent daily-pull WIP (`src/dateIssueBadges.test.ts` + `server/dailySync.test.ts`), unreachable from this change. Server-side only (loader + Python) — **no client bundle change**; the user must **restart their Rubicon server** for the loader forward-fill, and the rolling IV sweep takes effect on the next feed start (tomorrow's ~09:28 auto-start or a manual heatmap-feed restart). Concurrent A154 calendar-coalesce work left untouched.
- A154 — **Calendar alerts now coalesce: multiple events at the same start time fire ONE notification, not one per event.** Previously `MorningDashboard` set a separate timer per event (`calendarAlertTargets` returns one target per event), so a cluster like CPI + Retail Sales + Jobless Claims all at 8:30 produced three simultaneous toasts + three in-app cards + three (doubled) sounds. New pure `calendarAlertGroups`/`nextCalendarAlertGroup` in `src/calendarAlerts.ts` bucket the per-event targets by identical `eventAt` into a `CalendarAlertGroup { alertAt, eventAt, events[], millisUntilAlert }` (events within a moment stay title-sorted); `formatCalendarAlertStatus` now takes a group and renders "8:30 AM - 3 events" for clusters (singleton copy unchanged). `MorningDashboard.tsx` schedules ONE `setTimeout` per group, fires only while the group still has un-notified events (then marks every event id in the group notified), `fireCalendarAlert(group)` plays the two-tone sound once and sets a `{ events[] }` popup, and `showWindowsCalendarAlert(events[])` builds a single toast — title "3 calendar events start in 1 minute", body "CPI • Jobless Claims • Retail Sales", detail "8:30 AM - 8:30 AM EDT" (the single-event path/copy is byte-for-byte unchanged). `CalendarAlertOverlay` lists every event as a bulleted `.calendar-alert-list` (new `App.css` rule) when there's more than one, else the original single-event card. Validation: `npm run typecheck` clean; `src/calendarAlerts.test.ts` 7/7 (added a 3-at-8:30 + 1-at-8:31 coalescing case and a "2 events" status-summary case) + suite 427 pass (the lone red is the unrelated `dateIssueBadges` concurrent daily-pull WIP); `npm run build` OK; live-verified on `:5191` — POSTing the coalesced payload the frontend now builds rendered as ONE bottom-right toast / single Action-Center entry listing all three 8:30 events (same Rubicon AppId). Client + bundle change → hard-refresh; restart the server to serve the rebuilt bundle. Concurrent A151–A153 work left untouched.
- A153 — Estimator: the **P/L-vs-SPX curve and the SPX 2-min intraday chart now sit side by side** (previously stacked vertically). `src/components/LiveSpreadEstimatorPanel.tsx` wraps the `AggregateChart` (the portfolio/spread P/L curve) and the `EstimatorSpxChart` block (SPX candles + LIVE/replay badge + Start/Stop feed button) in a flex row — each `flex: 1 1 340px`, `flex-wrap` so they drop to stacked on narrow widths, `align-items: flex-start` — and moved the "target level" slider + quick-jump buttons (spot/±25/±50) to **below** the row, since the slider's Target line drives both charts. Each chart gets a compact heading ("portfolio/spread P/L vs SPX level" on the left, "SPX intraday · 2m" + badge/feed-button on the right). The `AggregateChart` stays a width-scaling SVG so it reads fine at half-width on the wide Estimator screen; `EstimatorSpxChart` keeps its fixed height. Validation: `npm run typecheck` clean; `LiveSpreadEstimatorPanel.test.tsx` 2/2; `npm run build` OK; served a fresh build on `:5192` and screenshotted the Estimator at 1500px — the P/L curve (x 41–744, 230px tall) and the SPX candle chart (x 757–1393) render side by side with the slider full-width beneath and the per-spread list below, zero console errors. Client-only (JSX) → **hard-refresh only, no server restart**. Two unrelated suite reds remain (`dateIssueBadges` + `server/dailySync.test.ts`, concurrent daily-pull WIP). Concurrent work left untouched.
- A152 — Morning **Brief** layout: AI Notes now sits directly under the Calendar, stacked as one left column matching the Live Updates height. At the 761–2200px breakpoint (most monitors) the brief grid was Calendar | Live Updates on row 1 and Holdings | AI Notes | TC2000 on row 2 — so AI Notes floated low in the middle of the bottom row while empty space sat under the Calendar. Fix wraps the Calendar (`MorningAgendaSection`) + the AI Notes panel in a new `.morning-brief-stack` div in `src/components/MorningDashboard.tsx`; `src/App.css` makes that wrapper `display:contents` by default (so at other widths its children stay direct grid items and the existing 1-col / 5-col layouts are unchanged), and in the 761–2200px rule turns it into a `flex-direction:column` left column (`grid-column:1/span 3`, `gap:12px`) with Live Updates filling the right column (`grid-column:4/span 3`) and IBKR + TC2000 on the bottom row. Result: AI Notes sits snug under the Calendar (the 12px flex gap) instead of ~138px adrift, and the Calendar+AI Notes column shares the Live Updates band. Earlier attempt (Live spanning two explicit grid rows) was rejected because the grid distributed Live's extra height into the gap *between* Calendar and AI Notes; the flex-stack keeps them snug and pushes any slack below. Validation: `npm run typecheck` clean; `MorningDashboard.test.tsx` 8/8 and the full suite's 417 pass — **two** unrelated reds now (`dateIssueBadges` **and** `server/dailySync.test.ts`, both from a concurrent agent's in-flight daily-pull edits to `dailySync.ts`/`dateIssueBadges` deps, unreachable from this layout change); `npm run build` OK; served `:5191`, screenshotted the Brief at 1680px — bounding boxes confirm Calendar (y 281–902) → AI Notes (y 914) stacked snug on the left, Live Updates filling the right. Client-only (CSS + JSX) → **hard-refresh only, no server restart**. Concurrent A151 toast work left untouched.
- A151 — The calendar 1-minute desktop alert is now a **native Windows toast** (slides in bottom-right / Action Center) instead of the centered `wscript` `shell.Popup` dialog — so every Rubicon computer notification is finally a toast, matching FirstSquawk. Backend `server/desktopAlert.ts` extracts the proven `spawnSync("powershell.exe", […show-windows-toast.ps1…])` block (AppId resolution + status/error handling + resolved-AppId message) into a shared `launchWindowsToast(sanitized, appRoot, duration)`; `showCalendarDesktopAlert` now calls it with `"long"` (a 1-minute pre-event warning should linger in the Action Center) and `showLiveUpdateDesktopToast` with `"short"` — both funnel through the **same** helper + AppId, so calendar and FirstSquawk look and land identically. The old detached `spawn` is gone (a toast returns right after `Show()`, so `spawnSync` is fine and lets the API confirm the launch + return the resolved AppId). Frontend `src/components/MorningDashboard.tsx` drops the **duplicate browser `Notification`** on the calendar fire (removed the `showBrowserNotification(...)` + `requestBrowserNotificationPermission()` calls and both now-unused helpers, incl. the `new Notification(...)`), so calendar is toast-only just like live-updates; the in-app `CalendarAlertOverlay` card + two-tone `playCalendarAlert` sound stay as the in-window fallback. `src/App.css` moves that in-app card from the top-right to the **bottom-right** (`.calendar-alert-overlay` `top`→`bottom` in both the main and narrow-screen rules) so the OS toast and the in-app card share the same corner (the trader explicitly wanted bottom-right, not the centered popup). Cleanup: `scripts/show-calendar-alert.vbs` is now unreferenced and **deleted**; `detailedcodebase.md` updated (the script table + the `desktopAlert.ts` row). Tests: `server/desktopAlert.test.ts` replaces the two stale calendar tests (the detached-`spawn` error-handler test + the `wscript.exe`/`show-calendar-alert.vbs` popup test) with one toast test asserting calendar spawns `powershell.exe` + `show-windows-toast.ps1` + "Calendar event starts in 1 minute" + `-Duration long` + `windowsHide:true` and that `spawn` is **never** called; the live-update toast test is unchanged. `src/components/MorningDashboard.test.tsx` has no browser-`Notification` assertions (grep-confirmed). Validation: `npm run typecheck` clean; `desktopAlert` 4/4 and the full suite's 418 pass — the lone red is the same unrelated `dateIssueBadges` concurrent daily-pull WIP; `npm run build` OK. **Live-verified** on a fresh-build server `:5186`: `POST /api/desktop-alert/calendar` returned `ok:true` with `message` resolving the **same AppId as live-update** (`127.0.0.1-9BBB1E10…!App`, the Edge "Rubicon" PWA) → a real bottom-right toast, no centered gray popup; `POST …/live-update` matched. **The user must restart their Rubicon server** to pick up the backend change. Concurrent A150 live-bars work left untouched.
- A150 — Live SPX intraday bar feed, closing the A148 chart limitation: the Estimator's 2-min SPX chart is now live during the session instead of waiting for the post-close daily pull. Built as a **dedicated decoupled sidecar** (the heatmap live loop is heavily contended by concurrent agents): new `scripts/refresh-spx-live-bars.py` connects once to TWS with its own client id **947** (distinct from heatmap 941 / holdings 884), then every ~15s re-pulls today's RTH 1-min SPX index bars (`Index('SPX','CBOE')`, `whatToShow=TRADES`, `useRTH=True`, filtered to today's ET date so a pre-open pull of the prior session doesn't bleed in) and atomically writes `data/spx-live-bars.json` as `{generatedAt, session, source, live, barSize, bars: SpxBar[]}`; it self-stops at 16:00 ET. `server/spxLiveBars.ts` adds a pure loader (`loadSpxLiveBars` — sanitises/sorts bars, reports `asOf`) plus a process manager (`startSpxLiveBars`/`stopSpxLiveBars`/`getSpxLiveBarsStatus`/`armSpxLiveBarsAutoStart`, `isSpxBarsMarketWindow`) mirroring `spxHeatmapLive` but leaner (no external-process discovery — the server owns this process), RTH-gated, auto-starting ~09:28 ET on weekdays. `server/index.ts` exposes `GET /api/spx-live-bars` + `/api/spx-live-bars/live/{status,start,stop}` and arms the auto-start at boot; `shared/types.ts` gains `SpxLiveBarsPayload`/`SpxLiveBarsLiveStatus`; `src/api.ts` gets the four fetchers. `MorningDashboard` polls the feed + status only while the Estimator screen is open and the tab is visible (20s), and passes the **live bars (preferred over the replay bars)** plus a `spxFeed` control object into the panel. `LiveSpreadEstimatorPanel` shows a **LIVE / replay** source badge next to "SPX intraday · 2m" and a **Start/Stop SPX feed** button (refuses outside RTH); `EstimatorSpxChart` was refactored to create the chart **once** and update in place (`series.setData` on new bars, `priceLine.applyOptions` on slider ticks) so the ~20s live refresh doesn't flicker, with an always-rendered container + overlaid empty-note. Validation: `npm run typecheck` clean; new `server/spxLiveBars.test.ts` (3/3: RTH window + loader sanitise/asOf + missing-file) and the full suite's 419 others pass — the lone red is the same unrelated `dateIssueBadges` concurrent daily-pull WIP; the `LiveSpreadEstimatorPanel` test now `vi.mock`s `EstimatorSpxChart` so lightweight-charts (matchMedia/ResizeObserver) doesn't need jsdom; `python -m py_compile` OK; `npm run build` OK; deployed to `dist/` (new bundle `index-DCS5kvKh.js`). **Live-verified against the user's TWS** (weekday ~14:2x ET): the sidecar connected and pulled **293 real SPX 1-min bars** (09:30 7529.54 → 14:22 7593.26, correct ET labels/epochs), `/api/spx-live-bars` served 294, and a fresh-build server on `:5190` rendered the Estimator's 2-min candlestick chart with today's session + the **red Target price line tracking the slider** (axis label 7592.72) and the green LIVE badge (screenshot). **The user must restart their Rubicon server** to load the new routes + auto-start (server-side change). Concurrent A149 heatmap-earnings work was left untouched.
- A149 — SPX Heatmap gains a togglable **"earnings" overlay**: any name reporting in the next **~2 weeks** gets a light-blue outline + faint tint that's always obvious and grows brighter/thicker as the last-tradeable date nears — and a **before-open (BMO) report counts as the prior trading day** (the prior close is the last chance to trade it). New pure `src/earningsOverlay.ts#earningsHighlight(date, time, now)` computes the effective date (BMO → previous trading day, weekends skipped), in-window membership (within ~2 weeks / 10 trading days, ≥ today — so a next-Wednesday report shows when today is Wednesday), and an intensity that floors at ~0.45 and ramps to 1.0 at 0 days (+8 tests). The Nasdaq fetch window widened to ~16 days to cover it. Earnings come free from the Nasdaq calendar the holdings pull already uses — new shared `scripts/earnings_nasdaq.py` (`week_earnings`; ~5 weekday HTTP calls cover all 500, no IBKR/key) is fetched by `refresh-spx-heatmap.py` at live-loop startup and written as `earningsDate`/`earningsTime` on each tile; `SpxHeatmapTile` gains both fields; the loader threads them through (dual-class merge keeps the primary's earnings). `src/components/SpxHeatmapPanel.tsx` adds an "Earnings" toggle (independent of the %/σ colour mode) drawing a `#60a5fa` outline+tint per this-week tile with strokeWidth/opacity scaled by intensity, plus a tooltip earnings line (date · BMO/AMC · this week); `src/components/SpxHeatmap.css` styles the toggle. Validation: `npm run typecheck` clean; new Vitest (`earningsOverlay` 7/7 + loader earnings passthrough) and the suite's 415 pass — lone red is the same unrelated `dateIssueBadges` concurrent daily-pull WIP; `python -m py_compile` OK; `npm run build` OK; served `:5185` with a synthetic-earnings payload → the toggle draws 19 blue outlines, NVDA (today) brightest/thickest, AAPL/AVGO (further out) dimmer, non-earnings tiles none (2× screenshot verified). NOTE: like the IV sweep, the running live feed must be restarted to populate real earnings. Concurrent A147/A148 work left untouched.
- A148 — Morning → Estimator becomes a study cockpit on top of the live-portfolio view. (a) New `src/spreadEstimator.ts` helpers: `liveSpreadFromTradeRecord(trade, spot)` maps a paired vertical `TradeRecord` to a `LiveSpread` with `creditNow = entryPrice` (so the Bachelier inversion frames the closed-spread curve at entry conditions); `todayClosedSpxSpreads(trades, todayEt, spot)` filters tracker trades to today's exited SPX 0DTE Credit verticals (drops `"Mixed"`, expiration-must-equal-today, SPXW legs) and carries `exitTimeLabel` + realised P/L; `activeSpreadsForResponse(open, all, focusedId)` enforces the **closed-never-in-portfolio** invariant — closed spreads only feed the aggregate when explicitly focused (1-element route through the same `buildPortfolioResponse` path as the portfolio aggregate, so no math change). New `EstimatorSpreadOption` shape. +9 unit tests covering closed-trade conversion, the SPXW/expiration/Credit/Mixed filters, the focus derivation, and a stale-id miss → []. (b) `App.tsx` passes `snapshot.trades` into `MorningDashboard`; `MorningDashboard` adds a `replay: ReplayPayload | null` state + `loadReplay(date)` callback + a per-`selectedDate` `useEffect` that `fetchReplay()`s once for SPX bars, then threads `trades` + `spxBars` into the panel. (c) `LiveSpreadEstimatorPanel` derives `openOptions` / `closedOptions` / `allOptions`, holds `focusedSpreadId: string | null` state with an auto-clear effect when the focused id leaves the available set, renders a horizontal chip rail above the chart (open chips solid in the panel's existing PCS-blue/CCS-red palette; closed chips muted with a dashed border, exit-time label, and signed realised P/L coloured green/red), shows a `← View Portfolio` button next to the LIVE pill whenever focused (returns to the open-spreads aggregate), adapts the header subtitle (`"N open spreads · M contracts · …"` vs `"Focused: CCS 7585/7590 ×5 · closed 13:42 · realised +$340 (study only — not in portfolio)"`), and gracefully degrades when there are no open positions but closed chips exist (spot falls back to the latest SPX bar's close). The per-spread detail card now reads "spreads" in portfolio mode and "focused spread" in focus mode (single-row drilldown). (d) New `src/components/EstimatorSpxChart.tsx` renders the SPX **2-min** intraday candles via the existing `MarketChart` lightweight-charts pipeline + `aggregateSpxBars(bars, 2)` (already in `ReplayCharts`), and attaches two horizontal price lines: a **Target** line (green when the slider's level yields positive aggregate P/L, red when negative) updated on every slider tick via `priceLine.applyOptions({ price, color })` (no chart re-render), plus a faint dashed **spot** line. Empty-state ("Waiting for SPX intraday bars") when no bars exist yet. Validation: `npm run typecheck` clean; new spreadEstimator 9/9 + `LiveSpreadEstimatorPanel.test.tsx` 2/2 (the panel test updated to match the new "open spreads" subtitle copy and to handle the chip rail + detail card both rendering the same label) + 404 prior pass — the one red (`src/dateIssueBadges.test.ts`) is the same unrelated concurrent daily-pull WIP and is unreachable from this change. `npm run build` OK; deployed to `dist/` (new bundle `index-BuB7A3Ga.js`) so a hard-refresh picks it up. Known limitation: SPX bars come from the existing replay endpoint which reads `data/spx_intraday/…`; during a live mid-session before the pull runs the chart shows the "Waiting for SPX intraday bars" empty-state — adding a live SPX bar feed (piggybacked on the heatmap loop or as its own sidecar) is a follow-up. Concurrent A146/A147 heatmap work was left untouched.
- A147 — SPX Heatmap adds a **% / σ toggle**: σ recolours every tile by its IV-normalized move (how many standard deviations the day's % move is) using each stock's own ~30-day ATM IV, surfacing moves that are unusual *for that name* (a low-vol utility +3% lights up far more than TSLA +3%). New pure `src/sigmaMove.ts` (σ = move% ÷ (IV/√252); +4 tests). `scripts/refresh-spx-heatmap.py` sweeps IBKR's per-stock implied vol (generic tick 106, brief streaming) every ~10 min inside the existing live loop and writes `iv` onto each tile (`sweep_iv`, env `IBKR_HEATMAP_IV_REFRESH_MIN`); `SpxHeatmapTile.iv` added and threaded through the loader (dual-class merge keeps the primary listing's IV). `src/components/SpxHeatmapPanel.tsx` adds the toggle by the legend (colours via `heatmapColor(σ, cap 2)`, σ tile labels, legend → ±2σ, IV+σ in the tooltip + σ peer rows; σ disabled until a sweep lands and auto-falls-back to % if IV disappears); `src/components/SpxHeatmap.css` styles it. Step-0 spike against live TWS confirmed tick-106 IV for 16/16 sampled names across the vol spectrum (KO 18% … AMD 68%). Validation: `npm run typecheck` clean; new Vitest (`sigmaMove` 4/4 + loader iv passthrough/merge) and 402 prior pass — the lone red is the same unrelated `dateIssueBadges` concurrent daily-pull WIP; `python -m py_compile` OK; `npm run build` OK; served `:5185` with a synthetic-IV payload → σ view recolours/labels (AVGO −7.4σ, JPM +2.4σ, LLY +3.7σ), legend reads ±2σ, tooltip shows IV+σ (screenshot verified). NOTE: the currently-running live feed is the *old* python (no IV sweep) — it must be restarted to populate real IV. Concurrent A145/A146 estimator+hover work left untouched.
- Estimator P/L chart framing (refines A145): the SPX axis is now framed to each spread's actual max-loss / max-profit saturation (≈3σ of the Bachelier move-scale beyond the strikes) instead of a fixed 1.5%-of-spot pad, so a spread's full −$width loss lands right on the chart edge and the SPX range / target slider isn't wider (more drag-sensitive) than the position warrants. `src/portfolioResponse.ts#defaultLadder` now takes `minutesToClose` and derives the pad from `impliedScale`/`signedDistanceToLoss` (`spreadResponse.ts`): `pad = max(3·scale, 25)`. Reported by the trader as "too sensitive; −5.00 should be on the edge" — on a live book (spot 7568, near-ATM 7585 call + far-OTM puts) it trims the range from ~7355–7700 to ~7372–7683 with the −$5 max-loss at the edges. Added a `src/portfolioResponse.test.ts` case asserting the edges reach ≥97% of full max-loss/max-profit within a bounded range. `npm run typecheck` clean; `portfolioResponse` 3/3.
- A146 — SPX Heatmap hover now shows a Finviz-style sub-industry panel: hovering any tile lists every stock in that tile's sector+industry with each name's intraday % change (colour swatch + last price + signed %), the hovered stock highlighted at top, sorted by index weight. New pure `src/heatmapPeers.ts#industryPeers(tiles, sector, industry)` (+ `src/heatmapPeers.test.ts`, 3 cases) drives the list; `src/components/SpxHeatmapPanel.tsx` rebuilds the hover tooltip (memoised peers recomputed only on industry change, edge-aware positioning so the taller panel stays on-screen, max-height clamp), and `src/components/SpxHeatmap.css` adds the peer-row styles. Validation: `npm run typecheck` clean; focused Vitest `heatmapPeers`/`spxTreemap`/`spxHeatmap` 10/10; `npm run build` passed; served `:5185`, hovered NVDA → tooltip renders "SEMICONDUCTORS · 13" with all 13 names + % changes (2× screenshot verified). The one unrelated red (`src/dateIssueBadges.test.ts`) is the same concurrent daily-pull failure noted under A145 — unreachable from this change. Concurrent A145 estimator work was left untouched.
- A145 — The Estimator (Morning → Estimator) now auto-refreshes its live 0DTE SPX spreads and shows a LIVE indicator. The server already pulled IBKR holdings every 5 min on weekdays 09:30–16:15 ET (`armIbkrHoldingsAutoRefresh` → `shouldFireIntradayHoldingsRefresh`, armed at `server/index.ts`), but the client fetched holdings only once on mount and gave no live signal. New pure `src/estimatorLiveState.ts` computes a LIVE / STALE / PRE_MARKET / CLOSED phase from the snapshot's `fetchedAt` freshness + `autoRefreshEt` + a client ET market-window check (LIVE only when viewing today, inside the weekday 09:30–16:00 window, and `fetchedAt` ≤ ~2× the 5-min interval; the badge greys at 16:00 even though pulls run to 16:15). `src/components/MorningDashboard.tsx` adds a visibility-gated 60 s read-only poll of `/api/ibkr-holdings` (it never POSTs `/refresh`, so it cannot open a competing TWS connection — the server owns the unique-client-id pull) that runs only while `shouldPoll` (today + in-window), plus a 30 s heartbeat so the pill flips phases at the boundaries. `src/components/LiveSpreadEstimatorPanel.tsx` renders a pulsing green "LIVE · auto every 5m · updated HH:MM:SS" pill (amber Stale / grey Pre-market·Closed) via a new `.estimator-live-dot` rule in `App.css`. Holidays aren't detected (weekday-only, same limitation as the heatmap/fpl feeds). Validation: `npm run typecheck` clean; new `src/estimatorLiveState.test.ts` 9/9 and the full suite's 397 other tests pass — the single red, `src/dateIssueBadges.test.ts` "option breadth failures not red", comes from concurrent uncommitted daily-pull work (`dailyPullChecklist.ts`/`dailyPullReviewModel.ts`) and is unreachable from this change; `vite build` verified into a temp out-dir so the user's running `dist/` was left untouched (rebuild + hard-refresh to load it).
- Manual canonical backfill for the 2026-06-03 pull is complete. Regenerated `..\IBKR Equity History Pull\data\ibkr_trades\2026-06-03\entries.csv`, `entries.parquet`, `contracts.csv`, `ibkr_option_intraday\spread_trade_marks_5s.*`, `summary.json`, `daily_sync_summary.json`, and tracker-only `google_sheet_upload_payload.json` from stored fills and option bars. The two wide exits (`44054554`, `44054868`) now attach to four existing 5-wide rows instead of creating raw 10-wide replay entries; live Replay for 2026-06-03 now returns 17 canonical quick trades, 6,885 sampled replay marks, 4,680 SPX bars, and every SPX vertical has a spread-mark id. Rubicon ingest refreshed tracker, replay safe state, and spread-speed state with no warnings. Validation: `python -m pytest tests -q` passed 17/17 in `IBKR Equity History Pull`; focused Rubicon importer/replay/P&L tests passed 36/36.

- Daily Pull Important Checks is now the single glance surface for important outputs: the duplicate Review Details / Review Critical disclosure is removed, the status pill is labeled Important, and the top checklist includes IBKR trade files, SPX 5s bars, traded spread replay marks, Option 5s chain, Option OI, and Option Volume. The old Review Readiness bucket no longer renders as its own section; readiness remains the hero verdict/pill. Validation: TDD red caught the old `3/3` + Review Details UI, then `npm run test -- App` passed 19/19, `npm run typecheck` passed, `npm run build` passed with the existing Vite large-chunk warning, and Playwright smoke on `http://127.0.0.1:5174` found `6/6 complete`, all three option checks, no Review Details/Critical/Readiness text, and zero console warnings/errors. Screenshot: `output/browser-smoke/daily-pull-important-checks.png`.

- Daily SPX/IBKR sync now records SPXW verticals as canonical adjacent 5-wide rungs before lifecycle matching. In `..\IBKR Equity History Pull\daily_spx_ibkr_sync.py`, wider SPXW PCS/CCS/debit close orders decompose into 5-point spread keys, synthetic middle-strike contracts are added to the option manifest, spread marks are generated against canonical entries, and `entries.csv` is rewritten after mark generation with scaled per-rung entry/exit prices plus audit columns. This fixes closing two adjacent 5-wide spreads with one wider order so replay, Daily Review, Google Trade Log, and P/L simulation see the same 5-wide units. Validation: `python -m pytest tests -q` passed 15/15 in `IBKR Equity History Pull`; `python -m py_compile daily_spx_ibkr_sync.py` passed; Rubicon focused replay/importer tests passed 36/36; full Rubicon Vitest passed 386/386; `npm run typecheck` passed; `npm run build` passed with the existing large-chunk warning; live replay smoke on `http://127.0.0.1:5174/api/replay?date=2026-06-03` returned 19 quick trades, 7,695 spread marks, and 4,680 SPX bars.

- Daily Review no longer lists EOD synthetic expiries in the tab timeline or headline counts. The tab now presents entries/exits only, filters `expiration` review events from the visible sequence, and keeps the underlying review/export model intact. Added an App regression with an expired 16:00 trade proving the tab shows 5 entry/real-exit events and no expiry wording. Validation: `npm run test -- App` passed 19/19, `npm run typecheck` passed, and `npm run build` passed with the existing Vite large-chunk warning.

- Daily Sync's Rubicon ingest now conditionally backfills `data/spx-heatmap.json` from Yahoo when the heatmap is missing, sample-only, or otherwise lacks usable real intraday values. Added `spxHeatmapPayloadIsFilled()` and `maybeBackfillSpxHeatmapFromYahoo()` to `server/dailySync.ts`; `refreshDailySyncDerivedState()` now reports `spxHeatmapBackfilled` / `spxHeatmapBackfillSkipped`, while background daily-sync catch-up opts out so server startup does not unexpectedly hit Yahoo. Validation: `npm run test -- server/dailySync.test.ts` passed 13/13, `npm run typecheck` passed, `npm run build` passed with existing Vite warnings, and a fake-script smoke proved the first missing-heatmap call backfills and the second call skips an already-filled `yahoo-1m` payload.

- Daily Pull now opens with a simplified Important Checks panel for the three review-critical outputs (IBKR trade files, SPX bars, traded spread replay marks) and keeps Review Details, Diagnostics, and Pipeline / Upload Details collapsed by default. Removed the coverage percentage column/meter from Daily Pull output tables. Process and Source State now live under a nested Run audit disclosure inside Pipeline / Upload Details, preserving the debugging/audit detail without making it part of the daily glance. Validation: `npm run test -- App` passed 19/19, `npm run typecheck` passed, `npm run build` passed with the existing large-chunk warning, and Playwright-core smoke on `http://127.0.0.1:5174` found 3 glance checks, 0 visible `Coverage` labels, collapsed details, Run audit revealing Source State, and zero console errors/warnings. Screenshot: `output/playwright/daily-pull-simplified.png`.

- Manual tracker-only Google upload for 2026-06-03 completed after fixing the upload precheck that rejected the default service-account credential path before the auth layer could use it. `npm run google:upload -- --date 2026-06-03 --payload ... --run-id daily-2026-06-03-20260603202523` updated Google `Daily Sync Runs` row 7 and `Trade Log` starting at row 41 (`updatedCells: 446`, `uploadMode: tracker_only`). Widened the Google snapshot range from `A1:AA1000` to `A1:AZ1000` so the uploaded status columns are visible, refreshed the Google snapshot, reran Rubicon ingest for 2026-06-03, and reconciled the live daily-sync status file to `googleUploaded: true` with the retired raw-workbook step removed. Validation: focused Google/daily-sync tests passed 21/21, `npm run typecheck` passed, `npm run build` passed with the existing chunk warning, `/api/tracker` reports today `uploadStatus: uploaded`, and `/api/daily-sync/status` reports `googleUploaded: true`.

- Daily Pull no longer duplicates the pipeline run/preflight controls when `Pipeline / Upload Details` is expanded. The top Daily Pull pipeline bar remains the single launch/progress surface, while `Source State` keeps Google refresh, diagnostics, readiness, and log detail. Added a focused App regression test for one visible Run/Preflight control pair after expanding details. Validation: `npm run test -- App`, `npm run typecheck`, `npm run build`, and Browser smoke on `http://127.0.0.1:5174` passed (`Run Daily Pipeline` count 1, `Preflight Pipeline` count 1, `Refresh Google` count 1, zero console warnings/errors); screenshot proof saved at `output/playwright/daily-pull-no-duplicate-pipeline.png`.

- Replay cockpit layout is now durable at the requested 1920x1080 target: Replay-specific CSS bounds the four-chart grid inside the cockpit flex budget, keeps the scrubber below the grid, keeps the visible Spread Speed panel inside the viewport, and prevents horizontal overflow in the replay console. `SpreadSpeedPanel` now has a stable `.spread-speed-panel` root class and shrinkable two-column body. Validation: `npm run test -- App ReplayCharts`, `npm run typecheck`, `npm run build`, and a mocked 1920x1080 Playwright smoke passed; screenshot proof saved at `output/playwright/rubicon-replay-1920x1080-durable.png`.

- A144 — SPX Heatmap (Morning → Heatmap) now nests **sector → industry → stock** on the Finviz/Morningstar taxonomy instead of flat GICS sectors. New `data/finviz-classification.json` holds all 500 S&P 500 names across 11 Finviz sectors / ~120 industries, transcribed from Finviz's market map and reconciled against the live SPY-holdings universe (`scripts/_reconcile.py`). The TS loader `server/spxHeatmap.ts` now (a) folds dual-class siblings GOOG→GOOGL / FOX→FOXA / NWS→NWSA into one weight-summed, %-blended tile via `mergeDualClassTiles` (universe 503→500, matching Finviz's single Alphabet/Fox/News box), (b) overlays the Finviz sector+industry onto each tile via `applyClassification`, and (c) re-derives the sector summary from the merged+classified tiles via `computeSectors` (the on-disk GICS sectors are ignored); the Python feed is untouched. `SpxHeatmapTile` gains an `industry` field. `src/components/SpxHeatmapPanel.tsx` lays a 3-level squarified treemap (sector header → industry sub-block + caption → stock tiles) and shows the industry in the tooltip. Reconciliation caught a 1-day-old index change: EPAM left the S&P 500 and FedEx Freight (FDXF) joined, effective 2026-06-02 (S&P Dow Jones Indices) — our SPY-holdings universe already reflected it, so EPAM was dropped and FDXF placed under Trucking. Validation: `npm run typecheck` clean; full Vitest 377/377 (added 2 loader tests for the dual-class merge + Finviz join in `server/spxHeatmap.test.ts`); `npm run build` passed; served the built app on `:5183` and screenshotted the rendered map — `/api/spx-heatmap` returns 500 tiles with Finviz sector names, and the treemap renders sector→industry→stock (e.g. Technology → Semiconductors / Software-Infrastructure / Consumer Electronics) with GOOGL as a single merged tile.
- A143 — Morning > Estimator now centers on the trader's live IBKR 0DTE SPX spreads. `src/spreadEstimator.ts` selects 0DTE SPXW verticals from the holdings pull; `src/portfolioResponse.ts` runs each through the existing self-calibrated Bachelier model on a shared SPX ladder and sums an aggregate portfolio P/L curve; `src/components/LiveSpreadEstimatorPanel.tsx` renders the live spreads + aggregate as primary and demotes the manual what-if spread to a collapsed disclosure; `server/ibkrHoldings.ts` adds a 5-minute market-hours live pull alongside the 08:30 window. Validation: full Vitest 375/375 and `vite build` passed; typecheck clean for the new code (only a pre-existing unrelated `MarketChart.tsx` unused-import remains). Plan in `GOAL-spread-estimator.md`.
- Daily Pull now has a visible Daily Sync progress bar above the date rail, driven by a frontend-only `dailySyncProgress` helper over `/api/daily-sync/status` steps. The bar shows current step detail, count, progressbar ARIA values, warning/failed/complete tones, and running status now polls every 5 seconds. Added focused unit and React coverage for idle, running, warning, failed, and completed progress states. Validation: `npm run test -- dailySyncProgress App dailySyncDiagnostics`, `npm run typecheck`, and `npm run build` passed; build retained only the existing Vite large-chunk warning.
- Daily Pipeline Google upload is now tracker-only: the sync no longer rebuilds or uploads the raw archive workbook, no longer requires `SPX_GOOGLE_RAW_UPLOAD_FOLDER_ID`, and generates the daily Google payload with `--tracker-only` so it contains only `Daily Sync Runs` plus compact `Trade Log` blocks. Daily Pull/Source State copy now reports "Google tracker upload" instead of raw workbook receipt. Verified tracker-only payload sanity for 2026-06-03: ~20 KB, 1 tab, 19 Trade Log rows. Validation: targeted Vitest suite 14/14 files and 92/92 tests passed, `npm run typecheck` passed, `npm run build` passed, Python compile and PowerShell parse checks passed.
- SPX Heatmap feed now refuses to start (and therefore to pull) outside regular trading hours. `isMarketPullWindow()` in `server/spxHeatmapLive.ts` allows starting only on weekdays 09:25-16:00 ET; after 16:00 / pre-open / weekends, `startSpxHeatmapLive` returns without spawning (no IBKR connect, no Yahoo backfill pull) and `getSpxHeatmapLiveStatus` reports `marketOpen:false`, which disables the `Start feed` button and shows a "market closed" note. Verified after-hours (16:29 ET): status `marketOpen:false`, POST start refused (`running:false`, log "start refused: market closed"), button disabled. Added `server/spxHeatmapLive.test.ts`; `npx vitest run` heatmap suite 7/7 pass, `npm run typecheck`/`build` clean. Holidays aren't detected (same weekday-only limitation as fplLive).
- Documentation drift cleanup: refreshed `README.md`, `codebase.md`, and `detailedcodebase.md` for the current Daily Pipeline, 07:00 ET cutoff, SPX Heatmap live feed, native live-update toast endpoint, current Vite proxy target, current route/module/script map, and `/api/tracker` cache/coalescing note. Updated `HEARTBEAT.md` to use the compact `naive_*` docs and marked `ACCEPTANCE_CRITERIA.md`, `VALIDATION.md`, `COMPLETION_AUDIT.md`, `RUBICON_CODE_LOOP_SANITY.md`, and `RUBICON_CODEBASE_REVIEW_2026-06-03.md` as historical/reference artifacts where appropriate. Verification used targeted `rg` drift checks plus `git diff --check`; app tests were intentionally not run because this was docs-only.
- SPX Heatmap (Morning -> Heatmap subsection) live-feed UX: disambiguated the two "live" controls — the backend feed is now `Start feed`/`Stop feed` (the per-minute IBKR snapshot poller) and the view-follow is `Jump to now` / muted `● now` (scrubber-at-latest), removing the old `Start live`/`Go live`/`following` collision. `Start feed` now triggers an immediate one-shot Yahoo backfill of the full session before the IBKR loop (`refresh-spx-heatmap.py --source ibkr-live` runs the backfill, writes it, then seeds the loop from it), so the map fills in ~15s instead of ~50s and is never blank when IBKR can't connect or it's after hours (verified after-hours: backfill writes `yahoo-1m` 503/503, loop then exits cleanly). The ~1-min Yahoo-frontier-to-first-IBKR-sweep seam is accepted by design. UI also burst-reloads the payload for ~40s after Start so the backfill/first sweep appear promptly. Added `server/spxHeatmap.test.ts` (loader sanitisation) and `src/spxTreemap.test.ts` (squarify + colour); `npx vitest run` 5/5 pass, `npm run typecheck` clean.
- Daily Pipeline now runs the TC2000 Qullamaggie sidecar after Google Upload and before TC2000 daily bars: it attempts the visible `Three Bar Rule Spike` export, validates a fresh non-empty `qullamaggie_latest.csv`, runs the Qullamaggie report/email from that fresh CSV with its own bars pull skipped, and keeps all TC2000/Qullamaggie failures as warning-only diagnostics.
- Morning's US macro calendar now auto-emits the previously rated-but-uncovered public-source rows for MBA, ADP weekly/monthly, API crude, NAR existing-home sales, UMich preliminary sentiment, NY Empire State, and NAHB HMI. These are timing/presence events only; actual/forecast/prior values remain out of scope for v1.
- FirstSquawk word-filter hits now route through a native Windows toast helper instead of the calendar popup path. Rubicon added `/api/desktop-alert/live-update`, a Windows toast PowerShell script using the existing `Rubicon.RubiconApp` AppUserModelID, and the Morning Live Updates alert call now targets that endpoint.
- Morning's economic calendar now uses a Rubicon-owned SPX macro calendar instead of the dead DailyFX/IG endpoint. The new source reads official/free schedule surfaces, applies code-owned DailyFX-style importance ratings, hides unrated rows as diagnostics, preserves RollCall/OPEX, and feeds the existing today/major-events Morning payload.
- Latest manual DailyFX rating batch added medium aliases for MBA 30-year mortgage rate, ADP employment change, Factory Orders MoM, EIA crude oil stocks change, EIA gasoline stocks change, and Fed speeches; ISM Services remains high.
- Second manual DailyFX rating batch added Initial Claims, Jobs Friday subrows, ADP weekly, trade/import/export rows, existing home sales, API crude, CPI subrows, and Monthly Budget Statement ratings.
- Third manual DailyFX rating batch added Core/PPI MoM split, Michigan Sentiment, NY Empire State, Industrial Production, NAHB, import/export prices, and high-vs-medium housing starts/building permits distinctions.
- Official aggregate releases now expand into DailyFX-style child rows for CPI, payrolls, PPI, trade/import/export, EIA crude/gasoline, import/export prices, and housing starts/building permits while preserving the official source title as coverage.

## Validation Run - 2026-06-03 Daily Pull Pipeline Button

Commands:
- `npm run test -- App`
- `npm run typecheck`
- `npm run build`
- Browser verification at `http://localhost:5173`

Result:
GREEN for the Daily Pull pipeline button placement on 2026-06-03.

Proof:
- Focused App Vitest passed 2 files / 13 tests, including the visible Daily Pull pipeline action region.
- Typecheck passed.
- Build passed with only the existing Vite large-chunk warning.
- Browser verification showed `Preflight Pipeline` and `Run Daily Pipeline` visible above Pull Dates in the first Daily Pull viewport; the Run button was enabled.

## Validation Run - 2026-06-03 TC2000 Qullamaggie Sidecar

Commands:
- PowerShell parser check for `..\scripts\run_tc2000_qullamaggie_export.ps1`
- PowerShell parser check for `..\IBKR Equity History Pull\run_daily_spx_ibkr_sync_with_sheet_payload.ps1`
- `python -m py_compile ..\spx-spread-replay-tracker\scripts\refresh-tc2000-daily-bars.py "..\IBKR Equity History Pull\qullamaggie_daily_email.py"`
- `npm run test -- dailySync dailySyncDiagnostics App`
- `npm run typecheck`
- `npm run build`

Result:
GREEN for the TC2000 Qullamaggie sidecar integration on 2026-06-03.

Proof:
- Both PowerShell scripts parsed successfully.
- Python compile check passed for the TC2000 bars refresh script and Qullamaggie email module.
- Focused Vitest slice passed 7 files / 41 tests, including sidecar step ordering and warning-only status behavior.
- Typecheck passed.
- Build passed with only the existing Vite large-chunk warning.

## Validation Run - 2026-06-03 A142

Commands:
- `npm run test -- server/morningMacroCalendar.test.ts`
- `npm run test -- server/morningBrief.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`

Result:
GREEN for A142 on 2026-06-03.

Proof:
- Macro calendar Vitest passed 1 file / 15 tests, including generated ADP/MBA/API markers, API Monday-holiday behavior, public NAR/NAHB/NYFed parsing, and UMich 2026 schedule warning behavior.
- Morning payload/dashboard Vitest passed 2 files / 21 tests.
- Typecheck passed.
- Build passed with only the existing Vite large-chunk warning.

## Validation Run - 2026-06-03 A141

Commands:
- `npm run test -- liveUpdateAlerts desktopAlert MorningDashboard`
- PowerShell parser check for `scripts/show-windows-toast.ps1`
- `npm run typecheck`
- `npm run build`
- Browser smoke on `http://127.0.0.1:5180`
- Direct toast script smoke and `/api/desktop-alert/live-update` API smoke

Result:
GREEN for A141 on 2026-06-03.

Proof:
- Focused Vitest passed 3 files / 16 tests.
- Typecheck passed.
- Build passed with only the existing large-chunk warning.
- Browser smoke showed Rubicon title/page identity, nonblank Morning UI, Live Updates alert controls, no framework overlay, zero console warnings/errors, and successful word-filter interaction.
- `show-windows-toast.ps1` parsed and executed cleanly; the live-update desktop-alert API returned `ok` and launched the Windows notification helper.

Follow-up debug:
- The first native-toast implementation used the custom `Rubicon.RubiconApp` shortcut AppID and returned `ok` after spawning PowerShell, which could hide child-script failures. The toast script now auto-resolves the Edge-installed Rubicon AppID when present, the API waits for the script to finish, and the live `5174` route returned `ok` via `127.0.0.1-9BBB1E10_tz517vvf8m8yt!App`.
- Focused `desktopAlert liveUpdateAlerts` tests passed after the fix. `npm run typecheck` and `npm run build` are currently blocked by unrelated concurrent edits in `src/components/SpreadSpeedPanel.tsx` (`RecommendedPick` unused and missing `Ladder`).

## Validation Run - 2026-06-03 SPX Macro Aggregate Titles

Commands:
- `npm run test -- server/morningMacroCalendar.test.ts`
- `npm run test -- server/morningBrief.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`
- `npm test`

Result:
GREEN for DailyFX-style official aggregate expansion on 2026-06-03.

Proof:
- Macro calendar Vitest passed 1 file / 11 tests.
- Morning payload/dashboard Vitest passed 2 files / 21 tests.
- Typecheck passed.
- Build passed with the existing large-chunk warning.
- Full Vitest passed 62 files / 333 tests.

## Validation Run - 2026-06-03 SPX Macro Calendar

Commands:
- `npm run test -- morningMacroCalendar morningBrief MorningDashboard calendarAlerts`
- `npm run typecheck`
- `npm run build`
- Live smoke: `readUsMacroCalendar(..., "2026-06-01", "2026-06-15")`

Result:
GREEN for SPX macro calendar replacement on 2026-06-03.

Proof:
- Focused Vitest passed 4 files / 35 tests.
- Typecheck passed.
- Build passed with only the existing large-chunk warning.
- Live smoke returned 17 rated SPX macro events across Census, ISM, BLS, Fed, EIA, DOL, and BEA, and hid 11 unrated official rows as diagnostics.

## Validation Run - 2026-06-03 A140

Commands:
- `npm run test -- dailySync dailySyncDiagnostics dailyPullReviewModel refreshLogic googleSheetsSnapshot App googleSheetsUpload`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- From `IBKR Equity History Pull`: `python -m pytest tests/test_daily_spx_ibkr_sync.py`
- Python syntax: `python -m py_compile daily_spx_ibkr_sync.py`
- PowerShell parser: `[scriptblock]::Create(...)` on `run_daily_spx_ibkr_sync_with_sheet_payload.ps1`

Result:
GREEN for A140 on 2026-06-03.

Proof:
- Shared daily sync status now carries run id, target date, three stage rows, review-ready and Google-uploaded verdicts, latest-pipeline evidence, lock status, and catch-up status.
- The wrapper acquires a cross-process lock, writes atomic stage-aware status, runs Data Collection, calls Rubicon Ingest through npm/tsx, then builds payload/workbook and runs Google Upload as a non-review-blocking stage.
- Google Upload requires write-capable credentials plus `SPX_GOOGLE_RAW_UPLOAD_FOLDER_ID`, uploads the raw workbook through Drive conversion, updates Daily Sync Runs and Trade Log idempotently, writes compact raw-tab link rows, updates local summary receipt fields, and refreshes the Google snapshot.
- Full Vitest passed 61 files / 326 tests; focused pipeline tests passed 11 files / 57 tests; typecheck passed; build passed with only the existing large-chunk warning; IBKR Python pytest passed 5/5; Python and PowerShell syntax checks passed.

## Validation Run - 2026-06-03 Duplicate Cleanup

Commands:
- `npm run test`
- `npm run typecheck`
- `npm run build`

Result:
GREEN for duplicate-code cleanup on 2026-06-03.

Proof:
- Server utility duplication now routes through `server/jsonStore.ts`, `server/normalize.ts`, and `server/easternClock.ts`; FPL, SPX heatmap, daily sync, IBKR holdings, spread speed, tracker summary, and data importer call the shared helpers.
- Dashboard daily summaries now come from `server/trackerSummary.ts`; `server/dataImporter.ts` no longer keeps the row-level fallback summary builder or payload-gap scoring helpers on the tracker hot path.
- Frontend trade/date selection, trade time labels, chart timestamp parsing, trade chart marker primitives, and lightweight-chart setup/data mapping now live in focused shared modules.
- Full Vitest suite passed 60 files / 323 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.

## Validation Run - 2026-06-02 A139

Commands:
- `npm run test -- src/components/MorningDashboard.test.tsx server/godelLiveNews.test.ts server/morningBrief.test.ts`
- `npm run typecheck`
- `npm run build`
- Playwright smoke against `http://127.0.0.1:5174?morningCopySmoke=1780429180`

Result:
GREEN for A139 on 2026-06-02.

Proof:
- `src\components\MorningDashboard.tsx` no longer renders per-event calendar metadata lines under today's events or major events.
- The Godel bridge card filters the old setup-instruction paragraph, and `server\godelLiveNews.ts` now reports the terse fallback detail `Godel feed unavailable.`
- AI Notes no longer renders the generated empty-state message line.
- TC2000 no longer renders the `Latest scanner pulls` panel subtitle or scanner-list count heading.
- Focused Morning/Godel/server tests passed 3 files / 28 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.
- Browser smoke loaded Morning on `127.0.0.1:5174`, found none of the requested noisy phrases, reported no console/page errors, and confirmed Calendar, Live Updates, and TC2000 panels rendered with nonzero dimensions.

## Validation Run - 2026-06-02 A138

Commands:
- `npm run test -- scripts/rubicon-icon.test.ts`
- `npm run desktop:install`
- `npm run typecheck`
- `npm run build`
- Shortcut inspection via `WScript.Shell`
- Built asset inspection for `dist\favicon.ico`

Result:
GREEN for A138 on 2026-06-02.

Proof:
- `scripts\rubicon-icon.mjs` generates a multi-size Windows ICO with the Rubicon bolt.
- `scripts\install-desktop-shortcut.mjs` writes Desktop and Start Menu `Rubicon.lnk` shortcuts with `IconLocation` set to `public\favicon.ico,0`, not Edge or Chrome executables.
- `scripts\launch-desktop.mjs` ensures `public\favicon.ico` exists before build freshness checks and includes `public/` in stale-build detection.
- `index.html` advertises `/favicon.ico`, the SVG fallback, Rubicon application name, and theme color.
- `npm run desktop:install` refreshed `C:\Users\charl\Desktop\Rubicon.lnk` and `C:\Users\charl\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Rubicon.lnk`; both inspect with the Rubicon icon path.
- Icon preview `data\rubicon-icon-preview.png` rendered nonblank, and production build copied the ICO to `dist\favicon.ico`.
- The existing taskbar `Microsoft Edge.lnk` pin was observed as a browser pin with no Rubicon arguments and was not modified.

## Validation Run - 2026-06-02 A137

Commands:
- `npm run test -- src/App.test.tsx src/components/ReplayCharts.test.ts src/marketFreshness.test.ts src/stats.test.ts src/dailySyncReadiness.test.ts src/dailyPullChecklist.test.ts src/dailySyncDiagnostics.test.ts src/dailySyncRefresh.test.ts src/dailySyncRunGuard.test.ts`
- `npm run typecheck`
- `npm run build`
- Playwright smoke against `http://127.0.0.1:5174?finalSmoke=1780428190`
- `npm run lint` audit

Result:
GREEN for A137 on 2026-06-02.

Proof:
- `src\App.tsx` now renders Replay's all-session state as `Session`, keeps the trade-history header as `Trades`, removes the today-pending banner, suppresses successful Google snapshot messages, and shortens the Daily Pull hero/status/source ledger copy.
- `src\components\MarketChart.tsx` and `src\components\ReplayCharts.tsx` no longer show Replay chart raw counts such as bars, closes, OHLC ranges, or open-interest strikes.
- `src\marketFreshness.ts` stays quiet when today's archive is not imported instead of explaining pending same-day sync state.
- Regression tests cover quiet Replay pending-today/full-session copy, terse Daily Pull copy, hidden chart count labels, and the updated market-freshness contract.
- Focused tests passed 9 files / 52 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.
- Browser smoke switched to the Replay portion on `127.0.0.1:5174`, found no targeted Replay/Daily Pull noisy phrases, reported no console/page errors, and confirmed the Daily Pull/source panels rendered with nonzero dimensions.
- `npm run lint` still fails on pre-existing repo-wide lint debt; the one helper unused-parameter finding introduced during this change was fixed before final validation.

## Validation Run - 2026-06-02 A136

Commands:
- `npm run test -- server/desktopAlert.test.ts`
- `npm run typecheck`
- `npm run build`
- Isolated API proof server on `http://127.0.0.1:5174`
- `POST /api/desktop-alert/calendar`

Result:
GREEN for A136 on 2026-06-02.

Proof:
- `server\desktopAlert.ts` now launches calendar desktop alerts through `wscript.exe` with a detached, visible Windows Script Host popup, avoiding the hidden-backend PowerShell/WinForms path that returned `ok` without showing a popup.
- `scripts\show-calendar-alert.vbs` displays an auto-closing Windows popup with title, body, and detail text.
- `server\desktopAlert.test.ts` covers the Windows Script Host launch path and keeps async spawn error handling covered.
- Focused alert tests passed 1 file / 4 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.
- Live API proof returned `ok: true`, PID `99108`, and desktop screenshot `data\calendar-os-alert-api-wscript-check.png` visibly shows the Windows popup titled `Rubicon calendar OS check`.
- Health after the popup remained GREEN on `127.0.0.1:5174` with Rubicon PID `99876`.

## Validation Run - 2026-06-02 Subagent Review Hardening

Commands:
- `npm run test -- src/components/MorningDashboard.test.tsx`
- `npm run test -- server/morningBrief.test.ts -t "loads brief live tape"`
- `npm run test -- server/desktopAlert.test.ts`
- `npm run validate:mvp`
- One-off built-server smoke on `http://[::1]:5197` for `/api/health` and `/`

Result:
GREEN on 2026-06-02.

Proof:
- Replay payload rendering is date-scoped and quick-trade selection no longer refetches the same date payload.
- Morning Dashboard brief loads ignore obsolete date responses and keep live-update cache copy aligned with the 10-second polling behavior.
- Review notes and other app-owned JSON state writes now use queued/atomic write paths where the review found overwrite/truncation risk.
- Safe replay mode no longer falls back to the full Google upload payload when safe sidecars are unavailable, preventing accidental broad payload exposure.
- Godel bridge import now requires a local bridge token and constrained origin handling; the Express app defaults to loopback binding unless explicitly configured.
- Desktop alert, FPL live, and IBKR refresh background paths register async error/timer handling so tests can exit cleanly.
- `npm run validate:mvp` passed typecheck, all 52 Vitest files / 269 tests, and production build; Vite still reports the pre-existing >500 kB chunk warning.
- Built-server smoke returned `/api/health` status 200 with `app: "rubicon"` and served an app shell containing `<div id="root"></div>`.

## Validation Run - 2026-06-02 A135

Commands:
- `npm run test -- src/components/MorningDashboard.test.tsx server/morningBrief.test.ts server/godelAlertBridge.test.ts src/morningDiary.test.ts`
- `npm run typecheck`
- `npm run build`
- Playwright smoke against `http://127.0.0.1:5174?appRefresh=1780427400`

Result:
GREEN for A135 on 2026-06-02.

Proof:
- `src\components\MorningDashboard.tsx` now renders the Morning header as the selected date only, hides ok source pills/details, removes routine calendar source details, removes high-importance event time/source metadata, changes Live Updates to source-agnostic counts/status, suppresses successful IBKR refresh messages, removes AI-note "ready" copy, and drops TC2000 total-hit/daily-bar readiness counters.
- `server\morningBrief.ts`, `server\godelAlertBridge.ts`, and `src\morningDiary.ts` now avoid source-pair/readiness/daily-bar narration in warning/status text that can surface on the dashboard.
- Regression tests cover date-only Morning copy, calendar failure-only source notes, major-event date-only metadata, hidden TC2000 counters, hidden successful IBKR refresh messages, and source-agnostic live-update cache wording.
- Focused tests passed 4 files / 30 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.
- Browser smoke loaded Morning on `127.0.0.1:5174`, found date heading `2026-06-02`, found none of the targeted noisy phrases in visible text, reported no console/page errors, and `overflow=false`.

## Validation Run - 2026-06-02 A134

Commands:
- `npm run typecheck`
- `npm run build`

Result:
GREEN for A134 on 2026-06-02.

Proof:
- `src\App.tsx` stores accepted Pull Date issue dates in localStorage and filters only the Daily Pull date-rail badge map, leaving detailed diagnostics intact.
- Daily Pull date rows now render a separate `Issues fine` button for dates with visible issue badges; the button is not nested inside the date selector.
- `src\App.css` widens the Daily Pull rail, styles the acceptance control, and keeps Pull Dates before the main Daily Pull content on narrow screens.
- Typecheck passed; production build passed with only the existing Vite large-chunk warning.
- Browser automation was attempted, but this repo/session did not have Playwright or a direct Browser control tool available.

## Validation Run - 2026-06-02 A133

Commands:
- `npm run test -- server/godelAlertBridge.test.ts server/godelLiveNews.test.ts server/morningBrief.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`
- Watcher stale-reference sweep: `rg -n "GodelAlertWatcher|godel-alert-watcher|godelWatcher|GodelWatcher|watch-godel|startGodelAlertWatcher|stopGodelAlertWatcher|fetchGodelAlertWatcherStatus|godel-watcher|godel:watch-alerts" shared src server scripts package.json`
- Temporary API smoke on `http://127.0.0.1:5194` using a hidden one-off server

Result:
GREEN for A133 on 2026-06-02.

Proof:
- `server\godelAlertWatcher.ts`, `scripts\watch-godel-alerts.py`, and `scripts\watch_godel_alerts_test.py` were deleted.
- `server\index.ts`, `src\api.ts`, `shared\types.ts`, and `package.json` no longer expose old watcher routes, API helpers, watcher shared types, or the `godel:watch-alerts` npm command.
- `src\components\MorningDashboard.tsx` now renders bridge-only Godel controls with setup/status/refresh and no Start/Stop, PID, screen-region, or screenshot-crop watcher fields.
- `src\App.css` removes `.godel-watcher*` styling and keeps a bridge-only card style.
- `server\godelLiveNews.ts` fallback guidance now points at `/api/godel-alert-bridge/setup` instead of the removed watcher command.
- Focused tests passed 4 files / 22 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning; stale-reference sweep returned no active-source watcher matches.
- API smoke returned `healthOk=true`, `app=rubicon`, bridge status `200` with `mode=dom-bridge`, bridge setup `200`, deleted watcher endpoint `404`, and no leftover listener on the spare port.

## Validation Run - 2026-06-02 A132

Commands:
- `npm run test -- server/morningBrief.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`
- Browser smoke against `http://[::1]:5174?appRefresh=1780140000`

Result:
GREEN for A132 on 2026-06-02.

Proof:
- `shared\types.ts` adds optional `newSymbols` metadata on TC2000 pull/screener payloads.
- `server\morningBrief.ts` enriches saved and refreshed Morning payloads by comparing each current scanner list against the most recent prior saved Morning state before the selected date.
- `src\components\MorningDashboard.tsx` adds the `new` class and accessible label/title to stock chips whose symbols are new for that scanner list; the scanner card also shows a compact new-symbol count.
- `src\App.css` gives new chips a warmer border/glow/dot and prevents hidden TC2000 chart popovers from adding page-level horizontal overflow.
- Focused tests passed 2 files / 18 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning; browser smoke loaded Rubicon, found the TC2000 panel, reported no console/page errors, and `overflow=false`.

## Validation Run - 2026-06-02 A131

Commands:
- `npm run test -- server/spreadSpeed.test.ts server/spreadSpeedState.test.ts server/dailySync.test.ts`
- `npm run test -- server/morningBrief.test.ts server/spreadSpeed.test.ts server/spreadSpeedState.test.ts server/dailySync.test.ts server/dataImporter.test.ts server/trackerSummary.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run desktop`
- Fresh one-off `loadSpreadSpeed("2026-06-01")` timing/probe after deleting `rubicon_spread_speed_state.json`
- Live `/api/spread-speed?date=2026-06-01` probes after relaunch

Result:
GREEN for A131 on 2026-06-02.

Proof:
- `server\spreadSpeed.ts` now has one serving path: `loadSpreadSpeed()` reads a matching `rubicon_spread_speed_state.json` or rebuilds from `loadSafeSpxBars()` and option-leg sidecar CSV candidates. It never calls the payload-fallback SPX loader.
- Spread Speed source validation uses stat-only source checks, so cache hits do not parse the option-leg CSV just to decide whether the state is fresh.
- Spread Speed collapses 5-second SPX bars to one frame per `HH:MM` minute before writing state. For `2026-06-01`, the state now stores 390 frames instead of 4,680 duplicate-label frames.
- `server\dailySync.ts` now refreshes Spread Speed state during `refreshDailySyncDerivedState()` after tracker and Replay safe state refresh, before Morning saved-state refresh.
- `server\index.ts` no longer forwards `/api/spread-speed?full=1`; stale full-mode callers are kept on the safe-state path.
- Fresh heavy-date probe for `2026-06-01`: first safe-state build took 3.64s, cached read took 12ms, and `rubicon_spread_speed_state.json` was about 2.71MB.
- Live proof after `npm run desktop`: `/api/spread-speed?date=2026-06-01` returned 390 frames from PID `57960`; final Node fetch+JSON probe returned in 26ms.
- Validation: focused Morning/Spread Speed/daily-sync/importer/summary tests passed 6 files / 62 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.

## Validation Run - 2026-06-02 A130

Commands:
- `npm run test -- server/dataImporter.test.ts server/dailySync.test.ts server/trackerSummary.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run desktop`
- Fresh one-off `loadReplayPayload("2026-06-01")` timing/memory probe after deleting `rubicon_replay_safe_state.json`
- Live `/api/replay?date=2026-06-01` probes after relaunch

Result:
GREEN for A130 on 2026-06-02.

Proof:
- `server\dataImporter.ts` now writes and reads `rubicon_replay_safe_state.json` beside the date archive. Default `loadReplayPayload()` uses that safe state; `mode: "full"` / `/api/replay?full=1` remains the old raw-detail escape hatch.
- The safe state never falls back to `google_sheet_upload_payload.json` for SPX bars. It reads sidecar/IBKR underlying CSVs, filters spread marks to imported SPX quick-trade ids at minute boundaries, and filters volume profile rows to SPX five-minute boundaries.
- `server\dailySync.ts` now refreshes Replay safe state during `refreshDailySyncDerivedState()` between tracker summary refresh and Morning saved-state refresh, so the poll/derived-state path prepares explicit Replay instead of requiring manual refresh work.
- Fresh heavy-date probe for `2026-06-01`: first safe-state build took 3.09s, second safe read took 17ms, with 4,680 SPX bars, 2,025 spread marks, 108 OI rows, 8,262 volume rows, and 5 quick trades. The safe file was about 4.48MB instead of using the 449MB sheet payload.
- Live proof after `npm run desktop`: `/api/replay?date=2026-06-01` returned the safe payload; first post-relaunch call was 5.2s cold, the second steady-state call was 427ms.
- Validation: focused importer/sync/summary tests passed 3 files / 42 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.

Known caveat:
- The explicit full-detail path is still available with `full=1` and remains heavy for `2026-06-01`; use it only when auditing raw replay artifacts.

## Validation Run - 2026-06-02 A129

Commands:
- `npm run test -- server/dailySync.test.ts src/dailySyncRefresh.test.ts src/morningAutoArm.test.ts`
- `npm run test -- server/dailySync.test.ts server/morningBrief.test.ts src/dailySyncRefresh.test.ts src/morningAutoArm.test.ts src/components/MorningDashboard.test.tsx`
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run desktop`
- Live API probes for `/api/health` and `/api/daily-sync/status`

Result:
GREEN for A129 on 2026-06-02.

Proof:
- `server\dailySync.ts` now routes successful sync completion through `refreshDailySyncDerivedState()`, which refreshes `rubicon_tracker_summary.json` and calls `loadMorningBrief(date, appRoot, { refresh: true })` for the completed sync summary date. Failed sync exits do not refresh derived state.
- `src\dailySyncRefresh.ts` adds a one-shot completion key derived from sync `finishedAt` and latest summary date. `src\App.tsx` uses it in both the regular 60s sync status poll and the active-running poll so Daily Pull/tracker state refreshes once when completion is observed.
- `src\morningAutoArm.ts` adds `morningAutoRefreshDecision()`: on weekdays, when Morning is showing today's ET date, it fires once per date at or after `08:30` ET. `src\components\MorningDashboard.tsx` uses that decision to call `fetchMorningBrief(..., { refresh: true })`, so the saved Morning state is rewritten after the morning data-pull window even if an earlier state existed; the auto marker is recorded only after a successful auto refresh.
- Runtime proof after `npm run desktop`: `/api/health` returned fresh PID `99620`; `/api/daily-sync/status` returned `state=completed`, latest summary date `2026-06-01`, and the completed sync details.
- Validation: targeted decision tests passed 3 files / 19 tests; affected server/Morning tests passed 5 files / 35 tests; full Vitest passed 46 files / 242 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.

Manual productivity meta-review:
- Goal quality: Strong; the goal tied derived state updates to actual lifecycle events instead of relying on manual refresh habits.
- Time to stable: Strong; red tests isolated the server completion hook, status-poll refresh decision, and 8:30 Morning refresh decision before implementation.
- Rework rate: Low; implementation followed the tests with only a local patch-target correction in `MorningDashboard`.
- Validation strength: Strong; focused tests, broader affected tests, full suite, typecheck, build, desktop relaunch, and API probes all ran.
- Workflow depth: Strong; both automatic sync completion and the morning data window now mutate the saved state artifacts users depend on.
- Context carryover: Strong; A128's no-eager-replay behavior stays intact while the new polling logic only refreshes compact tracker state.
- Tooling leverage: Strong; pure decision helpers make future timing changes testable without browser timer gymnastics.
- User-visible value: Strong; Daily Pull will reflect completed syncs from polling, and Morning will not stay stuck on pre-8:30 saved calendar state.
- Agent productivity metrics: Strong; no heavyweight replay/detail reads were reintroduced.
- Next-goal improvement: Keep future scheduling work centralized in pure decision helpers before wiring timers.

## Validation Run - 2026-06-02 A128

Commands:
- `npm run test -- server/dataImporter.test.ts server/trackerSummary.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run desktop`
- Fresh one-off `loadTrackerSnapshot()` and `loadReplayPayload("2026-06-01")` timing/memory probes
- Live `/api/health` and two `/api/tracker` probes after relaunch

Result:
GREEN for A128 on 2026-06-02, with explicit remaining Replay-detail caveat.

Proof:
- Root cause found during thread/performance review: `2026-06-01\google_sheet_upload_payload.json` is about 449MB, and the latest date has no `google_sheet_tab_csvs\SPX_5s.csv` sidecar. Any `readPayloadTabRows("SPX 5s")` fallback parses that whole JSON and balloons Node memory.
- `server\dataImporter.ts` now derives the `/api/tracker` `Replay market data` source-health row from compact `DailySummary` fields (`spxStatus`, `spxIntradayRowCount`, `spxIntradayBarSize`) instead of reading SPX tab rows from CSV/payload on the dashboard path.
- `src\App.tsx` now only fetches `/api/replay` when the Replay or Daily Review surface is open, and only fetches selected-date `/api/spread-speed` when the Replay cockpit is open. Normal Morning startup no longer requests those row-level payloads.
- Fresh one-off `loadTrackerSnapshot()` proof with Google export probe disabled returned 35 trades / 5 dates / latest `2026-06-01` in 30ms inside Node, RSS about 76MB, with replay detail `Latest replay date: 2026-06-01 (5s, 4680 SPX rows from compact summary).`
- Live proof after relaunch: `/api/health` returned fresh PID `96988`; `/api/tracker` returned in 9ms, with the same compact-summary replay detail and unchanged 35 trades / 5 daily summaries.
- Remaining caveat at A128: explicit Replay for `2026-06-01` was still heavy, and Spread Speed was not yet sidecar-only until A131. A fresh `loadReplayPayload("2026-06-01")` took about 7.9s and about 3GB RSS because it still returned 103,605 spread marks and 496,356 volume rows and could fall back to the 449MB payload for SPX bars. Next Replay fix should materialize `SPX_5s.csv` sidecars during sync and/or downsample/page replay volume data.

## Validation Run - 2026-06-02 A127

Commands:
- `npm run test -- server/morningBrief.test.ts -t "Morning state|refreshes live Morning"`
- `npm run test -- server/morningBrief.test.ts src/components/MorningDashboard.test.tsx`
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run desktop`
- Live API probes for `/api/health` and `/api/morning?date=2026-06-02` with and without `refresh=1`

Result:
GREEN for A127 on 2026-06-02.

Proof:
- `server\morningBrief.ts` now persists per-date Morning state under `data\morning-brief-state\YYYY-MM-DD.json` by default. The state file stores the full dashboard-ready Morning payload plus a small schema/version/savedAt wrapper, and normal `loadMorningBrief()` calls prefer that saved state.
- `loadMorningBrief(date, appRoot, { refresh: true })` bypasses saved state, pulls live Morning sources, writes the state file, and returns a `Morning brief state` source row showing the refresh/save time.
- `server\index.ts` wires `/api/morning?refresh=1` as the explicit live-refresh path with no-store response headers. Normal `/api/morning?date=...` remains the state-read path.
- `src\api.ts` and `src\components\MorningDashboard.tsx` keep initial loads and polling on saved state, while the `Refresh Morning` button sends `refresh=1`.
- Live proof after `npm run desktop`: `/api/health` returned fresh PID `65724`; `/api/morning?date=2026-06-02&refresh=1` returned `generatedAt=2026-06-02T18:01:01.605Z` and wrote state; the next normal `/api/morning?date=2026-06-02` returned the same `generatedAt` with `Morning brief state: Loaded saved Morning brief state from Jun 2, 2:01 PM EDT.`
- Runtime artifact proof: `data\morning-brief-state\2026-06-02.json` exists and is about 1.76MB, with 4 economic events, 4 Trump/RollCall events, 7 major events, 35 TC2000 symbols, 35 daily-bar symbol groups, and 35 profiles.
- Validation: focused Morning-state tests passed 2/2; Morning server + dashboard tests passed 16/16; full Vitest passed 45 files / 235 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.

Manual productivity meta-review:
- Goal quality: Strong; the work translated the SimpliQuery pattern to Morning without changing the user-facing brief shape.
- Time to stable: Strong; failing tests were written first for saved-state reads and refresh-state writes, then implementation was scoped to those seams.
- Rework rate: Low; the first implementation satisfied the red tests, and later checks only clarified live timing/proof.
- Validation strength: Strong; focused, component, full-suite, typecheck, build, launcher, and live API probes all ran.
- Workflow depth: Strong; normal update/load and explicit refresh now have different data paths, matching the requested operational model.
- Context carryover: Strong; the change respects the earlier live-update split, so live squawks still refresh separately and normal brief reloads preserve current live rows in the dashboard.
- Tooling leverage: Strong; future agents can inspect a small per-date Morning state file instead of retrying live calendar/TC2000 paths.
- User-visible value: Strong; normal Morning loads can reuse the saved state, while the button remains the intentional live pull.
- Agent productivity metrics: Strong; no heap-risk giant row artifact was introduced. The state file is dashboard-sized rather than tracker-sized.
- Next-goal improvement: Consider adding a dedicated Morning-state compactor if TC2000 daily bars/profiles grow beyond the current sub-2MB state size.

## Validation Run - 2026-06-02 A126

Commands:
- `npm run test -- server/trackerSummary.test.ts server/dataImporter.test.ts server/dailySync.test.ts`
- `npm run typecheck`
- `npm run build`
- One-off `loadTrackerSnapshot()` probe through `npx tsx`

Result:
GREEN for A126 on 2026-06-02.

Proof:
- `server\trackerSummary.ts` writes `rubicon_tracker_summary.json` beside each daily pull folder. The file is a compact serving-layer summary that describes `daily_sync_summary.json`, `google_sheet_upload_payload.json`, and the raw workbook, while keeping the giant row-level payload out of `/api/tracker`.
- `server\dataImporter.ts` now prefers compact validated summaries for `DailySummary`, keeps Google connector rows as upload receipt/fallback evidence instead of letting stale connector values downgrade local IBKR counts/statuses, coalesces/caches immediate `/api/tracker` reads, and loads replay chart marks only for replay/detail payloads.
- `server\dailySync.ts` refreshes the compact Rubicon summary after a daily sync completes, so the next dashboard load can read the simplified query artifact immediately.
- Current archive proof: `rubicon_tracker_summary.json` exists for `2026-05-26`, `2026-05-27`, `2026-05-28`, `2026-05-29`, and `2026-06-01`; each is about 5-6KB and records that row-level IBKR/Google artifacts stay in the archive for replay/audit/detail views.
- Loader proof: one-off `loadTrackerSnapshot()` returned 35 trades / 5 dates / latest `2026-06-01` in about 1.2s, with June 1 preserving local validated option status `partial`, option rows `540996`, volume rows `540996`, and upload status `uploaded`.
- Live server proof after `npm run desktop`: `/api/health` returned fresh PID `97932`; two immediate `/api/tracker` calls returned the same `generatedAt`, with the first at 9.56s and the cached second at 0.01s. June 1 stayed `partial` with `540996` option rows and `540996` volume rows.
- Validation: focused backend tests passed 3 files / 40 tests; typecheck passed; production build passed with only the existing Vite large-chunk warning.

Manual productivity meta-review:
- Goal quality: Strong; the goal targeted the actual serving-path materialization problem instead of only raising heap.
- Time to stable: Strong; red tests isolated compact-summary behavior and stale connector downgrade before implementation was finalized.
- Rework rate: Mixed; a cache version bump and count precedence fix were needed after validation exposed stale zero-count behavior.
- Validation strength: Strong; focused tests, typecheck, build, and one-off loader timing/memory proof covered behavior and performance.
- Workflow depth: Strong; daily sync now writes the serving artifact, tracker reads it, replay/detail still load row-level data on demand.
- Context carryover: Strong; the fix preserved A123 launcher behavior and A125 docs while updating the current acceptance chain.
- Tooling leverage: Strong; compact cache files give future agents a small artifact to inspect instead of reopening giant payloads.
- User-visible value: Strong; tracker load dropped from the earlier about 49s crash-prone path to about 1.2s in the one-off probe.
- Agent productivity metrics: Mixed; full `loadTrackerSnapshot()` still uses around 876MB heap in the one-off process, so future work can reduce remaining entry/trade object overhead.
- Next-goal improvement: Keep future data-pipeline goals explicit about source-of-truth precedence: local validated summary first, connector rows as receipt/fallback evidence only.

## Validation Run - 2026-06-02 A125

Commands:
- `npm run test -- server/godelAlertBridge.test.ts server/morningBrief.test.ts server/godelLiveNews.test.ts`
- `npm run typecheck`
- `npm run build`
- Live API probes for `/api/godel-alert-bridge/status`, `/api/godel-alert-bridge/setup`, `/api/godel-alert-bridge/ingest`, and `/api/morning/live-updates`

Result:
GREEN for A125 on 2026-06-02.

Proof:
- `server\godelAlertBridge.ts` adds a minimized-safe DOM bridge with status, setup, bookmarklet, and ingest behavior. The bookmarklet injects a MutationObserver into the Godel page, watches bottom-right/toast-like DOM changes, and posts headline-like text back to Rubicon.
- `src\components\MorningDashboard.tsx` shows the DOM bridge under Live Updates with readiness text, setup link, valid capture count, and latest headline/rejection state.
- Live ingest proof rejected the known-bad numeric ladder payload with `reason=not-enough-words`, kept `validCount=0`, and did not create `data\godel-live-news.json`.
- Setup proof returned HTTP 200 for `/api/godel-alert-bridge/setup`. Bridge status reported: `DOM bridge is ready. Open setup, arm it inside Godel once, then the Godel window can be minimized.`
- `/api/morning/live-updates` returned `count=0` and `has_bad_numeric_godel=False` after the rejection probe.
- Caveat: the Godel tab/page must remain open and the bridge must be armed once inside that page. This is no longer pixel/screen dependent, but browser background throttling can still delay events if Firefox suspends the page.

## Validation Run - 2026-06-02 A124

Commands:
- `python scripts\watch_godel_alerts_test.py`
- `npm run test -- server/morningBrief.test.ts server/godelLiveNews.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run desktop`
- API probes for `/api/godel-alert-watcher/status` and `/api/morning/live-updates`

Result:
GREEN for A124 on 2026-06-02 with an explicit visibility caveat.

Proof:
- `scripts\watch-godel-alerts.py` now uses Godel chat anchor calibration by default. It looks for a `v4.4.9`-style version anchor, builds the alert rectangle from that anchor to the right screen edge above the bottom bar, and reports `anchor-not-found` instead of capturing generic lower-right screen content.
- `server\godelAlertWatcher.ts` adds status/start/stop/screenshot endpoints. The status message explicitly says Godel must be fullscreen and visible; minimized or covered windows cannot be read by screen capture.
- `src\components\MorningDashboard.tsx` renders the watcher strip in the Live Updates panel with Start, Stop, status refresh, PID/count/region state, and latest crop link.
- Numeric BookTrader/ladder false positives were quarantined from `data\godel-live-news.json` and `data\morning-live-updates-cache.json`. `server\morningBrief.ts` now rejects mostly numeric Godel rows from live and fallback cache paths.
- API proof after relaunch: `/api/godel-alert-watcher/status` returned `running=false`, `validCount=0`, `screenRegion=null`, and the fullscreen/visible caveat. `/api/morning/live-updates` returned `Count=0`, `HasBadNumberRow=false`, with FirstSquawk warning and Godel stub sources only.
- In-app Browser proof before final cache cleanup showed the watcher strip rendered with Start enabled and Stop disabled; post-clean rendered proof was limited by Browser navigation/loading timeout, but API and build checks were green.

- Desktop launch now restarts stale Rubicon backend processes, includes health PID/start diagnostics, and gives the desktop API enough heap for the large tracker load.

## Validation Run - 2026-06-02 A123

Commands:
- `node --check scripts\launch-desktop.mjs`
- `npm run typecheck`
- `npm run build`
- `npm run desktop`
- Runtime probes against `http://[::1]:5174/api/health` and `/api/morning?date=2026-06-08`

Result:
GREEN for A123 on 2026-06-02.

Proof:
- Root cause: the desktop launcher reused any healthy Rubicon server and did not know about stale detached servers on ports such as `5187`, so an old backend could keep serving pre-fix calendar rows.
- Launcher proof: `scripts\launch-desktop.mjs` now rebuilds stale `dist`, restarts ready Rubicon servers by health PID, cleans up detached non-watch `server/index.ts` Rubicon processes from this app root, includes `5187` in the known port scan, and starts the desktop API with `NODE_OPTIONS=--max-old-space-size=16384` by default.
- Health proof: `/api/health` now returns `appRoot`, `pid`, and `startedAt`; live proof returned `pid=84460`, `startedAt=2026-06-02T16:30:13.484Z`, and the expected app root after launch.
- Calendar proof: `/api/morning?date=2026-06-08` returned `inflationExpectationsCount=0` with high-importance titles starting at Existing Home Sales, CPI rows, PPI MoM, Michigan Consumer Sentiment Prel, FOMC, and monthly OPEX.
- Validation: launcher syntax check, typecheck, and build passed; `npm run desktop` launched a fresh server that remained healthy beyond the previous 8GB OOM timing.

## Validation Run - 2026-06-02 A122

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN for A122 on 2026-06-02.

Proof:
- `src/dailyReviewSide.ts` defines the shared action-side rule: entries keep spread side, regular exits flip Call/Put, and expirations remain expiration events.
- `src/stats.ts` uses action side for Daily Review exit events, so CCS exits count as Long and PCS exits count as Short in the timeline.
- `src/components/ReviewEntryExitChart.tsx` uses action side for marker grouping, color, candle-edge anchoring, tooltips, and aria labels.
- `src/App.tsx` updates the map legend to show Long = PCS entries / CCS exits and Short = CCS entries / PCS exits.
- Focused `src/stats.test.ts` passed 24 tests; typecheck passed; build passed with the existing Vite large-chunk warning.

## Validation Run - 2026-06-02 A121

Commands:
- Live DailyFX/IG endpoint probe: `https://api.ig.com/explore/events?from=2026-06-01&to=2026-06-15&lang=en`
- Direct Rubicon loader probe: `loadMorningBrief("2026-06-02")`
- `npm run test -- server/morningBrief.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`

Result:
GREEN for A121 on 2026-06-02.

Proof:
- Source proof: the live DailyFX/IG feed returned only `importance: 3` U.S. rows for the two-week window: ISM Manufacturing PMI, JOLTs Job Openings, ISM Services PMI, Non Farm Payrolls, Unemployment Rate, Existing Home Sales, the four CPI/inflation rows, and PPI MoM.
- App proof: `loadMorningBrief("2026-06-02")` returned the same high-importance rows clustered only when simultaneous related rows share the same timestamp; no extra non-source rows appeared, and OPEX was absent because June monthly OPEX is outside the June 1-14 window.
- Code proof: `clusterMajorMacroEvents()` now preserves exact DailyFX/IG event titles for single-row events and builds multi-row titles from source event names. The Morning panel label now says `High-importance events` instead of generic `Major events`.
- Validation: focused tests passed 2 files / 13 tests; `npm run typecheck` passed; `npm run build` passed with the existing large-chunk warning.

## Validation Run - 2026-06-02 A120

Commands:
- `npm run test -- server/morningBrief.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`
- `npm run validate:mvp`
- Browser plugin QA against `http://[::1]:5174/?qa=calendar-split-high-only`

Result:
GREEN for A120 on 2026-06-02; full-suite importer data-drift maintenance remains separate from this change.

Proof:
- App proof: `src\components\MorningDashboard.tsx` now renders `.morning-calendar-body` with today's event list first and Major events second. `src\App.css` splits that body into equal desktop columns and stacks it on narrow viewports.
- Parser proof: `server\morningBrief.ts` now filters Major events to DailyFX/IG rows with `importance >= 3` only, while keeping native monthly OPEX markers. `shared\types.ts` narrows `MorningMajorEvent.impact` to `high | market`.
- Test proof: focused tests passed 2 files / 12 tests. The parser test first failed on medium-importance JOLTs before the filter change, then passed while preserving June 19 OPEX; the component test verifies the agenda-left/major-right DOM structure.
- Browser proof: desktop viewport at `http://[::1]:5174/?qa=calendar-split-high-only` rendered equal `602px 602px` calendar columns, with Major events on the same row to the right of today's agenda, no medium major text, and empty browser warning/error logs. The 412px viewport stacked the sections with no horizontal overflow. Document-level desktop overflow remains caused by existing TC2000 chart popovers rendered offscreen, not the calendar section.
- Validation: `npm run typecheck` passed; `npm run build` passed with the existing Vite large-chunk warning. `npm run validate:mvp` still fails only on unrelated `server\dataImporter.test.ts` live-data drift: connector snapshot count is now 5 instead of 4, and latest trade date is `2026-06-01` instead of the old `2026-05-29` expectation.

## Validation Run - 2026-06-02 A119

Commands:
- `npm run test -- src/liveUpdateAlerts.test.ts`
- `npm run test -- src/liveUpdateAlerts.test.ts src/liveUpdateFilters.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`
- Browser plugin QA against `http://[::1]:5174/?qa=live-update-desktop-alert-smoke`

Result:
GREEN for A119 on 2026-06-02.

Proof:
- Existing-feature check: Morning live-update word filters already parsed/deduped terms, highlighted matching rows, and beeped for new matching updates, but only calendar alerts called the Windows desktop popup helper.
- App proof: `src\liveUpdateAlerts.ts` now builds a readable desktop alert payload from the first new matching live update, includes matched filter terms plus source/time/count detail, and dispatches one grouped desktop alert per matching refresh batch. `MorningDashboard` calls that dispatcher alongside the existing live-update beep path, using the same local desktop alert endpoint as calendar alerts.
- Test proof: focused live-update alert tests passed 3 cases for readable payloads, silent empty batches, and one desktop notification per matching batch. Existing live-update filter tests and MorningDashboard calendar layout tests still passed.
- Browser proof: Rubicon loaded on `http://[::1]:5174`, Morning rendered with the word-filter control, live alert button, and calendar alert controls; console warning/error logs were empty; the default viewport had no horizontal overflow.
- Validation: focused tests passed 12 tests across 3 files; `npm run typecheck` passed; `npm run build` passed with only the existing Vite large-chunk warning.

## Validation Run - 2026-06-02 A118

Commands:
- `npm run test -- server/morningBrief.test.ts src/morningLiveState.test.ts`
- `npm run typecheck`
- `npm run build`
- API timing: `GET http://[::1]:5174/api/morning?date=2026-06-02&refresh=*`
- Browser plugin QA against `http://[::1]:5174/?qa=morning-fast-refresh`

Result:
GREEN for A118 on 2026-06-02.

Proof:
- Root cause: full Morning refresh waited on `readFirstSquawkSource()` and `readGodelLiveNewsSource()` inside `loadMorningBrief()`. FirstSquawk currently returns `fetch failed`, so the app tried Nitter timeline plus RSS fallback with 12-second fetch windows, making calendar refresh take about 21.8 seconds.
- App proof: `loadMorningBrief()` now loads DailyFX, major events, RollCall, TC2000, and the last-good live-update cache only. FirstSquawk/Godel network pulls run through `/api/morning/live-updates` separately, and the Morning UI starts that live refresh in the background while preventing overlapping 10-second live requests.
- Timeout proof: FirstSquawk timeline/RSS attempts now use a dedicated `RUBICON_LIVE_FEED_FETCH_TIMEOUT_MS` default of 3.5 seconds instead of the 12-second calendar/source timeout.
- Timing proof: before the patch, `/api/morning` took about 21.8s and `/api/morning/live-updates` took about 21.5s. After the patch, `/api/morning` took about 1.7s; live updates were still isolated at about 7.1s during the current Nitter failure.
- Browser proof: Morning rendered with source pills for DailyFX, Major events, RollCall, Live update cache, and TC2000 before the live network warning arrived; after the background live refresh completed, FirstSquawk showed its warning without blocking the Calendar panel. Console warnings/errors were empty and the 427px viewport had no horizontal overflow.
- Validation: focused tests passed 2 files / 15 tests, TypeScript passed, and production build passed with only the existing large-chunk warning.

## Validation Run - 2026-06-02 A117

Commands:
- `npm run test -- src/replayDateTabs.test.ts`
- `npm run typecheck`
- `npm run build`
- Browser plugin QA against `http://localhost:5174/?qa=hide-retired-replay-dates`
- API smoke: `GET http://localhost:5174/api/tracker`

Result:
GREEN for A117 on 2026-06-02.

Proof:
- App proof: `src\replayDateTabs.ts` filters `2026-05-26` and `2026-05-27` from display-only Replay date tabs. `src\App.tsx` uses it in the Replay, Daily Pull, Daily Review, and Journal left date rails. No data importer, archive, or server delete path was touched.
- Test proof: `src\replayDateTabs.test.ts` verifies the two dates are hidden from the display list and that the source `availableDates` array is not mutated.
- Browser proof: Replay left rail rendered `2026-06-01`, `2026-05-29`, and `2026-05-28`; no `2026-05-26` or `2026-05-27` text appeared in the visible Replay body; console warnings/errors were empty; no horizontal overflow at the 412px viewport.
- Data proof: `/api/tracker` still returned `availableDates` with both `2026-05-26` and `2026-05-27`, confirming the data was not deleted.
- Validation: focused test passed 1 test; `npm run typecheck` passed; `npm run build` passed with the existing large-chunk warning.

## Validation Run - 2026-06-02 A116

Commands:
- `npm run test -- src/tradeJournal.test.ts server/tradeJournalSnapshot.test.ts`
- `npm run test -- src/morningDiary.test.ts server/morningAiNotes.test.ts`
- `npm run typecheck`
- `npm run build`
- Browser plugin QA against `http://localhost:5174/?qa=journal-aspects-a114`
- `npm run test` (full suite, data-drift failures noted below)

Result:
GREEN for A116 on 2026-06-02; full-suite importer tests still need the date-drift maintenance already documented in A115.

Proof:
- App proof: `src/tradeJournal.ts` now stores `aspectChecks` with entry structure, price action, volume node, and optional orderflow keys. `journalAspectChecklistForTrade()` returns call-spread wording for lower-high / above OVN / selling flow and put-spread wording for higher-low / below OVN / buying flow.
- UI proof: `src\App.tsx` renders a Four Aspects checkbox panel in Journal, shows `0/3 required` to `3/3 required` as required checks change, and adds queue-card progress pills such as `0/3 aspects`.
- Snapshot proof: `server/tradeJournalSnapshot.ts` sanitizes and persists the same aspect checks for Codex automation.
- Browser proof: desktop Journal at `http://localhost:5174/?qa=journal-aspects-a114` showed 4 call-spread checks, the required-count header updated to `3/3 required` after checking the three required boxes, 2026-05-29 put spread `10:12 Put 7550/7545` showed higher-low / below-OVN / buying-flow labels, console warnings/errors were empty, and a 412px viewport had no horizontal overflow with a single-column aspect list.
- Validation: focused journal/snapshot tests passed 8 tests; morning diary/AI-note tests passed 4 tests; `npm run typecheck` passed; `npm run build` passed with the existing large-chunk warning. Full `npm run test` passed 191 / 193 tests; the 2 failures are unrelated live-data drift in `server/dataImporter.test.ts`, which still expects latest date `2026-05-29` while the archive now reports `2026-06-01`, and expects staged payload source health `ok` while current source health is `warning`.

## Validation Run - 2026-06-02 A115

Commands:
- `npm run test -- src/dateIssueBadges.test.ts src/dailyPullChecklist.test.ts`
- `npm run typecheck`
- `npm run build`
- Runtime helper smoke against `http://127.0.0.1:5187/api/tracker`
- `npm run test` (full suite, data-drift failures noted below)

Result:
GREEN for A115 on 2026-06-02; full-suite importer tests need date-drift maintenance.

Proof:
- Root cause: the date-rail badge helper counted raw `summary.issueCount` / non-info sync issues, while Daily Pull Required Outputs uses `buildDailyPullChecklist()` to score actual required output readiness. That let warning-only raw diagnostics show issue badges even when required outputs were green.
- App proof: `src/dateIssueBadges.ts` now builds badge counts from Required Outputs coverage rows and only counts rows with `status === "failed"`. Badge titles name the red output labels.
- Test proof: focused badge/checklist tests passed 9 tests, including green required outputs with raw pull warnings producing no badge, red outputs producing an error badge, and clean tooltip punctuation.
- Runtime proof: the local Rubicon server on port `5187` reported 2026-05-29 with `failedOutputCount=0` and `badge=null`; dates with red output counts had matching badge labels.
- Validation: `npm run typecheck` passed and `npm run build` passed with the existing large-chunk warning. Full `npm run test` passed 191 / 193 tests; the 2 failures are unrelated live-data drift in `server/dataImporter.test.ts`, which still expects latest date `2026-05-29` while the archive now reports `2026-06-01`, and expects staged payload source health `ok` while current source health is `warning`.

## Validation Run - 2026-06-01 A114

Commands:
- `npm run test -- server/morningBrief.test.ts src/morningLiveState.test.ts src/easternDate.test.ts`
- `npm run typecheck`
- `npm run build`
- API smoke: `GET /api/morning?date=2026-06-01&refresh=major-events-cluster-smoke2`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=major-events-calendar`

Result:
GREEN on 2026-06-01.

Proof:
- App proof: Morning no longer renders Today/Tomorrow shortcut buttons. The Calendar panel now includes `Major events` with separate `This week` and `Next week` groups before the chronological economic/presidential agenda.
- Data proof: `readMajorEventsSource()` scans the DailyFX/IG economic endpoint over the selected Morning week plus the following week, filters US high/important macro rows, clusters related rows such as ISM/jobs/CPI/PPI/FOMC/Fed themes, and adds native monthly OPEX markers when the standard third-Friday OPEX date falls inside the two-week window.
- API proof: `GET /api/morning?date=2026-06-01&refresh=major-events-cluster-smoke2` returned clustered major events for this week and next week; June 2026 monthly OPEX was not included because June 19 falls outside the June 1-June 14 two-week window.
- Browser proof: Morning rendered `2026-06-01 morning brief`, no date shortcut buttons, the two 10:00 DailyFX ISM rows in the daily agenda, 12 major-event rows in the outlook, source detail `Pulled 12 major DailyFX/IG macro clusters and 0 native OPEX markers for this week and next week.`, no console warnings/errors, and no 427px horizontal overflow.
- Validation: focused tests, TypeScript, and production build passed; build retained only the existing large-chunk warning.

## Validation Run - 2026-06-01 A113

Commands:
- `npm run test -- src/easternDate.test.ts server/morningBrief.test.ts`
- `npm run typecheck`
- `npm run build`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=morning-est-date-separate`

Result:
GREEN on 2026-06-01.

Proof:
- Root cause proof: Morning shared Replay's selected date, so it defaulted to the latest imported trade archive and could show stale rows during date changes. The date helper now proves `2026-06-02T02:41:00Z` maps to `2026-06-01` Today EST and `2026-06-02` Tomorrow EST.
- App proof: `morningDate` is separate from `selectedDate`, Morning tracks Eastern today and rolls every minute while in Today mode, and Signal Stack fetches spread speed for the Morning date.
- Browser proof: settled `Today EST` rendered `2026-06-01` with the two 10:00 DailyFX ISM rows; settled `Tomorrow EST` rendered `2026-06-02` with the four DailyFX rows from the user's pasted calendar, plus RollCall rows as separate political events. Console warnings/errors were empty and 427px viewport had no horizontal overflow.
- Validation: focused tests, TypeScript, and production build passed; build retained only the existing large-chunk warning.

## Validation Run - 2026-06-01 A112

Commands:
- `npm run test -- server/morningBrief.test.ts server/godelLiveNews.test.ts src/morningLiveState.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run validate:mvp`
- API smoke: `GET /api/morning?date=2026-05-29&refresh=calendar-fix-*` and `GET /api/morning?date=2026-06-01&refresh=calendar-fix-*`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=a112-calendar-cache`

Result:
GREEN on 2026-06-01.

Proof:
- Root cause proof: DailyFX now redirects into IG's rendered calendar app, so the old static-table parser returned no rows; RollCall's base calendar page only showed the current month, so May 29 was absent from the June page; Live Updates were preserved only in browser state, so a reload/server restart with empty live sources could show an empty tape.
- App proof: `readDailyFxSource()` calls the DailyFX/IG economic events endpoint and parses medium/high US rows in ET; `readRollcallSource()` fetches `month-year` calendar pages such as `may-2026`; `loadMorningLiveUpdates()` and full Morning loads write/read `data/morning-live-updates-cache.json` as the server-side last-good fallback.
- API proof: 2026-05-29 returned 9 DailyFX economic events, 5 RollCall actionable presidential events, and 14 combined agenda rows; 2026-06-01 returned 2 DailyFX economic events, 4 RollCall actionable presidential events, and 6 combined rows.
- Browser proof: May 29 Morning rendered 14 chronological rows, DailyFX and RollCall source pills were OK, FirstSquawk showed a current upstream `fetch failed` warning, Godel remained a setup stub, console warnings/errors were empty, and the 427px viewport had no horizontal overflow.
- Validation: full MVP validation passed 37 Vitest files / 187 tests, TypeScript, and production build; build retained only the existing large-chunk warning.

## Validation Run - 2026-06-01 A111

Commands:
- `npm run test -- src/liveUpdateDisplay.test.ts server/morningBrief.test.ts src/morningLiveState.test.ts`
- `npm run typecheck`
- `npm run build`
- API smoke: `GET /api/morning?date=2026-05-29&refresh=a111`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=a111-live-readable-timeline-polished`

Result:
GREEN on 2026-06-01.

Proof:
- UI proof: all-caps FirstSquawk rows now render through `formatLiveUpdateDisplayText()`, preserving acronyms like `US`, `FDA`, `CUPW`, and `WTI` while normalizing shouted headlines into readable sentence-style text.
- Source proof: `readFirstSquawkSource()` now tries the Nitter timeline page first and falls back to RSS only if the timeline is unavailable or empty. API source detail showed `Pulled 16 items from Nitter timeline; latest item 38m old` and later Browser proof showed `latest item 1m old`.
- Browser proof: first visible rows included `We will not strike Beirut...`, `The US is pressing... Hezbollah...`, `Canada Post CUPW-represented...`, and `Trump on Truth Social...`; first 10 live rows had `allCapsRowCount=0`, source title said `Nitter timeline`, no horizontal overflow at 427px, and console warnings/errors were empty.
- Automatic refresh note: Rubicon already polls Live Updates every 10 seconds while Morning is open. True tweet-push delivery still requires an authenticated X API stream/source; the app source note now calls that out instead of implying RSS can push instantly.

## Validation Run - 2026-06-01 A110

Commands:
- `npm run test -- src/morningLiveState.test.ts server/morningBrief.test.ts`
- `npm run typecheck`
- `npm run build`
- API smoke: two `GET /api/morning/live-updates?refresh=...` calls
- Browser plugin rendered QA against `http://[::1]:5174/?qa=a110-live-refresh-click`

Result:
GREEN on 2026-06-01.

Proof:
- Root cause: Rubicon was refreshing, but Nitter's FirstSquawk RSS can return the same cached rows for many minutes; without a visible checked timestamp/status, pressing `Refresh Live` looked inert when no new upstream tweet had arrived.
- App proof: `fetchMorningLiveUpdates()` sends a cache-busting query, `/api/morning/live-updates` returns `Cache-Control: no-store`, feed fetches send no-cache headers, and the UI reports `Checked h:mm:ss PM EDT - no new posts...` with FirstSquawk/Godel counts and newest-item age.
- API proof: two direct refresh calls returned different `generatedAt` values (`2026-06-01T17:55:47.108Z` then `2026-06-01T17:55:49.241Z`) while the same 16 FirstSquawk rows remained, matching the upstream cache behavior.
- Browser proof: after a visual click on `Refresh Live`, the status changed from `Checked 1:54:25 PM EDT...` to `Checked 1:54:35 PM EDT...`, the list stayed populated with 16 live items, and console warnings/errors were empty. Screenshot capture in the Browser session timed out, so proof is DOM/API/click-state based.

## Validation Run - 2026-06-01 A109

Commands:
- `python -m py_compile ..\analysis\fpl_perbar_indicator\fpl_live_predict.py`
- Helper smoke importing `fpl_live_predict.write_csv()` / `load_existing_rows()` against a temp CSV to prove timestamp sorting and duplicate-minute replacement.
- Restarted the live predictor through `/api/fpl-indicator/live/stop` then `/api/fpl-indicator/live/start`.
- API smoke: `GET /api/fpl-indicator?date=2026-06-01&live=true`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=fpl-bars-a109`
- `npm run typecheck`

Result:
GREEN on 2026-06-01.

Proof:
- Root cause: the 13:23 ET predictor restart started with an empty in-memory `rows` list and rewrote `predictions_2026-06-01.csv` with only post-restart bars, so the chart had one oversized candle.
- Script proof: live mode now loads existing prediction rows, dedupes/sorts by ET minute, seeds completed bars from IBKR's initial `keepUpToDate` snapshot, appends those bars into the indicator history before prediction, and then streams new completed bars.
- Live proof: after restart, the CSV/API backfilled from 3 API bars to 123 API bars; first bar `09:30`, latest completed bar `13:34`, live predictor running as pid `94040` with client id `177`.
- Browser proof: Signal Stack FPL selected `2026-06-01`, live state showed `streaming...`, scrubber `max=122`, label `13:34`, chart screenshot showed many intraday candles across the session instead of one large bar, no console warnings/errors, and no 412px horizontal overflow.

## Validation Run - 2026-06-01 A108

Commands:
- `npm run typecheck`
- `npm run build`
- `npm run validate:mvp`
- API smoke: `GET /api/fpl-indicator/live/status`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=fpl-live-a108-final`

Result:
GREEN on 2026-06-01.

Proof:
- Root cause: the live predictor was already running as a standalone Python process with IBKR `clientId=77`, but the current server had lost child-process ownership, reported `running=false`, and a new Start attempt collided with `clientId=77`.
- Server proof: `/api/fpl-indicator/live/status` now detects the existing Python `fpl_live_predict.py --live` process, returns `running=true`, `pid=88084`, and no longer tries to spawn over it; default new launches now use `clientId=177`.
- UI proof: while live is running, the FPL panel refreshes manifest/predictions every 10 seconds and keeps today selectable. Browser QA selected Signal Stack, FPL showed `2026-06-01`, `Stop`, detected existing live predictor pid `88084`, 115 live bars, rendered chart canvases and probability lanes, no console warnings/errors, and no 412px overflow.
- Layout proof: FPL header/live controls wrap on narrow screens, so the live predictor status is readable instead of clipped at the right edge.
- Full validation passed: 36 Vitest files / 179 tests, TypeScript, and production build.

## Relative Rotation Graph - smooth tails (2026-06-01)

Studied real StockCharts RRG charts and reworked the tail rendering to match their "smooth tails" look, in Rubicon's dark theme:

- Straight polyline tails → **centripetal Catmull-Rom splines** (new tested module `src/rrgSpline.ts` + `src/rrgSpline.test.ts`), rendered as per-segment béziers. Centripetal (not uniform) parameterisation avoids the loops/overshoot at curl-back turning points.
- Each tail now **tapers** (stroke 0.8→3.2px) and **fades** (opacity 0.16→0.96) from the oldest observation toward the head; past observations are **hollow rings**; the head stays a filled, labelled dot.
- Plot is now a **square** (height tracks width, capped 620px) so equal RS-units map to equal pixels and rotations read as circles instead of horizontally-stretched ellipses.

Files: `src/rrgSpline.ts` (+test), `src/components/RelativeRotationGraph.tsx` (spline tails, taper/fade, ring dots, square viewBox), `RelativeRotationGraph.css`.

Result: GREEN on 2026-06-01. ESLint clean, TypeScript clean, build OK, full suite 36 files / 179 tests pass (incl. 4 new spline tests: collinear stays flat = no overshoot, sharp curl-back stays finite). Verified in-browser: tails are cubic béziers (7 segments/tail), widths/opacity ramp toward the head, ring dots, and the viewBox is square (720×720). Rasterised the live SVG (canvas→JPEG) to confirm the smooth curved trails visually.

## Relative Rotation Graph - UX validation pass (2026-06-01)

Role-played 5 trader use cases against the Rotation tab and fixed the friction found:

- UC1 "what's leading now?" — all 35 symbols defaulted on → unreadable hairball. Fix: default to the most-rotated ~12 names (`All` still one click), plus a **quadrant filter** (All/Leading/Weakening/Lagging/Improving with live counts) to slice the cloud.
- UC2 "isolate one name" — dimmed ghosts still cluttered. Fix: soloing now dims others to 0.09 and labels only the focused series.
- UC4 "daily view" — head labels overlapped into a blob when clustered. Fix: labels auto-hide above 16 visible series (dots stay; focused/hovered always labelled).
- UC5 "replay the rotation" — no playback. Fix: **Play / step / N-of-M** controls on the as-of scrubber that roll the date forward and restart from the end.
- Confusion: the equal-weight basket silently tracks the plotted set. Fix: caption now states the basket is rebuilt from plotted symbols and how to pin it; added a **Top movers** quick-select.

Files: `src/components/RrgPanel.tsx` (+ `.css`), `src/components/RelativeRotationGraph.tsx` (label declutter + `maxLabels`), `RelativeRotationGraph.css` (dim).

Result: GREEN on 2026-06-01. ESLint clean, TypeScript clean, production build OK, full suite 35 files / 175 tests pass. Behaviourally verified in-browser (eval; screenshot capture infra was unavailable): default opens on 12 curated names; quadrant "Leading" isolates 5; Play advances the as-of (52/52 → 23/52) and pauses; plotting all 35 hides labels (dots only); soloing a name dims the other 34 to opacity 0.09 and labels only it.

## Validation Run - 2026-06-01 A107

Commands:
- `npm run typecheck`
- `npm run build`
- `npm run test -- server/ibkrHoldings.test.ts`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=delta-decimal-share-eq`

Result:
GREEN on 2026-06-01.

Proof:
- Morning holdings rows now render per-contract delta first, e.g. `Delta 0.53/ct`, and the converted share-equivalent exposure separately, e.g. `Share eq +791`.
- Browser proof at the 412px in-app viewport: first row rendered `MSFT 260618C00450000 ... Delta 0.53/ct | Share eq +791 | Theta -$515/day | IBKR`, 6 holdings rows were present, no old `Delta 791`-style mislabel remained, console warnings/errors were empty, and `scrollWidth=clientWidth=412`.
- TypeScript, production build, and the focused IBKR holdings normalization tests passed.

## Validation Run - 2026-05-31 A106

Commands:
- `python -m py_compile scripts\refresh-ibkr-holdings-snapshot.py`
- `npm run test -- server/ibkrHoldings.test.ts`
- `npm run ibkr:holdings -- --market-data-seconds 1 --earnings-fetch-gap-s 0.01`
- `npm run ibkr:holdings -- --skip-market-data --market-data-seconds 1 --skip-earnings`
- `npm run validate:mvp`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=ibkr-greeks-a106`

Result:
GREEN on 2026-05-31.

Proof:
- Official IBKR API docs show option market-data requests can return delta/gamma/theta/vega and model implied volatility, with live values depending on option and underlying market-data subscriptions.
- Normal live pull connected to `127.0.0.1:7496`, account `U19610351`, 6 open option positions, `grossCurrentValue=$58,391.77`, `grossCostBasis=$39,076.18`, `marketDataSummary=6/6 market price, 6/6 delta, 6/6 theta`, and `manualGreeksSummary.ibkr=6/manual=0/missing=0`.
- Forced fallback proof with `--skip-market-data` computed manual Black-Scholes Greeks for 6 / 6 option rows using portfolio marks plus underlying prices, then a normal pull restored the IBKR-sourced snapshot.
- Morning UI proof: refresh interaction succeeded, panel showed `Value $58,392 - Cost $39,076 - Greeks 6/6`, each row showed current value, cost, P/L, `Delta`, `Theta`, and `IBKR`, with no console warnings/errors and no horizontal overflow at the 412px in-app viewport.
- Full validation passed: 35 Vitest files / 175 tests, TypeScript, and production build.

## Relative Rotation Graph - 2026-05-31 (user-requested feature)

Scope:
- Reusable, dependency-free RRG split into a pure math core, an SVG view, a host panel, and a thin data endpoint so the chart can be reused or embedded elsewhere.
- New files: `src/relativeRotation.ts` (RS-Ratio/RS-Momentum via rolling z-score, equal-weight synthetic benchmark, daily/weekly resample, as-of clamp) + `src/relativeRotation.test.ts`; `src/components/RelativeRotationGraph.tsx` + `.css` (quadrant SVG, fading tails, labeled heads, hover tooltip, legend); `src/components/RrgPanel.tsx` + `.css` (controls + data load); `server/rrgBars.ts` + `server/rrgBars.test.ts`.
- Edits: `GET /api/rrg/bars` in `server/index.ts`, `RrgBarsPayload` in `shared/types.ts`, `fetchRrgBars` in `src/api.ts`, and a `rotation` portion tab in `src/App.tsx`.
- Customizable inputs: benchmark (any symbol or equal-weight basket), timeframe (daily/weekly), RS-Ratio window, RS-Momentum window, tail length, as-of date, symbol multiselect.

Commands:
- `npm run typecheck`
- `npm test`
- `npm run build`
- Preview QA against served `dist` (`npm run serve:app`) on the `Rotation` tab.

Result:
GREEN on 2026-05-31.

Proof:
- Typecheck clean; production build OK; full suite 35 Vitest files / 175 tests pass, including the new `src/relativeRotation.test.ts` (17 tests) and `server/rrgBars.test.ts` (2 tests).
- `/api/rrg/bars` serves all 35 TC2000 symbols; the `Rotation` tab renders the quadrant plane (Leading/Weakening/Lagging/Improving) with fading tails, labeled heads, legend, and tooltip.
- Live customization verified in-browser with no console warnings/errors: narrowed 35 -> 8 symbols (`Plotted 8`); switched the benchmark to `GE` (auto-excluded, `Plotted 7`, caption `Skipped 1: GE (is benchmark)`); switched to Daily (windows auto-set to 50/20); as-of scrubber bound to the benchmark date axis.

## Validation Run - 2026-05-31 A105

Commands:
- `python -m py_compile scripts\refresh-tc2000-daily-bars.py scripts\refresh-ibkr-holdings-snapshot.py`
- `npm run tc2000:daily-bars -- --no-refresh --profile-fetch-gap-s 0.03`
- `npm run ibkr:holdings`
- `npm run validate:mvp`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=a105-profiles-earnings-live-font`

Result:
GREEN on 2026-05-31.

Proof:
- Live Updates headline text now renders with `font-weight: 430`, `font-size: 12px`, and `line-height: 18px`, making all-caps squawks visibly less heavy while preserving matched-row emphasis.
- TC2000 daily-bar refresh now also writes `profilesBySymbol` from the local StockAnalysis industry CSV plus StockAnalysis company pages. Current generated payload has 35 / 35 scanner profiles with both industry and description; `UIS` hover shows `Information Technology Services` plus a one-sentence company blurb.
- IBKR holdings refresh now checks the Nasdaq earnings calendar for the next 7 calendar days and attaches red/yellow warning metadata to matching option underlyings. Live refresh connected to `127.0.0.1:7496`, account `U19610351`, 6 option positions, and found no MSFT/ORCL/PLTR/TEAM/WDAY earnings inside the 7-day warning window, so the app correctly showed `No 7d earnings warnings`.
- Browser QA on the 412px viewport verified title `Rubicon`, no console warnings/errors, no horizontal overflow after the TC2000 mobile hover fix, Live Updates typography, holdings summary, and a real hover over `UIS` showing the chart plus industry/blurb in a clean popover.
- Full validation passed: 35 Vitest files / 175 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A104

Commands:
- `npm run tc2000:daily-bars -- --duration "1 Y" --min-request-gap-s 0.25`
- `npm run validate:mvp`
- API smoke: `loadMorningBrief('2026-05-29')`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=a104-live-godel-tc2000`

Result:
GREEN on 2026-05-31.

Proof:
- Live Updates now has a `Refresh Live` button beside the alert arm button. Browser QA clicked it successfully; the panel stayed populated and showed `16 live items - FirstSquawk 16 / Godel 0`.
- Godel is incorporated into the live surface as a counted source, per-row source badge support, and a source diagnostic line. With no configured authenticated source or staged `data/godel-live-news.json`, the app correctly reports the Godel setup stub instead of pretending there is live Godel data.
- TC2000 now includes `UIS Jump Pause/BO V2` from `..\IBKR Equity History Pull\data\tc2000_exports\jump_pause_v2_latest.csv`, with 20 corrected visible hits. The Morning API rendered 3 scanner lists: Jump Pause v2 (20), Staircase 5of6 (9), and Three Bar Rule Spike/Base BO (8), with 35 unique symbols.
- Manual TC2000 daily-bar refresh pulled 35 / 35 symbols from IBKR and wrote `data\tc2000-daily-bars.json`. Temporary probe OCR artifacts were removed so Rubicon reads the curated CSV scanner lists rather than noisy probe captures.
- Multimodal QA: a real mouse hover over `UIS` opened the mini 1D candlestick chart after the 0.5s delay. The first pass showed sibling chips over the chart; the stacking fix was applied and the repeat screenshot showed the chart cleanly above the chip strip.
- Full validation passed: 33 Vitest files / 156 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A103

Commands:
- `npm run test -- src/morningLiveState.test.ts server/morningBrief.test.ts`
- `python -m py_compile scripts\refresh-tc2000-daily-bars.py`
- `powershell -NoProfile -Command ...PSParser...run_daily_spx_ibkr_sync_with_sheet_payload.ps1`
- `npm run tc2000:daily-bars -- --duration "1 Y" --min-request-gap-s 0.25`
- `npm run validate:mvp`
- Browser plugin rendered QA against `http://[::1]:5174/?qa=a103-tc2000-hover`

Result:
GREEN on 2026-05-31.

Proof:
- Live Updates were clearing because refresh paths replaced the current list with a transient empty payload. `mergeLiveUpdateList()` and `preserveMorningBriefLiveUpdates()` now keep the last non-empty list during empty live-only and full-brief refreshes, while still updating source diagnostics.
- TC2000 Brief now reads scanner export CSVs and renders 2 current lists: `Staircase 5of6` with 9 hits and `Three Bar Rule Spike/Base BO` with 8 hits. The current Staircase export was corrected for the one OCR-missed visible row (`GE`) and saved as `..\IBKR Equity History Pull\data\tc2000_exports\staircase_latest.csv`.
- Daily-bar extraction is wired through `scripts\refresh-tc2000-daily-bars.py` and added to the afternoon sync wrapper after the main SPX sync and Google payload generation. Manual refresh connected through existing IBKR helpers and wrote `data\tc2000-daily-bars.json` with daily bars for 17 / 17 TC2000 symbols.
- Browser QA proof: title `Rubicon`, no framework overlay, TC2000 rendered 2 scanner lists, `Total hits 17`, `Daily bars 17 / 17`, no duplicate BANC/old OCR list, and focusing `ONON` after the 0.5s path opened a compact 1D candlestick preview with prices and dates.
- Full validation passed: 33 Vitest files / 156 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A102

Commands:
- `npm run test -- src/liveUpdateFilters.test.ts server/godelLiveNews.test.ts server/ibkrHoldings.test.ts server/morningBrief.test.ts`
- `python scripts/refresh-ibkr-holdings-snapshot.py`
- `python -m py_compile scripts\refresh-ibkr-holdings-snapshot.py`
- `npm run validate:mvp`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=a102-live-filter-godel-ibkr`

Result:
GREEN on 2026-05-31.

Proof:
- Caps Lock is not meaningful for the live-update word filter: Browser QA typed `IRAN, NVIDIA`, chips rendered as `iran` and `nvidia`, and 4 visible live rows highlighted with match labels/titles.
- Live filter matching now compiles terms once and reuses compiled regex/phrase checks for alerting and row rendering, avoiding repeated per-row recompilation during the 10-second live update refresh.
- Godel is no longer only a stub: `server/godelLiveNews.ts` parses configured Godel JSON/RSS/HTML-like captures into Morning live updates, `/api/morning/live-updates` merges Godel with FirstSquawk, and `npm run godel:capture` can stage `data/godel-live-news.json` from a configured authenticated URL/cookie/bearer source.
- IBKR holdings refresh now requests option snapshot market data, stores option mark/bid/ask/last plus delta/theta/gamma/vega/IV when IBKR returns them, and keeps option average prices displayed as premiums divided by multiplier. Live proof: refresh connected to `127.0.0.1:7496`, account `U19610351`, 6 positions, and the rendered MSFT row showed `Delta 0.53 | Theta -0.34` plus `Avg $8.79`.
- Browser QA proof: title `Rubicon`, no framework overlay, no console warnings/errors, no horizontal overflow (`docW=412` at 427px), Godel source shows setup instructions when no authenticated URL/capture is configured, and the IBKR panel keeps empty space below the positions rather than in the top block. Screenshot artifacts: `C:\Users\charl\AppData\Local\Temp\rubicon-a102-filter-ibkr.png`, `C:\Users\charl\AppData\Local\Temp\rubicon-a102-ibkr-greeks-panel.png`.
- Full validation passed: 32 Vitest files / 153 tests, TypeScript, Python compile, and production build.

## Validation Run - 2026-05-31 A101

Commands:
- `npm run test -- server/morningBrief.test.ts src/liveUpdateFilters.test.ts`
- `npm run validate:mvp`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=a101-built`

Result:
GREEN on 2026-05-31.

Proof:
- FirstSquawk parsing now includes Nitter repost rows (`RT by @...`) as `kind: repost`, preserves original/reposting metadata, strips the repost prefix from the displayed text, and lets the word filter match repost metadata as well as body text.
- Live Updates still poll the app endpoint every 10 seconds; the source diagnostics now report newest item age and note that the upstream Nitter RSS advertises a 40-minute TTL, so source lag is visible instead of looking like a stopped app timer.
- The `Rubicon Morning AI Notes` automation prompt now validates the written JSON, retries transient read/write/validation failures every 5 minutes until success, and treats an empty diary as a successful empty-state output.
- The Morning IBKR panel is tighter on the 427px in-app viewport: Browser QA measured a 16px header row and 48px status row, with text reduced to `6 positions - U19610351` and `Updated 3:13 PM EDT - Gross cost $39,076`.
- Browser QA proof: title `Rubicon`, no framework overlay, no console warnings/errors, no horizontal overflow (`docW=412` at a 427px viewport), visible reply metadata in live updates, FirstSquawk source detail `latest item 6m old`, and the compact holdings panel screenshot rendered cleanly.
- Full validation passed: 31 Vitest files / 149 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A100

Commands:
- `npm run test -- src/liveUpdateFilters.test.ts server/morningBrief.test.ts server/morningAiNotes.test.ts`
- `npm run validate:mvp`
- Codex automation create: `Rubicon Morning AI Notes`, weekdays 08:20 ET, workspace `C:\Users\charl\Desktop\AI STUFF\spx-spread-replay-tracker`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=live-filter-silent-a100`

Result:
GREEN on 2026-05-31.

Proof:
- Live-update alarms now only sound for newly seen items that match the configured word filter; an empty filter is explicitly silent and renders `No alert terms`.
- Morning AI Notes no longer summarize inside the app. Rubicon snapshots journal entries to `data/trade-journal.json`, reads Codex automation output from `data/morning-ai-notes.json`, and shows a pending/staged-data state until the automation writes its JSON. The automation is active as `rubicon-morning-ai-notes`.
- TC2000 Brief output no longer renders a screenshot or artifact list. It shows the parsed screener name (`Three Bar Rule Spike/Base BO` in the current pull), a hit count, and hit symbols (`AISP`, `JOYY`, `BBAI`, `ATKR`, `ICLR`, `UHAL`, `PENN`, `QNC`).
- IBKR holdings narrow-screen UI is compact: Browser QA measured the holdings top at 67px high, with the refresh action as an accessible icon button (`aria-label="Refresh IBKR holdings"`).
- Browser QA proof: title `Rubicon`, no framework overlay, no console warnings/errors, no horizontal overflow at the 427px in-app viewport, live filter blank with chip `No alert terms`, 0 matching live rows, AI Notes pending automation state visible, no `.morning-tc2000-image`, and TC2000 text-only hits visible. Screenshot artifacts: `C:\Users\charl\AppData\Local\Temp\rubicon-morning-ibkr-header-a100.png`, `C:\Users\charl\AppData\Local\Temp\rubicon-morning-ai-tc2000-a100.png`.
- Full validation passed: 31 Vitest files / 147 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A99

Commands:
- `npm run test -- src/liveUpdateFilters.test.ts src/morningAutoArm.test.ts server/ibkrHoldings.test.ts server/ibkrWalletRefresh.test.ts`
- `npm run test -- src/liveUpdateFilters.test.ts src/morningAutoArm.test.ts server/ibkrHoldings.test.ts server/morningBrief.test.ts`
- `python -m py_compile scripts\refresh-ibkr-holdings-snapshot.py scripts\refresh-ibkr-wallet-snapshot.py`
- `npm run validate:mvp`
- API smoke: `GET /api/morning/live-updates`, `GET /api/ibkr-holdings`, `POST /api/ibkr-holdings/refresh`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=live-filter-a99`

Result:
GREEN on 2026-05-31.

Proof:
- Live Updates now start armed when Rubicon opens, poll `/api/morning/live-updates` every 10 seconds, preserve the heavier Morning brief refresh cadence, and beep once per newly seen matching update. The word filter accepts comma, semicolon, and newline separated terms; simple terms match whole words and phrases match normalized text. Empty filters stay silent until a term is configured.
- Calendar Alerts now start armed when Rubicon opens and the Morning dashboard re-arms both calendar and live-update alerts once per weekday around 08:30 ET if the app stays open.
- IBKR holdings are pulled server-side through `scripts/refresh-ibkr-holdings-snapshot.py`, persisted to `..\IBKR Equity History Pull\data\ibkr_holdings_snapshot.json`, exposed by `/api/ibkr-holdings`, refreshable by `/api/ibkr-holdings/refresh`, and auto-refreshed once per weekday at 08:30 ET. Live proof after restarting TWS/Gateway: `/api/ibkr-holdings/refresh` connected to `127.0.0.1:7496`, account `U19610351`, and returned 6 open positions with gross cost basis `$39,076`. A standalone script rerun with client id `894` also succeeded.
- Browser QA proof: Morning opened with `Alert Armed` and `Calendar Alerts Armed`; the Live Updates filter accepted `Iran, Fed`, rendered chips `iran` and `fed`, highlighted 5 of 10 visible rows, kept 16 FirstSquawk items loaded, and showed no console warnings/errors or horizontal overflow. The holdings panel rendered 6 live positions, account `U19610351`, updated timestamp, gross cost, and the `08:30 ET` auto note with no horizontal overflow.
- Full validation passed: 30 Vitest files / 144 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A98

Commands:
- `npm run test -- src/calendarAlerts.test.ts server/desktopAlert.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run validate:mvp`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=calendar-alerts-a98d`

Result:
GREEN on 2026-05-31.

Proof:
- Added `src/calendarAlerts.ts` with tested scheduling rules: timed Morning events alert 60 seconds before start, events inside the final minute alert immediately when armed, untimed/already-started events are ignored, and the UI gets a compact next-alert status.
- Added a Windows desktop alert path: `POST /api/desktop-alert/calendar` launches `scripts/show-calendar-alert.ps1`, plays a system sound, and positions a topmost alert on the smallest available monitor, preferring a non-primary display when present. Safe API proof returned 400 for missing body instead of launching a blank alert.
- Morning agenda now shows `Arm Calendar Alerts` and `Test`. Real alert firing plays Rubicon's two-tone sound, renders an in-app alert card, asks Windows for the smallest-monitor popup, and uses browser notifications when permission is granted.
- Browser QA proof: alert controls rendered with 5 calendar rows, arming changed the button to `Calendar Alerts Armed`, Test rendered `Starts in 1 minute` for the 11:00 RollCall event, the page stayed on Rubicon instead of `about:blank`, console warnings/errors were empty, and the 412px viewport had no horizontal overflow.
- Full validation passed: 27 Vitest files / 134 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A97

Commands:
- `npm run test -- server/morningBrief.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run validate:mvp`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=morning-calendar-merged`

Result:
GREEN on 2026-05-31.

Proof:
- Live RollCall verification against `https://rollcall.com/factbase/trump/calendar/`: Friday 2026-05-29 now parses exactly 5 actionable presidential events after filtering out Executive Time plus pool/report/lid logistics; actual Sunday 2026-05-31 parses 0 actionable events because its 4 raw rows are routine/logistics only.
- Morning Brief now renders one `Economic + presidential agenda` section using the combined chronological event list instead of separate DailyFX and Presidential cards. Event rows include source text, so DailyFX/rollcall provenance remains visible.
- API proof: `GET http://[::1]:5174/api/morning?date=2026-05-29` returned `presidential=5`, `combined=5`, and RollCall detail `Pulled 5 actionable presidential events; ignored 4 pool/routine rows.`
- Browser proof: one combined agenda heading, no old `DailyFX US Events` / `Presidential Calendar` headings, 5 rendered event rows, Brief/Signal Stack tab switching still works, no framework overlay, no console warnings/errors, and no horizontal overflow at the 412px in-app viewport.
- Full validation passed: 25 Vitest files / 127 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A96

Commands:
- `npm run test -- server/morningBrief.test.ts src/morningDiary.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run validate:mvp`
- `npm run desktop:install`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=rubicon-final`

Result:
GREEN on 2026-05-31.

Proof:
- App shell is now `Rubicon` with top-level `Morning` and `Replay` tabs. Replay keeps Daily Pull, Replay, Daily Review, and Journal as inner tabs; FPL moved out of the global mode list and into Morning beside the net-delta spread recommendation.
- Added `/api/morning` plus parsers for RollCall Factba.se and FirstSquawk RSS, guarded DailyFX parsing, Godel stub status, and local TC2000 artifact discovery/serving from the latest `analysis/tc2000_uis_scanner_*` directory.
- Morning UI sections are separate for DailyFX US Events, Presidential Calendar, Live Updates with an armed sound alert, Signal Stack with recommended PCS/CCS and FPL, yesterday diary summary, and TC2000 pulls.
- Browser user-flow QA at `http://[::1]:5174/?appRefresh=rubicon-final`: Morning loaded first, section order was DailyFX / Presidential Calendar / FirstSquawk / Recommended spread, RollCall rendered 9 events, FirstSquawk rendered 10 visible rows from 16 pulled items, TC2000 image/artifacts loaded, alert button toggled from `Arm Alert` to `Alert Armed`, Replay top tab revealed the inner Replay workspace, title was `Rubicon`, console warnings/errors were empty, and the 427px in-app viewport had no horizontal overflow (`scrollWidth=412`).
- Follow-up QA after the user asked for Signal Stack as a separate Morning screen: Morning now has `Brief` and `Signal Stack` sub-tabs. Browser proof at `http://[::1]:5174/?appRefresh=morning-signal-split`: Brief rendered DailyFX, Presidential Calendar, FirstSquawk, diary, and TC2000 headings with no Signal Stack heading; clicking Signal Stack rendered only `Recommended spread and FPL`, two recommendation cards (`7575/7570`, `7585/7590`), and FPL, with no calendar headings, no console warnings/errors, and no horizontal overflow (`scrollWidth=412`).
- Desktop proof: `npm run desktop:install` created `C:\Users\charl\Desktop\Rubicon.lnk`; shortcut description is `Open Rubicon as a local desktop app`. `npm run desktop` opened an identity-checked Rubicon app URL at `http://[::1]:5174`, avoiding the wrong `127.0.0.1:5174` project when that address belongs to another app.
- Full validation passed: 25 Vitest files / 127 tests, TypeScript, and production build. DailyFX source currently returns no parseable medium/high US calendar rows in its delivered HTML, so the Morning source chip correctly shows a warning instead of pretending the pull is complete.

## Validation Run - 2026-05-31 A95

Commands:
- `npm run test -- src/tradeJournal.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run validate:mvp`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=journal-a95*`

Result:
GREEN on 2026-05-31.

Proof:
- Added a `Journal` app mode with local-storage-backed per-trade journal entries, setup/playbook, tags, thesis, execution, emotion, process score, grade, mistake, lesson, follow-up, reviewed/draft status, `Save & Next`, and `Clear Entry`.
- User-flow QA on 2026-05-29: filtered losing trades, journaled the 09:30 loss, marked it reviewed/follow-up, reloaded to confirm persistence, filtered Follow-up to one item, opened the selected journaled trade in Replay, then cleared the QA entry through the UI so local data was clean again.
- First QA found and fixed two workflow issues: after reload the editor could show a reviewed trade while the default Needs Review queue showed the next trade, and on narrow screens the queue was pushed below the stats. Retest confirmed the active queue card and editor both showed `10:04 Call 7620/7625`, the queue rendered immediately after the hero, and `Save & Next` was available.
- Browser proof had title `SPX Spread Replay`, no framework overlay, no console warnings/errors, no horizontal overflow at 412px, and screenshots: `C:\Users\charl\AppData\Local\Temp\spx-a95-journal-mobile-fixed.png`, `C:\Users\charl\AppData\Local\Temp\spx-a95-journal-editor-fixed.png`, `C:\Users\charl\AppData\Local\Temp\spx-a95-journal-fields-fixed.png`, `C:\Users\charl\AppData\Local\Temp\spx-a95-journal-clean-final.png`.
- Full validation passed: 23 Vitest files / 122 tests, TypeScript, and production build.

## Validation Run - 2026-05-31 A94

Commands:
- `npm run typecheck`
- `npm run test`
- `npm run build`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=ux-fixes-a94*`

Result:
GREEN on 2026-05-31.

Proof:
- Daily Pull now says `10,240 non-blocking breadth rows not pulled` and the KPI pill reads `Breadth Gaps`, avoiding the earlier Ready-versus-missing contradiction. Screenshot: `C:\Users\charl\AppData\Local\Temp\spx-a94-daily-pull-breadth-labels.png`.
- Narrow Daily Review now renders `Entry / Exit Map` directly after the hero/actions; internal order proof showed map order 1, metric cards order 2, content grid order 3, ledger order 4. Multimodal screenshot: `C:\Users\charl\AppData\Local\Temp\spx-a94-daily-review-map-first-final.png`.
- Replay quick-trade timing is guarded: immediately after selecting the 10:55 put spread, Full Day/Replay Mode/Play were disabled, the play button read `Loading`, and the scrubber read `Loading trade...`; after reload, Replay Mode + Play advanced to `2026-05-29 at 09:35`. Screenshot: `C:\Users\charl\AppData\Local\Temp\spx-a94-replay-timing-fixed.png`.
- Date rail buttons now visibly show `5 issues` and `9 trades` instead of unlabeled adjacent numbers. Screenshot: `C:\Users\charl\AppData\Local\Temp\spx-a94-date-rail-labels.png`.
- Browser final health check had title `SPX Spread Replay`, meaningful app content, no framework overlay, and no console warnings/errors.
- Full Vitest passed 22 files / 116 tests, TypeScript passed, and production build passed.

## Validation Run - 2026-05-31 A93

Commands:
- `npm run test -- src/clipboard.test.ts src/reviewImpact.test.ts`
- `npm run build`
- `npm run test`
- `npm run typecheck`
- Browser plugin rendered QA against `http://[::1]:5174/?appRefresh=ux-a93-*`

Result:
GREEN on 2026-05-31.

Proof:
- Daily Review `Copy Review` clicked successfully in the in-app Browser and showed `Review copied as markdown`, with screenshot `C:\Users\charl\AppData\Local\Temp\spx-a93-copy-review.png`.
- Narrow Daily Pull now renders `Daily Pull` readiness and `Required Outputs` above KPI cards; multimodal proof: `C:\Users\charl\AppData\Local\Temp\spx-a93-mobile-daily-pull.png`.
- Replay quick trade selection now has a selected chip/dot, the scrubber mode button reads `Replay Mode`, the play command reads `Play`, and no lower control is still named plain `Replay`; screenshots: `C:\Users\charl\AppData\Local\Temp\spx-a93-replay-quick-controls.png` and `C:\Users\charl\AppData\Local\Temp\spx-a93-replay-mode-controls.png`.
- Data Integrity warnings now show review-impact summaries first and hide raw diagnostics behind `Details`; expanding one row reveals the raw option-data error text on demand. Screenshots: `C:\Users\charl\AppData\Local\Temp\spx-a93-impact-warnings.png` and `C:\Users\charl\AppData\Local\Temp\spx-a93-impact-warnings-expanded.png`.
- Browser final health check on `http://[::1]:5174/?appRefresh=ux-a93-warnings` had title `SPX Spread Replay`, meaningful app content, no framework overlay, and no console warnings/errors.
- Focused UX tests passed 2 files / 7 tests, full Vitest passed 22 files / 116 tests, TypeScript passed, and production build passed.

## Validation Run - 2026-05-31 A92

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- Browser plugin rendered QA against `http://localhost:5174/?appRefresh=candle-gap-a92`

Result:
GREEN on 2026-05-31.

Proof:
- Source-data audit for `2026-05-29` found 31 raw SPX 1m bars from 10:00 through 10:30 ET and 16 expected 2m display candles at 10:00, 10:02, ..., 10:30.
- `buildReviewPnlLineData()` now samples P/L values only at the displayed candle timestamps, using the already-aggregated `displayBars`, so odd-minute P/L points cannot create empty time-scale slots between 2m candles.
- Browser QA in Daily Review rendered the default 2m chart with canvases present, no framework overlay, no console warnings/errors, and no horizontal overflow.
- Multimodal inspection of `C:\Users\charl\AppData\Local\Temp\spx-review-candles-1000-1030-crop-a92.png` confirmed the 10:00-10:30 candle strip contains rendered candle bodies/wicks after the fix.
- Focused chart tests passed 1 file / 22 tests, full Vitest passed 20 files / 109 tests, TypeScript passed, and production build passed.

## Validation Run - 2026-05-31 A91

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- Browser plugin rendered QA against `http://localhost:5174/?appRefresh=edge-arrows-a91`

Result:
GREEN on 2026-05-31.

Proof:
- `reviewArrowDimensionsForPlacement()` keeps normal arrow clearance in the middle of the chart, but reduces clearance near the top/bottom plot edges while preserving the guide/head geometry floor.
- Browser QA in default 2m Daily Review rendered 10 markers with the lowest edge marker held to a 4px bottom plot gap, no negative top gaps, no framework overlay, no console warnings/errors, and no horizontal overflow.
- Browser QA in 30m grouped Daily Review rendered 4 markers; the grouped bottom-edge marker also held to a 4px plot gap with no console warnings/errors or horizontal overflow.
- Screenshot artifacts: `C:\Users\charl\AppData\Local\Temp\spx-review-edge-arrows-2m-a91.png` and `C:\Users\charl\AppData\Local\Temp\spx-review-edge-arrows-30m-a91.png`.
- Focused chart tests passed 1 file / 21 tests, full Vitest passed 20 files / 108 tests, TypeScript passed, and production build passed.

## Validation Run - 2026-05-31 A90

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- Browser plugin rendered QA against `http://localhost:5174/?appRefresh=pnl-axis-a90c`

Result:
GREEN on 2026-05-31.

Proof:
- The Daily Review Entry / Exit Map no longer renders the `$0` / `P/L 0` reference line or label.
- The P/L series now uses a hidden left price scale plus compact custom gutter labels, so the same 412px viewport gives the candle pane 272px instead of the prior 210-216px plot area.
- P/L labels render at `x=8` in the left gutter, the redundant in-plot `P/L` tag is gone, and the P/L line is drawn behind the SPX candles so candle bodies and arrows remain the primary layer.
- Browser drag proof after moving the SPX/right price scale kept canvas widths `[272, 272, 64, 64, 272, 272, 64]`, kept `scrollWidth=clientWidth=412`, showed no zero-P/L text, and produced no console warnings/errors or framework overlay.
- Screenshot artifact: `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-overlay-final-a90.png`.
- Focused chart tests passed 1 file / 20 tests, full Vitest passed 20 files / 107 tests, TypeScript passed, and production build passed.

## Validation Run - 2026-05-31 A89

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- Browser plugin rendered QA against `http://localhost:5174/?appRefresh=pnl-axis-a89`

Result:
GREEN on 2026-05-31.

Proof:
- Daily Review Entry / Exit Map now renders SPX on the right price scale and all-position P/L on the visible left price scale. Browser canvas layout proof showed left axis width 62px, plot width 210px, and right SPX axis width 64px at the 412px viewport.
- The P/L line is now `lineWidth: 1`, uses the built-in `left` price scale rather than the hidden `daily-pnl` overlay scale, shows the current P/L axis label, and includes a dashed zero P/L line with a left-axis label.
- `expandReviewPnlAutoscaleInfo()` keeps zero in the P/L range while letting the left P/L axis autoscale per visible/day data.
- Browser drag proof: after dragging the SPX/right price scale vertically, the P/L overlay remained a native chart series inside the plot with both axes still present, no framework error text, no console warnings/errors, and no horizontal overflow. Screenshot artifact: `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-left-axis-a89.png`.
- Focused chart tests passed 1 file / 19 tests, full Vitest passed 20 files / 106 tests, TypeScript passed, and production build passed.

## Validation Run - 2026-05-31 A88

Commands:
- `npm run test -- server/dailySync.test.ts src/dailySyncReadiness.test.ts`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- API daily-sync status smoke against `http://localhost:5174/api/daily-sync/status`
- Browser plugin rendered QA against `http://localhost:5174/?appRefresh=data-integrity-a90`

Result:
GREEN on 2026-05-31.

Proof:
- Data Integrity rendered `5 items need review`, exactly 5 main issue rows, and a collapsed `5 non-blocking diagnostics` drawer. Main rows no longer include the info-only `Secondary IBKR endpoint did not connect` or `Open interest pull not fully clean` notes.
- Archive metric now reads `Core Ready` with detail `11 tabs - 61,673 staged rows; option breadth partial`, so the partial archive status no longer looks like a broken core import.
- Weekend Source State readiness now reads `Market closed` and explains that 2026-05-31 is a weekend date, with latest trading session 2026-05-29 used until the next market day. Browser QA confirmed no `Same-day sync opens` or `until 16:25 ET` text remained in Source State.
- Browser console warnings/errors were empty, no framework error text was present, and the 412px in-app viewport had no horizontal overflow (`scrollWidth=clientWidth=412`).
- Screenshot artifacts: `C:\Users\charl\AppData\Local\Temp\spx-data-integrity-separated-a88.png` and `C:\Users\charl\AppData\Local\Temp\spx-weekend-sync-readiness-a88.png`.
- Focused weekend sync tests passed 2 files / 12 tests, full Vitest passed 20 files / 105 tests, TypeScript passed, and production build passed.

## Validation Run - 2026-05-31 A87

Commands:
- `npm run test -- server/dataImporter.test.ts src/dailyPullChecklist.test.ts`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- API sync-health smoke against `http://localhost:5174/api/tracker`
- Desktop hover-placement QA with Python Playwright using local Edge against `http://localhost:5174/`

Result:
GREEN on 2026-05-31.

Proof:
- Desktop hover-placement QA showed the Daily Review readout at bottom-right inside the chart, with `right=64px`, `bottom=34px`, no old inset, no console warnings/errors, no framework error text, no horizontal overflow, and screenshot artifact `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-hover-position-a87.png`.
- API sync-health proof: Source Health is 11 / 11 OK; latest trade date is 2026-05-29; Google API refresh, Google Drive connector snapshot, Google CSV probe reconciliation, staged payload, raw workbook receipt, wallet, and IBKR live wallet socket are OK.
- Latest-date output proof: 2026-05-29 is uploaded with 136 fills, 24 spreads, 19 entries, 12 traded option contracts, 43,565 option intraday rows at `1 min`, connected-underlying 1m status `ok` with 2,340 rows, and open interest info-only at 112 / 120 rows.
- Warning explanation proof: remaining warnings are date-output breadth gaps, not Google or wallet failures. Option intraday has 65 unexpected option-data errors and 10 HMDS no-data responses; 16 of 20 scored missing contracts are within 100 pts of SPX open/close, causing warning severity. Volume profile has 5,035 missing raw rows, while 14 far-ITM contracts and 249 non-SPX rows are explicitly ignored/not scored. OI is info-only because all scored missing OI contracts are at least 100 pts away.
- Focused importer/checklist tests passed 2 files / 28 tests, full Vitest passed 20 files / 103 tests, TypeScript passed, and production build passed.

## Validation Run - 2026-05-31 A86

Commands:
- `npm run typecheck`
- `npm run test -- src/stats.test.ts`
- `npm run build`
- `npm run test`
- Browser plugin hover QA against `http://localhost:5174/`
- Desktop hover QA with Python Playwright using local Edge against `http://localhost:5174/`

Result:
GREEN on 2026-05-31.

Proof:
- Daily Review now appends a bottom chart readout that updates from the chart crosshair and displays hovered time, SPX close, all-position P/L, and SPX O/H/L.
- `reviewHoverReadoutForTime()` chooses the nearest displayed SPX candle and nearest P/L point, so values remain useful when the cursor is between exact bars.
- TypeScript passed, focused chart tests passed 18 tests, full Vitest passed 20 files / 103 tests, and production build passed.
- In-app Browser hover proof at 412px: readout updated to `13:58 EST SPX 7,569.92 P/L -$572 O 7,571.76 / H 7,571.80 / L 7,569.65`, stayed inside the chart, old inset count 0, no console warnings/errors, no framework error text, no horizontal overflow, and screenshot artifact `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-hover-readout-a86.png`.
- Desktop hover proof at 1280px: readout updated to `13:20 EST SPX 7,581.40 P/L -$297 O 7,585.36 / H 7,585.62 / L 7,580.16`, stayed inside the chart, old inset count 0, no console warnings/errors, no framework error text, no horizontal overflow, and screenshot artifact `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-hover-readout-desktop-a86.png`.

## Validation Run - 2026-05-31 A85

Commands:
- `npm run typecheck`
- `npm run test -- src/stats.test.ts`
- `npm run build`
- `npm run test`
- Browser plugin rendered QA against `http://localhost:5174/`
- Desktop rendered QA with Python Playwright using local Edge against `http://localhost:5174/`

Result:
GREEN on 2026-05-31.

Proof:
- Daily Review now passes P/L simulation points into `ReviewEntryExitChart` and draws them as a `lightweight-charts` line series on the same intraday time scale as the SPX candles.
- The old boxed inset overlay is removed; rendered proof showed `oldInsetOverlayCount=0` and `data-pnl-overlay="true"` on the chart.
- `buildReviewPnlLineData()` filters P/L points to the SPX bar window so synthetic 16:00 expiry points do not stretch the chart.
- TypeScript passed, focused chart test passed 17 tests, full Vitest passed 20 files / 102 tests, and production build passed.
- In-app Browser proof at 412px: selected tab `Daily Review`, chart overlay true, old inset count 0, no console warnings/errors, no framework error text, no horizontal overflow, and screenshot artifact `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-direct-browser-a85-polished.png`.
- Desktop proof at 1280px: chart height 560px, chart width 1009px, overlay true, old inset count 0, no console warnings/errors, no framework error text, no horizontal overflow, and screenshot artifact `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-direct-desktop-a85b.png`.

## Validation Run - 2026-05-31 A84

Commands:
- `npm run typecheck`
- `npm run test`
- `npm run build`
- Rendered overlay QA with Python Playwright using local Edge against `http://localhost:5174/`

Result:
GREEN on 2026-05-31.

Proof:
- Daily Review no longer renders a standalone `All-Positions P/L Replay` panel below the map.
- `Entry / Exit Map` contains a compact `daily-pnl-simulator` overlay inside the chart bounds, with the P/L line and summary stats on a translucent layer.
- TypeScript passed, production build passed, and full Vitest passed 20 files / 101 tests.
- Rendered proof at 1280px: chart height 560px, overlay 937x136, overlay inside chart, no horizontal overflow, no framework error text, and screenshot artifact `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-overlay-desktop-a84b.png`.
- Rendered proof at 412px: chart height 620px, overlay 300x150, overlay inside chart, no horizontal overflow, no framework error text, and screenshot artifact `C:\Users\charl\AppData\Local\Temp\spx-daily-review-pnl-overlay-mobile-a84b.png`.

## Validation Run - 2026-05-30 A83

Commands:
- `npm run typecheck`
- `npm run build`
- `npm run test`
- Rendered layout QA with Python Playwright using local Edge against `http://localhost:5174/`

Result:
GREEN on 2026-05-30.

Proof:
- Daily Review JSX now renders `Entry / Exit Map` before `All-Positions P/L Replay`.
- CSS sets the entry/exit chart to 440px and compresses the P/L replay chart/summary cards, including a 2-column narrow viewport summary grid.
- TypeScript passed, production build passed, and full Vitest passed 20 files / 101 tests.
- Rendered proof at 412px width: active tab `Daily Review`; first review headings were `Entry / Exit Map`, then `All-Positions P/L Replay`; entry/exit chart height was 440px; P/L chart stage height was about 220px; chart ratio was 2.0; entry panel appeared above P/L; no console messages; no horizontal overflow. Screenshot artifact: `C:\Users\charl\AppData\Local\Temp\spx-daily-review-map-priority-chart-a83.png`.

## Validation Run - 2026-05-30 A82

Commands:
- `npm run test -- src/dailyPullChecklist.test.ts server/dataImporter.test.ts server/googleSheetsSnapshot.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- Source-health smoke: `loadTrackerSnapshot()` filtered to Google source cards
- Browser plugin QA at `http://localhost:5174/`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 3 files / 34 tests, including the new regression that a private Google CSV 401 becomes benign when `Google API snapshot refresh` is OK.
- TypeScript passed, production build passed, and full Vitest passed 20 files / 101 tests.
- Source-health smoke showed `Google API snapshot refresh` OK through `GOOGLE_SERVICE_ACCOUNT_PATH`, `Google CSV export probe` OK with the expected private-sheet fallback explanation, connector snapshot OK/fresh, and raw workbook access OK.
- Browser proof at `http://localhost:5174/`: Daily Pull rendered 11 required-output rows, 6 rows with compact detail chips, 0 inline `.coverage-notes`, a focused row opened the hover/focus popover with `Warnings - Raw replay mark gap: 162 rows missing, 97.9% covered.`, Source State showed the Google CSV probe as OK, console warnings/errors were empty, and the current 412px viewport had no horizontal overflow. Screenshot artifact: `C:\Users\charl\AppData\Local\Temp\spx-required-outputs-hover-a82.png`.

## A82 Goal Meta-Review

| Meta-goal | Score | Proof | Adjustment |
|---|---|---|---|
| Goal quality | Strong | One focused readability/status request. | Keep Daily Pull goals tied to output usability. |
| Time to stable | Strong | One implementation pass plus narrow fixes. | Check rendered API route before UI assertions. |
| Rework rate | Strong | No code reverts or repeated failed fixes. | Keep source-health reconciliation isolated. |
| Validation strength | Strong | Focused tests, full tests, typecheck, build, source smoke, Browser proof. | Prefer `localhost:5174` static app while 5173 proxy is pointed at a conflicting process. |
| Workflow depth | Strong | User can read required outputs and reveal details with focus/hover. | Keep details discoverable without making rows noisy. |
| Context carryover | Strong | Preserved A81 tracker cleanup and Google credential context. | Continue updating `NOTEPAD.md` when status semantics change. |
| Tooling leverage | Strong | Browser plugin caught the bad 5173 API route before QA. | Start Browser QA with page JSON-health checks. |
| User-visible value | Strong | Required outputs are now scannable and Google no longer looks broken from private CSV fallback. | Keep red/yellow reserved for output-impacting gaps. |
| Agent productivity metrics | Mixed | Good validation count, but port conflict cost extra minutes. | Note port/source in final when relevant. |
| Next-goal improvement | Strong | Next Daily Pull tweaks should distinguish visibility from severity. | Add UI tests only if this hover pattern starts changing again. |

## Validation Run - 2026-05-30 A81

Commands:
- `.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"` in `..\IBKR Equity History Pull`
- `.\.venv\Scripts\python.exe -m py_compile daily_spx_ibkr_sync.py prepare_spx_google_sheet_upload.py` in `..\IBKR Equity History Pull`
- `.\.venv\Scripts\python.exe prepare_spx_google_sheet_upload.py --date 2026-05-29`
- `npm run test -- server/dataImporter.test.ts`
- `npm run typecheck`
- `npm run test`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Python sync/upload tests passed 5 tests, including a new regression that `trade_log_upload` includes one SPXW vertical while excluding a non-SPX single option and a non-SPX vertical.
- The upload scripts compiled.
- Regenerated `2026-05-29` payload keeps 61,673 raw rows but now reports `trade_log_upload.included_row_count=9` and `skipped_non_spx_row_count=10`.
- Live Google Sheet cleanup proof: backed up old `Trade Log!27:45` rows to `data\trade-log-2026-05-29-before-spx-only-2026-05-30T21-10-11-249Z.json`, replaced 19 old rows with 9 SPXW rows, and cleared extra block cells in `Trade Log!A36:G45`, `I36:J45`, `L36:P45`, `W36:X45`, and `AB36:AC45`.
- Live tracker verification after write: 2026-05-29 has exactly 9 `IBKR-` Trade Log rows, all `Call Credit Spread` or `Put Credit Spread`, all `Closed` or `Expired`, and no TEAM/MSFT/PLTR/ORCL/WDAY notes.
- Focused app importer test passed 1 file / 24 tests with `payloadRows=61673` still intact.
- Full app validation passed TypeScript, 20 Vitest files / 100 tests, and production build.

## Validation Run - 2026-05-30 A80

Commands:
- `npm run test -- src/dailyPullChecklist.test.ts server/dataImporter.test.ts`
- `npm run google:snapshot`
- `npm run test -- server/googleSnapshotAutoRefresh.test.ts server/googleSheetsSnapshot.test.ts server/dataImporter.test.ts`
- `npm run typecheck`
- `npm run test`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 2 files / 27 tests, including 100-point relevance wording, far-away gaps staying as notes, and IBKR execution endpoints showing 100% coverage when one endpoint connects.
- Full Vitest passed 20 files / 100 tests.
- TypeScript passed.
- Production build passed.
- Importer proof for 2026-05-29: `127.0.0.1:7496` returned 136 fills, so `IBKR execution endpoints` is `1 / 1`, `100%`, `complete`, with the failed `4001` fallback as an info note; OI gaps are info-only because all 4 scored missing contracts are at least 100 pts from SPX open/close and 4 far-ITM contracts are ignored; option/volume warnings remain for 16 near scored contracts and 382 near rows.
- Google proof: `GOOGLE_SERVICE_ACCOUNT_PATH` now points to the existing `.secrets\spx-replay-google-service-account.json`; `npm run google:snapshot` succeeds without manual env setup; the desktop launcher and snapshot script auto-detect that JSON; importer Source State reports `Google API snapshot refresh` OK, connector snapshot OK/fresh with 4 Daily Sync Runs rows, and the raw workbook receipt exists. Direct unauthenticated CSV export still returns HTTP 401 Unauthorized, which is expected for a private Sheet.

## Validation Run - 2026-05-30 A79

Commands:
- `..\IBKR Equity History Pull\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'`
- `..\IBKR Equity History Pull\.venv\Scripts\python.exe -m py_compile daily_spx_ibkr_sync.py prepare_spx_google_sheet_upload.py ibkr\spy_spike_fetch.py`
- `npm run test -- src/dailyPullChecklist.test.ts server/dataImporter.test.ts`
- `npm run validate:mvp`

Result:
GREEN on 2026-05-30.

Proof:
- Python daily-sync tests passed 4 tests and the touched sync/upload/SPX fetch scripts compiled.
- Focused app tests passed 2 files / 27 tests, including 5-second SPX and option artifact preference with 1-minute fallback.
- Full app validation passed typecheck, full Vitest at 20 files / 100 tests, and production build.
- Code proof: the daily sync requests SPX session `TRADES` with `--bar-size 5s`, requests IBKR option `TRADES` with `barSizeSetting="5 secs"`, writes `session_trades_5s`, `option_leg_trades_5s`, `spread_trade_marks_5s`, and 5s cumulative-volume artifacts, emits the `SPX 5s` and `IBKR Option Trades 5s` upload tabs, and the replay importer prefers 5s artifacts while falling back to old 1m files.
- Session boundary proof: SPXW option contracts retain the 16:15 ET end time; regular equity options cap at 16:00 ET to avoid IBKR previous-session tail bars.

## Validation Run - 2026-05-30 A78

Commands:
- `npm run test -- src/dailyPullChecklist.test.ts server/dataImporter.test.ts server/ibkrWalletRefresh.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run test`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 3 files / 29 tests, including far-away option/OI gaps staying as non-warning notes and live 2026-05-29 proximity details.
- Full Vitest passed 20 files / 100 tests.
- TypeScript passed.
- Production build passed.
- Importer proof: 2026-05-29 now has no `error` severity issues; the failed `127.0.0.1:4001` endpoint is informational because `127.0.0.1:7496` returned 136 fills; OI gaps say 8 / 8 missing contracts are within 200 pts of SPX open/close; volume profile says 4,786 SPX rows are near and 249 missing rows are non-SPX option rows not scored against SPX open/close.
- Browser proof at `http://127.0.0.1:5184`: Daily Pull rendered the correct SPX app, zero failed pull steps, `IBKR execution endpoints` as `complete` / `Endpoint ready` with the 4001 fallback note, OI and volume rows with the proximity details, and no console warnings/errors.
- Port note: `127.0.0.1:5174` is currently occupied by another Vite project, so rendered QA used a temporary production server on `5184`, then shut it down.

## Validation Run - 2026-05-30 A77

Commands:
- `npm run test -- src/marketFreshness.test.ts src/dailyPullChecklist.test.ts server/googleSnapshotAutoRefresh.test.ts server/googleSheetsSnapshot.test.ts server/dataImporter.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 5 files / 38 tests, including the new Saturday `2026-05-30` missing-archive case where `marketFreshness()` returns `null` instead of a Today pending alert.
- TypeScript passed.
- Production build passed.
- Importer proof: `loadTrackerSnapshot()` reported `today=2026-05-30`, `latestTradeDate=2026-05-29`, `SPX Spread Trade Tracker Google Sheet` OK, `Google Drive connector snapshot` OK/fresh with 4 Daily Sync Runs rows read at `2026-05-30T19:26:35.900Z`, and 2026-05-29 upload `uploaded` with `uploadReceiptCheck.status=found`.
- Remaining Google caveat: `Google API snapshot refresh` still warns because no reusable Google Sheets API credential is configured, and the direct Google CSV export probe still returns HTTP 401 Unauthorized.
- Browser proof was not used for this change because the open `127.0.0.1:5174` target was serving a different Vite project; source-state proof came directly from the app importer.

## Validation Run - 2026-05-30 A76

Commands:
- `npm run test`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Full Vitest passed 20 files / 97 tests after updating the live same-day payload row expectation to the current 61,673-row upload payload.
- TypeScript passed.
- Production build passed.
- Unit proof: `src/dailyPnlSimulator.test.ts` covers overlapping open positions, realized P/L after exits, SPX/replay timeline use, and missing reconstructed mark observations.
- Browser proof at `http://localhost:5174`: Daily Review rendered `All-Positions P/L Replay`, `417 steps`, final simulated P/L `+$575`, high/low `+$575 / -$1,247`, max drawdown `$1,353`, max open trades `6`, a non-empty total/revealed SVG curve, and the reconstructed Replay spread-close note.
- Completion proof: the simulator receives `replay.spreadMarks`, iterates all selected-date trades, marks open positions from reconstructed spread closes, switches terminal positions to actual `trade.pnl`, and finishes at the same net P/L as Daily Review.
- Screenshot artifact: `C:\Users\charl\AppData\Local\Temp\spx-daily-pnl-simulator.png`.

## Validation Run - 2026-05-30 A75

Commands:
- `npm run test -- src/stats.test.ts src/dailyReviewExport.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 2 files / 18 tests, including `premiumArrowHeadScale()` staying below the old/current scale for smaller premiums and reaching the current cap for large premium.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: default `2m` Daily Review rendered 10 entry/exit markers, `0` expiry markers, and premium-scaled head lengths from about `7.9px` to `9.5px`.
- Grouped 30m proof: 5 grouped entry/exit arrows rendered, with arrowhead lengths from about `8.01px` at 3.50 premium to `11.54px` at 16.25 premium, still below the previous current cap.

## Validation Run - 2026-05-30 A74

Commands:
- `npm run test -- src/stats.test.ts src/dailyReviewExport.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 2 files / 17 tests, including marker clearance scaling and the prior expiry/2m checks.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: Daily Review defaulted to `2m`, still showed `9 entries, 4 exits, and 5 expiries`, had `0` expiry marker elements, rendered 10 entry/exit markers, and produced no console warnings/errors.
- Marker readability proof: measured visual marker bodies at least 30px away from the candle coordinate, with only a 0.85px dashed guide line and a 5px final gap before the candle.
- Screenshot artifact: `C:\Users\charl\AppData\Local\Temp\spx-review-marker-clearance-final-2m.png`.

## Validation Run - 2026-05-30 A73

Commands:
- `npm run test -- src/stats.test.ts src/dailyReviewExport.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 2 files / 17 tests, including no chart marker for synthetic expirations, 2m candle aggregation, grouped expiry wording, and exact no-offset arrow box alignment.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: Daily Review still showed `9 entries, 4 exits, and 5 expiries` and metric `9 / 4 / 5`, while the chart had `0` `.review-marker.expiration` elements and `0` marker labels containing expiry/expired.
- 2m proof: clicking `2m` made that button active, rendered 10 non-expiry entry/exit markers, and all checked SVG arrow tips sat at the marker edge with no stem/head x-offset.
- 30m proof: clicking `30m` rendered exactly 5 grouped entry/exit arrows with no expiry arrow groups; labels included `3 Entries / 1 Exit` and `1 Entry / 3 Exits`.
- Console proof: Browser warnings/errors were empty.
- Screenshot artifact: `C:\Users\charl\AppData\Local\Temp\spx-review-no-expiry-2m.png`.

## Validation Run - 2026-05-30 A72

Commands:
- `npm run test -- src/stats.test.ts src/dailyReviewExport.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 2 files / 17 tests, including expiry counts separate from exits, expiry marker labels, grouped marker expiry wording, and markdown export `entries / exits / expiries`.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: Daily Review copy showed `9 entries, 4 exits, and 5 expiries`, the metric showed `9 / 4 / 5`, 30m review rendered 7 grouped arrows with 2 expiry marker groups, and arrow sizes/stems now ranged from `27x37:2.68px` to `32x43:4.02px`.
- Date rail proof: Daily Review date buttons had `railOverflowCount=0`, so date, issue badge, and trade count fit without right-side clipping.
- Tooltip proof: hovering the grouped `3 Entries / 1 Exit` call arrow showed the tooltip as flex/column, 28px above the full arrow body, and not clipped left or right.
- Screenshot artifact: `qa-review-arrows-expiries-tooltip-final.png`.

## Validation Run - 2026-05-30 A71

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 1 file / 14 tests, including same-candle marker grouping across entries/exits and premium-based full-arrow scaling.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: 30m Daily Review now rendered 7 grouped candle-side arrows instead of 18 independent markers; same-candle call entries/exits collapsed into `3 Entries / 1 Exit` and same-candle put entry/exits collapsed into `1 Entry / 3 Exits`.
- Visual proof: premium scaling produced arrow hit widths/heights from 19x26 for 3.50 premium up to 21x29 for 15.00-16.25 grouped premium, with stem widths from 1.89px to 2.79px.
- Zoom proof: after mouse-wheel zoom the grouped chart still had 7 markers, 0 outside marker wrappers, and 0 outside hit targets.
- Interaction proof: clicking grouped `3 Entries / 1 Exit 10:04 +3 EST - 4 trades - 15.00 total premium` selected the representative Replay trade `Entry 10:04 EST - Call 7620/7625 - 5`.
- Screenshot artifact: `qa-review-grouped-arrows.png`.

## Validation Run - 2026-05-30 A70

Commands:
- `npm run test -- src/components/ReplayCharts.test.ts src/refreshLogic.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 2 files / 5 tests, including the new full-day-until-replay-mode chart cutoff behavior.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: clicking `Replay` selected 2026-05-29 (latest available because today is 2026-05-30 with no imported archive), rendered `2026-05-29 full day`, showed `390 bars - EST` and `405 closes - EST`, kept `Full Day` active with the scrubber disabled, and the enlarged replay cockpit measured about 719x758 with a 691x560 chart grid and no horizontal overflow.
- Browser optional replay proof: clicking the Replay mode control switched the header to `2026-05-29 at 09:30`, enabled the scrubber, and reduced visible chart data to `1 bars - EST` / `1 closes - EST`.
- Browser FPL proof: FPL Indicator rendered with document scroll height 1335 vs 720 viewport height, `.fpl-panel` overflow `visible`, keyboard/window scroll reached lower content, and the screenshot shows the lower probability lanes/side rail. Console warnings/errors were empty.
- Browser Daily Review proof: the date rail starts `2026-05-29`, `2026-05-28`, `2026-05-27`, `2026-05-26`, and the heading stayed on `2026-05-29 entries and exits`. Console warnings/errors were empty.
- Screenshot artifacts: `C:\Users\charl\AppData\Local\Temp\spx-replay-full-day-a69.png`, `C:\Users\charl\AppData\Local\Temp\spx-fpl-scroll-a69.png`, `C:\Users\charl\AppData\Local\Temp\spx-daily-review-newest-a69.png`.

## Validation Run - 2026-05-30 A69

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 1 file / 13 tests, including higher-timeframe SPX candle aggregation, candle-edge arrow anchoring, zoom-edge arrow boxes, and edge-aware clustered-marker lane fan-out.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: Daily Review exposed `1m`, `5m`, `15m`, and `30m` controls; the 30m chart rendered 18 markers with 0 hit-target overlaps and 0 hit targets outside the 336px chart; after mouse-wheel zoom there were still 0 outside marker wrappers, 0 outside hit targets, and 0 hit-target overlaps.
- Interaction proof: clicking the `Entry 09:30 EST - 10 x 0.35 premium` marker on the 30m chart switched to Replay and selected `Entry 09:30 EST - Call 7620/7625 - 10`, not the nearby `10:10` trade.
- Screenshot artifact: `qa-review-30m-arrows-fixed.png`.

## Validation Run - 2026-05-30 A68

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 1 file / 9 tests, including premium stem scaling and clustered-marker lane fan-out.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: 2026-05-29 Daily Review rendered 18 markers, max marker height was 26px, clustered 15:59 EOD stems fanned to visual x positions 294/309/324, eight distinct premium stem widths rendered, the legend still showed `Stem = entry premium`, clicking the first entry arrow selected the matching Replay trade, console warnings/errors were empty, and the 412px viewport had no horizontal overflow.
- Screenshot artifact: `C:\Users\charl\AppData\Local\Temp\spx-fixed-review-arrows.png`.

## Validation Run - 2026-05-30 A67

Commands:
- `npm run test -- src/appRefresh.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 1 file / 2 tests.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: `.source-chip` count was 0, top strip text was only `Daily Pull`, `Replay`, `Daily Review`, `FPL Indicator`, `Checked 12:36:57`, and `Latest`; local import refresh remained available as one icon button with `aria-label="Refresh local import"`; `Latest` retained `aria-label="Refresh to latest version"`; console warnings/errors were empty; and the 412px viewport had no horizontal overflow.

## Validation Run - 2026-05-30 A66

Commands:
- `npm run test -- src/appRefresh.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 1 file / 2 tests for preserving URL context and replacing old app-refresh markers.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: `Refresh to latest version` rendered in the top strip, clicking it changed the URL from `/` to `/?appRefresh=1780158765936`, the app reloaded with meaningful SPX Spread Replay content and the button still present, no console warnings/errors appeared, and the 412px viewport had no horizontal overflow (`scrollWidth=clientWidth=412`).

## Validation Run - 2026-05-30 A65

Commands:
- `npm run test -- src/stats.test.ts`
- `npm run typecheck`
- `npm run build`

Result:
GREEN on 2026-05-30.

Proof:
- Focused Vitest passed 1 file / 8 tests, including premium amount and stem-width scaling for Daily Review arrows.
- TypeScript passed.
- Production build passed.
- Browser proof at `http://localhost:5174`: Daily Review rendered 18 arrow markers for 2026-05-29, every sampled marker had an SVG arrow head plus stem, stem widths varied from 1.94px to 2.55px based on `abs(contracts * entryPrice)`, the legend showed `Stem = entry premium`, clicking the first entry arrow switched to Replay and selected `Entry 09:30 EST - Call 7620/7625 - 10`, and console warnings/errors were empty.

## Validation Run

Commands:
- `node .\node_modules\vitest\vitest.mjs run`
- `node .\node_modules\typescript\bin\tsc -b`
- `node .\node_modules\vite\bin\vite.js build`
- `python -m py_compile ..\IBKR Equity History Pull\daily_spx_ibkr_sync.py ..\IBKR Equity History Pull\prepare_spx_google_sheet_upload.py`

Result:
GREEN on 2026-05-29.

Proof:
- TypeScript: `tsc -b` passed.
- Tests: full Vitest passed 17 files / 83 tests, including the new Daily Pull checklist model and existing importer/Google/upload/replay coverage.
- Build: `vite build` passed.
- Python sync scripts: `py_compile` passed for `daily_spx_ibkr_sync.py` and `prepare_spx_google_sheet_upload.py`.
- API proof: `GET /api/tracker` reported latest/today `2026-05-29`, upload `uploaded`, option intraday `partial`, `tradedOptionContractCount=12`, `optionIntradayRowCount=43565`, connected underlying 1m `missing`, `underlyingIntradaySymbolCount=5`, and `underlyingIntradayRowCount=0`.
- Browser Daily Pull proof: `http://localhost:5173` selected the `Daily Pull` tab, rendered one `[data-testid="daily-pull-checklist"]`, showed 11 required steps, hid `Trade History`, kept Daily Pull-local `SessionHealth` and `SourceLedger`, displayed `6/11 checked - 2 warnings - 3 failures.`, placed warning detail in hover/title text, showed visible failures for IBKR `ok_with_errors`, option intraday partial/errors, and connected underlying 1m `missing`, had no framework overlay or console warnings/errors, and at the 412px in-app viewport had no horizontal overflow (`scrollWidth=clientWidth=412`).
- Browser plugin app check: `http://localhost:5173`, title `SPX Spread Replay`, no console warnings/errors during replay/review checks.
- Browser spread chart proof: `Line` toggles active and the spread title changes to `21 closes - EST`, then `HL` toggles active and the title changes back to `21 OHLC / 20 ranged - EST`; console warnings/errors were empty.
- Browser auto-import proof: manual refresh button stayed unique, `Checked HH:MM:SS` rendered in the topbar, Replay Cockpit and Source State remained visible after refresh, and console warnings/errors were empty.
- Browser quick-access proof: 2026-05-28 rendered 21 quick trade buttons; late trade `IBKR-997697850-21` was directly clickable; Replay header updated to `Entry 15:08 EST - Call 7565/7570 - 20`; the selected quick button stayed marked active; console warnings/errors were empty.
- Browser source-state proof: Source State ledger renders 11 source cards, reports `9/11 ready`, links the tracker index, shows `Run Daily Sync` and `Refresh Google`, shows `AI STUFF daily sync launcher` OK with latest 2026-05-29 counts, shows `Staged sheet payload` OK with 59,333 rows, shows `Replay market data` OK for 2026-05-29, keeps Google API/CSV auth warnings visible, and shows `Google Drive connector snapshot` OK with 4 Daily Sync Runs rows. Browser console warnings/errors were empty.
- Browser latest sync diagnostics proof: Source State rendered `Daily SPX/IBKR sync completed`, `State completed`, `Target 2026-05-29 (auto, cutoff 16:25 ET)`, `Latest summary 2026-05-29: partial, 19 entries`, the latest daily sync log path, and a log tail ending with `fills=136, spreads=24, entries=19`. Exactly one `Run Daily Sync` action remained visible and enabled after cutoff, and console warnings/errors were empty.
- Browser market freshness proof: `http://localhost:5173` rendered `.market-freshness` with `Today imported` and `Today's archive is available; viewing 2026-05-29.` Browser proof also showed 9 SPX spread trade rows, 9 replay quick trade buttons, EST chart text, all replay chart panes named, and no console warnings/errors.
- Browser Daily Review export proof: `http://localhost:5173` switched to Daily Review, rendered one `Copy Review` action, one `Download .md` action, and `Replay Day`; clicking `Download .md` displayed `spx-daily-review-2026-05-29.md downloaded`, kept the 2026-05-29 review and `9/9 trades` ledger visible, and produced no console warnings/errors.
- Browser Daily Review Source State export proof: `http://localhost:5173` switched to Daily Review, rendered one `Copy Review` action, one `Download .md` action, live Source State text including `Google API snapshot refresh`, and `9/9 trades`; clicking `Download .md` displayed `spx-daily-review-2026-05-29.md downloaded`, and console warnings/errors were empty. Browser virtual clipboard read was unavailable and screenshot capture timed out, so the export-body proof is the focused unit test plus DOM/status/console proof.
- Browser selected-date receipt check proof: `http://localhost:5173` rendered exactly one `[data-testid="upload-receipt-check"]` for 2026-05-29 with `59,333` staged rows, `GOOGLE_SHEETS_ACCESS_TOKEN`, `npm run google:snapshot`, `2026-05-29`, and `raw_upload_google_sheet_url`; the panel width stayed within the 1280px viewport, and console warnings/errors were empty. Browser screenshot capture timed out, so proof is DOM/layout/console based.
- Browser date issue badge proof: Replay session rail rendered three `.date-issue-badge.error` pills; selected `2026-05-28` had aria label `2026-05-28, 21 trades, 5 issues need review` and tooltip `2026-05-28: 5 data sync issues need review (pull 3, availability 2).` Daily Review date rail rendered the same three badges and selected-date aria label; console warnings/errors were empty.
- Browser per-trade review flag proof: Daily Review rendered 21 flag controls with `Follow-up`, `Mistake`, and `Quality`; after a page-level scroll the first trade's `Follow-up` flag toggled active, `Save Note` wrote `tradeFlags` with `IBKR-997697494-1: follow_up` to `data/review-notes.json`, reload kept `Follow-up` active with `aria-pressed=true`, console warnings/errors were empty, and the temporary QA review-notes file was deleted to restore the original missing local-notes state.
- Browser review flag filter proof: Daily Review saved three sample flags, the flag panel showed `3/21 flagged` with one `Follow-up`, one `Mistake`, one `Quality`, and 18 unflagged; selecting `Mistake` filtered the ledger to `1/21`, selecting `Unflagged` filtered it to `18/21`, selecting `All` restored `21/21`, reload preserved all three active flags, console warnings/errors were empty, and the temporary QA review-notes file was deleted afterward.
- Browser flagged replay queue proof: with temporary flags on the first two trades, Daily Review rendered queue buttons `Follow-up 09:30 C 7565/7570 x10` and `Mistake 09:31 P 7460/7455 x3`; clicking the Mistake queue item switched to the Replay tab, updated the header to `Entry 09:31 EST - Put 7460/7455 - 3`, selected the matching 09:31 ledger row, produced no console warnings/errors, and restored the original missing `data/review-notes.json` state afterward.
- Browser daily sync readiness proof: at 15:56 ET on 2026-05-29, Source State rendered `.sync-readiness.warning` with `Same-day sync opens at 16:25 ET` and detail `Auto is still targeting 2026-05-28. Today's 2026-05-29 sync opens after 16:25 ET.`; exactly one `Run Daily Sync` button remained visible, `9/11 ready` remained visible, the Today pending freshness banner still named 2026-05-28 as the fallback session, and console warnings/errors were empty.
- Browser sync preflight proof: clicking `Preflight Sync` at 16:00 ET returned `Daily SPX/IBKR sync preflight passed; command is ready to launch`, displayed the exact `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...run_daily_spx_ibkr_sync_with_sheet_payload.ps1 --no-popup --date auto` command, preserved diagnostics with `Latest summary 2026-05-28: partial, 21 entries`, kept one `Preflight Sync` button and one `Run Daily Sync` button visible, never showed `Sync Running`, kept `9/11 ready`, and produced no console warnings/errors.
- Browser daily sync countdown proof: at 16:05 ET on 2026-05-29, Source State rendered `.sync-readiness.warning` with `Same-day sync opens at 16:25 ET` and detail `Auto is still targeting 2026-05-28. Today's 2026-05-29 sync opens after 16:25 ET, about 20 minutes from now.`; clicking `Preflight Sync` still preserved the guarded PowerShell command and latest summary, kept one Preflight and one Run button, never showed `Sync Running`, kept `9/11 ready`, and produced no console warnings/errors. Browser screenshot capture timed out twice, so proof is DOM/console based.
- Browser cutoff guard proof: at 16:11 ET on 2026-05-29, `Run Daily Sync` was disabled with title `Auto would still target 2026-05-28...unlock after 16:25 ET`; after idle polling past 16:25 ET, Source State changed to target `2026-05-29`, readiness changed to `Today sync ready`, and the same button became enabled without page reload.
- Live sync launch proof: clicking `Run Daily Sync` after cutoff started the AI STUFF wrapper with PID 20528 and target `2026-05-29`; the run completed with exit code 0 at `2026-05-29T20:38:24.442Z`. A first launch exposed a PowerShell stderr-capture wrapper bug, which was fixed in `..\IBKR Equity History Pull\run_daily_spx_ibkr_sync_with_sheet_payload.ps1` before the successful rerun.
- Fresh Google connector proof: Google Sheets connector read `Daily Sync Runs!A1:AA20` from spreadsheet `1w0S_DNJJ6ZhcSGB0qEtkBxsVLxQk0prVPqnV9t-WvtE` in formatted mode and returned rows for 2026-05-26, 2026-05-27, and 2026-05-28, including the 2026-05-28 raw upload workbook URL and 21 entries. The metadata read hit a Sheets 429 project quota response, so the existing known metadata was preserved while the range-backed snapshot content/read time was refreshed.
- Connector snapshot API proof: `GET /api/tracker` reported `Google Drive connector snapshot` OK with `SPX Spread Trade Tracker read through Google Drive connector at 2026-05-29T15:10:44-04:00; 3 Daily Sync Runs rows captured. Snapshot is fresh (0.0h old).`
- Daily sync API proof: `POST /api/daily-sync/run` with `dryRun: true` returned `Daily SPX/IBKR sync preflight passed; command is ready to launch.` with the exact PowerShell wrapper command and `--no-popup --date auto`; `GET /api/daily-sync/status` returned the latest log tail and latest summary path.
- Daily sync target-plan proof: at 15:05 ET on 2026-05-29, `GET /api/daily-sync/status` returned `targetPlan.estimatedTargetDate=2026-05-28`, `nowEt=2026-05-29 15:05 ET`, and the note `until 16:25 ET`; Browser Source State displayed the same prior-session target note before the `Run Daily Sync` action.
- Same-day API import proof: after receipt repair, `GET /api/tracker` reported `latestTradeDate=2026-05-29`, `today=2026-05-29`, 4 available sessions, 9 SPX spread trade rows for today, Source State connector snapshot OK, staged payload count 59,333, and 2026-05-29 summary `fillCount=136`, `spreadCount=24`, `entryCount=19`, `optionContractCount=12`, `uploadStatus=uploaded`, and a raw Google workbook URL.
- Same-day replay proof: `GET /api/replay?date=2026-05-29` returned 390 SPX bars, 7,533 spread marks, 9 SPX-only quick trades, 106 open-interest rows, and 41,384 volume rows; all quick-trade legs were `SPXW`, and there were 0 low-strike non-SPX rows in OI or volume.
- Connector receipt repair proof: the 2026-05-29 staged payload was rebuilt into `spx_daily_upload_2026-05-29.xlsx`, imported as native Google Sheet `SPX Daily Upload 2026-05-29` (`https://docs.google.com/spreadsheets/d/1oPFgKIyBbny3qjbqw73Sqr-_uaYVJw0AD9v3FP7eE7g`), and appended to `SPX Spread Trade Tracker > Daily Sync Runs`. A live connector row search scanned `A1:AA999` at 18:09 ET and found row 5 for `2026-05-29` with `raw_upload_google_sheet_url`; `/api/tracker` now reports `uploadStatus=uploaded`, `uploadReceiptCheck.status=found`, Source State connector status `ok`, and no `Connector receipt row not found` issue.
- Daily Review export proof: `src/dailyReviewExport.test.ts` verifies the markdown export includes selected date, net/session stats, import health issues, Source State ready count and warnings, note text, flagged trades, EOD expiration labeling, ledger rows, and stable filename `spx-daily-review-2026-05-29.md`.
- Completion audit proof: `COMPLETION_AUDIT.md` maps the original app requirements to current evidence. Fresh API proof showed today/latest `2026-05-29`, four available dates, 9 latest-date trades, Source State connector snapshot OK, IBKR wallet net liquidation `108396.82`, latest summary `fills=136`, `spreads=24`, `entries=19`, `payloadRows=59333`, `uploadStatus=uploaded`, and replay payload with 390 SPX bars, 7,533 spread marks, 9 quick trades, 106 OI rows, 41,384 volume rows, and 0 non-SPX quick legs. Browser proof showed Uploaded state, zero receipt-warning panels, four Replay chart panels, 9 quick buttons, entry crosses, HL/Line controls, split/calls/puts volume controls, EST labels, and no console warnings/errors. Desktop proof showed the installed shortcut and Edge app-mode process.
- Automatic Google refresh proof: `/api/tracker` invokes a credential-aware Google tracker snapshot refresh before loading the tracker snapshot. With no reusable API credential configured, Source State still shows the credential wait while the connector-backed snapshot supplies confirmed receipts through 2026-05-29. Browser proof showed `Today imported`, 9 trades, `Uploaded`, and no console warnings/errors. Focused validation `npm run test -- server/googleSnapshotAutoRefresh.test.ts server/googleSheetsSnapshot.test.ts server/dataImporter.test.ts` passed 3 files / 29 tests in the earlier refresh slice.
- Previous Browser Google refresh action proof: clicking `Refresh Google` with no reusable Google credential configured displayed `No Google Sheets credential configured. Set GOOGLE_SHEETS_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_PATH, or GOOGLE_SHEETS_API_KEY.` inside Source State and produced no console warnings/errors.
- Daily sync progress/fail-soft proof: the AI STUFF wrapper now writes Rubicon `daily-sync-status.json` at sync start and after `core-sync`, `sheet-payload`, `raw-workbook`, and `tc2000-bars`; it continues payload/workbook/TC2000 steps after incomplete core data instead of exiting early. 2026-06-01 ET validation ran the wrapper with `--no-popup`, produced 75 fills, 31 spreads, 22 entries, 4,680 SPX 5s rows, an 11-tab payload, `spx_daily_upload_2026-06-01.xlsx`, and 35/35 TC2000 daily-bar refresh; direct server status and temporary API smoke both reported `state=completed`, 5 steps, 5 complete, 0 warnings. Daily Pull now consumes those live sync steps: the process checks show `sync-run`, `payload`, `raw-workbook`, and `upload` complete for 2026-06-01, and Required Output coverage includes green `Google upload payload tabs`, `Local raw upload workbook`, and `Google raw upload receipt`. Vitest passed 42 files / 202 tests, `npm run typecheck` passed, and `npm run build` passed.
- IBKR wallet command proof: `npm run ibkr:wallet` connected to read-only TWS API on `127.0.0.1:7496`, wrote `C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\data\ibkr_account_snapshot.json`, and returned account `U19610351` with a fresh `NetLiquidation` snapshot.
- IBKR wallet API proof: `POST /api/ibkr-wallet/refresh` returned `ok: true`, message `Refreshed IBKR wallet from read-only TWS/Gateway API on port 7496.`, and wallet source `AI_STUFF:ibkr_account_snapshot.json`.
- Browser IBKR refresh proof: at `http://localhost:5173`, Browser found exactly one `IBKR` wallet refresh button, clicked it, the wallet card showed the success message, Source State reported `8/10 ready`, `IBKR wallet` OK, and `IBKR live wallet refresh` OK with reachable sockets `127.0.0.1:7496, 4001`; console warnings/errors were empty.
- Browser data health: 2026-05-28 shows IBKR pull warning, expected HMDS no-data responses, partial OI, and `Uploaded` with `Google Drive connector snapshot confirmed raw workbook receipt at May 29, 14:23 EDT.`
- Google snapshot command proof: `npm run google:snapshot` failed closed without credentials and printed `No Google Sheets credential configured. Set GOOGLE_SHEETS_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_PATH, or GOOGLE_SHEETS_API_KEY.`
- Import detail proof: API/importer reports 2026-05-28 `fillCount=253`, `spreadCount=30`, `entryCount=21`, `optionContractCount=11`, and `payloadRows=59888` by falling back to staged `google_sheet_upload_payload.json` counts when the newest daily sync summary marks historical trade refresh as skipped.
- Wallet source proof: `readWallet()` loads an IBKR-style `IBKR_ACCOUNT_SNAPSHOT_PATH` JSON file with `NetLiquidation=123456.78`, account `U19610351`, and fetched timestamp before falling back to `IBKR_WALLET_SIZE`; missing-wallet source health now names manual local entry, `IBKR_ACCOUNT_SNAPSHOT_PATH`, AI STUFF account snapshot files, and `IBKR_WALLET_SIZE`.
- Playwright replay proof: split volume profile shows puts 43,891, calls 45,813, top 36 of 55 strikes, first active row 7510 with 4,703 puts and 4,611 calls; speed select value was 16.
- Playwright daily review proof: Daily Review shows 42 events from 21 entries and 21 exits; clicking the first timeline event returned to Replay with `aria-selected=true` and one selected trade row.
- Playwright mobile proof: Daily Review content at 390x844 rendered 42 events with document `scrollWidth` equal to viewport width.
- Browser replay proof: Trade History shows exactly one red `!` warning on `IBKR-997697617-7` at 10:15 with tooltip `fill -1.30 - chart -0.90 - diff -0.40 - 44.4%`; selected spread panel defaults to `HL`.
- Data proof: selected 10:15 CCS has reconstructed mark open -1.50, high -0.50, low -3.10, close/mark -0.90, `activeLegCount` 2, 405 marks, and 388 non-collapsed range bars.
- Full spread reconstruction audit: 21 / 21 entries were two-leg spreads; 8,505 spread mark rows imported; 405 minute marks per trade; 0 trades missing expected option-leg symbols; 7,176 rows had non-collapsed OHLC ranges; all checked rows had `active_leg_count=2`.
- Browser daily review proof: Entry / Exit Map renders 42 markers; expiration markers expose `Expired EOD`, no exit marker label contains 16:00, and timeline/ledger show `EOD` for expiration exits.
- Desktop proof: `C:\Users\charl\Desktop\SPX Spread Replay.lnk` targets hidden PowerShell launcher `scripts\launch-desktop.ps1`; launcher log includes `Opened desktop app window`; process command line shows `msedge.exe --app=http://127.0.0.1:5174 --user-data-dir=C:\Users\charl\AppData\Local\SPX Spread Replay App`.

Artifacts:
- `C:\Users\charl\AppData\Local\Temp\spx-replay-split-16x.png`
- `C:\Users\charl\AppData\Local\Temp\spx-daily-review.png`
- `C:\Users\charl\AppData\Local\Temp\spx-daily-review-mobile-content.png`
- `C:\Users\charl\AppData\Local\Temp\spx-spread-ohlc-chart-qa.png`
- `C:\Users\charl\AppData\Local\Temp\spx-auto-import-refresh-qa.png`
- `C:\Users\charl\AppData\Local\Temp\spx-all-quick-trades-qa.png`
- `C:\Users\charl\AppData\Local\Temp\spx-google-csv-probe-qa.png`
- `data/google-drive-tracker-snapshot.json`
- `qa-spread-hl-toggle.png`
- `qa-entry-price-alert.png`
- `qa-daily-review-eod.png`
- `C:\Users\charl\Desktop\SPX Spread Replay.lnk`

## Current Blocker

- None for the local MVP.

## Known Limits

- Google Sheets snapshot auto-refresh is wired into `/api/tracker`, throttled by `SPX_GOOGLE_AUTO_REFRESH_MINUTES`, and now uses the existing service-account JSON in `.secrets`. The app has connector/API-confirmed receipts through 2026-05-29; direct unauthenticated Google CSV export still returns HTTP 401 Unauthorized for the private tracker, which is expected.
- Live IBKR wallet refresh is wired through a read-only TWS/Gateway account-summary snapshot when the API socket is open. Daily trade/market-data refresh can be launched from the desktop app through the existing AI STUFF sync wrapper and has been proven with a real 2026-05-29 run; the 2026-05-29 Google upload is connector-confirmed, while the current archive predates the new connected-underlying 1m artifact and is correctly flagged as `missing` until the next sync rerun.
- Only local proof is claimed. Hosted deployment, broker auth, telemetry, and pilot proof remain future phases.

## Ten-Point Productivity Meta-Review

- Goal quality: Strong. A99 turns Morning from a passive brief into an armed live-workflow surface with alerts, filtered tape beeps, and current broker holdings.
- Time to stable: Strong. The IBKR retry initially collided on client id because two pulls ran in parallel; a separate client-id rerun proved the script path while the app endpoint had already succeeded.
- Rework rate: Strong. The implementation reused existing Morning, API, and scheduler patterns instead of creating a separate alert service.
- Validation strength: Strong. Focused filter/auto-arm/holdings tests, Python compile, API smoke, live IBKR proof, Browser QA, and full `validate:mvp` all passed.
- Workflow depth: Strong. A trader can open Morning, see alerts already armed, filter tape terms, and review live account positions before market prep.
- Context carryover: Strong. Calendar alerts, live-update alerts, FPL live auto-start, and daily sync remain separate paths with their own cadences.
- Tooling leverage: Strong. Browser QA verified the actual narrow UI, and the local API validated the live IBKR socket after TWS/Gateway restarted.
- User-visible value: Strong. The default state now does the thing the trader would otherwise forget: arm alerts and pull positions each morning.
- Agent productivity metrics: Strong. The run added 10 focused tests and one real broker-data smoke without breaking the replay/review stack.
- Next-goal improvement: Strong. Future live-tape work should add durable alert history/snooze controls before adding more feed sources.

## Next Smallest Useful Task

- Add durable live-alert history/snooze state so Morning can show which calendar/live-update alerts fired, which were filtered, and which were dismissed.

## Files Changed Last Heartbeat

- `WORKLOG.md`
- `ACCEPTANCE_CRITERIA.md`
- `VALIDATION.md`
- `src\components\MorningDashboard.tsx`
- `src\liveUpdateAlerts.ts`
- `src\liveUpdateAlerts.test.ts`
- `dist\index.html`
- `dist\assets\index-CGKBsaC5.js`

## 2026-06-03 19:07 ET - Replay Spread Speed Trim

- Trimmed the Replay Spread Speed panel to show only the recommended put-credit and call-credit spreads when spread-speed data is available. Removed the per-strike ladder, threshold warning, long net-delta explanation, and header metadata so the bottom Replay cockpit area fits more reliably.
- Added compact recommendation styling and a narrow-screen single-column fallback in `src\App.css`; changed the delta display to ASCII (`d0.01 / $0.00`) so the recommendation text renders cleanly in the local app.
- Validation: `npm run typecheck` passed; `npm run build` passed with the existing Vite large-chunk warning; Playwright-core smoke at 1920x1080 showed no horizontal overflow, 2 recommendation rows, `.replay-grid` bottom 910 below scrubber top 920, and Spread Speed panel bottom 1053 inside the 1080px viewport. Screenshot: `output\playwright\rubicon-replay-spread-speed-recommended-only.png`.

## 2026-06-03 19:16 ET - Replay Spread-Level Selection

- Added spread-level Replay selection above the existing entry chips. Spread chips group same-date trades by side and strike pair; selecting one feeds all matching entries into the SPX intraday and selected credit-spread charts while entry chips remain available for single-entry focus.
- Updated Replay chart selection to dedupe same-spread marks by timestamp and label each grouped entry/exit as `E1`, `X1`, etc. Softened chart marker lines/labels and split the selector into `Spreads` and `Entries` lanes for easier scanning.
- Validation: `npm run test -- quickTrades ReplayCharts App` passed 4 files / 31 tests; `npm run typecheck` passed; `npm run build` passed with the existing Vite large-chunk warning. Playwright-core smoke at 1920x1080 selected `Put 7540/7535 - 5 entries`, showed 5 included entry chips, rendered 20 entry/exit labels across SPX + spread charts, and had no horizontal overflow. Screenshot: `output\playwright\rubicon-replay-spread-selection.png`.

## 2026-06-03 19:34 ET - Replay Spread Selector Only

- Removed the individual entry-chip lane from the Replay cockpit header; the top selector now shows only spread groups.
- Made the selected trade's spread group the default active chart selection, so the charts stay spread-first even before the user clicks a spread chip.
- Validation: `npm run test -- App ReplayCharts quickTrades` passed 4 files / 31 tests; `npm run typecheck` passed; `npm run build` passed with the existing Vite large-chunk warning. Playwright-core smoke at 1920x1080 showed 10 spread buttons, 0 entry buttons, no `Entries` heading, no horizontal overflow, and screenshot `output\playwright\rubicon-replay-spreads-only.png`.

## 2026-06-03 19:40 ET - Replay Control And Header Tightening

- Moved the spread recommendation indicator out of Replay and into Morning > Signal Stack by making the recommendation cards explicit `Recommended` indicators with frame context; Replay no longer fetches or renders the bottom spread-speed panel.
- Moved SPX chart controls into the SPX chart header as `2m`, `5m`, and `CC` buttons, matching the spread chart's `HL/Line` toolbar pattern.
- Updated Trade History to show `In` and `Out` times and removed the `Status` column. Compacted the KPI strip to six equal columns with smaller card height/padding so it fits horizontally without the empty extra slot.
- Validation: `npm run test -- App ReplayCharts MorningDashboard quickTrades` passed 5 files / 39 tests; `npm run typecheck` passed; `npm run build` passed with the existing Vite large-chunk warning. Browser smoke at 1920x1080 showed no standalone chart-control row, no Replay spread-speed panel, SPX chart buttons `2m/5m/CC`, Trade History headers `In/Out/Side/Strikes/Qty/Entry/Exit/P/L`, six KPI columns, and Morning Signal Stack `Recommended` badges. Screenshots: `output\playwright\rubicon-replay-ui-tightened.png`, `output\playwright\rubicon-morning-signal-stack-spreads.png`.

## 2026-06-03 20:01 ET - Replay Collapsed Session Rails

- Collapsed the Replay session/date rail to a 30px left-edge hover target across Replay, Daily Pull, Daily Review, and Journal. The rail expands over the content on hover/focus instead of consuming permanent horizontal space; Daily Pull opens to 260px, the other Replay rails open to 190px.
- Tightened the Replay Trade History table to `table-layout: fixed`, removed its desktop `min-width`, and hid horizontal overflow inside the table wrapper so the trade table does not create a horizontal scrollbar when the session rail is hidden.
- Validation: `npm run test -- App ReplayCharts` passed 3 files / 28 tests; `npm run typecheck` passed; `npm run build` passed with the existing Vite large-chunk warning. Browser smoke at 1920x1080 and 1100x900 showed body/document `scrollWidth === clientWidth`, Trade History `scrollWidth === clientWidth`, the rail expanding from 30px to 190px on Replay hover, Daily Pull expanding 30px -> 260px, Daily Review and Journal expanding 30px -> 190px, and no console warnings/errors. Screenshots: `output\playwright\rubicon-replay-rail-hover-1920.png`, `output\playwright\rubicon-replay-rail-collapsed-1100.png`, `output\playwright\rubicon-replay-rail-hover-1100.png`, `output\playwright\rubicon-replay-journal-rail-hover-1100.png`.

## 2026-06-03 20:10 ET - Replay Cheat-Code MA Warmup Fix

- Checked the Replay CC math against the FPL cheat-code generator. Root cause: Replay used strict full-period SMA/EMA availability, so the 2m 200 SMA disappeared on normal 195-bar sessions; the FPL generator uses warmups (`50` MAs after 5 bars, `200` MAs after 10 bars).
- Added `minPeriods` support to `src\movingAverages.ts` and wired Replay's CC overlay specs to the FPL warmups. The 200 SMA now appears alongside the 200 EMA instead of being silently dropped; on 2026-06-03 the 2m 200 pair differs by max ~16.8 SPX points, avg ~9.0, last ~2.7.
- Validation: watched the new ReplayCharts warmup test fail before the fix; `npm run test -- movingAverages ReplayCharts` passed 2 files / 19 tests; `npm run typecheck` passed; `npm run build` passed with the existing Vite large-chunk warning. Browser smoke at 1280x900 toggled CC on (`aria-pressed=true`), showed no framework overlay, no horizontal overflow, and zero console warnings/errors. Screenshot: `output\playwright\rubicon-replay-cc-fpl-warmup-desktop.png`.
