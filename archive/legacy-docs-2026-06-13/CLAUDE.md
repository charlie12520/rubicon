# Rubicon

Local-first morning-intelligence + SPX 0DTE trade tracker / replay cockpit (React + Vite client, Express/`tsx` server). This file is Claude Code's entry point — the authoritative rules and repo map live in the imports below, so read them before doing anything.

## Read first (every session)

@AGENTS.md
@codebase.md
@TASKS.md

First user-visible reply in every session/task must include an ID token. For section work, claim or
confirm the assigned `TASK-###` in `TASKS.md` and open with that token. For read-only status/questions,
report the current active A-id as context. Only the final merge/landing agent claims new `A###`
acceptance IDs.

Then skim only the **top / current** portion of these (they are large — do NOT read end-to-end; use `rg` to jump to a specific acceptance ID, feature name, or blocker):

- `TASKS.md` — active agent task board, owners, branches/worktrees, handoff notes
- `WORKLOG.md` — current work state, recent changes, known blockers
- `naive_acceptance.md` — final acceptance criteria and latest A-ids
- `naive_validation.md` — latest validation status and commands

## Non-negotiables (the AGENTS.md rules most easily skipped)

- **Map section work to a task first.** Section agents update `TASKS.md`; final merge agents update the
  acceptance/worklog/validation ledgers.
- **Add/update tests when behavior changes.** Every `server/*.ts` has a sibling `server/*.test.ts` and `src/` has `*.test.tsx` — match that pattern; don't land new modules untested.
- **Do not append `WORKLOG.md` from a section task.** Leave task proof and merge notes in `TASKS.md`; the final merge agent writes the landed history.
- **Always record out-of-section edits.** If you edit outside your claimed section, write the file path and reason in `TASKS.md` immediately.
- **Validate before claiming done:** run the narrowest relevant check first, then `npm run typecheck && npm run test` (full gate: `npm run validate:mvp`).
- Reuse the existing stack; prefer small, reviewable patches; preserve existing user changes; commit/push only when the user asks.
- The app may be inspired by reference products but must not copy competitor branding, exact UI/CSS, icons, or wording.
- **Concurrency:** Codex and Claude agents often run here simultaneously — follow AGENTS.md §2 (refresh `TASKS.md`, branch-check before commit, stage only your own files, never sweep up others' uncommitted work).
- **Worktree safety:** repo-changing work belongs in sibling `../rubicon-worktrees/` worktrees via
  `npm run worktree:create`; final integration uses `npm run land -- --branch ...` and pushes only
  when explicitly requested. The live checkout stays production-only on `main` after the dirty
  transition is complete.

## Run / verify

- Dev: `npm run dev` (client on 5173, API on 5174). Single-process build+serve: `npm run build` then `PORT=<p> RUBICON_LISTEN_HOST=127.0.0.1 npx tsx server/index.ts`.
- The user usually has their own instance on `127.0.0.1:5174` — don't kill it; when stopping a server you started, kill only its exact PID (never `taskkill /T` a parent — it can cascade into their app).
