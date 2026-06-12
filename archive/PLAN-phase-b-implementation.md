# Phase B implementation — live SPXW 0DTE Signal Stack  ✅ SHIPPED 2026-06-06

> **Status:** implemented & verified — tsc clean, vite build clean, full vitest
> 454 pass / 1 pre-existing unrelated fail (`dateIssueBadges`), 6 new tests green
> (4 live-loader + LIVE-pill + Go-live control), `refresh-spx-0dte-chain.py`
> compiles. **Not yet confirmed end-to-end against live TWS** (needs RTH + live
> options market-data entitlement); degrades to the EOD fallback when the feed is
> absent/stale. New files: `scripts/refresh-spx-0dte-chain.py`,
> `server/spreadSpeedLive.ts`, `server/spreadSpeedLive.test.ts`. Touched:
> `server/spreadSpeed.ts` (exports), `server/index.ts` (routes + auto-start),
> `shared/types.ts` (`live?`), `src/api.ts`, `src/App.tsx`,
> `src/components/MorningDashboard.tsx` (+test), `src/App.css`, `src/App.test.tsx`.


Concrete build notes for the genuine-live path (Phase B = live picks **with** the
live credit/$ Mark). Cloned 1:1 from the SPX live-bars feed pattern
(`server/spxLiveBars.ts` + `scripts/refresh-spx-live-bars.py`). The engine math is
reused unchanged — `buildFrame()` is pure Black–Scholes and already produces the
whole pick from spot + an ATM straddle + the sampled strike marks.

## Verification honesty
The live IBKR pull can only be confirmed end-to-end with **TWS running during RTH
+ a live options market-data subscription**. Everything else (loader→frame,
selection, UI, degradation) is unit-tested and typechecked. When the feed is
absent/stale the route returns `available:false` and the UI falls back to Phase A
(EOD), so the app never breaks when TWS is down or out of hours.

## Contract spec (from IBKR Equity History Pull/daily_spx_ibkr_sync.py)
SPXW 0DTE option: `secType=OPT`, `symbol=SPX`, `exchange=CBOE`, `currency=USD`,
`tradingClass=SPXW`, `lastTradeDateOrContractMonth=<YYYYMMDD today>`,
`strike=<float>`, `right=C|P`, `multiplier=100`. SPX spot: `Index("SPX","CBOE","USD")`.

## Strike grid
Engine `make()` samples `base + off` for off 0..45 step 5 (PCS shorts `base-off`,
longs `base-off-5`; CCS shorts `base+off`, longs `base+off+5`), and `atmStraddle`
probes `base, base±5, ±10, ±15`. So pull **both C and P for strikes
`base-50 … base+50` step 5** (21 strikes × 2 = 42 contracts), where
`base = round(spot/5)*5`. That covers every leg the recommended pick can land on,
so the **$ Mark fills in** (the B deliverable over C).

## Mark selection (per contract)
`mark = last if finite&>0 else mid(bid,ask) if both finite&>0 else close`.
Engine reads `close`, so write the chosen mark into `close`.

## Snapshot file — data/spx-0dte-chain.json
```json
{ "generatedAt":"<ISO ET>", "session":"2026-06-05", "source":"ibkr-live",
  "live":true, "spot":7530.2, "label":"10:14", "asOf":"<ISO ET>",
  "rows":[ {"strike":7530,"right":"C","close":12.3}, ... ] }
```

## Files
1. **scripts/refresh-spx-0dte-chain.py** (new) — clone of refresh-spx-live-bars.py.
   Connect once; loop every ~15s until 16:00 ET: read SPX spot (reqMktData on the
   Index), build the 42-contract grid, reqMktData(marketDataType 1) snapshot each,
   write JSON atomically. Own client-id **948**. Exits at close.
2. **server/spreadSpeed.ts** — `export` `buildFrame`, `TARGET_NET_DELTA`, `FAST`
   (consumed by the live loader; no logic change).
3. **server/spreadSpeedLive.ts** (new) — clone of spxLiveBars.ts process manager
   (start/stop/status/auto-start ~09:28 ET/market-window/log tail, client-id 948,
   file data/spx-0dte-chain.json, log data/spx-0dte-chain-feed.log). `loadLiveSpreadSpeed()`:
   read+sanitize JSON; if missing or `asOf` older than **STALE_MS=180s** →
   `available:false` + note; else assemble calls/puts Maps and call `buildFrame`;
   return SpreadSpeedPayload `{ date:session, frames:[frame], live:true, ... }`.
4. **server/index.ts** — routes `GET /api/spread-speed/live`,
   `GET /api/spread-speed/live/status`, `POST /api/spread-speed/live/start|stop`;
   arm auto-start at boot next to `armSpxLiveBarsAutoStart()`.
5. **shared/types.ts** — add `live?: boolean` to SpreadSpeedPayload (already has
   requestedDate/fallback from Phase A). Reuse `SpxLiveBarsLiveStatus` for status.
6. **src/api.ts** — `fetchLiveSpreadSpeed`, `fetchLiveSpreadSpeedStatus`,
   `startLiveSpreadSpeed`, `stopLiveSpreadSpeed`.
7. **src/App.tsx** — when `morningTracksToday`, poll `/api/spread-speed/live`
   (~20s) into `morningLiveSpreadSpeed`; pass `morningLiveSpreadSpeed.available
   ? live : morningSpreadSpeed` to MorningDashboard. Status + start/stop wired
   through like the Estimator's spxFeed.
8. **src/components/MorningDashboard.tsx** — when `spreadSpeed.live`, show a green
   **LIVE · HH:MM** pill (frame.label) instead of the amber EOD badge; add a compact
   start/stop + status control in the Signal Stack header.
9. **Tests** — spreadSpeedLive.test.ts (JSON→frame; stale guard; missing→unavailable);
   MorningDashboard LIVE-pill render; App selection prefers live over EOD.

## Client-id / port map (avoid contention)
heatmap 941 · holdings 884 · spx-live-bars 947 · **spread-speed-live 948**.
Ports default `7496,4001` (env `SPREAD_SPEED_LIVE_PORTS` / `_CLIENT_ID` override).
