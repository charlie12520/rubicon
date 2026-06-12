# DECISIONS.md

## Decision Log

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

### D004: Spread chart truth model

Decision:
Spread replay charts distinguish close-only Line mode from OHLC HL mode. Imported spread marks carry leg-symbol metadata, and fallback reconstruction combines every option leg's signed open/high/low/close values instead of drawing close-only bars.

Reason:
A credit/debit spread can look deceptively flat if high/low bars collapse to the close. The UI should make real intraminute range visible when it exists, while the importer should prove every displayed spread mark represents the complete two-leg trade.

Status:
Accepted

---

### D005: Daily review note persistence

Decision:
Daily Review notes are persisted locally by trade date in app-local `data/review-notes.json`.

Reason:
The local MVP needs lightweight session reflection without requiring a hosted database, account system, or Google write access.

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

### D007: Direct Google CSV export probe

Decision:
The app probes the configured SPX Spread Trade Tracker `Daily Sync Runs` CSV export endpoint and reports whether direct unauthenticated Google Sheet import is readable, auth-gated, or unavailable. It keeps local AI STUFF mirrors as the data source when the probe is not OK.

Reason:
The trader asked for automatic SPX Spread Trade Tracker intake, but the current live public export endpoint returns HTTP 401 Unauthorized. Surfacing that exact source state is more trustworthy than silently falling back or implying live Google import is connected.

Status:
Accepted

---

### D008: Google Drive connector snapshot bridge

Decision:
The desktop app can consume `data/google-drive-tracker-snapshot.json`, a small JSON artifact produced from a credentialed Google Drive/Sheets connector read of the SPX Spread Trade Tracker. Connector-backed `Daily Sync Runs` raw workbook URLs are merged into daily summaries to confirm live Google upload receipts.

Reason:
The public CSV endpoint is auth-gated, but the connected Google Drive plugin can read the private tracker. Capturing a narrow connector snapshot gives the app truthful Google-backed evidence without embedding Codex-only connector APIs or secrets into the desktop runtime.

Status:
Accepted

---

### D009: Connector snapshot freshness is part of source health

Decision:
The app treats `data/google-drive-tracker-snapshot.json` as connector-backed evidence with an explicit freshness window. Source State marks the snapshot warning/stale when its `readAt` is older than 24 hours, while daily Upload copy names the connector snapshot and read time when it confirms a raw workbook receipt.

Reason:
Connector reads are trustworthy only as of their capture time. A stale snapshot can still explain historical receipts, but the trader should not mistake yesterday's connector evidence for a fresh confirmation of today's Google upload state.

Status:
Accepted

---

### D010: Google tracker snapshot refresh uses explicit reusable credentials

Decision:
The project owns a `npm run google:snapshot` command that refreshes `data/google-drive-tracker-snapshot.json` through the Google Sheets API when `GOOGLE_SHEETS_ACCESS_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SERVICE_ACCOUNT_PATH`, or `GOOGLE_SHEETS_API_KEY` is configured. Source State reports whether that reusable refresh path is configured.

Reason:
The Codex Google Drive connector proves the private tracker can be read, but desktop runtime code should not depend on Codex-only connector APIs. A credential-gated project command gives the app a durable refresh path while still failing closed when no credential is present.

Status:
Accepted

---

### D011: Google snapshot refresh is exposed in Source State

Decision:
The desktop app exposes a `Refresh Google` action in Source State that calls `/api/google-snapshot/refresh`, using the same credential-gated Google Sheets snapshot refresher as `npm run google:snapshot`. Missing credentials are shown inline as a normal source-state message.

Reason:
The trader should not need to leave the app to discover whether Google-backed tracker refresh is available. Keeping the action beside the source-health evidence makes refresh attempts auditable and prevents silent fallback when credentials are absent.

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

### D013: Daily trade import runs as a three-stage daily pipeline

Decision:
The desktop app exposes a guarded `Run Daily Pipeline` action that calls `run_daily_spx_ibkr_sync_with_sheet_payload.ps1`, with `/api/daily-sync/status` reporting separate Data Collection, Rubicon Ingest, and Google Upload stages.

Reason:
Data Collection decides local review readiness, Rubicon Ingest publishes local summaries and replay-safe state even when the app server is closed, and Google Upload is archive/receipt hygiene. Splitting the status model prevents Google failures from making usable local review data look broken.

Status:
Accepted

---

### D014: Daily sync auto target is surfaced before launch

Decision:
The desktop app shows an estimated `auto` target date, current New York time, and 07:00 ET cutoff note before the trader launches the daily pipeline. The AI STUFF collector remains the final market-calendar authority.

Reason:
After 07:00 ET, the trader expects same-day collection to target today. Surfacing that target plan makes the desktop launch action safer and easier to audit without duplicating the full market-calendar logic.

Status:
Accepted

---

### D015: Estimator reuses the validated Bachelier model for live 0DTE spreads

Decision:
Morning > Estimator centers on the trader's current live IBKR 0DTE `SPXW` spreads, pulled directly from IBKR (`server/ibkrHoldings.ts`, client id 884) on a ~5-minute market-hours cadence. Every spread is valued with the existing self-calibrated Bachelier vertical model (`src/spreadResponse.ts`, validated 2024-26) — no new Black-Scholes math. Live legs are grouped heuristically into verticals (`src/spreadEstimator.ts`); the aggregate portfolio P/L curve (`src/portfolioResponse.ts`) sums all legs on a shared SPX ladder and is exact regardless of grouping. Per-spread "credit now" is the live cost-to-close from holdings marks, falling back to entry credit. The manual what-if tool (`SpreadResponsePanel`) stays available but secondary (collapsed below the live spreads + aggregate).

Reason:
The Bachelier model was already validated end-to-end, so reusing it for every spread avoids divergent math and keeps the aggregate exact. A direct IBKR pull is the single source of truth; `TradeRecord`s only refine spread labels when present. Locked in `GOAL-spread-estimator.md` (now archived) decisions #1-#4.

Status:
Accepted (implemented A143, A145; Bachelier model lock)

---

### D016: Intraday expected-move cone is calibrated, not linear-root-t

Decision:
The Estimator's SPX expected-move cone (`src/expectedMoveCone.ts`) uses a measured non-linear intraday variance-time profile (390-point cumulative-variance curve, not linear sqrt(t)), per-side calibrated bands (variance-risk-premium correction + crash-skew → asymmetric up/down multipliers), and an option-implied per-day scale (chain-straddle / FPL-credit-implied) with an honest fallback that drops the stale static prior when credits are ill-conditioned. Constants are generated by the Phase-5 calibration study's `export` step, never hand-tuned.

Reason:
Intraday variance is front-loaded: the old linear-sqrt(t) cone was ~25% too narrow at the open and ~15-25% too wide midday. Per-day option-implied scales dominate prediction (chain-straddle Spearman ~0.92, FPL-credit ~0.88 vs realized remaining RV) and are out-of-sample validated; the prior fallback keeps a symmetric RMS scale but gains the profile shape.

Status:
Accepted (A172)

---

### D017: In-app self-update is a guarded GitHub updater that never restarts mid-pull

Decision:
The header "Latest" button (`src/components/AppUpdateButton.tsx` → `server/selfUpdate.ts`) compares local main to `origin/main` and, when behind, offers an update that pulls `--ff-only`, rebuilds BEFORE restart, and relaunches the server via the "Rubicon Server" scheduled task. The gate refuses, in order, on: uncommitted TRACKED changes (untracked ignored), local commits not on GitHub, already-up-to-date, and market hours without explicit force. It hard-refuses (force cannot override) while a daily sync holds the pid-probed lock, and runtime `data/` churn is filtered out of the blocking dirty list.

Reason:
A restart mid-pull would kill the attached sync wrapper, and any restart during RTH orphans the day's auto-started live feeds (they only re-arm in the 09:28 open window). Build-before-restart means a broken build leaves the running server untouched. Only source changes should block an update, so continuously-rewritten `data/` files must not count as dirty.

Status:
Accepted (A182; hardened A183)

---

### D018: Godel news comes from an off-screen scraper, replacing the DOM bridge

Decision:
Godel Terminal news is captured by `scripts/godel-news-scraper.mjs` — a real headed Edge parked off-screen (Cloudflare blocks all headless and raw-HTTP routes) — which writes `data/godel-live-news.json` feeding the existing Morning > Live Updates panel. It auto-starts at logon via a Startup-folder shortcut + windowless VBS launcher with a pid-probed single-instance lock. The earlier minimized-safe DOM-bridge bookmarklet (`server/godelAlertBridge.ts`, its routes, the `GodelBridgeControls` card, and the legacy `capture/scrape-godel-news.mjs` scripts) is fully removed.

Reason:
The manual bookmarklet bridge needed a visible browser tab and surfaced stale chat fragments. The scraper is windowless, restart-safe, and auto-starting, with zero server changes (the reader already merged Godel + FirstSquawk). A real off-screen Edge is required because Cloudflare's managed challenge defeats headless and raw HTTP.

Status:
Accepted (A186-A189 built; bridge removed A190)

---

### D019: Lint is a zero-tolerance gate in validate:mvp and CI

Decision:
`npm run validate:mvp` runs typecheck → lint → test → build, and `npm run lint` (`eslint .`) is zero-tolerance. CI (GitHub Actions, `windows-latest`, on push to main + PRs) runs typecheck/lint/test. Component files export only components, unused-vars use the underscore convention configured in `eslint.config.js`, and no new `eslint-disable`s are added.

Reason:
Lint debt had grown to 73 findings; gating lint at the validate step and in CI drove it to 0 and enforces React hook-correctness mechanically. CI is Windows-only because Rubicon is Windows-only (WMI launcher, PowerShell toasts, Edge PWA) — the first ubuntu run failed on Windows path-shape assertions.

Status:
Accepted (CI added A165; lint debt cleared + gate added A184)

---

### D020: Parallel agents coordinate by TASK IDs; acceptance IDs are assigned at merge

Decision:
Rubicon section agents use `TASK-###` IDs from `TASKS.md` for active parallel work. A task records
owner, branch/worktree, scope, focused validation, touched files, and merge notes. Section agents do
not claim new `A###` acceptance IDs, do not mark acceptance rows GREEN, and do not prepend
`WORKLOG.md`. A final merge/landing agent integrates finished task branches/worktrees, resolves
conflicts and any stale/colliding `A###` wording, runs the broader validation, then assigns the final
`A###` IDs and updates `naive_acceptance.md`, `WORKLOG.md`, and `naive_validation.md`.

Reason:
Multiple agents can read stale ledgers at the same time and independently claim the same acceptance
ID. Separating active task coordination from final acceptance history lets agents work in parallel
without corrupting the canonical ledger. It also makes section-level validation useful without
pretending isolated branch work is already landed.

Status:
Accepted by user workflow request; final landing ID is assigned by the merge agent.
