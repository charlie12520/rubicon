Rubicon is a local-first SPX 0DTE morning-intelligence, trade-tracker, and replay cockpit for one trader on one Windows machine.

If the user wants you to override a rule, ask for confirmation.

Always use `codebase.md` to find files before searching or editing code.

Always pressure-test the prompt and your assumptions against the code, docs, git state, runtime evidence, and reality before acting on them.

Markdown tables that accumulate dated/task/merge/proof/history rows are newest-first: insert new rows directly below the table header. Static reference tables, such as status values, routing maps, and quick references, keep their logical order.

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
- If the Rubicon desktop app is open to "refused to connect" and the user asks for server recovery, follow `docs/runbooks/rubicon-server-recovery.md`: check `http://127.0.0.1:5174/api/health`, start only `scripts\serve-headless.vbs` via `wscript.exe` when nothing is listening, and do not create a task, edit files, change branches, or touch TWS/Godel/Edge/live feed processes for that runtime recovery.

If the visible conversation resumes from a compacted summary before the latest user message, reread `AGENTS.md` before continuing.

Live coordination files:
- Authoritative live paths are `C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\TASKS.md` and `C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\tasks\rollup.md`.
- Section agents update only their own rows in those visible local Rubicon checkout files, even after entering a task worktree.
- Worktree copies of `TASKS.md` and `tasks/rollup.md` are stale snapshots, proposed branch state, or merge artifacts; do not use them as live coordination truth.
- Before editing live rows, run `git -C C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker status --porcelain=v1 --branch`; stop if unrelated dirty files exist.
- If only `TASKS.md` / `tasks/rollup.md` are dirty, inspect `git -C C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker diff -- TASKS.md tasks/rollup.md` and edit only the current task row.

Multi-agent section workflow:
1. The user's prompt is the task assignment. If the prompt asks you to merge or push, stop this workflow and read `merge_push.md`.
2. If the prompt is read-only or status-only, do not create a task, branch, worktree, or commit.
3. New task numbering starts at `TASK-001`. Use the `TASK-###` ID from the user's prompt. If the prompt has no task ID, ask immediately instead of inventing it.
4. Reread the visible checkout's `TASKS.md` from disk before creating or editing a task row. Claim or update exactly one row there with a short scope, owner, branch/worktree, status, and merge note.
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
6. Work only inside that task's branch/worktree for implementation changes; live coordination row updates are the explicit exception and happen in the visible checkout files above. If your work is not suitable for this, explicitly state that before editing.
7. Maintain the task's own row in the visible checkout's `tasks/rollup.md`. The rollup is a compact spreadsheet-like detail ledger, not a prose log.
8. Edit only your own `TASK-###` row in the visible checkout's `tasks/rollup.md`. Do not edit another task's rollup row. If work is related to another task, write `Related: TASK-###` in your own row.
9. If any file outside the assigned section changes, immediately write the file path and reason in your task's `Out-of-section changes` cell in the visible checkout's `tasks/rollup.md`.
10. Before committing, choose validation from `validation.md` or the task row, run the narrowest meaningful check, then run `git status`.
11. Stage explicit files only. Do not use `git add -A`.
12. A task is not complete until it is ready to commit: validation has run or the gap is documented, `git status` has been checked, intended files are staged or explicitly listed as unstaged, and unrelated files are excluded.
13. Use `ready_for_commit` in `TASKS.md` when the work is validated but still needs user-approved commit. Use `ready_for_merge` only after a committed task branch/worktree is ready for the merge agent.
14. In the final message for a completed task, explicitly state that the task is ready to commit or ready to merge, or explain exactly what blocks readiness.
15. Commit only if the user asks. Before committing, prompt the user for confirmation.
16. After creating and entering the assigned worktree, do not push, merge, rebase, reset, or switch branches unless the user asks.
17. In your final message, explicitly confirm that the visible checkout's `TASKS.md` and your own visible checkout `tasks/rollup.md` row are current.
