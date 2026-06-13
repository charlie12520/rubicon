# TASKS.md

Active Rubicon multi-agent board. Keep this file spreadsheet-like and short.

Use `TASKS.md` for live task status. Use `tasks/rollup.md` for compact task-owned details. Do not use `WORKLOG.md`, `acceptance.md`, or `proof.md` as scratchpads.

## Rules

- Refresh this file from disk immediately before creating or editing a task row.
- Use the `TASK-###` ID from the user's prompt. If the prompt has no task ID, ask instead of inventing one.
- One section agent owns one active task row at a time.
- Keep rows short: task, section, scope, owner/branch/worktree, status, merge notes.
- A section agent may edit only its own task row and its own `tasks/rollup.md` row.
- If work is related to another task, mention `Related: TASK-###` in merge notes instead of editing the other task.
- If any file outside the assigned section changes, note the path and reason in the task's `tasks/rollup.md` row.
- Commit only if the user asks, and ask for confirmation before committing.
- Merge agents assign `MERGE-###` IDs in `acceptance.md` after integration and validation.

## Status Values

| Status | Meaning |
|---|---|
| `open` | Ready to claim. |
| `claimed` | Agent accepted the task but has not made meaningful changes yet. |
| `in_progress` | Agent is editing or validating. |
| `blocked` | Agent cannot continue without user input or an external state change. |
| `ready_for_commit` | Work is validated or the gap is documented; user must approve commit. |
| `ready_for_merge` | Committed task branch/worktree is ready for the merge agent. |
| `merged` | Merge agent integrated the task into the landed branch. |
| `dropped` | User or merge agent intentionally chose not to land it. |

## Active Board

| Task | Section | Scope | Owner / branch / worktree | Status | Merge notes |
|---|---|---|---|---|---|
| TASK-001 | Governance | Multi-agent guardrails: worktree flow, landing scripts/hooks, build lock, Latest off-main behavior | Legacy landed branch; no active worktree | merged | Landed before `MERGE-###`; see `WORKLOG.md`. |
| TASK-002 | Brief / Godel live news | Breaking-banner-only Godel watcher and reader test coverage | Landed before compact rollup; no active owner | merged | Already landed; do not re-merge. Compact detail is in `tasks/rollup.md`. |
| TASK-003 | Docs / Archive | Archive deprecated root docs and QA artifacts; refresh active references | Legacy landed branch; no active worktree | merged | Landed before `MERGE-###`; see `WORKLOG.md`. |
| TASK-004 | Docs / Governance | Rewrite active Markdown copy for task-first section agents and final merge IDs | Legacy landed branch; no active worktree | merged | Landed before `MERGE-###`; see `WORKLOG.md`. |
| TASK-005 | Docs / Governance | Require explicit notes for out-of-section edits in task handoffs | Legacy landed branch; no active worktree | merged | Landed before `MERGE-###`; see `WORKLOG.md`. |
| TASK-007 | General / Docs and Runtime | Deprecate old AI STUFF Rubicon folders and update mirror env defaults; strengthen acceptance/validation proof rules | Branch `agent/TASK-007-docs-runtime`; current Desktop mirror | ready_for_commit | New acceptance evidence-standard and validation failure-classification doc changes are validated; user approval needed before commit. |

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
