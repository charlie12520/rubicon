# Daily sync + TC2000 hardening — handoff plan (2026-06-12)

> For Opus. Source: a 5-lens read-only review (launcher / wrapper / python / TC2000 / contracts)
> + spot verification. Tier 1 items are PERSONALLY VERIFIED (evidence inline) — fix directly.
> Tier 2 items are review-reported with strong evidence — VERIFY FIRST (read the cited code,
> confirm the mechanism), then fix. Do not trust line numbers blindly; locate by quoted code.
>
> CONSTRAINTS: market day — no live-server (127.0.0.1:5174) restarts before ~16:05 ET; server-side
> Rubicon changes land at the next after-hours restart. The sibling
> `../IBKR Equity History Pull` has NO git — copy every file you'll edit to
> `~/Documents/sync_hardening_backup_2026-06-12/` first. Concurrent agents are active: follow
> AGENTS.md §2 (fresh ledger read, branch check, stage only your files). The nightly sync runs
> tonight — Tier 1 should land before it.

## Why "some part of the sync always seems to break" — the map

| Observed recurring breakage | Root cause (finding) |
|---|---|
| A crashed night bricks the NEXT nights until someone deletes the lock | T1: `$Pid` param crashes every stale-lock recovery |
| "Pull can't find a TC2000-screened stock"; screened list feels stale | T2: 3 of 4 screens serve May-31 membership; T5: fetch-failed symbols may drop from the bars file |
| Failures discovered late / sync "looked green" | T3: manual-retry masks failures as exit 0 completed; lock-skip exits 0; status writer can go silent |
| Option sidecars blocked review on volatile days (Jun-10) | T6: midpoint pull is last under the 480s budget, full-session-only, and unrecoverable in the retry path |
| Server-side status weirdness after launches | T4: spawn handlers attach late; duplicate-launch clobbers live status |

## Tier 1 — VERIFIED, fix today

### T1. `$Pid` parameter crashes stale-lock recovery (wrapper) — trivial fix, biggest reliability win
`run_daily_spx_ibkr_sync_with_sheet_payload.ps1:892`: `param([AllowNull()][object]$Pid)`.
`$PID` is a read-only PowerShell automatic variable; EMPIRICALLY CONFIRMED on this machine:
calling any function with that param throws `Cannot overwrite variable Pid because it is
read-only or constant`. Consequence: whenever a previous run leaves `data\daily_sync.lock.json`
behind (any crash night), the next night's staleness check CRASHES instead of recovering — the
nightly is bricked until someone manually deletes the lock.
**Fix:** rename the parameter (e.g. `$ProcessId`) and its call sites (L894, L898 + callers).
Note `pid = $PID` at L934/L1160 are reads of the automatic var — correct, leave them.
**Validate:** PowerShell AST parse; a unit-style call of the renamed function with a fake pid;
simulate a stale lock (copy an old lock json in, run the wrapper's preflight/dry path) and
confirm recovery instead of crash.

### T2. TC2000 membership is stale-by-architecture (live-confirmed)
Last night's `data/tc2000-daily-bars.json`: `screenerFreshnessStatus: "partial-stale",
staleSourceCount: 3` — `jump_pause_v2_latest.csv`, `staircase_latest.csv`, `three_bar_latest.csv`
are all frozen at **May-31** (only `qullamaggie_latest.csv` refreshed nightly). The A185
metadata REPORTS the staleness but the May-31 membership is still served, and the review found
the Morning ingest (`server/morningBrief.ts` loadTc2000Pulls) unions EVERY export CSV (stale
dated + orphaned `_latest`, no junk-ticker filter) and even ingests symbol lists from
prompt-FAILED `.ocr.json` files — so stale/poisoned members render indistinguishably from fresh.
**Fix (decide with the user or pick the conservative default):**
1. Ask the user whether jump_pause_v2 / staircase / three_bar scans are still wanted. If yes:
   re-enable their export in the TC2000 export step (only qullamaggie exports today). If no:
   delete the three orphaned `_latest.csv` and their dated leftovers.
2. Defense regardless: age-gate membership in `scripts/refresh-tc2000-daily-bars.py` — exclude
   `_latest.csv` sources older than N days (e.g. 5) from MEMBERSHIP (keep reporting them as
   retired in sourceDetails), so orphans can never silently pin the list again.
3. Morning ingest: scope `loadTc2000Pulls` to fresh `_latest.csv` only (reuse the freshness
   metadata), apply the same junk-ticker rejection the refresh script has, and never ingest
   symbols from `.ocr.json` files whose run failed (exit 4 / blocking_prompt).
**Validate:** `python scripts/test_refresh_tc2000_daily_bars.py` (extend for the age gate);
focused vitest `server/morningBrief.test.ts` (extend for stale-source exclusion); inspect the
regenerated json: staleSourceCount drops to 0 and symbols reflect live screens only.

### T3. Failures masked as success (wrapper exit semantics)
Verified shape at `run_daily_spx_ibkr_sync_with_sheet_payload.ps1:2104`: the manual option-retry
catch does `Add-SyncWarning` + proceeds to the completed path (review: "converts any failure
into exit 0 / state=completed"). Related review-verified family: the early lock-skip path
returns exit 0 (a locked night looks green), and the Rubicon status writer goes permanently
silent if `data\daily-sync-status.json` is ever corrupt (write wrapped in a catch that logs once
to stdout nobody reads).
**Fix:** failed retry ⇒ `state=failed` (or `completed-with-warnings` + nonzero exit); lock-skip
⇒ distinct nonzero exit + status note; status writer: on corrupt-json read, quarantine-rename
the corrupt file and rewrite fresh (mirror the godelLiveNews quarantine pattern) instead of
giving up.
**Validate:** wrapper-focused vitest (`server/dailySyncWrapper.test.ts` pins command shapes) +
hand-run the retry path against a fake failing date; corrupt the status json in a temp copy and
prove the writer recovers.

### T4. Launcher attaches child handlers too late (server/dailySync.ts)
Verified structure: `child = spawn(...)` at L1337, `child.unref()` L1347, but `child.on("close")`
attaches at L1370 and `child.on("error")` at **L1398** — with an awaited status write in
between. An async spawn failure (ENOENT etc.) can emit `error` before the handler exists →
unhandled 'error' event crashes the SERVER; if the awaited write throws, status stays "running"
forever and the log fd leaks. The review also confirmed the duplicate-launch "blocked" response
clobbers the ACTIVE run's persisted status (wrapper catch at ~L2037 writes state=failed to the
shared file), and the dry-run preflight mutates state before checking `dryRun`.
**Fix:** attach `close`/`error` handlers SYNCHRONOUSLY immediately after spawn (before unref and
before any await); wrap handler-internal awaits in try/catch; make the duplicate-launch path
write a non-clobbering "blocked" note (or skip the shared-status write entirely); move the
dryRun check ahead of any mutation.
**Validate:** `npx vitest run server/dailySync.test.ts` + add a regression: spawn with an
invalid command and assert the server survives and status terminalizes. REMEMBER: server-side —
lands at tonight's restart, which is fine (the wrapper runs from source per-launch).

## Tier 2 — verify first, then fix (review-reported, mechanisms quoted in the review)

- **T5. Bars file can lose symbols.** `scripts/refresh-tc2000-daily-bars.py`: review claims a
  per-symbol IBKR fetch failure DROPS that symbol's previously cached bars from the output, and
  a 0-symbol run overwrites the whole file with an empty payload (this matches the historical
  "can't find a screened stock" symptom). Verify the payload assembly: if true, carry forward
  the prior bars for fetch-failed symbols (mark them stale) and refuse to overwrite a non-empty
  file with an empty symbol set.
- **T6. A174 midpoint pull fragility** (`daily_spx_ibkr_sync.py`): (a) corrupt-parquet read
  guard has a NameError path; (b) in the wrapper's OI-never retry scope the qualified-contract
  dict is empty for TRADES-complete legs so midpoints are silently never backfilled; (c) the
  midpoint pull runs LAST under the shared 480s wall clock (starved exactly on the volatile days
  that need it); (d) single full-session request — should reuse the A180 chunk-first mode;
  (e) presence-only dedupe can permanently truncate marks. Fix order: (a) trivial guard,
  (b) re-qualify contracts in retry scope, (c) move midpoints ahead of broad-breadth pulls or
  give them a reserved budget slice, (d) pass the history-window mode through, (e) dedupe on
  (symbol, timestamp) with content compare.
- **T7. Contract drift / races:** the literal date "auto" flowing into the server's summary
  lookup (fabricated latestSummary on auto runs); `daily_sync_summary.json` written
  non-atomically (only shared file without temp+rename); wrapper accepting a stale same-date
  summary when a re-run crashes before rewriting; self-update gate evaluated once then minutes
  pass before restart (re-check after build, before relauncher spawn); catch-up refresher and
  duplicate-launch lack lock-aware re-checks; selfUpdate vs dailySync disagree on what a "live"
  lock is (unify on one helper).
- **T8. TC2000 UI-automation robustness:** unknown blocking prompts can still pass silently
  (PS classifier missing the `don't show again` pattern the Python side flags — quoted in nits);
  foreground never verified before SendKeys (wrong-window input risk); loose `*TC2000*` title
  match; DPI-mixed crop math. Start with the prompt-pattern parity + a foreground re-check
  before every SendKeys; the DPI item needs a repro before touching.

## Tier 3 — nits (fix opportunistically, list preserved)

lock-removed vs lock-stale pipelineState asymmetry · auto-repair marks OI "usable; retry
skipped" without evaluating · Get-ReviewState fallback dead code (`@($null).Count -eq 1`) ·
blocked duplicate launch writes failed status (covered by T4) · tc2000-bars has no live progress
(ReadToEndAsync) · dead midpoint-CSV re-write guard · allocation-method overwrite vs append ·
PS prompt classifier missing don't-show-again (covered by T8) · `tc2000_export_parts_*` temp
dirs never cleaned (13 since May-31) · New-DailySyncLock can fall through both attempts lockless.

## Validation ladder (after each tier)

1. Python: `python -m pytest tests -q` in the IBKR project (bare python, NOT the venv — venv
   lacks pytest). PowerShell: AST parse every edited ps1.
2. Rubicon: focused vitest for touched modules → `npm run validate:mvp`.
3. Dry-run: `POST /api/daily-sync/run {date:"auto", dryRun:true}` against a scratch server.
4. The real proof is TONIGHT'S run: check `data/daily-sync-status.json` + the summary json
   tomorrow; tc2000-daily-bars.json should read `screenerFreshnessStatus: "fresh"` (or honestly
   reflect the user's decision on the three dead scans).

## Ledger

One acceptance ID per tier is fine (read the yaml fresh — concurrent sessions). WORKLOG entries
per AGENTS.md §3. Commit on the current branch; push only when the user asks.
