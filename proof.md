# Proof Ledger

Compact validation proof for accepted merges. Only the merge agent edits this file.

This is the receipt file: it records the validation evidence that justified each accepted `MERGE-###`. Do not record every scratch run.

## Proof Entries

## MERGE-003 - 2026-06-13 - TASK-011 TASK-012 Docs

Tasks: TASK-011, TASK-012
Validation: `git diff --check origin/main..HEAD`; `git diff --check AGENTS.md TASKS.md tasks/rollup.md merge_push.md codebase.md README.md docs/runbooks/rubicon-server-recovery.md acceptance.md proof.md WORKLOG.md memory/general.md`; targeted `rg` checks for live-board sync wording, commit-default wording, server recovery/runbook safety wording, and removed commit-approval contradictions.
Result: Accepted after integration into `agent/MERGE-003-task-011-012-docs`.
Evidence: TASK-011 commit `c548ef1` and TASK-012 commit `bab2522` merged cleanly into the MERGE-003 integration worktree from `origin/main`. TASK-011 documents the safe post-push visible-checkout sync case when only live board files are dirty and already match `origin/main`, and clarifies that agents commit validated task work by default unless the user explicitly says not to or validation has a blocking gap. TASK-012 adds the no-edit live Rubicon server recovery runbook for refused-to-connect cases, including health checks, PID/log discovery, launcher use, and explicit protection for TWS, Godel, Edge, and live feed processes.
Known gaps / failure class: No app tests or `npm run validate:mvp` were run at merge-branch acceptance time because this merge only changes Markdown governance/docs and does not touch shipped runtime behavior. The landing push path runs the configured validation before updating `origin/main`.

## MERGE-002 - 2026-06-13 - TASK-010 Live Rollup Coordination

Tasks: TASK-010
Validation: `git diff --check AGENTS.md TASKS.md tasks/rollup.md merge_push.md codebase.md`; `git diff --check origin/main..HEAD`; `rg -n "visible local Rubicon checkout|live coordination|worktree copies|stale snapshots|TASKS.md|tasks/rollup.md" AGENTS.md TASKS.md tasks/rollup.md merge_push.md codebase.md`; old-ambiguity `rg` check for `Maintain the task's own row...` and `Work only inside.*worktree`.
Result: Accepted after integration into `agent/MERGE-002-task-010-live-rollup-coordination`.
Evidence: TASK-010 commit `391f233` merged cleanly into the MERGE-002 integration worktree from `origin/main`. The accepted docs make the visible local Rubicon checkout's `TASKS.md` and `tasks/rollup.md` authoritative live coordination files, identify worktree copies as stale/proposed snapshots, tighten merge handling so stale task-branch ledgers cannot overwrite live coordination rows, and refresh the codebase map.
Known gaps / failure class: No app tests or `npm run validate:mvp` were run because the merge only changes Markdown governance/docs and does not touch shipped runtime behavior. Failure class: none.

## MERGE-001 - 2026-06-13 - TASK-007 Docs/Runtime Merge

Tasks: TASK-007
Validation: `git diff --check origin/main..HEAD`; `git diff --check`; `node --check scripts/mirror-env.mjs`; `node --check scripts/launch-desktop.mjs`; `node --check scripts/serve-headless.mjs`; `npm run test -- server/dataImporter.test.ts` with Desktop AI STUFF mirror evidence paths; `npm run validate:mvp` with the same mirror evidence paths; `npm run land -- --branch agent/MERGE-001-task-007-docs-runtime`.
Result: Accepted after integration into `agent/MERGE-001-task-007-docs-runtime`.
Evidence: TASK-007 merged cleanly into an integration worktree from `origin/main` at `8d94eba`; late ready-for-merge marker `ec70b61` was absorbed with a content-preserving merge because MERGE-001 already superseded it with `merged` ledger rows; focused data importer proof passed 30/30; full `validate:mvp` passed typecheck, lint, 597 tests, and build.
Known gaps / failure class: Initial bare fresh-worktree validation failed in `server/dataImporter.test.ts` because the worktree had no Google connector snapshot/receipt files and no `SPX_GOOGLE_*` mirror paths. Failure class: `environment`. Rerun with the Desktop AI STUFF mirror evidence paths passed.
