# TASKS.md

Active Rubicon multi-agent board. Use this for parallel section work; do not use `WORKLOG.md` or
`naive_acceptance.md` as a scratchpad.

## Rules

- Refresh this file immediately before claiming or changing a task row.
- One section agent owns one `TASK-###` at a time.
- Section agents update task status, branch/worktree, touched files, validation proof, and merge notes here.
- If you edit outside the claimed section, write the file path and reason here immediately.
- Section agents do not claim new `A###` IDs and do not mark acceptance rows GREEN.
- The final merge agent assigns `A###` IDs only after integrating finished tasks and running the agreed validation.
- If a branch already contains a colliding `A###` row, the final merge agent renumbers or rewrites that row before landing it.
- Edit by anchored text, not line numbers. If this file changed since your read, re-read and re-apply.

## Status Values

| Status | Meaning |
|---|---|
| `open` | Ready to claim. |
| `claimed` | Agent has accepted the task but has not made meaningful changes yet. |
| `in_progress` | Agent is editing or validating. |
| `blocked` | Agent cannot continue without user input or an external state change. |
| `ready_for_merge` | Focused validation is recorded and the task is ready for the final merge agent. |
| `merged` | Final merge agent integrated the task into the landed branch. |
| `dropped` | User or merge agent intentionally chose not to land it. |

## Active Board

| Task | Section | Scope | Owner / branch / worktree | Status | Merge notes |
|---|---|---|---|---|---|
| TASK-001 | Governance | Multi-agent guardrails: worktree flow, landing scripts/hooks, build lock, Latest off-main behavior | Branch `agent/A196-multi-agent-safety`; worktree `..\rubicon-worktrees\agent-A196-multi-agent-safety` | merged | Landed to `origin/main` as A196 (`9f4439b`). |
| TASK-002 | Godel / Live Updates | Breaking-banner-only Godel watcher and reader test coverage | Branch `agent/A198-live-cleanup`; files `scripts/godel-news-scraper.mjs`, `scripts/godel-news-scraper.test.mjs`, `server/godelLiveNews.test.ts`, plus plan note | merged | Final merge agent renumbered the stale dirty A196 label to A199. |
| TASK-003 | Docs / Archive | Archive deprecated root docs and QA artifacts; refresh active references | Branch `agent/A198-live-cleanup`; docs/archive moves | merged | Final merge agent kept this as A197. |
| TASK-004 | Governance docs | Rewrite active Markdown copy for task-first section agents and final merge acceptance IDs | Branch `agent/A198-live-cleanup`; active docs + `TASKS.md` | merged | Final merge agent kept the user's A198 label and reconciled it with the already-landed A196 worktree/landing guardrails. |
| TASK-005 | Governance docs | Require explicit notes for out-of-section edits in task handoffs | Branch `agent/A198-live-cleanup`; active docs + `TASKS.md` | merged | Landed as A200 so overlap risks are visible before final merge. |

## Section Routing

Use these section labels when creating new tasks:

| Section | Likely files |
|---|---|
| Morning / Brief | `src/components/MorningDashboard.tsx`, `server/morningBrief.ts`, `server/morningMacroCalendar.ts`, `src/morning*.ts`, live-update helpers |
| Morning / Estimator | `src/components/LiveSpreadEstimatorPanel.tsx`, `src/expectedMoveCone.ts`, `src/spreadResponse.ts`, `src/portfolioResponse.ts`, `server/ibkrHoldings.ts` |
| Morning / Heatmap | `src/components/SpxHeatmapPanel.tsx`, `server/spxHeatmap*.ts`, `src/spxTreemap.ts`, `scripts/refresh-spx-heatmap.py` |
| Godel / Live Updates | `scripts/godel-news-scraper.mjs`, `server/godelLiveNews.ts`, `server/morningBrief.ts`, live-update display/filter modules |
| Replay cockpit | `src/App.tsx`, `src/components/ReplayCharts.tsx`, `src/components/MarketChart.tsx`, replay helpers |
| Daily Pull / Sync | `server/dailySync*.ts`, `src/dailySync*.ts`, `src/dailyPull*.ts`, sibling `..\IBKR Equity History Pull` wrapper |
| Daily Review / Journal | `src/App.tsx`, `src/dailyReview*.ts`, `src/tradeJournal.ts`, review chart components |
| Rotation / RRG | `src/components/RrgPanel.tsx`, `src/relativeRotation.ts`, `server/rrgBars.ts`, `scripts/refresh-sector-rrg.py` |
| Self-update / Desktop | `server/selfUpdate.ts`, `src/components/AppUpdateButton.tsx`, `scripts/launch-desktop.*`, `scripts/serve-headless.*` |
| Docs / Governance | `AGENTS.md`, `CLAUDE.md`, `TASKS.md`, `WORKLOG.md`, `naive_acceptance.md`, `naive_validation.md`, `DECISIONS.md`, maps |

## Task Template

Copy this row pattern into `Active Board` for new work:

```md
| TASK-### | Section | One-sentence scope | Owner / branch / worktree | open | Constraints, expected validation, or merge notes |
```

Optional per-task note, if the task is large:

```md
## TASK-### - Short Title

Owner:
Branch / worktree:
Status:
Scope:
Out of scope:
Files touched:
Out-of-section changes:
Validation:
Merge notes:
Blockers:
```

## Final Merge Checklist

The final merge agent should:

1. Re-read `TASKS.md`, `WORKLOG.md` top, and `naive_acceptance.md` yaml.
2. Inspect each `ready_for_merge` branch/worktree and confirm its focused validation.
3. Review `Out-of-section changes` before landing.
4. Merge or cherry-pick only intentional files.
5. Resolve conflicts and duplicate/colliding `A###` wording.
6. Run the validation ladder appropriate to the integrated diff.
7. Assign final `A###` IDs, update `naive_acceptance.md`, prepend `WORKLOG.md`, and add compact proof to `naive_validation.md`.
8. Mark integrated tasks `merged` with the final acceptance ID.
