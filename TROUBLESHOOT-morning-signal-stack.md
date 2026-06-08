# Morning › Signal Stack — "live picks unavailable" (2026-06-05)

## Symptom
Morning cockpit → **Signal Stack** tab shows **"No live pick"** with
"Spread-speed data is unavailable." for both PCS and CCS cards.

## Root cause (confirmed)
The Signal Stack is **not wired to a live feed**. It reads only date-keyed
**EOD CSV sidecars** produced by the daily pull.

Data flow:
- `App.tsx` sets `morningDate = easternDateOffset(0)` → **today** (2026-06-05).
- `fetchSpreadSpeed(today)` → `GET /api/spread-speed?date=2026-06-05`.
- `server/spreadSpeed.ts` → `buildSafeSpreadSpeedPayload(date)` reads:
  - SPX intraday bars: `ibkr_trades/<date>/google_sheet_tab_csvs/SPX_5s.csv`
    | `SPX_1m.csv` | `ibkr_option_intraday/underlying_1m.csv`
  - Option legs: `ibkr_trades/<date>/ibkr_option_intraday/option_leg_trades_5s.csv`
    | `option_leg_trades_1m.csv`
- If either is missing → `available:false`,
  note "No SPX intraday bars for this date." → frontend `latestSpreadFrame`
  returns null → **"Spread-speed data is unavailable."**
- Frontend gate: `MorningDashboard.tsx:1659` `latestSpreadFrame` requires
  `payload.available && payload.frames.length`.

### Evidence
- `ibkr_trades/` has **no `2026-06-05` directory at all** (today not pulled).
- Latest full day = `2026-06-04`: has `ibkr_option_intraday/option_leg_trades_5s.csv`
  + `rubicon_spread_speed_state.json` with `available:true` and full frames/picks.
- `option_leg_trades_5s.csv` for 06-04 was written **21:01 ET** (after close) —
  i.e. the date dir is populated only by the post-close daily pull.

**Conclusion:** "live picks" for the *current* day can never appear in the
morning, by construction — today's directory doesn't exist until the EOD pull
(~after close). The label "live" is misleading; the engine is EOD-fed.

## What the engine actually needs (for a genuine live path)
`buildFrame()` is analytic (Black–Scholes `callNd1`); per minute it needs:
1. **SPX spot** — already available live via `startSpxLiveBars` / SPX live feed.
2. **ATM straddle** (`atmStraddle`) → derives `sigma` and `EM`. Needs live
   0DTE SPXW call+put marks at ~ATM (a handful of strikes).
3. (optional) OTM leg marks for the `value`/Mark field — without them picks
   still compute (netDelta/regime/recommend), only the `$ Mark` is blank.

So the only genuinely missing live input is a **small live SPXW 0DTE chain
snapshot** (ATM ± a few strikes, plus the OTM strikes near 0.05Δ).

## Options

### A. Clarity + graceful fallback (low effort, no IBKR work)
- When today's payload is `available:false`, **auto-fall back to the most
  recent date that has frames**, badge it "as of 2026-06-04 (EOD)".
- Reword the empty state: "Today's chain hasn't been pulled yet — picks
  appear after the daily pull (post-close). Showing last session / pick a
  date." Make the morning calendar date obviously selectable.
- Net: stops the dead-end "unavailable" and lets the user view the last real
  Signal Stack immediately. Does NOT make it live.

### B. True live morning snapshot (the real fix, medium effort)
- New server route, e.g. `GET /api/spread-speed/live?date=today`, that:
  - pulls live SPX spot (existing feed), and
  - requests a **live SPXW 0DTE chain snapshot** from IBKR/TWS — ATM ± N
    strikes + OTM strikes out to ~45pt (matches `make()` offsets 0..45 step5).
  - feeds spot+chain into the existing `buildFrame()` (reuse as-is).
- Frontend: when `morningTracksToday`, poll the live route (e.g. 15–30s) and
  pass the resulting frame into `SignalStackSection`.
- Requires TWS/IBKR up during the morning (same dependency as Estimator's
  live SPX feed and IBKR holdings refresh).

### C. Lightweight ATM-only snapshot (smallest live version)
- Like B but pull only ATM ± ~10 strikes (enough for `atmStraddle` → sigma/EM)
  and synthesize OTM leg marks analytically (leave `value` null). Cheapest
  IBKR request; picks/regime/recommend all still render, only `$ Mark` blank.

## Recommendation
Ship **A** now (removes the dead-end, zero IBKR dependency), then scope **C**
as the minimum genuine-live path; promote to **B** if live OTM marks are wanted.

## Open questions for owner
- Should the morning Signal Stack be live-for-today, or is "last session's
  frame" acceptable? (Decides A-only vs A+C/B.)
- Is TWS reliably running during the AM window? (Gates B/C.)
