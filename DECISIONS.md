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

### D013: Daily trade import sync is launched through the existing AI STUFF wrapper

Decision:
The desktop app exposes a guarded `Run Daily Sync` action that calls the existing `run_daily_spx_ibkr_sync_with_sheet_payload.ps1` wrapper, plus `/api/daily-sync/status` for launch state, latest log tail, and latest daily summary.

Reason:
The AI STUFF wrapper already owns the correct sequencing: SPX bars, IBKR executions, spread summaries, option fallback data, open interest, volume profiles, and staged Google Sheet payload generation. Wrapping that workflow keeps the desktop app aligned with the proven data pipeline instead of duplicating broker and sheet-payload logic.

Status:
Accepted

---

### D014: Daily sync auto target is surfaced before launch

Decision:
The desktop app shows an estimated `auto` target date, current New York time, and 16:25 ET cutoff note before the trader launches the daily sync. The AI STUFF wrapper remains the final market-calendar authority.

Reason:
Before 16:25 ET, the existing wrapper intentionally targets the prior trading session in `auto` mode to avoid same-day execution-report timing risk. Surfacing that target plan makes the desktop launch action safer and easier to audit without duplicating the full sync pipeline.

Status:
Accepted
