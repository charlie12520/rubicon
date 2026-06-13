Rubicon sections:
- Brief: morning brief, calendars, news, AI notes. Start with `src/components/MorningDashboard.tsx`, `server/morningBrief.ts`, `server/morningMacroCalendar.ts`, `server/godelLiveNews.ts`.
- Signal Stack: FPL, live bars, spread speed, holdings/signal inputs. Start with `src/components/FplIndicatorPanel.tsx`, `src/components/SpreadSpeedPanel.tsx`, `server/fpl*.ts`, `server/spxLiveBars.ts`, `server/spreadSpeed*.ts`.
- Estimator: live spread estimator and what-if math. Start with `src/components/LiveSpreadEstimatorPanel.tsx`, `src/components/SpreadResponsePanel.tsx`, `src/expectedMoveCone.ts`, `src/spreadResponse.ts`, `src/portfolioResponse.ts`, `server/ibkrHoldings.ts`.
- Heatmap: SPX/QQQ heatmap UI, live feed, treemap math. Start with `src/components/SpxHeatmapPanel.tsx`, `server/spxHeatmap*.ts`, `src/spxTreemap.ts`, `scripts/refresh-spx-heatmap.py`.
- Daily Pull: daily sync, Source State, import/ingest/upload pipeline. Start with `server/dailySync*.ts`, `src/dailySync*.ts`, `src/dailyPull*.ts`, `server/dataImporter.ts`, `scripts/rubicon-ingest-daily.ts`.
- Replay: replay cockpit, charts, marks. Start with `src/App.tsx`, `src/components/ReplayCharts.tsx`, `src/components/MarketChart.tsx`, replay helpers, `server/dataImporter.ts`.
- Daily Review: review screen, notes, flags, review charts. Start with `src/App.tsx`, `src/dailyReview*.ts`, `src/components/ReviewEntryExitChart.tsx`, `server/dataImporter.ts`.
- Journal: trade journal entries and snapshots. Start with `src/tradeJournal.ts`, `server/tradeJournalSnapshot.ts`, `src/App.tsx`.
- Rotation: RRG and relative strength. Start with `src/components/RrgPanel.tsx`, `src/relativeRotation.ts`, `server/rrgBars.ts`, `scripts/refresh-sector-rrg.py`.

Servers:
- Dev: `npm run dev` starts Vite on `5173` and API on `5174`; `/api` is proxied.
- Live app/API is usually `http://127.0.0.1:5174`; do not reuse it for scratch checks.
- If the installed desktop app says "refused to connect", use `docs/runbooks/rubicon-server-recovery.md` to recover the live server without repo edits, task creation, branch changes, or touching TWS/Godel/live feed processes.
- Scratch verification server: use `127.0.0.1` on ports `5189-5199`, build first if UI is needed, and kill only the exact PID you started.
- Browser proof uses `playwright-core` with Edge; keep temporary scripts inside the repo so module resolution works.

Doc map:
- `AGENTS.md` - standing rules and section-agent workflow
- `acceptance.md` - final accepted-work verdict ledger
- `codebase.md` - file anchors and server/run basics
- `merge_push.md` - merge or push workflow only, including safe visible-checkout sync when dirty live board files already match `origin/main` or are verified as superseded by `origin/main` merged rows
- `proof.md` - compact proof ledger for accepted merges
- `TASKS.md` - authoritative live multi-agent board only in the visible local Rubicon checkout; branch/worktree copies are snapshots or proposed state
- `tasks/rollup.md` - visible-checkout compact live task detail companion to `TASKS.md`; branch/worktree copies may be stale snapshots
- `memory/general.md` - shared project memory
- `memory/<section>.md` - section-specific project memory
- `DECISIONS.md` - original unsorted decision log
- `validation.md` - concise validation selector
- `docs/runbooks/rubicon-server-recovery.md` - no-edit runtime procedure for restoring the live `127.0.0.1:5174` Rubicon server after a refused-to-connect app window

If these anchors are not enough, use `detailedcodebase.md` before broad searching.

For pure logic changes, prefer co-located `*.test.ts(x)`; display-only components may use build/browser proof.
