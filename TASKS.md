# TASKS.md

Active Rubicon multi-agent board. Keep this file spreadsheet-like and short. The copy at `C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\TASKS.md` in the visible local Rubicon checkout is the live board; branch/worktree copies are proposed branch state or stale snapshots for coordination.

Use the visible checkout `TASKS.md` for live task status. Use the visible checkout `tasks/rollup.md` for compact task-owned details. Do not use `WORKLOG.md`, `acceptance.md`, or `proof.md` as scratchpads.

## Rules

- Refresh the visible checkout copy of this file from disk immediately before creating or editing a task row.
- Use the `TASK-###` ID from the user's prompt. If the prompt has no task ID, ask instead of inventing one.
- One section agent owns one active task row at a time.
- Keep rows short: task, section, scope, owner/branch/worktree, status, merge notes.
- A section agent may edit only its own visible checkout task row and its own visible checkout `tasks/rollup.md` row.
- Before editing live rows, run `git -C C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker status --porcelain=v1 --branch`; stop if unrelated dirty files exist.
- If only `TASKS.md` / `tasks/rollup.md` are dirty, inspect `git -C C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker diff -- TASKS.md tasks/rollup.md` and edit only the current task row.
- After push, live board dirt is sync-safe only when `TASKS.md` / `tasks/rollup.md` already match `origin/main`, or when `merge_push.md` proves every dirty row is superseded by an `origin/main` `merged` row for the same task ID; otherwise it is unlanded live coordination state.
- If work is related to another task, mention `Related: TASK-###` in merge notes instead of editing the other task.
- If any file outside the assigned section changes, note the path and reason in the task's `tasks/rollup.md` row.
- Active Board rows are newest-first: add new task rows directly below the table header, above older task rows.
- After validation passes, stage explicit intended files and commit the task branch/worktree by default unless the user explicitly says not to commit or validation documents a blocking gap.
- Merge agents assign `MERGE-###` IDs in `acceptance.md` after integration and validation.

## Status Values

| Status | Meaning |
|---|---|
| `open` | Ready to claim. |
| `claimed` | Agent accepted the task but has not made meaningful changes yet. |
| `in_progress` | Agent is editing or validating. |
| `blocked` | Agent cannot continue without user input or an external state change. |
| `ready_for_commit` | Work is validated or the gap is documented, but commit is intentionally withheld because the user explicitly said not to commit yet, a commit is blocked, or the work cannot be committed safely. |
| `ready_for_merge` | Committed task branch/worktree is ready for the merge agent. |
| `merged` | Merge agent integrated the task into the landed branch. |
| `dropped` | User or merge agent intentionally chose not to land it. |

## Active Board

| Task | Section | Scope | Owner / branch / worktree | Status | Merge notes |
|---|---|---|---|---|---|
| TASK-019 | Docs / Governance | Allow push agents to sync visible checkout live-board rows superseded by `origin/main` merged rows | Branch `agent/TASK-019-superseded-live-board-sync`; worktree `../rubicon-worktrees/agent-TASK-019-superseded-live-board-sync`; commit `cb4eec5` | merged | Accepted in `MERGE-006`; validation and proof recorded in `proof.md`. |
| TASK-018 | Self-update / Desktop | Automatically check git upstream availability so the Latest button reflects when a new version is available | Branch `agent/TASK-018-latest-git-check`; worktree `../rubicon-worktrees/agent-TASK-018-latest-git-check`; commit `a7f07aa` | merged | Accepted in `MERGE-005`; validation and proof recorded in `proof.md`. |
| TASK-017 | Daily Pull | Cancel automated and manual daily pulls when IBKR workstation is not activated, and notify the user | Branch `agent/TASK-017-ibkr-activation-gate`; worktree `../rubicon-worktrees/agent-TASK-017-ibkr-activation-gate`; commit `d2cb268` | merged | Accepted in `MERGE-005`; validation and proof recorded in `proof.md`. Related: TASK-015 auto-run inherits the shared `startDailySync` guard. |
| TASK-016 | Daily Review | Add report-only historical PnL audit for Daily Review against local IBKR archive | Branch `agent/TASK-016-daily-review-pnl-audit`; worktree `../rubicon-worktrees/agent-TASK-016-daily-review-pnl-audit`; commit `4c18f4f` | merged | Accepted in `MERGE-005`; validation and proof recorded in `proof.md`. |
| TASK-015 | Daily Pull | Auto-run the full Rubicon daily pipeline at 4:15 PM ET on weekdays | Branch `agent/TASK-015-daily-pipeline-auto-run`; worktree `../rubicon-worktrees/agent-TASK-015-daily-pipeline-auto-run` | merged | Accepted in `MERGE-004` from commit `9c82643`; validation and proof recorded in `proof.md`. |
| TASK-014 | Replay / Journal | Add after-close journal-review reminder and default-on guided journal Q/A flow | Branch `agent/TASK-014-journal-review-reminder`; worktree `../rubicon-worktrees/agent-TASK-014-journal-review-reminder`; commit `a2d395f` | merged | Accepted in `MERGE-004`; validation and proof recorded in `proof.md`. |
| TASK-013 | Daily Pull / Replay / Daily Review | Allow clean no-execution days to publish market-data-only SPX review and preflight Rubicon source root | Branch `agent/TASK-013-market-data-only-review`; worktree `../rubicon-worktrees/agent-TASK-013-market-data-only-review`; commits `dd7ec1d`, `6cc6b4a` | merged | Accepted in `MERGE-004`; validation and proof recorded in `proof.md`. |
| TASK-012 | Docs / Governance | Add a no-edit live Rubicon server recovery runbook for refused-to-connect cases | Branch `agent/TASK-012-server-recovery-runbook`; commit `bab2522`; merged by `agent/MERGE-003-task-011-012-docs` | merged | Accepted in `MERGE-003`; validation and proof recorded in `proof.md`. |
| TASK-011 | Docs / Governance | Allow push agents to sync visible checkout when only live board files are dirty and already match `origin/main` | Branch `agent/TASK-011-live-board-sync`; commit `c548ef1`; merged by `agent/MERGE-003-task-011-012-docs` | merged | Accepted in `MERGE-003`; validation and proof recorded in `proof.md`. |
| TASK-010 | Docs / Governance | Make visible-checkout `TASKS.md` and `tasks/rollup.md` the live coordination source; clarify stale worktree snapshot handling | Branch `agent/TASK-010-live-rollup-coordination`; commit `391f233`; merged by `agent/MERGE-002-task-010-live-rollup-coordination` | merged | Accepted in `MERGE-002`; validation and proof recorded in `proof.md`. |
| TASK-007 | General / Docs and Runtime | Deprecate old AI STUFF Rubicon folders and update mirror env defaults; strengthen acceptance/validation proof rules; add newest-first table rules | Branch `agent/TASK-007-docs-runtime`; merged by `agent/MERGE-001-task-007-docs-runtime` | merged | Accepted in `MERGE-001`; validation and proof recorded in `proof.md`. |
| TASK-001 | Governance | Multi-agent guardrails: worktree flow, landing scripts/hooks, build lock, Latest off-main behavior | Legacy landed branch; no active worktree | merged | Landed before `MERGE-###`; see `WORKLOG.md`. |
| TASK-002 | Brief / Godel live news | Breaking-banner-only Godel watcher and reader test coverage | Landed before compact rollup; no active owner | merged | Already landed; do not re-merge. Compact detail is in `tasks/rollup.md`. |
| TASK-003 | Docs / Archive | Archive deprecated root docs and QA artifacts; refresh active references | Legacy landed branch; no active worktree | merged | Landed before `MERGE-###`; see `WORKLOG.md`. |
| TASK-004 | Docs / Governance | Rewrite active Markdown copy for task-first section agents and final merge IDs | Legacy landed branch; no active worktree | merged | Landed before `MERGE-###`; see `WORKLOG.md`. |
| TASK-005 | Docs / Governance | Require explicit notes for out-of-section edits in task handoffs | Legacy landed branch; no active worktree | merged | Landed before `MERGE-###`; see `WORKLOG.md`. |

## Section Routing

Use these section labels when creating new tasks:

| Section | Likely files |
|---|---|
| Brief | `src/components/MorningDashboard.tsx`, `server/morningBrief.ts`, `server/morningMacroCalendar.ts`, `server/godelLiveNews.ts` |
| Signal Stack | `src/components/FplIndicatorPanel.tsx`, `src/components/SpreadSpeedPanel.tsx`, `server/fpl*.ts`, `server/spxLiveBars.ts`, `server/spreadSpeed*.ts` |
| Estimator | `src/components/LiveSpreadEstimatorPanel.tsx`, `src/expectedMoveCone.ts`, `src/spreadResponse.ts`, `src/portfolioResponse.ts`, `server/ibkrHoldings.ts` |
| Heatmap | `src/components/SpxHeatmapPanel.tsx`, `server/spxHeatmap*.ts`, `src/spxTreemap.ts`, `scripts/refresh-spx-heatmap.py` |
| Daily Pull | `server/dailySync*.ts`, `src/dailySync*.ts`, `src/dailyPull*.ts`, `server/dataImporter.ts`, `scripts/rubicon-ingest-daily.ts` |
| Replay | `src/App.tsx`, `src/components/ReplayCharts.tsx`, `src/components/MarketChart.tsx`, replay helpers, `server/dataImporter.ts` |
| Daily Review | `src/App.tsx`, `src/dailyReview*.ts`, `src/components/ReviewEntryExitChart.tsx`, `server/dataImporter.ts` |
| Journal | `src/tradeJournal.ts`, `server/tradeJournalSnapshot.ts`, `src/App.tsx` |
| Rotation | `src/components/RrgPanel.tsx`, `src/relativeRotation.ts`, `server/rrgBars.ts`, `scripts/refresh-sector-rrg.py` |
| Self-update / Desktop | `server/selfUpdate.ts`, `src/components/AppUpdateButton.tsx`, `scripts/launch-desktop.*`, `scripts/serve-headless.*` |
| Docs / Governance | `AGENTS.md`, `CLAUDE.md`, `TASKS.md`, `tasks/rollup.md`, `acceptance.md`, `proof.md`, `validation.md`, `merge_push.md`, docs maps |

## New Row Pattern

```md
| TASK-### | Section | One-sentence scope | Owner / branch / worktree | open | Constraints, expected validation, or merge notes |
```
