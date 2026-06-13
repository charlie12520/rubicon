Rubicon is a local-first SPX 0DTE morning-intelligence, trade-tracker, and replay cockpit for one trader on one Windows machine.

If the user wants you to override a rule, ask for confirmation.

Always use `codebase.md` to find files before searching or editing code.

Always pressure-test the prompt and your assumptions against the code, docs, git state, runtime evidence, and reality before acting on them.

Read `memory/general.md` and the relevant section memory file before reversing or questioning an existing architecture decision.

Only merge agents update `memory/*.md`; section agents read memory but do not edit it.

Only merge agents update `validation.md`; section agents use it and note any gaps in their task file.

If you do not know something, check official documentation or scientific literature first, forum advice second, and the open internet last.

User has provided capable subagents for your use.

Use subagents when they would improve review, validation, research, or merge confidence.

Live app safety:
- Do not kill or restart the live `5174` server during market hours.
- Kill only exact PIDs you started.
- Do not touch TWS, the live server, or the Godel watcher unless the user asks.

If the visible conversation resumes from a compacted summary before the latest user message, reread `AGENTS.md` before continuing.

Multi-agent section workflow:
1. The user's prompt is the task assignment. If the prompt asks you to merge or push, stop this workflow and read `merge_push.md`.
2. If the prompt is read-only or status-only, do not create a task, branch, worktree, or commit.
3. New task numbering starts at `TASK-001`. Use the `TASK-###` ID from the user's prompt. If the prompt has no task ID, ask immediately instead of inventing it.
4. Reread `TASKS.md` from disk before creating or editing a task row. Claim or update exactly one row with a short scope, owner, branch/worktree, status, and merge note.
5. Create the task branch/worktree from `origin/main`:
```powershell
$task = "TASK-###"
$slug = "short-slug"
$branch = "agent/$task-$slug"
$worktree = "../rubicon-worktrees/agent-$task-$slug"
git fetch origin main
git worktree add $worktree -b $branch origin/main
Set-Location $worktree
```
6. Work only inside that task's branch/worktree, not directly on `main`.
7. Maintain the task's own row in `tasks/rollup.md`. The rollup is a compact spreadsheet-like detail ledger, not a prose log.
8. Edit only your own `TASK-###` row in `tasks/rollup.md`. Do not edit another task's rollup row. If work is related to another task, write `Related: TASK-###` in your own row.
9. If any file outside the assigned section changes, immediately write the file path and reason in your task's `Out-of-section changes` cell in `tasks/rollup.md`.
10. Before committing, choose validation from `validation.md` or the task row, run the narrowest meaningful check, then run `git status`.
11. Stage explicit files only. Do not use `git add -A`.
12. A task is not complete until it is ready to commit: validation has run or the gap is documented, `git status` has been checked, intended files are staged or explicitly listed as unstaged, and unrelated files are excluded.
13. Use `ready_for_commit` in `TASKS.md` when the work is validated but still needs user-approved commit. Use `ready_for_merge` only after a committed task branch/worktree is ready for the merge agent.
14. In the final message for a completed task, explicitly state that the task is ready to commit or ready to merge, or explain exactly what blocks readiness.
15. Commit only if the user asks. Before committing, prompt the user for confirmation.
16. After creating and entering the assigned worktree, do not push, merge, rebase, reset, or switch branches unless the user asks.
17. In your final message, explicitly confirm that `TASKS.md` and your own `tasks/rollup.md` row are current.
