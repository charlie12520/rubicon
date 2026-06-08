# Plan — Morning › Signal Stack live picks

Companion to [TROUBLESHOOT-morning-signal-stack.md](TROUBLESHOOT-morning-signal-stack.md).
Root cause recap: the Signal Stack reads only date-keyed **EOD CSV sidecars**
(`ibkr_trades/<date>/...`). Today's dir doesn't exist until the post-close pull,
so `GET /api/spread-speed?date=<today>` returns `available:false` and both cards
show "Spread-speed data is unavailable."

Three phases. **A** is standalone and ships first. **C** is the genuine-live
path. **B** is a thin extension of C. Each phase is independently shippable and
leaves the EOD path untouched (no regression).

---

## Phase A — Graceful fallback + honest messaging  ✅ SHIPPED 2026-06-05
**Goal:** never show a dead-end; surface the most recent real frame, clearly
badged, and let the user change date. No IBKR dependency.

> **Status:** implemented & verified (tsc clean, vite build clean, 6 new tests
> green — 3 server fallback + 3 SignalStackSection UI). Touched: `shared/types.ts`,
> `server/spreadSpeed.ts` (`loadSpreadSpeedWithFallback`), `server/index.ts`
> (`&fallback=1`), `src/api.ts`, `src/App.tsx`, `src/components/MorningDashboard.tsx`,
> `src/App.css`, + the two test files. Phase C/B below remain TODO.

### A1. Server — fallback walk-back (`server/spreadSpeed.ts` + `server/index.ts`)
- Add `loadSpreadSpeedWithFallback(date)`:
  - `const primary = await loadSpreadSpeed(date)`.
  - if `primary.available` → return `{ ...primary, requestedDate: date, fallback: false }`.
  - else walk `tradeDates()` (from `dataImporter.ts`) descending, skipping
    `date`, `loadSpreadSpeed(d)` until first `available:true` (cap at ~10 look-backs).
  - return that payload tagged `{ requestedDate: date, fallback: true }`;
    if none found, return `primary` with `fallback:false` (genuinely empty).
- Extend `/api/spread-speed` with `&fallback=1`; when set, call the new helper.
  Keep default behavior unchanged for other callers (Replay/Estimator).
- Type: add `requestedDate: string` and `fallback: boolean` to
  `SpreadSpeedPayload` in `shared/types.ts` (optional fields → no breakage).
  `payload.date` already carries the *actual* frame date.

### A2. Frontend fetch (`src/App.tsx` ~line 368)
- Change to `fetchSpreadSpeed(morningDate, signal, { fallback: morningTracksToday })`
  (only fall back for the live "today" view; explicit past-date picks stay exact).
- `fetchSpreadSpeed` in `src/api.ts`: add opts → append `&fallback=1`.

### A3. UI (`src/components/MorningDashboard.tsx`)
- Pass `requestedDate` + `payload.date` (or a derived `isStale`/`asOfDate`) into
  `SignalStackSection`.
- In `RecommendedSpreadCard` header, when `payload.date !== requestedDate`, render
  an **"as of {payload.date} · EOD"** badge (amber, same style family as other
  stale chips).
- Reword the empty state (`MorningDashboard.tsx:1363-1365`):
  - frame present + stale → cards render normally + badge.
  - genuinely empty today → "Today's 0DTE chain hasn't been pulled yet — picks
    post after the daily pull (after close). Pick a past date to view its stack."
- Confirm the morning date control (`onSelectDate={selectMorningCalendarDate}`,
  `App.tsx:655`) is discoverable from the Signal Stack screen; add a one-line
  hint if not.

### A4. Tests
- `server/spreadSpeed.test.ts`: fallback returns most-recent available; cap honored;
  no available → empty with `fallback:false`.
- `MorningDashboard.test.tsx`: stale badge renders; reworded empty state; exact
  past-date request does NOT fall back.

**Effort:** ~half day. **Risk:** low. **Deliverable:** Signal Stack always shows
last real picks + an honest "EOD as of" badge.

---

## Phase C — Live ATM 0DTE snapshot (genuine live picks for today)
**Goal:** today's picks compute live from a small live SPXW 0DTE chain. Mirrors
the existing **SPX live bars** feed pattern 1:1 (`server/spxLiveBars.ts` +
`scripts/refresh-spx-live-bars.py`).

### Why it's small
`server/spreadSpeed.ts` `buildFrame(label, spot, calls, puts)` is pure
Black–Scholes (`callNd1`) — it already produces a full frame (picks, regimes,
recommend) from just **spot + an ATM straddle + the sampled strike marks**. The
only missing input is a *live* chain snapshot. We reuse `buildFrame` verbatim.

### C1. Capture script — `scripts/refresh-spx-0dte-chain.py`
- Clone of `refresh-spx-live-bars.py` (ib_insync, venv python, weekday RTH
  09:25–16:00 ET window, own **client-id 948**, ports `7496,4001`).
- Each ~15s tick:
  1. read SPX spot (SPX index last, or reuse latest `spx-live-bars.json` close).
  2. `base = round(spot/5)*5`; request SPXW 0DTE call+put `reqMktData` (snapshot)
     for strikes `base-45 … base+45` step 5 (covers `make()` offsets 0..45 both
     sides — same grid the engine samples), plus ATM±15 for the straddle.
  3. write `data/spx-0dte-chain.json`:
     `{ generatedAt, session, source:"ibkr", live:true, spot, label:"HH:MM",
        rows:[{ strike, right:"C"|"P", close }] }` (close = last/mark).
- Reuse the script's existing TWS connect/retry/error-suppression scaffolding.

### C2. Server feed module — `server/spreadSpeedLive.ts`
- Copy `spxLiveBars.ts`'s process manager: `start/stop/getStatus`, `pushLog`,
  auto-start arm (~09:28 ET weekdays), `isMarketWindow`, log tail, single active
  child. Output file `data/spx-0dte-chain.json`, log `data/spx-0dte-chain-feed.log`.
- `loadLiveSpreadSpeed(): SpreadSpeedPayload`:
  - read+sanitize the JSON; if missing/stale (asOf > ~3 min old) → `available:false`
    with a note.
  - assemble `calls`/`puts` Maps from rows; call `buildFrame(label, spot, calls, puts)`.
  - return `{ date: easternToday, generatedAt, available: !!frame, note,
      targetNetDelta, fastThreshold, frames: frame ? [frame] : [], live:true }`.
  - **Refactor:** export `buildFrame` (+ `atmStraddle`, consts) from `spreadSpeed.ts`
    so the live module reuses them — no logic duplication.

### C3. Routes (`server/index.ts`, mirror `/api/spx-live-bars*`)
- `GET  /api/spread-speed/live`            → `loadLiveSpreadSpeed()` (no-store).
- `GET  /api/spread-speed/live/status`     → feed status.
- `POST /api/spread-speed/live/start|stop` → start/stop child.
- Arm auto-start at boot next to `armSpxLiveBarsAutoStart()`.

### C4. Frontend
- `src/api.ts`: `fetchLiveSpreadSpeed()`, `fetch/start/stop` status helpers.
- `src/App.tsx`: when `morningTracksToday`, poll `/api/spread-speed/live` (~20s).
  Selection: **live frame if `available` → else Phase-A EOD fallback.** Track
  which source won so the UI can label it.
- `SignalStackSection`: source pill — **"LIVE · HH:MM"** (green) vs
  **"EOD · as of {date}"** (amber, from Phase A). Optional start/stop + log-tail
  control reusing the Estimator's SPX-feed UI.
- `$ Mark`: with the ±45pt grid the recommended ~0.05Δ leg marks are present, so
  Mark renders. (If we cap strikes tighter, Mark may be null — see Phase B.)

### C5. Tests
- `spreadSpeedLive.test.ts`: JSON→frame; stale-snapshot guard; market-window gate.
- buildFrame export unchanged-output regression (same numbers as cached 06-04).
- Frontend: live-preferred-over-EOD selection; source pill states.

**Effort:** ~1.5–2 days. **Risk:** medium — IBKR/TWS dependency.

### C — risks / gotchas
- **TWS must be up in the AM.** Degrade silently to Phase-A EOD when the feed is
  down/stale (already the selection rule).
- **Live options market-data subscription** on the IBKR account: without it,
  SPXW quotes come back NaN → `available:false`. Verify entitlement first; this
  is the single biggest go/no-go.
- **Client-id / port contention** with existing feeds (spx-live-bars 947, heatmap,
  holdings, daily pull). Use a fresh client-id (948); respect the single-instance
  lock noted in the launch-conflicts review. See `project_rubicon_launch_conflicts`.
- Use last/mark consistently (engine reads `close`); don't mix bid/ask.
- Weekday-only window (no holiday calendar) — same known limitation as the other
  live feeds.

---

## Phase B — Full live OTM marks (thin extension of C)
If C is built with the full ±45pt grid, B is essentially already covered: pull
real marks for **every** sampled strike (not just ATM), so `value` / `$ Mark` is
populated on all rows including the recommended pick. The only added cost is more
`reqMktData` lines per tick. Promote C→B by widening the strike request and
removing any null-mark synthesis. No new files.

**Effort:** ~half day on top of C. **Risk:** same as C (a few more subscribed lines).

---

## Recommended sequence
1. **Ship A** — kills the dead-end today, zero infra risk.
2. **Verify the IBKR options data entitlement** (go/no-go for live).
3. **Build C** behind a feature flag; default to A's fallback when the feed is
   absent/stale.
4. **Fold in B** (full marks) once C is stable.

## Touch list
- `shared/types.ts` — `SpreadSpeedPayload.{requestedDate?,fallback?,live?}`.
- `server/spreadSpeed.ts` — `loadSpreadSpeedWithFallback`; export `buildFrame`/helpers.
- `server/spreadSpeedLive.ts` — **new** feed module (clone of `spxLiveBars.ts`).
- `scripts/refresh-spx-0dte-chain.py` — **new** capture (clone of `refresh-spx-live-bars.py`).
- `server/index.ts` — `&fallback=1`; `/api/spread-speed/live*` routes; arm auto-start.
- `src/api.ts` — fallback opt; live fetch/start/stop helpers.
- `src/App.tsx` — fallback fetch; live poll; source selection.
- `src/components/MorningDashboard.tsx` — stale/live source pill; reworded empty state.
- Tests: `spreadSpeed.test.ts`, `spreadSpeedLive.test.ts`, `MorningDashboard.test.tsx`.
