# Rubicon

Local-first morning-intelligence + SPX 0DTE trade tracker / replay cockpit (React + Vite client, Express/`tsx` server). This file is Claude Code's entry point — the authoritative rules and repo map live in the imports below, so read them before doing anything.

## Read first (every session)

@AGENTS.md
@codebase.md

Then skim only the **top / current** portion of these (they are large — do NOT read end-to-end; use `rg` to jump to a specific acceptance ID, feature name, or blocker):

- `WORKLOG.md` — current work state, recent changes, known blockers
- `naive_acceptance.md` — current acceptance criteria and IDs
- `naive_validation.md` — latest validation status and the commands to run

## Non-negotiables (the AGENTS.md rules most easily skipped)

- **Map each change to an acceptance criterion** before building; if none fits, add one.
- **Add/update tests when behavior changes.** Every `server/*.ts` has a sibling `server/*.test.ts` and `src/` has `*.test.tsx` — match that pattern; don't land new modules untested.
- **Update `WORKLOG.md`** after each meaningful change.
- **Validate before claiming done:** run the narrowest relevant check first, then `npm run typecheck && npm run test` (full gate: `npm run validate:mvp`).
- Reuse the existing stack; prefer small, reviewable patches; preserve existing user changes; commit/push only when the user asks.
- The app may be inspired by reference products but must not copy competitor branding, exact UI/CSS, icons, or wording.
- **Concurrency:** Codex and Claude agents often run here simultaneously — follow AGENTS.md §2 (branch-check before commit, claim acceptance IDs from a fresh read, stage only your own files, never sweep up others' uncommitted work).

## Run / verify

- Dev: `npm run dev` (client on 5173, API on 5174). Single-process build+serve: `npm run build` then `PORT=<p> RUBICON_LISTEN_HOST=127.0.0.1 npx tsx server/index.ts`.
- The user usually has their own instance on `[::1]:5174` — don't kill it; when stopping a server you started, kill only its exact PID (never `taskkill /T` a parent — it can cascade into their app).
