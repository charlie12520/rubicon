# Proof Ledger

Compact validation proof for accepted merges. Only the merge agent edits this file.

This is the receipt file: it records the validation evidence that justified each accepted `MERGE-###`. Do not record every scratch run.

## Proof Entries

## MERGE-006 - 2026-06-13 - TASK-019 Live Board Sync Governance

Tasks: TASK-019
Validation: `git diff --check origin/main..HEAD`; targeted `rg` checks for `superseded`, `clean-equivalent`, `origin/main` merged-row wording, and old strict-only sync wording in `AGENTS.md`, `TASKS.md`, `tasks/rollup.md`, `merge_push.md`, and `codebase.md`.
Result: Accepted after integration into `agent/MERGE-006-task-019-live-board-sync`.
Evidence: TASK-019 commit `cb4eec5` merged cleanly into the MERGE-006 integration worktree from `origin/main`. The accepted docs preserve the clean-equivalent live-board sync path and add a second verified superseded-row path: push agents may sync dirty live board files only when every dirty task ID is already present as `merged` on `origin/main`, with no local-only task IDs, active unsuperseded rows, staged files, or non-board dirt.
Known gaps / failure class: No app tests or `npm run validate:mvp` were run at merge-branch acceptance time because this merge only changes Markdown governance/docs and does not touch shipped runtime behavior. The landing push path runs the configured validation before updating `origin/main`.

## MERGE-005 - 2026-06-13 - TASK-016 TASK-017 TASK-018 Shipped Behavior

Tasks: TASK-016, TASK-017, TASK-018
Validation: `npm run validate:mvp` with `SPX_GOOGLE_DRIVE_TRACKER_SNAPSHOT_PATH=C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\data\google-drive-tracker-snapshot.json` and `SPX_GOOGLE_RECEIPT_CHECKS_PATH=C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\data\google-drive-receipt-checks.json`; Browser smoke on scratch `http://127.0.0.1:5189/`; `Invoke-RestMethod http://127.0.0.1:5189/api/health`.
Result: Accepted after integration into `agent/MERGE-005-task-016-017-018`.
Evidence: TASK-016 commit `4c18f4f`, TASK-017 commit `d2cb268`, and TASK-018 commit `a7f07aa` were merged into the MERGE-005 integration worktree from `origin/main`. Full validation passed typecheck, lint, Vitest 98 files passed / 1 skipped with 632 passed tests / 9 skipped tests, and production build produced `dist/assets/index-D9VvzMSL.css` and `dist/assets/index-B8pizGRH.js` with the existing large-chunk warning. Browser smoke through the scratch Express server rendered the Rubicon shell, Morning surface, Dev branch badge, and no console errors; `/api/health` returned `ok:true` for scratch server PID `49516`, which was then stopped.
Known gaps / failure class: `npm ci` reported one existing high-severity advisory. TASK-018's task-branch full `npm test` gap was the known fresh-worktree Google snapshot/receipt evidence issue; MERGE-005 validation used explicit connector evidence paths and passed. No live `5174`, TWS, Godel, or Windows Task Scheduler changes were made.

## MERGE-004 - 2026-06-13 - TASK-013 TASK-014 TASK-015 Shipped Behavior

Tasks: TASK-013, TASK-014, TASK-015
Validation: `npm run validate:mvp` with `SPX_GOOGLE_DRIVE_TRACKER_SNAPSHOT_PATH=C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\data\google-drive-tracker-snapshot.json` and `SPX_GOOGLE_RECEIPT_CHECKS_PATH=C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\data\google-drive-receipt-checks.json`; Browser smoke on scratch `http://127.0.0.1:5189/`; `Invoke-RestMethod http://127.0.0.1:5189/api/health`; `npm run land -- --branch agent/MERGE-004-task-013-014-015` with the same connector evidence paths.
Result: Accepted after integration into `agent/MERGE-004-task-013-014-015`.
Evidence: TASK-013 commits `dd7ec1d` and `6cc6b4a`, TASK-014 commit `a2d395f`, and TASK-015 commit `9c82643` merged cleanly into the MERGE-004 integration worktree from `origin/main`. Full validation passed typecheck, lint, Vitest 97 files passed / 1 skipped with 623 passed tests / 9 skipped tests, and production build produced `dist/assets/index-D9VvzMSL.css` and `dist/assets/index-Bv91pNCU.js` with the existing large-chunk warning. Browser smoke through the scratch Express server rendered the Rubicon shell, Morning surface, 14 synced sessions, and 14 buttons with no console errors; `/api/health` returned `ok:true` for the scratch server PID `47156`, which was then stopped. Local landing validation also passed through the repository landing script.
Known gaps / failure class: The first bare worktree `npm run validate:mvp` failed in `server/dataImporter.test.ts` because the fresh worktree had no Google connector snapshot/receipt evidence files. Failure class: `environment`. The rerun with explicit visible-checkout connector evidence paths passed. TASK-013's external AI STUFF collector edits remain outside Rubicon git as documented by the section agent; the full wrapper exact run still depends on closed TWS/TC2000 state and was not rerun at merge time.

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
