# Rubicon

A local-first morning intelligence, trade tracker, and SPX spread replay cockpit built from the AI STUFF trade archive plus the SPX Spread Trade Tracker mirror data.

## What It Does

- Imports SPX spread trades from `..\IBKR Equity History Pull\data\ibkr_trades`.
- Reads mirrored Google Sheet tabs or staged upload payload tabs for SPX 5-second bars, spread marks, 0DTE open interest, and 0DTE volume profile, with legacy 1-minute fallback for older archives.
- Splits the app into top-level Morning and Replay portions. Morning shows the Rubicon-owned SPX macro calendar, political calendar pulls, FirstSquawk live updates, alert arming, SPX Heatmap, net-delta recommended spreads, FPL, prior-session diary notes, and TC2000 pulls.
- Shows today/date/range stats: net P/L, average P/L, win rate, trade count, max call-side position, max put-side position, and IBKR wallet size.
- Replays a selected session with a scrubber/autoplay cockpit: SPX chart, selected spread chart with OHLC/Line modes, static OI profile, and volume profile with both/calls/puts modes.
- Lists every selected-date trade in the replay quick-access strip so late-day entries can be opened directly.
- Persists per-date Daily Review notes and per-trade review flags locally in `data/review-notes.json`, then summarizes, filters, and replays flagged trades from Daily Review.
- Exports the selected Daily Review as compact markdown with current notes, flags, import issues, Source State diagnostics, stats, and ledger rows.
- Badges session/date buttons when that date has pull, upload, or availability issues that need review.
- Shows a selected-date Google receipt check when a payload is staged locally but the raw Google workbook upload receipt is still unconfirmed, including the exact credential/action/Sheet-row confirmation steps.
- Persists connector row-search evidence in `data/google-drive-receipt-checks.json` when the tracker is checked directly and uses it to explain dates where `Daily Sync Runs` has no matching receipt row.
- Opens as a local desktop app window through `npm run desktop` or the installed `Rubicon` shortcut.
- Automatically re-checks the local AI STUFF/SPX tracker mirrors while the app is open and re-fetches replay data after import refresh.
- Shows a `Today pending` freshness banner when today's archive is not imported yet and the app is displaying the latest imported session instead.
- Exposes Source State `Preflight Pipeline` and `Run Daily Pipeline` actions so the trader can dry-run the exact AI STUFF daily SPX/IBKR wrapper before launching the local daily pipeline.
- Shows same-day pipeline readiness in Source State, including whether `auto` is still targeting the prior session before the 07:00 ET cutoff, roughly how many minutes remain, and locks `Run Daily Pipeline` until the auto target is safely today's session.
- Runs the daily pipeline as Data Collection -> Rubicon Ingest -> Google Upload, with TC2000/Qullamaggie report/email sidecar failures reported as warning-only diagnostics.
- Lets Morning's SPX Heatmap start a per-minute IBKR snapshot feed; `Start feed` immediately writes a Yahoo session backfill so the map is not blank while the first live sweep starts.
- Sends FirstSquawk word-filter matches through a native Windows toast endpoint instead of reusing the calendar popup path.
- Probes the configured SPX Spread Trade Tracker Google Sheet CSV export and surfaces whether direct import is public-readable or blocked by Google auth.
- Reads a Google Drive connector snapshot from `data/google-drive-tracker-snapshot.json` when present, using connector-confirmed `Daily Sync Runs` raw workbook URLs to mark live Google upload receipts accurately and warn when the snapshot is stale or predates the latest staged payload.
- Keeps the connector snapshot warning active when a refreshed connector read is newer than the staged payload but still lacks that date's `raw_upload_google_sheet_url`, so a fresh-but-missing receipt cannot look confirmed.
- Can refresh that Google connector snapshot through `npm run google:snapshot` when a reusable Google Sheets API credential is configured; the default bounded `Daily Sync Runs` scan covers `A1:AA1000`.
- Automatically attempts that Google connector snapshot refresh during the desktop app's `/api/tracker` import read when a reusable Google Sheets credential is configured, throttled by `SPX_GOOGLE_AUTO_REFRESH_MINUTES` and disableable with `SPX_GOOGLE_AUTO_REFRESH=0`.
- Includes a Source State `Refresh Google` action for triggering the same snapshot refresh from the desktop app on demand.
- Reads wallet size from `data/wallet.json`, `IBKR_ACCOUNT_SNAPSHOT_PATH`, recognized AI STUFF account snapshot files, `IBKR_WALLET_SIZE`, or a read-only TWS/Gateway account-summary refresh.

## Run It

For the desktop app experience, install the shortcut once:

```bash
npm run desktop:install
```

Then open `Rubicon` from your Windows desktop. The shortcut launches a hidden local server and opens a dedicated app-style Edge/Chrome window with no address bar. You can also launch the same desktop app window directly:

```bash
npm run desktop
```

For development, run the web and API servers:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

The API runs on:

```text
http://127.0.0.1:5174
```

The production desktop launcher serves the built app from the API server after verifying `/api/health` reports `rubicon`; if one local address is occupied by another project, it tries the next Rubicon-ready address. You do not need to manually open that URL when using the desktop shortcut.

## Refresh Google Tracker Snapshot

The app can rebuild `data/google-drive-tracker-snapshot.json` through the Google Sheets API. By default it reads `Daily Sync Runs!A1:AA1000`, which covers the current tracker tab depth while staying within a bounded Sheets read:

```bash
npm run google:snapshot
```

Configure one of these before running it:

- `GOOGLE_SHEETS_ACCESS_TOKEN`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_SERVICE_ACCOUNT_PATH`
- `GOOGLE_SHEETS_API_KEY`

Without a credential, the command fails closed and Source State shows the missing configuration instead of implying live Google import is active.

The desktop app also exposes the same refresh path in Source State through `Refresh Google`; when credentials are missing, the app shows the setup message inline.

While the desktop app is open, `/api/tracker` also checks this same credential-gated refresh path automatically. It waits quietly when no credential is configured, reports failures in Source State, and throttles retries to 30 minutes by default. Override with `SPX_GOOGLE_AUTO_REFRESH_MINUTES`, or disable with `SPX_GOOGLE_AUTO_REFRESH=0`.

## Run Daily SPX/IBKR Pipeline

The desktop app's Source State panel exposes `Preflight Pipeline` and `Run Daily Pipeline`, which call the existing AI STUFF wrapper:

```text
..\IBKR Equity History Pull\run_daily_spx_ibkr_sync_with_sheet_payload.ps1 --no-popup --date auto
```

The API also exposes `/api/daily-sync/status` for the latest launch state, log tail, daily summary, three stage rows, Google-uploaded verdict, review-ready verdict, lock status, catch-up status, and the estimated `auto` target date. Before the 07:00 ET cutoff, Source State warns when `auto` is still expected to target the prior session, shows a minute countdown to the same-day pipeline window, and disables `Run Daily Pipeline`; after the cutoff it updates while the app is open and unlocks the action for today's archive.

The pipeline stages are:

- Data Collection: pulls local SPX 5s bars, IBKR executions, option data, OI, underlying bars, spread marks, and summary files.
- Rubicon Ingest: publishes local summaries and replay-safe state so Rubicon can review the session even if Google upload fails.
- Google Upload: builds/uploads the raw workbook, updates tracker receipt rows, and refreshes the Google snapshot.
- TC2000/Qullamaggie sidecar: runs after Google Upload and before TC2000 daily bars; failures stay warning-only diagnostics.

The wrapper remains the final market-calendar authority. It pulls local SPX/IBKR data and updates archive/upload artifacts; it does not place orders.

## Refresh IBKR Wallet Snapshot

With TWS or IB Gateway open and API socket access enabled, refresh the wallet snapshot from read-only account summary:

```bash
npm run ibkr:wallet
```

By default this checks `127.0.0.1` ports `7496,4001` and writes `..\IBKR Equity History Pull\data\ibkr_account_snapshot.json`. You can override with `IBKR_HOST`, `IBKR_WALLET_PORTS`, `IBKR_WALLET_CLIENT_ID`, `IBKR_ACCOUNT`, `IBKR_ACCOUNT_SNAPSHOT_OUT_PATH`, or `IBKR_WALLET_PYTHON`.

The desktop wallet card also exposes an `IBKR` refresh button that calls the same read-only path through `/api/ibkr-wallet/refresh`.

## Agent Coordination

Rubicon supports parallel section work by using `TASKS.md` as the active board. Section agents claim
or update `TASK-###` rows there, record focused validation and merge notes there, and leave
`WORKLOG.md`, `naive_acceptance.md`, and `naive_validation.md` for the final merge/landing agent.
Final acceptance IDs (`A###`) are assigned only after task branches/worktrees are integrated and the
merged result is validated.

## Validate

```bash
npm run validate:mvp
```

That runs TypeScript typecheck, ESLint (zero-tolerance, also CI-gated), the full Vitest suite, and a production build.

## Completion Audit

`archive/COMPLETION_AUDIT.md` is a point-in-time audit from 2026-05-29. Current acceptance and validation status live in `WORKLOG.md`, `naive_acceptance.md`, and `naive_validation.md`.

## Data Sources

- Local trade archive: `..\IBKR Equity History Pull\data\ibkr_trades`
- SPX Spread Trade Tracker Sheet: `https://docs.google.com/spreadsheets/d/1w0S_DNJJ6ZhcSGB0qEtkBxsVLxQk0prVPqnV9t-WvtE/edit`
- Runtime import path: the app auto-scans dated local sessions, their mirrored `google_sheet_tab_csvs` exports, and staged `google_sheet_upload_payload.json` tabs when CSV tab exports have not been written yet.
- Direct Google CSV probe: the app checks the `Daily Sync Runs` tab export endpoint; if Google returns 401/auth or non-CSV content, Source State reports the exact auth gate and keeps using local mirrors.
- Google Drive connector bridge: create or refresh `data/google-drive-tracker-snapshot.json` from a connected Google Drive/Sheets read or `npm run google:snapshot`; the app merges connector-backed upload receipts into daily summaries, labels their source/read time in the Upload health metric, and warns when the connector read is older than the newest staged payload it would need to confirm. The current connector snapshot confirms receipts through 2026-05-29.
- Google receipt row-search evidence: `data/google-drive-receipt-checks.json` records bounded connector searches for selected dates; when a staged upload still has no receipt row, the selected-date health panel shows the search status, scanned range, and matching-row count. For 2026-05-29, the latest stored row-search evidence is `found`.
- Daily local pipeline: use Source State `Run Daily Pipeline` to start the existing AI STUFF SPX/IBKR wrapper after the 07:00 ET cutoff guard unlocks, then the app's auto-refresh picks up newly written local mirror files, replay-safe state, staged sheet payload summaries, Google upload receipts, and warning-only TC2000/Qullamaggie sidecar diagnostics. Same-day replay filters to SPXW multi-leg spreads so non-SPX single-option executions do not pollute SPX charts, OI, or volume.
- Market-date freshness: when `today` is missing from imported dates, the app labels the visible fallback session so the Today view is not mistaken for a completed same-day import.
- Date-specific data quality: Replay and Daily Review date rails show issue badges with pull/upload/availability counts when a date's imported summary needs review.
- Wallet/account import: set `IBKR_ACCOUNT_SNAPSHOT_PATH` to a JSON/CSV account snapshot with `NetLiquidation`, place an account snapshot at one of the recognized AI STUFF latest-account paths, or use `npm run ibkr:wallet` / the in-app `IBKR` button to produce one from read-only TWS/Gateway account summary.
- Review notes and flags: saved by date through the Daily Review panel and stored at `data/review-notes.json`; per-trade flags use `follow_up`, `mistake`, and `quality`.

## QA Artifacts

- Historical screenshots and QA server logs are archived under `archive/artifacts/`.
- Active section-agent proof lives in `TASKS.md`; final proof lives in `WORKLOG.md`,
  `naive_acceptance.md`, and `naive_validation.md`.
