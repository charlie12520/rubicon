# Acceptance Ledger

Final verdict ledger for merged work. Only the merge agent edits this file.

New merge numbering starts at `MERGE-001`. The merge agent assigns the next `MERGE-###` from this file and updates `Latest accepted merge` every time.

Do not add an accepted entry until the task work is merged and validation is sufficient. If validation is incomplete, record the gap in the task file and ask the user before accepting it.

## Current State

Status:
Latest accepted merge: MERGE-004
Open risks: None
Deferred: None

## Status Values

- `accepted`: merged, validated, and no blocking risk remains.
- `accepted_with_risk`: merged and usable, with a named non-blocking risk.
- `deferred`: not accepted in this merge; explicitly left for later.

## Accepted Work

Accepted merge rows are newest-first: add each new `MERGE-###` row directly below the table header.

| Merge | Date | Tasks | Status | Proof |
|---|---|---|---|---|
| MERGE-004 | 2026-06-13 | TASK-013, TASK-014, TASK-015 | accepted | `npm run validate:mvp` with connector evidence paths; browser smoke on scratch `127.0.0.1:5189` plus `/api/health`; local landing via `npm run land -- --branch agent/MERGE-004-task-013-014-015`; see `proof.md#merge-004-2026-06-13-task-013-task-014-task-015-shipped-behavior`. |
| MERGE-003 | 2026-06-13 | TASK-011, TASK-012 | accepted | `git diff --check origin/main..HEAD`; targeted `rg` checks for live-board sync, commit-default wording, and server recovery safety/runbook terms; see `proof.md#merge-003-2026-06-13-task-011-task-012-docs`. |
| MERGE-002 | 2026-06-13 | TASK-010 | accepted | `git diff --check AGENTS.md TASKS.md tasks/rollup.md merge_push.md codebase.md`; `git diff --check origin/main..HEAD`; requested coordination-text `rg` checks for live/stale wording and old ambiguity; see `proof.md#merge-002-2026-06-13-task-010-live-rollup-coordination`. |
| MERGE-001 | 2026-06-13 | TASK-007 | accepted | `git diff --check origin/main..HEAD`; `node --check` for mirror/startup scripts; `npm run validate:mvp` with Desktop AI STUFF mirror evidence paths; local landing validation via `npm run land -- --branch agent/MERGE-001-task-007-docs-runtime`; see `proof.md#merge-001-2026-06-13-task-007-docsruntime-merge`. |

## Evidence Standard

An accepted merge must cite concrete evidence, not vague "validated" wording.

The `Proof` column must include or link to at least one relevant proof type:

- passed command, such as focused tests, `npm run typecheck`, `npm run build`, or `npm run validate:mvp`
- passed test result, including the test file or suite when focused
- API or browser smoke result for runtime/UI behavior
- data/file evidence for importer, sync, replay, or local-state changes
- artifact path, screenshot path, or log path when visual/runtime proof matters
- explicit documented deferral or accepted non-blocking risk

Use the narrowest proof that can catch the likely failure. Follow `validation.md`; keep compact merge receipts in `proof.md`.

Do not accept a merge when proof only says "validated", "tested", "looks good", or "works" without naming the evidence.
