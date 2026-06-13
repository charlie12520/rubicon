# Task Rollup

Compact task-owned ledger. `TASKS.md` is the live board; this file keeps the short detail row that lets another agent review or merge the work.

Rules:
- A section agent may edit only its own task row.
- Other section agents must not edit another task's row.
- Keep cells short; link to a plan or commit when detail would make the table hard to scan.
- Merge agents may mark rows `merged` and add the final `MERGE-###`, but should not rewrite owner notes unless reconciling a conflict.

| Task | Dates | Section | Owner / branch / worktree | Status | Files | Validation | Out-of-section changes | Blockers / risks | Merge notes | Review notes |
|---|---|---|---|---|---|---|---|---|---|---|
| TASK-002 | 2026-06-12 -> 2026-06-12 | Brief / Godel live news | Landed before compact rollup; no active owner | merged | `scripts/godel-news-scraper.mjs`; scraper tests; `server/godelLiveNews.test.ts`; plan doc | `node --check`; focused tests 13/13; `npm run validate:mvp` passed | None | Watcher and server must use the same repo copy; `godel-news/` remains in AI STUFF. | Already landed before `MERGE-###`; do not re-merge. | Banner text shape beat CSS/color heuristics; watchdog should key on app shell, not banner presence. |
| TASK-007 | 2026-06-13 -> 2026-06-13 | General / Docs and Runtime | Branch `agent/TASK-007-docs-runtime`; current Desktop mirror | ready_for_commit | `AGENTS.md`; `TASKS.md`; `tasks/rollup.md`; `acceptance.md`; live doc set; mirror launch scripts | Targeted stale-reference checks; rollup task IDs exist in `TASKS.md`; `git diff --check -- acceptance.md`; `git diff --check -- TASKS.md tasks/rollup.md` | `scripts/mirror-env.mjs`: kept Google evidence paths working after old AI STUFF checkout rename; `NOTEPAD.md`: moved stale scratch note to Desktop `depreciated_rubicon` | Direct `main` commit blocked by hook; user approval needed before commit. Running processes may keep old env values until relaunched. | Acceptance evidence standard now rejects vague proof; ready to commit after user approval. | Kept data in AI STUFF; moved deprecated non-data Rubicon material out of AI STUFF; compact board/rollup is easier to scan. |
