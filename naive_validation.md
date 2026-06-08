# naive_validation.md

## Standard Commands

```bash
npm run test
npm run typecheck
npm run build
```

`npm run validate:mvp` runs typecheck, full Vitest, and build.

## Local Targets

- API/app server: `http://[::1]:5174`
- Dev web server: `http://[::1]:5173`
- Use `http://[::1]:5174` when another project owns `127.0.0.1:5174`.

## Latest Validation - 2026-06-04 Canonical 5-Wide SPX Verticals

Commands:

```bash
python -m pytest tests -q
python -m py_compile daily_spx_ibkr_sync.py
python prepare_spx_google_sheet_upload.py --date 2026-06-03 --tracker-only
npm run rubicon:ingest -- --date 2026-06-03
npm run test -- server/dataImporter.test.ts server/dataImporterSafeReplay.test.ts src/dailyPnlSimulator.test.ts src/quickTrades.test.ts
```

Result: GREEN for canonical 5-wide SPX vertical recording and the 2026-06-03 manual backfill.

Proof:

- `daily_spx_ibkr_sync.py` decomposes wider SPXW verticals into adjacent 5-wide rungs before lifecycle matching, normalizes numeric CSV expirations for synthetic SPXW symbols, preserves actual close time on partial-expiration rows, adds synthetic middle-strike contracts, and rewrites canonical `entries.csv` prices after spread-mark generation.
- The 2026-06-03 pull was manually rebuilt from stored fills and existing 5-second option bars: 164 fills, 28 raw spread summaries, 24 canonical entry rows, 18 contracts, and 114,386 canonical spread-mark rows. The wide exits `44054554` and `44054868` now attach to four existing 5-wide rows.
- IBKR Python tests passed 17/17; Rubicon focused importer/replay/P&L tests passed 36/36; `npm run rubicon:ingest -- --date 2026-06-03` refreshed tracker, replay safe state, and spread-speed state with no warnings.
- Live replay smoke for 2026-06-03 returned 17 canonical quick trades, 6,885 sampled replay marks, 4,680 SPX bars, and all SPX vertical trade ids had matching spread marks.

## Recent Validation Notes

| ID | Focus | Result |
|---|---|---|
| A142 | Missing public macro calendar sources | Macro calendar tests passed 1 file / 15 tests, including ADP/MBA/API generators, API holiday behavior, NAR/NAHB/NYFed parsing, and UMich schedule warning behavior; Morning dashboard tests passed 2 files / 21 tests; typecheck/build passed. |
| A141 follow-up | FirstSquawk toast AppID/debug hardening | The toast script now auto-resolves the Edge-installed Rubicon AppID and the API waits for script completion. Focused `desktopAlert liveUpdateAlerts` tests passed; live `5174` API route returned `ok` via `127.0.0.1-9BBB1E10_tz517vvf8m8yt!App`. Typecheck/build are currently blocked by unrelated `src/components/SpreadSpeedPanel.tsx` concurrent edits. |
| A141 | FirstSquawk Windows toast notifications | Focused alert/dashboard tests passed 3 files / 16 tests; PowerShell parser/script smoke passed; typecheck/build passed; browser smoke on `http://127.0.0.1:5180` passed; API route returned `ok`. |
| A140 | Three-stage Daily Pipeline | Focused pipeline tests passed 11 files / 57 tests; full Vitest passed 61 files / 326 tests; typecheck/build passed; IBKR Python pytest passed 5/5; Python and PowerShell syntax checks passed. |
| A139 | Morning calendar/Godel/AI Notes/TC2000 copy cleanup | Focused tests passed 3 files / 28 tests; typecheck/build passed with the existing Vite large-chunk warning; browser smoke found no requested noisy phrases and no console/page errors. |
| A138 | Rubicon desktop/taskbar icon identity | Focused icon tests passed 1 file / 2 tests; shortcut reinstall/inspection confirmed Desktop and Start Menu shortcuts use `public\favicon.ico,0`; typecheck/build passed with the existing Vite large-chunk warning. |
| A137 | Replay/Daily Pull copy cleanup | Focused tests passed 9 files / 52 tests; typecheck/build passed with the existing Vite large-chunk warning; browser smoke found no targeted Replay/Daily Pull noisy phrases and no console/page errors. |
| A136 | Computer-level calendar notifications | Focused desktop-alert tests passed 1 file / 4 tests; typecheck/build passed with the existing Vite large-chunk warning; live `/api/desktop-alert/calendar` returned `ok` and screenshot `data\calendar-os-alert-api-wscript-check.png` showed the Windows popup. |
| A135 | Morning copy cleanup | Focused tests passed 4 files / 30 tests; typecheck/build passed with the existing Vite large-chunk warning; browser smoke found date-only heading, no targeted noisy phrases, clean console, and no overflow. |
| A134 | Pull Dates issue-count suppression | Typecheck passed; build passed with the existing Vite large-chunk warning. Browser automation was attempted but unavailable in this repo/session. |
| A133 | Delete old visible-screen Godel watcher | Focused Godel/Morning tests passed 4 files / 22 tests; typecheck/build passed; active-source watcher reference sweep was empty; temporary API smoke showed bridge status/setup live and deleted watcher endpoint returning 404. |
| A132 | TC2000 new-symbol highlighting | Focused Morning tests passed 2 files / 18 tests; typecheck/build passed; browser smoke found the TC2000 panel with no console/page errors and no horizontal overflow. |
| A131 | Spread Speed sidecar-only state | Focused Morning/Spread Speed/daily-sync/importer/summary tests passed 6 files / 62 tests; typecheck/build passed; first safe build for 2026-06-01 took 3.64s, cached read took 12ms, and live `/api/spread-speed` returned 390 frames in 26ms. |
| A130 | Replay safe state connected to sync-derived state | Focused importer/sync/summary tests passed 3 files / 42 tests; typecheck/build passed; first safe build for 2026-06-01 took 3.09s, cached read took 17ms, live steady `/api/replay` returned in 427ms. |
| A129 | Sync-completion state refresh and 8:30 Morning state refresh | Targeted tests passed 3 files / 19 tests; affected server/Morning tests passed 5 files / 35 tests; full Vitest passed 46 files / 242 tests; typecheck/build passed; desktop relaunch and live health/status probes passed. |
| A128 | Morning startup and tracker hot-path payload avoidance | Focused importer/summary tests passed 2 files / 31 tests; typecheck/build passed; one-off tracker probe returned in 30ms and live `/api/tracker` returned in 9ms; explicit Replay remains the next heavy path. |
| A127 | Morning saved-state reads and explicit live refresh | Focused Morning-state tests passed 2/2; Morning server/dashboard tests passed 16/16; full Vitest passed 45 files / 235 tests; typecheck/build passed; live `/api/morning` probes showed normal reads using saved state and `refresh=1` rewriting it. |
| A126 | Compact tracker serving summaries | Focused backend tests passed 3 files / 40 tests; typecheck passed; build passed; one-off loader probe returned June 1 with validated local option status/counts and about 1.2s load time. |
| A125 | Minimized-safe Godel DOM bridge | Focused bridge/Morning/Godel tests passed 3 files / 17 tests; typecheck passed; build passed; live bridge status/setup/ingest probes passed; numeric ladder ingest was rejected without creating a live Godel capture file. |
| A124 | Godel alert watcher controls and false-positive filtering | Focused Python watcher test, Morning/Godel Vitest files, typecheck, build, desktop relaunch, watcher status API, and live-update API passed. |
| A123 | Desktop launcher stale-server restart | `npm run desktop` launched a fresh Rubicon backend, health returned PID/start/appRoot, June 8 Morning excluded low-importance inflation expectations, syntax check/typecheck/build passed. |
| A122 | Daily Review exit action-side counting | Focused `src/stats.test.ts` passed 24 tests; `npm run typecheck` passed; `npm run build` passed with the existing Vite large-chunk warning. |
| A121 | High-importance calendar verification | Live DailyFX/IG feed and direct loader probe matched; focused tests passed 2 files / 13 tests; typecheck/build passed. |
| A120 | Daily sync progress reflected in Daily Pull | Wrapper run for 2026-06-01 completed with 75 fills, 31 spreads, 22 entries, 4,680 SPX 5s rows, 11 payload tabs, rebuilt `spx_daily_upload_2026-06-01.xlsx`, and 35/35 TC2000 daily bars. Daily Pull model shows `sync-run`, `payload`, `raw-workbook`, and `upload` complete, plus Required Output rows `payload-tabs`, `raw-workbook`, and `upload-receipt` complete. Focused tests, full tests (42 files / 202 tests), typecheck, and build passed. |
| A119 | Live-update word-filter desktop popups | Focused tests passed 3 files / 12 tests; typecheck/build passed; Browser smoke showed word-filter and alert controls with clean console. |

## Validation Ladder

Use the smallest relevant check:

| Change type | Minimum proof |
|---|---|
| Pure logic | Focused `npm run test -- path/to/test.ts` |
| Type or cross-file app change | Focused tests + `npm run typecheck` |
| Shipped frontend or CSS change | Focused tests if relevant + `npm run build` |
| UI behavior/layout change | Browser smoke on `http://[::1]:5174` after tests/build |
| Importer/data contract change | Focused importer tests + API smoke for `/api/tracker` |

## Browser Smoke Checklist

When Browser proof is worth the token cost, record only:

- URL tested.
- What visible behavior changed.
- Console warning/error status.
- Horizontal overflow status for the relevant viewport.
- Screenshot path only if a screenshot was explicitly useful.

## History Policy

Keep detailed historical proof in `WORKLOG.md`. This file should stay compact enough to read at the start of a task.
