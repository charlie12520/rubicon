# Daily Pull Memory

Copied from `DECISIONS.md`. Keep the original decision blocks intact.

### D007: Direct Google CSV export probe

Decision:
The app probes the configured SPX Spread Trade Tracker `Daily Sync Runs` CSV export endpoint and reports whether direct unauthenticated Google Sheet import is readable, auth-gated, or unavailable. It keeps local AI STUFF mirrors as the data source when the probe is not OK.

Reason:
The trader asked for automatic SPX Spread Trade Tracker intake, but the current live public export endpoint returns HTTP 401 Unauthorized. Surfacing that exact source state is more trustworthy than silently falling back or implying live Google import is connected.

Status:
Accepted

## Changelog

| Date | Merge | Notes |
|---|---|---|

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
