# Proof Ledger

Compact validation proof for accepted merges. Only the merge agent edits this file.

This is the receipt file: it records the validation evidence that justified each accepted `MERGE-###`. Do not record every scratch run.

## Proof Entries

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
