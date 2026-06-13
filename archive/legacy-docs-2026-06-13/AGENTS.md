# AGENTS.md — Rubicon operating guide

Rubicon is a local-first SPX 0DTE morning-intelligence + trade-tracker + replay cockpit for one
trader, on one Windows machine. React 19 + Vite client (`src/`), Express 5 + `tsx` server
(`server/`), shared types (`shared/`), automation scripts (`scripts/`). It may take inspiration
from reference products but must never copy competitor branding, exact UI/CSS, icons, or wording.

Start every session: read this file, then `codebase.md` (repo map), `TASKS.md` (active agent
board), the TOP of `WORKLOG.md` (landed state), and the yaml header of `naive_acceptance.md`
(latest accepted A-id). Use `rg` to jump; never read the big logs end-to-end.

First user-visible reply in a session/task must include an ID token. Section agents use the assigned
or newly claimed `TASK-###` token (for example, `TASK-014 - ...`). Read-only status/questions use
the current active A-id as context (for example, `A197 context - ...`). Only the final merge/landing
agent claims new `A###` acceptance IDs. This keeps parallel transcripts tied to the task board
without racing the final acceptance ledger.

This file is the SHARED rulebook for every agent runtime (Codex reads it natively; Claude imports
it via CLAUDE.md). Shell on this machine is Windows PowerShell 5.1 — no `&&` chaining, no `??`;
all recipes below are PS syntax. Durable repo knowledge belongs in these md files, never in any
one runtime's private memory.

## 1. The working tree IS production

The user's live app serves THIS folder. At logon, the "Rubicon Server" scheduled task runs
`scripts/serve-headless.vbs` (rebuilds stale `dist/`, then `tsx server/index.ts` on
`127.0.0.1:5174`), and an Edge PWA window auto-opens pointed at it. Live market feeds
(FPL 09:25; heatmap / SPX bars / spread-speed 09:28 ET) auto-start only in their open window —
**a midday server restart silently kills the feeds for the rest of the day.**

- NEVER kill or restart the live 5174 server during market hours (~09:20–16:05 ET).
- Client-only change: `npm run build`; the user hard-refreshes the PWA. Server change: lands at
  the next after-hours restart — say so, don't restart.
- Kill only the exact PIDs of processes YOU started. NEVER `taskkill /T` (a tree-kill once took
  down the user's app). Never touch TWS, the live server, or the Godel watcher (an invisible
  off-screen Edge + node pair; it has its own Startup-folder shortcut and single-instance lock).

## 2. Task-first concurrent agents (Codex + Claude often run here simultaneously)

The default parallel workflow is:

1. The user assigns a Rubicon section or improvement to a `TASK-###` in `TASKS.md`.
2. One agent claims that task from a fresh read, records owner/branch/worktree/status, and works only
   that task's scope.
3. Section agents record progress, focused validation, risks, and handoff notes in `TASKS.md` or a
   linked task note. They do not mark `A###` rows GREEN and do not prepend `WORKLOG.md`.
4. If you edit outside the claimed section, write the file path and reason in `TASKS.md` immediately.
5. A final merge agent integrates the finished task branches/worktrees, resolves conflicts, runs the
   broader validation, then assigns the next free `A###` ID(s) in `naive_acceptance.md`, updates
   `WORKLOG.md` and `naive_validation.md`, and commits the integrated result.

`TASKS.md` is the live coordination board. `naive_acceptance.md` and `WORKLOG.md` are final-history
ledgers. If a branch already contains a stale or colliding `A###` row, the final merge agent must
renumber or rewrite that branch's row before landing it; the first committed/landed A-id wins.

Treat every file and the git state as liable to change under you:

- The live `spx-spread-replay-tracker` checkout is production-only after the dirty-checkout
  transition is complete: keep it on `main`, let the live server and Latest button operate only
  there, and do not edit source files there directly.
- For repo-changing work, create a sibling worktree under `../rubicon-worktrees/`:
  `npm run worktree:create -- --id TASK-### --slug short-name` for section work, or
  `npm run worktree:create -- --id A### --slug short-name` for a final merge branch. Future
  worktrees start from fresh `origin/main`; use branches named `agent/TASK-###-short-name` or
  `agent/A###-short-name`.
- Land completed branches through `npm run land -- --branch agent/...`; add `--push` only when the
  user explicitly wants the validated merge pushed to `origin/main`. The landing script uses a
  temporary integration worktree and must not checkout local `main` in the live folder.
- Install repo hooks with `npm run hooks:install` in a checkout that has the guardrail files.
  Hooks block direct commits/merges on `main`, duplicate/regressed acceptance IDs, and broad
  archive rotations mixed with source edits.
- `git branch --show-current` BEFORE committing — another session may have switched the checkout
  to its feature branch. Commit where you are; never switch branches out from under a session.
- Uncommitted changes you didn't make are someone's in-flight work. Stage ONLY files you touched
  (`git add <paths>`, never `-A` blindly); never `checkout -- .`, stash, or reset.
- `TASKS.md` claims race too. Re-read it immediately before claiming or changing a task row; edit
  by anchored text, not line-number splices. If the board changed under you, re-apply cleanly.
- Never bypass the build lock. `npm run build` is lock-protected; `build:raw` is only for the
  lock wrapper. If another build/validation is active, wait or run focused non-build checks.
- Scratch ports can collide too: probe before binding (`Get-NetTCPConnection -LocalPort <p>`)
  or pick randomly within 5189–5199. Name temp scripts uniquely (`<task>-<something>.tmp.mjs`).
- `data/` is runtime state, written by the live app at any moment (e.g. the daily index-reconcile
  rewrites the tracked `data/heatmap-classification-auto.json`). Never treat `data/` churn as a
  blocker or sweep it into commits; the self-update gate already ignores it (A183).
- Respect the locks: daily sync (`../IBKR Equity History Pull/data/daily_sync.lock.json`,
  pid-probed), Godel watcher (`../godel-news/watcher.lock.json`), and the server's pre-bind port
  probe (a second instance on an owned port exits cleanly — that's by design).

## 3. Per-task and merge rituals

Section-agent ritual:

1. Claim or confirm your `TASK-###` in `TASKS.md` from a fresh read. If the project section is
   unclear, use `codebase.md` / `detailedcodebase.md` first, then narrow the task.
2. Write/update tests — nearly every `server/*.ts` and `src/` logic module has a co-located
   `*.test.ts(x)`; match that. Display-only components are the usual exception.
3. Validate with the narrowest meaningful proof first. Prefer focused tests + typecheck while other
   agents are active; leave build/full `validate:mvp` to the final merge agent unless you know it is
   safe to build.
4. Update only your task row/note with files touched, validation proof, known risks, and merge notes.
   Put any out-of-section edit under `Out-of-section changes`.
5. Commit only your files if asked to commit. Push only when the user asks.

Final merge-agent ritual:

1. Read `TASKS.md`, `WORKLOG.md` top, and `naive_acceptance.md` yaml fresh.
2. Integrate finished task branches/worktrees without sweeping unrelated dirty files.
3. Resolve duplicate task/acceptance wording, then run the agreed validation ladder. Use the full
   `npm run validate:mvp` when the integrated change touches shipped behavior and no other build is
   active.
4. Check each task's `Out-of-section changes` before landing it.
5. Claim the next free `A###` ID(s), update `naive_acceptance.md`, prepend `WORKLOG.md`, and add
   compact proof to `naive_validation.md`.
6. Commit only the integrated files; push only when the user asks. Use `npm run land -- --branch ...`
   for the final push to `origin/main`; do not merge by checking out `main` in the live folder.

## 4. Run / verify

- Dev: `npm run dev` (Vite client 5173, API 5174, `/api` proxied).
- Scratch server for verification (never reuse 5174):
  `$env:PORT="5189"; $env:RUBICON_LISTEN_HOST="127.0.0.1"; npx tsx server/index.ts`
  — use ports 5189–5199, kill the exact PID when done. Build first if you need the client UI.
- Browser proof: `playwright-core` with `{ channel: "msedge", headless: true }`. The script must
  live INSIDE the repo (module resolution) — name it `*.tmp.mjs`, delete it after.
- The Claude preview MCP is rooted at the WRONG project on this machine — never use it for Rubicon.

## 5. External processes & integrations

- IBKR/TWS client-ids — never reuse: holdings **884** · heatmap **941** · TC2000 bars **947** ·
  0DTE chain **948** · SPX live bars **949** · nightly sync **9300+/9393/9494–9497**.
- The nightly sync lives in the sibling `../IBKR Equity History Pull` (PowerShell wrapper
  `run_daily_spx_ibkr_sync_with_sheet_payload.ps1` + `daily_spx_ibkr_sync.py`). That project has
  **no git** — copy any file you'll edit to `~/Documents/<task>_backup_<date>/` first.
- Godel news: `scripts/godel-news-scraper.mjs` (invisible Edge, Cloudflare-constrained — headless
  does NOT work) → `../godel-news/` archives + `data/godel-live-news.json` → the Morning
  Live Updates panel.
- Secrets live outside the repo (e.g. `.secrets/` in sibling projects). Never print or commit them.

## 6. Doc map

| Doc | Read when |
|---|---|
| `codebase.md` (→ `detailedcodebase.md` for depth) | finding the right module — don't spelunk blind |
| `TASKS.md` | claiming section work, checking active worktrees/owners, leaving handoff notes |
| `WORKLOG.md` — top block only | landed state and recent accepted changes |
| `naive_acceptance.md` — yaml + recent rows | final merge/landing acceptance IDs |
| `naive_validation.md` | validation commands and final proof summary |
| `archive/PLAN-improvement-roadmap-2026-06-09.md` | historical roadmap snapshot; re-verify before using any item |
| `DECISIONS.md` | before reversing an architecture decision |
| `archive/`, `docs/` | history; point-in-time audits and shipped plans |

Done for a section agent means: task note updated, focused validation recorded, no unrelated files
staged, and merge risks called out. Done for the final merge agent means: integrated validation
passed, acceptance/worklog/validation ledgers updated, and the app still serves the user's live
workflow.
