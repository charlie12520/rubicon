# Merge / Push Workflow

Use this only when the user asks to merge or push. Read only the relevant section: `Merge` for merge-only work, `Push` for push-only work, and both sections when the user asks for both.

## Merge

Do not merge by checking out `main` in the live folder. The landing script uses a temporary integration worktree.
Do not sweep unrelated dirty files.
Do not hide duplicate task wording, stale task IDs, or colliding final acceptance rows.
Do not add to, summarize, rewrite, or delete rollup entries. If rollup conflicts appear during integration, preserve every section-agent entry.
Do not use `memory/*.md` for raw task notes, validation proof, or low-level change logs.
Only the merge agent writes `WORKLOG.md` summaries. It may use subagents if useful.
`WORKLOG.md` remains a polished summary, not a raw ledger.
The merge agent may edit and reorganize `memory/*.md` only for high-level decisions or durable project memory, after verifying every change.
The merge agent may update `validation.md` only when the validation policy itself needs to change.

1. Read fresh: `AGENTS.md`, `codebase.md`, `validation.md`, `acceptance.md`, `proof.md`, `TASKS.md`, `tasks/rollup.md`, the top of `WORKLOG.md`, and the relevant `memory/*.md`.
2. Select `TASKS.md` rows with status `ready_for_merge`, unless the user names specific task IDs.
3. For each selected task, inspect the `TASKS.md` row and matching `tasks/rollup.md` row for branch/worktree, commit hash or merge note, files changed, validation, blockers/risks, merge notes, and `Out-of-section changes`. Skip tasks with blockers, missing commits, or missing validation unless the user explicitly approves.
4. Create or use one final merge branch/worktree from `origin/main`; this is the only branch that receives selected task work.
5. For each selected task, run `git status` in its task worktree, then integrate it into the final merge branch/worktree one at a time. Resolve conflicts intentionally.
6. Run validation from `validation.md`. Use `npm run validate:mvp` when integrated changes touch shipped behavior and no other build is active.
7. After validation is sufficient, update final ledgers in this order: assign the next `MERGE-###` and update `acceptance.md` with every included `TASK-###`, prepend `WORKLOG.md` with the `MERGE-###`, then add compact proof to `proof.md`.
8. Update `memory/*.md` only for high-level decisions or durable project memory. Double-check every memory change against code/docs/git/runtime evidence before making it, and add a date + `MERGE-###` note to that memory file's changelog.
9. Mark integrated rows `merged` in `TASKS.md` and add the final `MERGE-###` to the matching `tasks/rollup.md` rows without rewriting owner notes.
10. Commit only integrated files on the final merge branch.
11. For a local merge without push, use `npm run land -- --branch <final-merge-branch>`.

## Push

Do not push section-agent branches directly to `origin/main`.
Do not merge during a push-only request.

1. Push only when the user explicitly asks.
2. Before pushing, confirm the final merge branch is already merged, committed, and validated.
3. Push the final merge branch with the landing script: `npm run land -- --branch <final-merge-branch> --push`.
4. After a successful push, sync the visible local Rubicon checkout back to GitHub `main`, but only if it is clean:
```powershell
git status --porcelain=v1 --branch
git fetch origin main
git switch main
git pull --ff-only origin main
```
Do not use reset, force checkout, or stash. If the visible checkout is dirty, stop and report the dirty files instead of switching branches.
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
