# VALIDATION.md

> Restoration note: the exact pre-compaction file was not recoverable in this non-git workspace. The compact replacement was preserved as `naive_validation.md`; this canonical file was rebuilt into the prior detailed style from `WORKLOG.md` and current evidence.

## Main Validation Command

```bash
npm run validate:mvp
```

This runs:

1. `npm run typecheck`
2. `npm run test`
3. `npm run build`

## Actual Repo Commands

Package manager:
- npm

Install:
- `npm install`

Run dev server:
- `npm run dev`

API:
- `http://[::1]:5174` when another local project occupies `127.0.0.1:5174`

Web:
- `http://[::1]:5173` in dev, proxying `/api` to `http://[::1]:5174`

Database/init:
- none; local-first CSV/JSON importer

Seed/demo data:
- real AI STUFF archive at `..\IBKR Equity History Pull\data\ibkr_trades`

Typecheck:
- `npm run typecheck`

Unit tests:
- `npm run test`

Production build:
- `npm run build`

## Latest Validation - 2026-06-02 A120

Commands:
- `npm run test -- server/morningBrief.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`
- `npm run validate:mvp`
- Browser plugin QA against `http://[::1]:5174/?qa=calendar-split-high-only`

Result:
- GREEN for A120; full-suite importer data-drift maintenance remains separate from this change.

Proof:
- App proof: `src\components\MorningDashboard.tsx` renders `.morning-calendar-body` with today's event list first and Major events second. CSS splits that body into equal desktop columns and stacks it on narrow viewports.
- Parser proof: `server\morningBrief.ts` filters Major events to DailyFX/IG rows with `importance >= 3`, while preserving native monthly OPEX markers. `shared\types.ts` narrows `MorningMajorEvent.impact` to `high | market`.
- Test proof: focused tests passed 2 files / 12 tests. The parser test first failed on medium-importance JOLTs before the filter change, then passed while preserving June 19 OPEX; the component test verifies the agenda-left/major-right DOM structure.
- Browser proof: desktop viewport rendered equal `602px 602px` calendar columns, with Major events on the same row to the right of today's agenda, no medium major text, and empty browser warning/error logs. The 412px viewport stacked the sections with no horizontal overflow. Document-level desktop overflow remains caused by existing TC2000 chart popovers rendered offscreen, not the calendar section.
- Validation: typecheck passed; build passed with the existing Vite large-chunk warning.

Known caveat:
- `npm run validate:mvp` still fails only on unrelated `server\dataImporter.test.ts` live-data drift: connector snapshot count is now 5 instead of 4, and latest trade date is `2026-06-01` instead of the old `2026-05-29` expectation.

## Previous Validation - 2026-06-02 A119

Commands:
- `npm run test -- src/liveUpdateAlerts.test.ts`
- `npm run test -- src/liveUpdateAlerts.test.ts src/liveUpdateFilters.test.ts src/components/MorningDashboard.test.tsx`
- `npm run typecheck`
- `npm run build`
- Browser plugin QA against `http://[::1]:5174/?qa=live-update-desktop-alert-smoke`

Result:
- GREEN for A119.

Proof:
- Existing-feature check: Morning live-update word filters already parsed/deduped terms, highlighted matching rows, and beeped for new matching updates, but only calendar alerts called the Windows desktop popup helper.
- App proof: `src\liveUpdateAlerts.ts` builds a readable desktop alert payload from the first new matching live update, includes matched filter terms plus source/time/count detail, and dispatches one grouped desktop alert per matching refresh batch. `MorningDashboard` calls that dispatcher alongside the existing live-update beep path, using the same local desktop alert endpoint as calendar alerts.
- Test proof: focused live-update alert tests passed 3 cases for readable payloads, silent empty batches, and one desktop notification per matching batch. Existing live-update filter tests and MorningDashboard calendar layout tests still passed.
- Browser proof: Rubicon loaded on `http://[::1]:5174`, Morning rendered with the word-filter control, live alert button, and calendar alert controls; console warning/error logs were empty; the default viewport had no horizontal overflow.
- Validation: focused tests passed 12 tests across 3 files; typecheck passed; build passed with only the existing Vite large-chunk warning.

## Previous Validation - 2026-06-02 A118

Commands:
- `npm run test -- server/morningBrief.test.ts src/morningLiveState.test.ts`
- `npm run typecheck`
- `npm run build`
- API timing: `GET http://[::1]:5174/api/morning?date=2026-06-02&refresh=*`
- Browser plugin QA against `http://[::1]:5174/?qa=morning-fast-refresh`

Result:
- GREEN for A118.

Proof:
- Root cause: full Morning refresh waited on `readFirstSquawkSource()` and `readGodelLiveNewsSource()` inside `loadMorningBrief()`. FirstSquawk currently returns `fetch failed`, so the app tried Nitter timeline plus RSS fallback with 12-second fetch windows, making calendar refresh take about 21.8 seconds.
- App proof: `loadMorningBrief()` now loads DailyFX, major events, RollCall, TC2000, and the last-good live-update cache only. FirstSquawk/Godel network pulls run through `/api/morning/live-updates` separately, and the Morning UI starts that live refresh in the background while preventing overlapping 10-second live requests.
- Timeout proof: FirstSquawk timeline/RSS attempts now use `RUBICON_LIVE_FEED_FETCH_TIMEOUT_MS`, defaulting to 3.5 seconds instead of the 12-second calendar/source timeout.
- Timing proof: after the patch, `/api/morning` took about 1.7s; live updates were isolated at about 7.1s during the current Nitter failure.
- Browser proof: Morning rendered calendar/TC2000/cache source pills before the live network warning arrived; after the background live refresh completed, FirstSquawk showed its warning without blocking the Calendar panel. Console warnings/errors were empty and the 427px viewport had no horizontal overflow.

## Previous Validation - 2026-06-02 A117

Commands:
- `npm run test -- src/replayDateTabs.test.ts`
- `npm run typecheck`
- `npm run build`
- Browser plugin QA against `http://localhost:5174/?qa=hide-retired-replay-dates`
- API smoke: `GET http://localhost:5174/api/tracker`

Result:
- GREEN for A117.

Proof:
- `src\replayDateTabs.ts` filters `2026-05-26` and `2026-05-27` from display-only Replay date tabs. No importer, archive, or server delete path changed.
- Test proof verifies hidden display list and non-mutated source `availableDates`.
- API proof still returned both dates in `availableDates`, confirming data was not deleted.

## Validation Ladder

### Importer/model change

Run:

1. `npm run test`
2. `npm run typecheck`
3. API smoke: `GET http://[::1]:5174/api/tracker`

### User workflow change

Run:

1. Focused tests for changed logic
2. `npm run typecheck`
3. Browser smoke on `http://[::1]:5174`

### Styling/responsive change

Run:

1. `npm run build`
2. Browser desktop check
3. Browser mobile check for horizontal overflow
4. Console warning/error check

### End-to-end milestone

Run:

1. `npm run validate:mvp`
2. API health check
3. Browser desktop interaction loop
4. Browser mobile responsive loop

## Failure Classification

Classify failures as one of:

- install
- compile
- typecheck
- lint
- runtime
- import
- test
- browser
- dependency
- environment
- product ambiguity

If the same failure class blocks the same acceptance criterion twice, stop and write options in `WORKLOG.md`.
