# Task Rollup

Compact task-owned ledger. `TASKS.md` is the live board; this file keeps the short detail row that lets another agent review or merge the work.

Rules:
- A section agent may edit only its own task row.
- Other section agents must not edit another task's row.
- Keep cells short; link to a plan or commit when detail would make the table hard to scan.
- Task rows are newest-first: add new rows directly below the table header, above older rows.
- Merge agents may mark rows `merged` and add the final `MERGE-###`, but should not rewrite owner notes unless reconciling a conflict.

| Task | Dates | Section | Owner / branch / worktree | Status | Files | Validation | Out-of-section changes | Blockers / risks | Merge notes | Review notes |
|---|---|---|---|---|---|---|---|---|---|---|
| TASK-007 | 2026-06-13 -> 2026-06-13 | General / Docs and Runtime | Branch `agent/TASK-007-docs-runtime`; merged by `agent/MERGE-001-task-007-docs-runtime` | merged | `AGENTS.md`; `TASKS.md`; `tasks/rollup.md`; `acceptance.md`; `validation.md`; `proof.md`; `memory/*.md`; live doc set; mirror launch scripts | `git diff --check origin/main..HEAD`; `node --check` for mirror/startup scripts; `npm run validate:mvp` with Desktop AI STUFF mirror evidence paths; local `npm run land -- --branch agent/MERGE-001-task-007-docs-runtime` | `scripts/mirror-env.mjs`: kept Google evidence paths working after old AI STUFF checkout rename; `NOTEPAD.md`: moved stale scratch note to Desktop `depreciated_rubicon` | Running processes may keep old env values until relaunched. Fresh worktree validation needs the preserved Google evidence env paths. | Accepted in `MERGE-001`. | Kept data in AI STUFF; mutable Markdown tables stay newest-first; compact board/rollup is easier to scan. |
| TASK-002 | 2026-06-12 -> 2026-06-12 | Brief / Godel live news | Landed before compact rollup; no active owner | merged | `scripts/godel-news-scraper.mjs`; scraper tests; `server/godelLiveNews.test.ts`; plan doc | `node --check`; focused tests 13/13; `npm run validate:mvp` passed | None | Watcher and server must use the same repo copy; `godel-news/` remains in AI STUFF. | Already landed before `MERGE-###`; do not re-merge. | Banner text shape beat CSS/color heuristics; watchdog should key on app shell, not banner presence. |
