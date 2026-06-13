# General Memory

Copied from `DECISIONS.md`. Keep the original decision blocks intact.

### D001: Product wedge

Decision:
SPX Spread Replay focuses on local review and replay of SPX 0DTE spread trading sessions.

Reason:
The useful first loop is fast post-session inspection: import the user's existing trades and mirrored market data, show the day's risk/P&L, then replay the session without requiring live credentials.

Alternatives considered:
- Build a general trading journal first.
- Build a live execution dashboard first.
- Build a Google-Sheet-only reporting layer first.

Status:
Accepted

---

### D002: Local-first integration boundary

Decision:
The MVP imports from AI STUFF local session folders and mirrored SPX tracker CSV exports. Live Google Sheets or IBKR API credentials are not required for the local MVP.

Reason:
The available local archive already contains trades, SPX bars, spread marks, OI, and volume data. This keeps the app usable without secrets and avoids fake hosted claims.

Status:
Accepted

---

### D003: Wallet handling

Decision:
IBKR wallet size is shown from local `data/wallet.json`, a configured `IBKR_ACCOUNT_SNAPSHOT_PATH`, recognized AI STUFF account snapshot files, or `IBKR_WALLET_SIZE`; when no source exists, the UI exposes a local manual save.

Reason:
No trustworthy wallet-size source was found in the local archive during the initial build. A manual local value makes position sizing visible without inventing broker data, while the account-snapshot reader lets future IBKR `NetLiquidation` snapshots populate the app automatically when present.

Status:
Accepted

---

### D006: Automatic local import refresh

Decision:
The desktop app re-checks the local AI STUFF/SPX tracker mirrors through the existing `/api/tracker` endpoint while the window is visible, refreshes again when the app regains visibility, and re-fetches replay data after a successful import refresh.

Reason:
The MVP's trustworthy data boundary is still local mirrors, but the trader should not have to manually reload the app to see newly generated session folders or updated staged sheet payloads. The refresh behavior follows Today/latest when the trader is already in live-review mode and preserves custom historical review dates.

Status:
Accepted

---

### D012: IBKR wallet refresh uses read-only account-summary snapshots

Decision:
The desktop app owns a `npm run ibkr:wallet` command and `/api/ibkr-wallet/refresh` endpoint that connect read-only to TWS/Gateway account summary, extract `NetLiquidation`, and write the recognized AI STUFF account snapshot file.

Reason:
The existing wallet importer already trusts account snapshots, and a live TWS session is available locally. Producing the snapshot through a read-only account-summary call gives the trader a fresh wallet KPI without storing broker credentials in the app or changing the trade-data importer boundary.

Status:
Accepted

---

### D017: In-app self-update is a guarded GitHub updater that never restarts mid-pull

Decision:
The header "Latest" button (`src/components/AppUpdateButton.tsx` â†’ `server/selfUpdate.ts`) compares local main to `origin/main` and, when behind, offers an update that pulls `--ff-only`, rebuilds BEFORE restart, and relaunches the server via the "Rubicon Server" scheduled task. The gate refuses, in order, on: uncommitted TRACKED changes (untracked ignored), local commits not on GitHub, already-up-to-date, and market hours without explicit force. It hard-refuses (force cannot override) while a daily sync holds the pid-probed lock, and runtime `data/` churn is filtered out of the blocking dirty list.

Reason:
A restart mid-pull would kill the attached sync wrapper, and any restart during RTH orphans the day's auto-started live feeds (they only re-arm in the 09:28 open window). Build-before-restart means a broken build leaves the running server untouched. Only source changes should block an update, so continuously-rewritten `data/` files must not count as dirty.

Status:
Accepted (A182; hardened A183)

---

### D019: Lint is a zero-tolerance gate in validate:mvp and CI

Decision:
`npm run validate:mvp` runs typecheck â†’ lint â†’ test â†’ build, and `npm run lint` (`eslint .`) is zero-tolerance. CI (GitHub Actions, `windows-latest`, on push to main + PRs) runs typecheck/lint/test. Component files export only components, unused-vars use the underscore convention configured in `eslint.config.js`, and no new `eslint-disable`s are added.

Reason:
Lint debt had grown to 73 findings; gating lint at the validate step and in CI drove it to 0 and enforces React hook-correctness mechanically. CI is Windows-only because Rubicon is Windows-only (WMI launcher, PowerShell toasts, Edge PWA) â€” the first ubuntu run failed on Windows path-shape assertions.

Status:
Accepted (CI added A165; lint debt cleared + gate added A184)

---

### D020: Parallel agents coordinate by TASK IDs; accepted merges use MERGE IDs

Decision:
Rubicon section agents use `TASK-###` IDs and per-task files for active parallel work. A task records
owner, branch/worktree, scope, focused validation, touched files, and merge notes. Section agents do
not update acceptance, proof, memory, or `WORKLOG.md`. A final merge agent integrates finished task
branches/worktrees, runs broader validation, assigns the next `MERGE-###` in
`acceptance.md`, prepends `WORKLOG.md`, records proof in `proof.md`, appends task
handoffs/reviews to `tasks/rollup.md`, and marks merged task files `merged`.

Reason:
Multiple agents can read stale ledgers at the same time and independently claim the same final ID.
Separating active task coordination from final acceptance history lets agents work in parallel
without corrupting the canonical ledger. It also makes section-level validation useful without
pretending isolated branch work is already landed.

Status:
Drafted by user workflow request; final merge ID is assigned by the merge agent.

## Changelog

| Date | Merge | Notes |
|---|---|---|
