# Merge / Push Workflow

Use this only when the user asks to merge or push. Read only the relevant section: `Merge` for merge-only work, `Push` for push-only work, and both sections when the user asks for both.

## Merge

Do not merge by checking out `main` in the live folder. The landing script uses a temporary integration worktree.
Do not sweep unrelated dirty files.
Do not hide duplicate task wording, stale task IDs, or colliding final acceptance rows.
Live `TASKS.md` and `tasks/rollup.md` rows are selection inputs from the visible local Rubicon checkout at `C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker`, not from task branch/worktree copies.
Do not add to, summarize, rewrite, or delete rollup entries. If rollup conflicts appear during integration, preserve every section-agent entry.
Do not let stale task-branch copies of `TASKS.md` or `tasks/rollup.md` overwrite live coordination rows.
Do not use `memory/*.md` for raw task notes, validation proof, or low-level change logs.
Only the merge agent writes `WORKLOG.md` summaries. It may use subagents if useful.
`WORKLOG.md` remains a polished summary, not a raw ledger.
The merge agent may edit and reorganize `memory/*.md` only for high-level decisions or durable project memory, after verifying every change.
The merge agent may update `validation.md` only when the validation policy itself needs to change.
During integration, preserve live rows and reconcile only the accepted final ledger state into the final merge branch.

1. Read fresh from the visible local Rubicon checkout: `AGENTS.md`, `codebase.md`, `validation.md`, `acceptance.md`, `proof.md`, live `TASKS.md`, live `tasks/rollup.md`, the top of `WORKLOG.md`, and the relevant `memory/*.md`.
2. Select live `TASKS.md` rows with status `ready_for_merge`, unless the user names specific task IDs.
3. For each selected task, inspect the live `TASKS.md` row and matching live `tasks/rollup.md` row for branch/worktree, commit hash or merge note, files changed, validation, blockers/risks, merge notes, and `Out-of-section changes`. Skip tasks with blockers, missing commits, or missing validation unless the user explicitly approves.
4. Create or use one final merge branch/worktree from `origin/main`; this is the only branch that receives selected task work.
5. For each selected task, run `git status` in its task worktree, then integrate it into the final merge branch/worktree one at a time. If the task branch includes `TASKS.md` or `tasks/rollup.md`, compare those snapshot rows against the live rows and keep the live coordination state. Resolve conflicts intentionally.
6. Run validation from `validation.md`. Use `npm run validate:mvp` when integrated changes touch shipped behavior and no other build is active.
7. After validation is sufficient, update final ledgers in this order: assign the next `MERGE-###` and update `acceptance.md` with every included `TASK-###`, prepend `WORKLOG.md` with the `MERGE-###`, then add compact proof to `proof.md`.
8. Update `memory/*.md` only for high-level decisions or durable project memory. Double-check every memory change against code/docs/git/runtime evidence before making it, and add a date + `MERGE-###` note to that memory file's changelog.
9. Mark integrated rows `merged` in the final merge branch's `TASKS.md` and add the final `MERGE-###` to the matching `tasks/rollup.md` rows without rewriting owner notes or reintroducing stale task-worktree snapshots.
10. Commit only integrated files on the final merge branch.
11. For a local merge without push, use `npm run land -- --branch <final-merge-branch>`.

## Push

Do not push section-agent branches directly to `origin/main`.
Do not merge during a push-only request.

1. Push only when the user explicitly asks.
2. Before pushing, confirm the final merge branch is already merged, committed, and validated.
3. Push the final merge branch with the landing script: `npm run land -- --branch <final-merge-branch> --push`.
4. After a successful push, sync the visible local Rubicon checkout back to GitHub `main`. Use the clean path when possible:
```powershell
git status --porcelain=v1 --branch
git fetch origin main
git switch main
git pull --ff-only origin main
```
Do not use reset, force checkout, or stash.

If the visible checkout is dirty only in live board files (`TASKS.md` and/or `tasks/rollup.md`), a push agent may sync only after proving one of these cases:

1. Clean-equivalent live board files: the dirty board files already match `origin/main`, so the dirt is a landed live-board sync artifact rather than unmerged work. In that exact case, reconcile the local branch pointer without sweeping unrelated files:
```powershell
git status --porcelain=v1 --branch
git fetch origin main
git diff --name-only
git diff --cached --name-only
git diff --quiet origin/main -- TASKS.md tasks/rollup.md
git restore --source=HEAD -- TASKS.md tasks/rollup.md
git pull --ff-only origin main
```
Run this exception only when the visible checkout is already on `main`, `git diff --name-only` lists no files except `TASKS.md` and/or `tasks/rollup.md`, `git diff --cached --name-only` is empty, and `git diff --quiet origin/main -- TASKS.md tasks/rollup.md` exits `0`. The `git restore --source=HEAD` step is allowed only in this verified clean-equivalent case; it temporarily clears the local live-board dirt so the fast-forward can reapply the already-pushed board state from `origin/main`. If `git pull --ff-only origin main` fails after this restore, immediately run `git restore --source=origin/main -- TASKS.md tasks/rollup.md`, then stop and report the failed sync.

2. Superseded live-board rows: the only differences are local pre-merge rows for task IDs that `origin/main` already contains as `merged` rows from the pushed merge. Before using this path, inspect `git diff -- TASKS.md tasks/rollup.md` and the `origin/main` versions of both files. Confirm every dirty task ID is present on `origin/main` with status `merged`, no local-only task ID exists, no local row is `claimed`, `in_progress`, `blocked`, or otherwise active without an `origin/main` `merged` counterpart, and no non-board or staged file exists. Then clear the local board dirt and fast-forward:
```powershell
git status --porcelain=v1 --branch
git fetch origin main
git diff --name-only
git diff --cached --name-only
git diff -- TASKS.md tasks/rollup.md
git show origin/main:TASKS.md
git show origin/main:tasks/rollup.md
git restore --source=HEAD -- TASKS.md tasks/rollup.md
git pull --ff-only origin main
```
Report the task IDs that were superseded before or with the sync result. The `git restore --source=HEAD` step is intentional: it clears the old local live-board dirt so the fast-forward can reapply the already-pushed board state from `origin/main`. If `git pull --ff-only origin main` fails after this restore, immediately run `git restore --source=origin/main -- TASKS.md tasks/rollup.md`, then stop and report the failed sync. This path is only for rows already landed on `origin/main`; it must not be used to hide an active local coordination row.

If the visible checkout has any unrelated dirty file, any staged file, or live board files that satisfy neither the clean-equivalent nor the superseded-row case above, stop and report the dirty files instead of switching branches, pulling, or overwriting them. Dirty live board files that are neither already matched to `origin/main` nor superseded by `origin/main` merged rows are unlanded coordination rows and must remain visible.
5. Clean up only the exact final merge and landing worktrees from this push run, after proving each one is safe. Run cleanup from the visible local Rubicon checkout, not from inside a worktree being removed:
```powershell
git worktree list --porcelain
git -C <final-merge-worktree-path> status --porcelain=v1 --branch
git merge-base --is-ancestor <final-merge-branch> origin/main
git -C <landing-worktree-path> status --porcelain=v1 --branch
$landingHead = git -C <landing-worktree-path> rev-parse HEAD
git merge-base --is-ancestor $landingHead origin/main
git worktree remove <final-merge-worktree-path>
git worktree remove <landing-worktree-path>
git branch -d <final-merge-branch>
git worktree prune
```
Use the exact paths printed by the landing script and `git worktree list --porcelain`; do not infer or glob paths. Remove the final merge worktree only if its status is clean and its branch is already contained in `origin/main`. Remove a detached landing worktree only if its status is clean and its HEAD is already contained in `origin/main`. Delete the final merge branch only after its worktree is removed, and only with `git branch -d`, never `-D`. Never remove active task worktrees such as `agent-TASK-*`, dirty worktrees, or any worktree you did not positively identify as part of the completed merge/push run. If any check fails or is unclear, leave the worktree in place and report it.
