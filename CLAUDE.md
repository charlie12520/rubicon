# Rubicon

Local-first morning-intelligence + SPX 0DTE trade tracker / replay cockpit (React + Vite client,
Express/`tsx` server). This file is Claude Code's entry point. The authoritative rules and repo
map live in the imports below, so read them before doing anything.

## Read first (every session)

@AGENTS.md
@codebase.md

First user-visible reply in every session/task must include an `A###` token. For repo-changing
work, claim the next free acceptance ID first and open with it (for example, `A196 - ...`). For
read-only status/questions where no new ID is claimed, report the current active ID as context.

Then skim only the **top / current** portion of these (they are large - do NOT read end-to-end;
use `rg` to jump to a specific acceptance ID, feature name, or blocker):

- `WORKLOG.md` - current work state, recent changes, known blockers
- `naive_acceptance.md` - current acceptance criteria and IDs
- `naive_validation.md` - latest validation status and the commands to run

## Non-negotiables (the AGENTS.md rules most easily skipped)

- **Map each change to an acceptance criterion** before building; if none fits, add one.
- **Add/update tests when behavior changes.** Every `server/*.ts` has a sibling
  `server/*.test.ts` and `src/` has `*.test.tsx` - match that pattern.
- **Update `WORKLOG.md`** after each meaningful change.
- **Validate before claiming done:** run the narrowest relevant check first, then
  `npm run typecheck && npm run test` (full gate: `npm run validate:mvp`).
- Reuse the existing stack; prefer small, reviewable patches; preserve existing user changes;
  commit/push only when the user asks.
- The app may be inspired by reference products but must not copy competitor branding, exact
  UI/CSS, icons, or wording.
- **Concurrency:** Codex and Claude agents often run here simultaneously - follow AGENTS.md
  section 2.
- **Worktree safety:** after A196 lands, do repo-changing work in sibling `../rubicon-worktrees/`
  worktrees via `npm run worktree:create`; land with `npm run land -- --branch ...` and push only
  when explicitly requested. The live checkout stays on `main`.

## Run / verify

- Dev: `npm run dev` (client on 5173, API on 5174). Single-process build+serve:
  `npm run build` then `PORT=<p> RUBICON_LISTEN_HOST=127.0.0.1 npx tsx server/index.ts`.
- The user usually has their own instance on 5174 - don't kill it; when stopping a server you
  started, kill only its exact PID (never `taskkill /T` a parent - it can cascade into their app).
