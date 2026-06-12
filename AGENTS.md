# AGENTS.md - Rubicon operating guide

Rubicon is a local-first SPX 0DTE morning-intelligence + trade-tracker + replay cockpit for one
trader, on one Windows machine. React 19 + Vite client (`src/`), Express 5 + `tsx` server
(`server/`), shared types (`shared/`), automation scripts (`scripts/`). It may take inspiration
from reference products but must never copy competitor branding, exact UI/CSS, icons, or wording.

Start every session: read this file, then `codebase.md` (repo map), then the TOP of `WORKLOG.md`
(current state) and the yaml header of `naive_acceptance.md` (current acceptance ID). Use `rg` to
jump; never read the big logs end-to-end.

First user-visible reply in a session/task must include an `A###` token. For repo-changing work,
claim the next free acceptance ID first and open with it (for example, `A196 - ...`). For read-only
status/questions where no new ID is claimed, report the current active ID as context (for example,
`A195 context - ...`). This keeps cross-agent transcripts tied to the ledger from the first message.

This file is the SHARED rulebook for every agent runtime (Codex reads it natively; Claude imports
it via CLAUDE.md). Shell on this machine is Windows PowerShell 5.1 - no `&&` chaining, no `??`;
all recipes below are PS syntax. Durable repo knowledge belongs in these md files, never in any
one runtime's private memory.

## 1. The working tree IS production

The user's live app serves THIS folder. At logon, the "Rubicon Server" scheduled task runs
`scripts/serve-headless.vbs` (rebuilds stale `dist/`, then `tsx server/index.ts` on
`127.0.0.1:5174`), and an Edge PWA window auto-opens pointed at it. Live market feeds
(FPL 09:25; heatmap / SPX bars / spread-speed 09:28 ET) auto-start only in their open window -
**a midday server restart silently kills the feeds for the rest of the day.**

- NEVER kill or restart the live 5174 server during market hours (~09:20-16:05 ET).
- Client-only change: `npm run build`; the user hard-refreshes the PWA. Server change: lands at
  the next after-hours restart - say so, don't restart.
- Kill only the exact PIDs of processes YOU started. NEVER `taskkill /T` (a tree-kill once took
  down the user's app). Never touch TWS, the live server, or the Godel watcher (an invisible
  off-screen Edge + node pair; it has its own Startup-folder shortcut and single-instance lock).

## 2. Concurrent agents and production/main safety

Treat every file and the git state as liable to change under you:

- A196 bootstrap exception: this guardrail change may be authored from the current feature-branch
  HEAD in a sibling worktree. After it lands, the live `spx-spread-replay-tracker` checkout is
  production-only: keep it on `main`, let the live server and Latest button operate only there,
  and do not edit source files there directly.
- For repo-changing work, create a sibling worktree under `../rubicon-worktrees/`:
  `npm run worktree:create -- --id A### --slug short-name`. Future worktrees start from fresh
  `origin/main`; use feature branches named `agent/A###-short-name`.
- Land completed branches through `npm run land -- --branch agent/A###-short-name`; add `--push`
  only when the user explicitly wants the validated merge pushed to `origin/main`. The landing
  script uses a temporary integration worktree and must not checkout local `main` in the live
  folder.
- Install repo hooks with `npm run hooks:install` after the guardrail commit lands. Hooks block
  direct commits/merges on `main`, duplicate/regressed acceptance IDs, and broad archive rotations
  mixed with source edits.
- `git branch --show-current` BEFORE committing - another session may have switched the checkout
  to its feature branch. Commit where you are; never switch branches out from under a session.
- Uncommitted changes you didn't make are someone's in-flight work. Stage ONLY files you touched
  (`git add <paths>`, never `-A` blindly); never `checkout -- .`, stash, or reset.
- Acceptance IDs race. Read `naive_acceptance.md`'s yaml fresh at claim time, take the next free
  ID, add your row + bump the yaml. Never renumber or rewrite another session's rows. If a ledger
  file changed since your read, re-read and re-apply - anchored string edits only, never
  line-number splicing (a bad splice once destroyed the ledger).
- ID collisions still happen despite the protocol. Resolution: the id that is COMMITTED first
  wins; the loser renumbers their own row to the next free id (this has been done before -
  branch row "A179" became A184 at merge). Start every WORKLOG entry with its A-id so prepend
  order never matters.
- Never bypass the build lock. `npm run build` is lock-protected; `build:raw` is only for the
  lock wrapper. If another build/validation is active, wait or run focused non-build checks.
- Scratch ports can collide too: probe before binding (`Get-NetTCPConnection -LocalPort <p>`)
  or pick randomly within 5189-5199. Name temp scripts uniquely (`<task>-<something>.tmp.mjs`).
- `data/` is runtime state, written by the live app at any moment (e.g. the daily index-reconcile
  rewrites the tracked `data/heatmap-classification-auto.json`). Never treat `data/` churn as a
  blocker or sweep it into commits; the self-update gate already ignores it (A183).
- Respect the locks: daily sync (`../IBKR Equity History Pull/data/daily_sync.lock.json`,
  pid-probed), Godel watcher (`../godel-news/watcher.lock.json`), and the server's pre-bind port
  probe (a second instance on an owned port exits cleanly - that's by design).

## 3. Per-change ritual

1. Map the change to an acceptance criterion: claim the next ID in `naive_acceptance.md`
   (row + yaml bump).
2. Write/update tests - nearly every `server/*.ts` and `src/` logic module has a co-located
   `*.test.ts(x)`; match that. Display-only components are the usual exception.
3. Validate: narrowest check first, then `npm run validate:mvp`
   (= typecheck && lint && test && build). Lint is zero-tolerance and gated in CI
   (windows-latest, push to main + PRs; CI runs typecheck/lint/test).
4. Prepend the entry under `## Last Completed Change` in `WORKLOG.md`.
   (Ignore WORKLOG's own yaml header - it drifts; `naive_acceptance.md` is the ID authority.)
5. Commit only your files, with a clear message. Push only when the user asks.

## 4. Run / verify

- Dev: `npm run dev` (Vite client 5173, API 5174, `/api` proxied).
- Scratch server for verification (never reuse 5174):
  `$env:PORT="5189"; $env:RUBICON_LISTEN_HOST="127.0.0.1"; npx tsx server/index.ts`
  - use ports 5189-5199, kill the exact PID when done. Build first if you need the client UI.
- Browser proof: `playwright-core` with `{ channel: "msedge", headless: true }`. The script must
  live INSIDE the repo (module resolution) - name it `*.tmp.mjs`, delete it after.
- The Claude preview MCP is rooted at the WRONG project on this machine - never use it for Rubicon.

## 5. External processes & integrations

- IBKR/TWS client-ids - never reuse: holdings **884**; heatmap **941**; TC2000 bars **947**;
  0DTE chain **948**; SPX live bars **949**; nightly sync **9300+/9393/9494-9497**.
- The nightly sync lives in the sibling `../IBKR Equity History Pull` (PowerShell wrapper
  `run_daily_spx_ibkr_sync_with_sheet_payload.ps1` + `daily_spx_ibkr_sync.py`). That project has
  **no git** - copy any file you'll edit to `~/Documents/<task>_backup_<date>/` first.
- Godel news: `scripts/godel-news-scraper.mjs` (invisible Edge, Cloudflare-constrained - headless
  does NOT work) -> `../godel-news/` archives + `data/godel-live-news.json` -> the Morning
  Live Updates panel.
- Secrets live outside the repo (e.g. `.secrets/` in sibling projects). Never print or commit them.

## 6. Doc map

| Doc | Read when |
|---|---|
| `codebase.md` (then `detailedcodebase.md` for depth) | finding the right module - don't spelunk blind |
| `WORKLOG.md` - top block only | every session: current state, recent changes |
| `naive_acceptance.md` - yaml + recent rows | claiming an acceptance ID |
| `naive_validation.md` | validation commands / latest evidence |
| `PLAN-improvement-roadmap-2026-06-09.md` | picking up roadmap work (R2-R5 remain) |
| `DECISIONS.md` | before reversing an architecture decision |
| `archive/`, `docs/` | history; point-in-time audits and shipped plans |

Done means: validated per section 3, ledger + WORKLOG updated, app still serves the user's live workflow.
