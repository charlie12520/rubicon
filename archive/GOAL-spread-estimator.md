# GOAL — Morning > Estimator: live IBKR 0DTE SPX spreads + portfolio response

Status: planned (build-ready). Scope: **0DTE SPX (`SPXW`, expiring today) only.**

## Objective
Make the existing **Morning > Estimator** screen center on the trader's **current live IBKR 0DTE SPX spreads**:
1. Pull current option positions **directly from IBKR on a ~5-minute cadence**, filter to 0DTE SPX.
2. Show **each spread's estimated move** (credit / cost-to-close vs SPX level).
3. Show a prominent **aggregate portfolio** curve — combined estimated value/P&L over price moves.
4. Keep the existing **custom / what-if** spread tool, but **de-emphasized** (secondary, collapsed).

## This is an extension, not a new feature
The Estimator already exists:
- `src/components/MorningDashboard.tsx` → `screen === "estimator"` (one of `MorningScreen = "brief" | "signal" | "estimator" | "heatmap"`).
- Renders `src/components/SpreadResponsePanel.tsx` — a **manual / recommended single-spread** "credit vs level" tool.
- Backed by `src/spreadResponse.ts` (`predictSpreadResponse`, `creditCurve`, `minutesToCloseFromLabel`) — a **self-calibrated Bachelier model** (validated 2024–26, R²≈0.97) taking `side, shortStrike, width, spot, credit, minutesToClose, level`.

**Reuse that model for every spread.** Do **not** add new Black–Scholes math.

## Locked decisions
- **#1 — Data source (LOCKED): direct live IBKR pull every ~5 min is the source of truth.** Extend the existing direct pull (`scripts/refresh-ibkr-holdings-snapshot.py` → `server/ibkrHoldings.ts`, `/api/ibkr-holdings`, client id 884). Group the live legs into spreads (heuristic 5-wide verticals: pair short/long of the same right + expiry); today's open `TradeRecord`s are **optional labels** only. The **aggregate sums all legs and needs no grouping** (exact).
- **#3 — Custom tool placement (LOCKED): collapsed.** The manual `SpreadResponsePanel` moves **below** the live spreads + aggregate, inside a "Custom spread (what-if)" disclosure collapsed by default. Keep all its functionality.
- #2 — Model: keep `spreadResponse.ts` per spread (default).
- #4 — Per-spread "credit now": live cost-to-close from holdings marks (sum of leg mids), fallback to entry credit.

## Data source & refresh (the 5-min live pull)
- Extend the existing holdings auto-refresh (`server/ibkrHoldings.ts`, currently the 08:30 ET daily window via `shouldFireDailyWindow` + `autoRefreshTimer`).
- Add a **market-hours 5-minute cadence**: on trading days ~09:30–16:15 ET, call the existing `refreshIbkrHoldings()` every ~5 min. Env-configurable (interval + window), defaulting on. Preserve the 08:30 pull and manual refresh.
- Guards (mostly already present): skip if `activeRefresh` is in flight; skip / mark stale if TWS unreachable; keep client id **884** (distinct from sync ids 9300/9393/9494, TC2000 947, FPL) to avoid collisions.
- The snapshot (`ibkr_holdings_snapshot.json`) stays the cache; the Estimator reads the freshest one + can force a refresh.
- Each `IbkrHoldingPosition` already carries `symbol/tradingClass, strike, right, expiration, position (signed), multiplier, marketPrice, underlyingPrice` — enough to build spreads and feed the model. No new IBKR plumbing.

## Filter
`tradingClass === "SPXW"` && `expiration === todayET` && open position. Everything else excluded.

## Aggregation — "combine all spreads"
New pure util (`src/portfolioResponse.ts`, co-located test): sample each spread's `creditCurve(base, xMin, xMax, N)` on a **shared SPX level ladder**, then sum `Σ (perSpreadCredit × contracts × 100 × sign)` per ladder point → portfolio P/L curve + aggregate stats (net P/L at level, net $/pt, combined breakevens). Exact regardless of grouping.

## UI intent (Estimator screen, top → bottom)
1. **Portfolio response (headline):** aggregate credit/P&L vs SPX-level chart over all live 0DTE SPX spreads, with the existing target-level scrubber; net P/L at level, net $/pt, combined breakevens. + "as of HH:MM:SS / next pull in N min" + manual **Refresh positions**.
2. **Your 0DTE SPX spreads (primary list):** one compact row per live spread — side/strikes/width/qty, current credit, mini credit-vs-level sparkline, P/L at the scrubbed level.
3. **Custom spread (what-if) — collapsed:** the existing `SpreadResponsePanel`, below the above, collapsed by default.

## Phased build (each phase = one acceptance criterion + co-located tests, per AGENTS.md)
1. **Selector** — `selectOpenZeroDteSpxSpreads(holdings, todayET, tradeRecords?)` → `[{side, shortStrike, width, contracts, creditNow, spot}]`; fixture tests (non-SPX / non-today excluded; legs paired into verticals).
2. **Aggregation util** — `src/portfolioResponse.ts` summing per-spread `creditCurve`s on a common ladder; unit tests (one spread == its curve; two spreads sum).
3. **5-min live refresh** — extend `server/ibkrHoldings.ts` auto-refresh to a market-hours 5-min cadence (env-configurable; guards above); tests for the window/interval logic (reuse `easternClock`/`shouldFireDailyWindow` patterns).
4. **UI revision (main work)** — restructure the `screen === "estimator"` block: portfolio headline + per-spread list primary; collapse `SpreadResponsePanel` into a secondary "Custom (what-if)" disclosure. Reuse the existing scrubber/curve SVG style.
5. **Tests / validation / docs** — `npm run validate:mvp`; update `WORKLOG.md`, `ACCEPTANCE_CRITERIA.md` + `naive_acceptance.md`, and `codebase.md` / `detailedcodebase.md`.

## Acceptance criteria (draft)
- **AC-EST-1:** Estimator lists each live 0DTE SPX spread with a credit-vs-level curve + P/L at the scrubbed level; non-SPX / non-today excluded.
- **AC-EST-2:** A prominent aggregate portfolio curve = exact sum of the live spreads (net P/L at level + combined breakevens); reconciles to current net at spot.
- **AC-EST-3:** Positions refresh automatically from IBKR ~every 5 min during market hours (+ manual refresh); in-flight/unreachable/empty/closed states handled.
- **AC-EST-4:** The custom/manual spread tool remains available but secondary (collapsed, below the live spreads + aggregate).

## Risks / notes
- Live-mark availability per leg → fallback to entry / model credit.
- 0DTE time decay as `minutesToClose → 0` (model handles; clamp tiny values).
- Net holdings → per-spread grouping is heuristic; the **aggregate** is exact (sums legs). `TradeRecord`s refine labels when present.
- 5-min cadence requires TWS/Gateway up; gate to market hours and skip when in-flight/unreachable to avoid connection churn.
- AGENTS.md: small patches, co-located tests, don't disturb the user's running instance, expect concurrent agents.
