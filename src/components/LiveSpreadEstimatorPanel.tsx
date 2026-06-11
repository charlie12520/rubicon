import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { IbkrHoldingsSnapshot, SpxBar, SpxLiveBarsLiveStatus, TradeRecord } from "../../shared/types";
import { buildPortfolioResponse } from "../portfolioResponse";
import {
  activeSpreadsForResponse,
  type EstimatorSpreadOption,
  selectOpenZeroDteSpxSpreads,
  todayClosedSpxSpreads,
} from "../spreadEstimator";
import { currentMinutesToClose } from "../estimatorClock";
import { minutesToCloseFromLabel } from "../spreadResponse";
import { coneScaleFromSpreads, expectedMoveCone, type ExpectedMoveCone } from "../expectedMoveCone";
import { buildThetaSpeedCurve, resolveMoveScale } from "../thetaSpeedCurve";
import type { EstimatorLiveState } from "../estimatorLiveState";
import { EstimatorSpxChart } from "./EstimatorSpxChart";
import { ThetaSpeedCurvePanel, type ThetaSpeedMarker } from "./ThetaSpeedCurvePanel";

type Props = {
  holdings: IbkrHoldingsSnapshot | null;
  todayEt: string; // selected/today ET date, "YYYY-MM-DD"
  refreshing?: boolean;
  onRefresh?: () => void;
  live?: EstimatorLiveState; // auto-refresh / freshness state for the LIVE pill
  // Today's tracker trades — source for the closed-spread chips. Closed trades
  // are study material only and never enter the portfolio aggregate.
  trades?: TradeRecord[];
  // SPX intraday bars for the 2-min chart (live feed preferred, replay fallback).
  // May be empty before either source has data; the chart shows an empty-state.
  spxBars?: SpxBar[];
  // True when `spxBars` came from the live SPX feed (vs the post-close replay).
  spxBarsLive?: boolean;
  // Start/stop + status for the dedicated live SPX bar sidecar.
  spxFeed?: SpxFeedControl;
};

type SpxFeedControl = {
  status: SpxLiveBarsLiveStatus | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
};

const muted: CSSProperties = { fontSize: 11, color: "#9ca3af" };

function interpPnl(points: Array<{ level: number; pnl: number }>, level: number): number {
  if (points.length === 0) return 0;
  if (level <= points[0].level) return points[0].pnl;
  if (level >= points[points.length - 1].level) return points[points.length - 1].pnl;
  for (let i = 1; i < points.length; i++) {
    if (level <= points[i].level) {
      const a = points[i - 1];
      const b = points[i];
      const t = (level - a.level) / (b.level - a.level || 1);
      return a.pnl + t * (b.pnl - a.pnl);
    }
  }
  return points[points.length - 1].pnl;
}

const fmtUsd = (value: number): string => `${value >= 0 ? "+" : "−"}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const timeOnly = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
};

export function LiveSpreadEstimatorPanel({ holdings, todayEt, refreshing, onRefresh, live, trades, spxBars, spxBarsLive, spxFeed }: Props) {
  const selection = useMemo(
    () => selectOpenZeroDteSpxSpreads(holdings?.positions ?? [], todayEt),
    [holdings, todayEt],
  );
  // When there are no open SPX positions to read spot from (e.g. studying a
  // closed trade after flatting), fall back to the latest SPX bar so the chart
  // and curve still have a price reference.
  const bars = useMemo(() => spxBars ?? [], [spxBars]);
  const spot = useMemo(() => {
    if (selection.spot != null) return selection.spot;
    if (bars.length > 0) return bars[bars.length - 1].close;
    return null;
  }, [selection.spot, bars]);

  // Tick a wall clock (live only) so the expected-move cone and the P/L curve's theta
  // keep advancing toward 16:00 ET even when holdings/bars aren't refreshing. Without
  // this, minutesToClose was memoized on [holdings] and the cone width froze between
  // (gated) holdings polls. Replay anchors to the bar clock instead, so it doesn't tick.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (spxBarsLive === false) return;
    const id = window.setInterval(() => setNowTs(Date.now()), 20_000);
    return () => window.clearInterval(id);
  }, [spxBarsLive]);
  const minutesToClose = useMemo(() => currentMinutesToClose(new Date(nowTs)), [nowTs]);

  const openOptions = useMemo<EstimatorSpreadOption[]>(
    () => selection.spreads.map((spread) => ({ spread, status: "open" as const })),
    [selection.spreads],
  );
  const closedOptions = useMemo<EstimatorSpreadOption[]>(
    () => (spot != null && trades ? todayClosedSpxSpreads(trades, todayEt, spot) : []),
    [trades, todayEt, spot],
  );
  const allOptions = useMemo<EstimatorSpreadOption[]>(
    () => [...openOptions, ...closedOptions],
    [openOptions, closedOptions],
  );

  const [focusedSpreadId, setFocusedSpreadId] = useState<string | null>(null);
  const [coneEnabled, setConeEnabled] = useState(true);
  // Auto-clear focus if the focused spread leaves the available set (e.g. a live
  // pull removes the open spread, or the user changes the selected date). Focus
  // is only ever set from ids in the set, so a change to the set is the trigger.
  const [prevAllOptions, setPrevAllOptions] = useState(allOptions);
  if (prevAllOptions !== allOptions) {
    setPrevAllOptions(allOptions);
    if (focusedSpreadId && !allOptions.some((option) => option.spread.id === focusedSpreadId)) {
      setFocusedSpreadId(null);
    }
  }
  const focusedOption = useMemo(
    () => (focusedSpreadId ? allOptions.find((option) => option.spread.id === focusedSpreadId) ?? null : null),
    [focusedSpreadId, allOptions],
  );

  const activeSpreads = useMemo(
    () => activeSpreadsForResponse(openOptions, allOptions, focusedSpreadId),
    [openOptions, allOptions, focusedSpreadId],
  );

  const response = useMemo(() => {
    if (spot == null || activeSpreads.length === 0) return null;
    return buildPortfolioResponse(activeSpreads, { spot, minutesToClose });
  }, [activeSpreads, spot, minutesToClose]);

  // Forward expected-move cone (now → 16:00 ET). Width comes from the live spreads'
  // implied move-scale (same vol as the P/L curve), falling back to a typical-day
  // prior; in replay the horizon anchors to the last bar's clock, not wall-clock now.
  const coneMinutesToClose = useMemo(() => {
    if (spxBarsLive === false && bars.length > 0) {
      const m = minutesToCloseFromLabel(bars[bars.length - 1].label);
      if (m != null) return m;
    }
    return minutesToClose;
  }, [spxBarsLive, bars, minutesToClose]);
  const coneScale = useMemo(
    () => coneScaleFromSpreads(activeSpreads, spot ?? 0, coneMinutesToClose),
    [activeSpreads, spot, coneMinutesToClose],
  );
  const cone = useMemo<ExpectedMoveCone | null>(() => {
    if (!coneEnabled || spot == null) return null;
    return expectedMoveCone({
      anchorSpot: spot,
      anchorMinutesToClose: coneMinutesToClose,
      scale: coneScale,
      levels: [1, 1.645, 2],
      stepMinutes: 2,
    });
  }, [coneEnabled, spot, coneMinutesToClose, coneScale]);

  // θ/speed-across-strikes curve: structural edge-ratio curve using the portfolio's
  // shared move-scale (same coneScale the expected-move cone uses), independent of the
  // target-level slider. Marks each active spread's short strike on the curve.
  const thetaCurve = useMemo(() => {
    if (spot == null) return null;
    const moveScale = resolveMoveScale(coneScale, minutesToClose);
    return buildThetaSpeedCurve({ spot, minutesToClose, moveScale });
  }, [spot, minutesToClose, coneScale]);

  const [level, setLevel] = useState<number | null>(null);
  // The slider tracks spot until the user drags: each new spot tick re-pins the
  // level (matching the old mirror effect), so a drag holds until the next tick.
  const [prevSpot, setPrevSpot] = useState(spot);
  if (prevSpot !== spot) {
    setPrevSpot(spot);
    setLevel(spot);
  }
  const activeLevel = level ?? spot ?? 0;

  const refreshBtn = (
    <button
      type="button"
      onClick={() => onRefresh?.()}
      disabled={refreshing}
      style={{ background: "#111827", border: "1px solid #334155", color: "#cbd5e1", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: refreshing ? "default" : "pointer" }}
    >
      {refreshing ? "Pulling…" : "⟳ Refresh positions"}
    </button>
  );

  if (!response) {
    // No active curve to plot — but if there are any chips to show (open OR
    // closed) we still render the rail so the user can click into a closed
    // trade for study.
    if (allOptions.length === 0) {
      return (
        <section style={wrap}>
          <Header asOf={holdings?.fetchedAt} openCount={0} totalContracts={0} spot={spot} refreshBtn={refreshBtn} live={live} focusedOption={null} onClearFocus={() => setFocusedSpreadId(null)} />
          <p style={{ ...muted, marginTop: 10 }}>
            {holdings == null
              ? "Waiting for the IBKR positions pull…"
              : spot == null
                ? "No open 0DTE SPX option positions found in the live IBKR pull."
                : "No 0DTE SPX vertical spreads could be formed from the current legs."}
          </p>
          {selection.unpaired.length > 0 && <UnpairedNote count={selection.unpaired.length} />}
        </section>
      );
    }
    return (
      <section style={wrap}>
        <Header asOf={holdings?.fetchedAt} openCount={openOptions.length} totalContracts={0} spot={spot} refreshBtn={refreshBtn} live={live} focusedOption={focusedOption} onClearFocus={() => setFocusedSpreadId(null)} />
        <ChipRail
          openOptions={openOptions}
          closedOptions={closedOptions}
          focusedSpreadId={focusedSpreadId}
          onPick={setFocusedSpreadId}
        />
        <p style={{ ...muted, marginTop: 10 }}>
          {spot == null
            ? "Spot unknown — waiting for SPX intraday bars or an open SPX position."
            : "Click a closed spread above to study it."}
        </p>
        {selection.unpaired.length > 0 && <UnpairedNote count={selection.unpaired.length} />}
      </section>
    );
  }

  const pnlAtLevel = interpPnl(response.aggregate, activeLevel);
  const pnls = response.aggregate.map((p) => p.pnl);
  const worst = Math.min(...pnls);
  const best = Math.max(...pnls);
  const pnlSign: 1 | -1 | 0 = pnlAtLevel > 0 ? 1 : pnlAtLevel < 0 ? -1 : 0;
  const sliderMin = Math.min(response.levelMin, activeLevel);
  const sliderMax = Math.max(response.levelMax, activeLevel);
  const portfolioMode = focusedOption == null;

  // Theta totals across the active rows (portfolio in portfolio mode, the one spread
  // in focus mode). θ/hr scales by contracts; the edge ratio is the contract-weighted blend.
  const decayPerHourTotal = response.rows.reduce((sum, r) => sum + r.decayNextHourDollars * r.spread.contracts, 0);
  const speedTotal = response.rows.reduce((sum, r) => sum + r.dollarsPerPointNow * r.spread.contracts, 0);
  const portfolioThetaPerSpeed = speedTotal > 1e-9 ? decayPerHourTotal / speedTotal : 0;
  const thetaMarkers: ThetaSpeedMarker[] = response.rows.map((r) => ({
    strike: r.spread.shortStrike,
    side: r.spread.side,
    label: `${r.spread.side === "call_credit" ? "CCS" : "PCS"} ${r.spread.shortStrike}`,
  }));

  return (
    <section style={wrap}>
      <Header asOf={holdings?.fetchedAt} openCount={openOptions.length} totalContracts={portfolioMode ? response.totalContracts : openOptions.reduce((sum, option) => sum + option.spread.contracts, 0)} spot={spot} refreshBtn={refreshBtn} live={live} focusedOption={focusedOption} onClearFocus={() => setFocusedSpreadId(null)} />

      <ChipRail
        openOptions={openOptions}
        closedOptions={closedOptions}
        focusedSpreadId={focusedSpreadId}
        onPick={setFocusedSpreadId}
      />

      {/* Aggregate / focused-spread P/L vs SPX */}
      <div style={{ marginTop: 10, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div style={muted}>{portfolioMode ? "portfolio" : "spread"} P/L if SPX → {activeLevel.toFixed(0)} (move {activeLevel - response.spot >= 0 ? "+" : ""}{(activeLevel - response.spot).toFixed(0)}pt)</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: pnlAtLevel >= 0 ? "#22c55e" : "#ef4444" }}>{fmtUsd(pnlAtLevel)}</div>
        </div>
        <div>
          <div style={muted}>worst / best in range</div>
          <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "#ef4444" }}>{fmtUsd(worst)}</span> · <span style={{ color: "#22c55e" }}>{fmtUsd(best)}</span>
          </div>
        </div>
        <div title="Credit that decays in your favor over the next hour if SPX holds (Bachelier theta, clamps into the close). θ/speed = $-to-time per $-at-risk per point.">
          <div style={muted}>{portfolioMode ? "portfolio" : "spread"} θ/hr · θ/speed</div>
          <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#86efac" }}>
            {fmtUsd(decayPerHourTotal)}/hr · {portfolioThetaPerSpeed.toFixed(1)}x
          </div>
        </div>
      </div>

      {/* The P/L-vs-SPX curve and the SPX 2-min intraday chart sit side by side
          (they wrap on narrow widths); the target-level slider below drives both. */}
      <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 340px", minWidth: 300 }}>
          <div style={{ ...muted, fontWeight: 600, marginBottom: 4 }}>{portfolioMode ? "portfolio" : "spread"} P/L vs SPX level</div>
          <AggregateChart response={response} level={activeLevel} pnlAtLevel={pnlAtLevel} />
        </div>
        <div style={{ flex: "1 1 340px", minWidth: 300 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ ...muted, fontWeight: 600 }}>SPX intraday · 2m</span>
            {bars.length > 0 && (
              <span style={sourceBadge(spxBarsLive ? "#22c55e" : "#9ca3af")}>{spxBarsLive ? "LIVE" : "replay"}</span>
            )}
            <SpxFeedButton feed={spxFeed} />
          </div>
          {bars.length > 0 && (
            <ConeControls enabled={coneEnabled} onToggle={() => setConeEnabled((v) => !v)} cone={cone} />
          )}
          <EstimatorSpxChart bars={bars} targetLevel={activeLevel} spot={spot} pnlSign={pnlSign} emptyNote={spxBarsEmptyNote(spxFeed)} cone={cone} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <span style={muted}>target level</span>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          step={1}
          value={Math.min(Math.max(activeLevel, sliderMin), sliderMax)}
          onChange={(e) => setLevel(Number(e.target.value))}
          style={{ flex: 1, minWidth: 160 }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {([["spot", response.spot], ["−25", response.spot - 25], ["+25", response.spot + 25], ["−50", response.spot - 50], ["+50", response.spot + 50]] as const).map(([lab, val]) => (
            <button key={lab} type="button" onClick={() => setLevel(val)} style={{ background: "#111827", border: "1px solid #334155", color: "#cbd5e1", borderRadius: 5, padding: "2px 6px", fontSize: 10.5, cursor: "pointer" }}>{lab}</button>
          ))}
        </div>
      </div>

      {/* Per-spread list — shows all openOptions in portfolio mode, or just the focused row in focus mode. */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ ...muted, fontWeight: 600 }}>{portfolioMode ? "spreads" : "focused spread"}</div>
        {response.rows.map((row) => {
          const pnl = interpPnl(row.curve, activeLevel);
          const s = row.spread;
          return (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto auto", gap: 10, alignItems: "center", padding: "6px 8px", background: "#0a0f1a", border: "1px solid #1f2937", borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: s.side === "call_credit" ? "#fca5a5" : "#93c5fd" }}>
                  {s.side === "call_credit" ? "CCS" : "PCS"} {s.shortStrike}/{s.longStrike}
                </div>
                <div style={muted}>{s.contracts}x · w{s.width} · credit {s.creditNow != null ? `$${s.creditNow.toFixed(2)}` : "—"} · θ/spd {row.thetaPerSpeed.toFixed(1)}x</div>
              </div>
              <Sparkline curve={row.curve} level={activeLevel} />
              <div style={{ textAlign: "right" }}>
                <div style={muted}>P/L @ {activeLevel.toFixed(0)}</div>
                <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: pnl >= 0 ? "#22c55e" : "#ef4444" }}>{fmtUsd(pnl)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={muted}>$/pt</div>
                <div style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "#cbd5e1" }}>${Math.round(row.dollarsPerPointNow * s.contracts)}</div>
              </div>
              <div style={{ textAlign: "right" }} title="Credit that decays in your favor over the next hour if SPX holds (Bachelier theta; clamps into the close)">
                <div style={muted}>θ/hr</div>
                <div style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "#86efac" }}>${Math.round(row.decayNextHourDollars * s.contracts)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* θ/speed across strikes — the structural edge-ratio curve, with the active
          spreads dotted onto it. A graph of where each strike sits, not a per-spread list. */}
      {thetaCurve && thetaCurve.points.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ ...muted, fontWeight: 600 }}>θ decay per unit speed across strikes</div>
          <div style={{ ...muted, marginTop: 2 }}>
            time-edge ÷ directional risk — higher = more credit decay per $ at risk to a 1pt move. Rises the further OTM the short strike sits.
          </div>
          <ThetaSpeedCurvePanel curve={thetaCurve} markers={thetaMarkers} />
        </div>
      )}

      {selection.unpaired.length > 0 && <UnpairedNote count={selection.unpaired.length} />}

      <p style={{ ...muted, marginTop: 8, marginBottom: 0 }}>
        Self-calibrated from each spread's live credit (Bachelier model), held to ~{Math.round(minutesToClose)}m to close. Aggregate sums all legs and is exact regardless of how legs were paired. θ/hr = credit decaying in your favor over the next hour if SPX holds — the typical outcome; an adverse move can erase it.
      </p>
    </section>
  );
}

const wrap: CSSProperties = { marginTop: 4, padding: "12px 14px", background: "#0b1220", border: "1px solid #1f2937", borderRadius: 10, color: "#e5e7eb" };

function Header({
  asOf,
  openCount,
  totalContracts,
  spot,
  refreshBtn,
  live,
  focusedOption,
  onClearFocus,
}: {
  asOf?: string | null;
  openCount: number;
  totalContracts: number;
  spot: number | null;
  refreshBtn: ReactNode;
  live?: EstimatorLiveState;
  focusedOption: EstimatorSpreadOption | null;
  onClearFocus: () => void;
}) {
  const focusedSubtitle = (() => {
    if (!focusedOption) return null;
    const s = focusedOption.spread;
    const tag = s.side === "call_credit" ? "CCS" : "PCS";
    const head = `Focused: ${tag} ${s.shortStrike}/${s.longStrike} ×${s.contracts}`;
    if (focusedOption.status === "open") return `${head} · open`;
    const pieces = [head, "closed"];
    if (focusedOption.exitTimeLabel) pieces.push(focusedOption.exitTimeLabel);
    if (focusedOption.realisedPnl != null) {
      pieces.push(`realised ${fmtUsd(focusedOption.realisedPnl)}`);
    }
    return `${pieces.join(" · ")} (study only — not in portfolio)`;
  })();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Your live 0DTE SPX spreads</h3>
          <LivePill live={live} />
          {focusedOption && (
            <button
              type="button"
              onClick={onClearFocus}
              title="Return to the live portfolio aggregate"
              style={{ background: "#0f172a", border: "1px solid #38bdf8", color: "#38bdf8", borderRadius: 999, padding: "2px 9px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.02em", cursor: "pointer" }}
            >
              ← View Portfolio
            </button>
          )}
        </div>
        <div style={muted}>
          {focusedSubtitle ?? `${openCount} open spread${openCount === 1 ? "" : "s"} · ${totalContracts} contracts · SPX ${spot != null ? spot.toFixed(2) : "—"} · positions as of ${timeOnly(asOf)}`}
        </div>
      </div>
      {refreshBtn}
    </div>
  );
}

// Horizontal chip rail of today's spreads. Open chips first (live colors), then
// closed chips (muted, dashed). Clicking focuses the estimator on that single
// spread; the View Portfolio button in the header restores the aggregate.
function ChipRail({
  openOptions,
  closedOptions,
  focusedSpreadId,
  onPick,
}: {
  openOptions: EstimatorSpreadOption[];
  closedOptions: EstimatorSpreadOption[];
  focusedSpreadId: string | null;
  onPick: (id: string) => void;
}) {
  if (openOptions.length === 0 && closedOptions.length === 0) return null;
  return (
    <div role="group" aria-label="Today's spreads" style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
      {openOptions.map((option) => (
        <SpreadChip key={option.spread.id} option={option} active={option.spread.id === focusedSpreadId} onClick={() => onPick(option.spread.id)} />
      ))}
      {openOptions.length > 0 && closedOptions.length > 0 && (
        <span aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "#1f2937", margin: "0 2px" }} />
      )}
      {closedOptions.map((option) => (
        <SpreadChip key={option.spread.id} option={option} active={option.spread.id === focusedSpreadId} onClick={() => onPick(option.spread.id)} />
      ))}
    </div>
  );
}

function SpreadChip({ option, active, onClick }: { option: EstimatorSpreadOption; active: boolean; onClick: () => void }) {
  const s = option.spread;
  const isCcs = s.side === "call_credit";
  const tag = isCcs ? "CCS" : "PCS";
  const sideColor = isCcs ? "#fca5a5" : "#93c5fd";
  const open = option.status === "open";
  const pnlColor = option.realisedPnl != null ? (option.realisedPnl >= 0 ? "#22c55e" : "#ef4444") : "#9ca3af";
  const baseStyle: CSSProperties = {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 1,
    padding: "4px 8px",
    background: open ? "#0a0f1a" : "rgba(10, 15, 26, 0.55)",
    color: "#e5e7eb",
    border: open ? "1px solid #1f2937" : "1px dashed #334155",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
  };
  const activeStyle: CSSProperties = active
    ? { outline: "2px solid #38bdf8", outlineOffset: 0, borderColor: "#38bdf8", background: open ? "#0f172a" : "rgba(15, 23, 42, 0.7)" }
    : {};
  return (
    <button type="button" aria-pressed={active} onClick={onClick} style={{ ...baseStyle, ...activeStyle }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: sideColor }}>{tag} {s.shortStrike}/{s.longStrike}</span>
      <span style={{ fontSize: 10.5, color: open ? "#9ca3af" : "#6b7280", display: "flex", gap: 6, alignItems: "baseline" }}>
        <span>×{s.contracts}</span>
        {open ? (
          <span>· credit {s.creditNow != null ? `$${s.creditNow.toFixed(2)}` : "—"}</span>
        ) : (
          <>
            {option.exitTimeLabel && <span>· exited {option.exitTimeLabel}</span>}
            {option.realisedPnl != null && <span style={{ color: pnlColor, fontWeight: 700 }}>· {fmtUsd(option.realisedPnl)}</span>}
          </>
        )}
      </span>
    </button>
  );
}

// Live/stale/closed pill driven by estimatorLiveState — the green pulsing dot is
// the "it's live" indicator; the cadence + last-update detail is in the tooltip.
function LivePill({ live }: { live?: EstimatorLiveState }) {
  if (!live) return null;
  const color = live.phase === "LIVE" ? "#22c55e" : live.phase === "STALE" ? "#d97706" : "#9ca3af";
  return (
    <span
      aria-live="polite"
      title={live.detail}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "1px 8px",
        borderRadius: 999,
        border: `1px solid ${color}55`,
        background: `${color}1a`,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.03em",
        color,
        whiteSpace: "nowrap",
      }}
    >
      <span className={`estimator-live-dot${live.pulsing ? " on" : ""}`} aria-hidden="true" />
      {live.label}
    </span>
  );
}

function sourceBadge(color: string): CSSProperties {
  return {
    padding: "0px 6px",
    borderRadius: 999,
    border: `1px solid ${color}66`,
    background: `${color}1a`,
    color,
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: "0.04em",
  };
}

function spxBarsEmptyNote(feed?: SpxFeedControl): string {
  const status = feed?.status;
  if (!status) return "Waiting for SPX intraday bars";
  if (status.running) return "SPX feed running — first bars land within ~15s";
  if (status.marketOpen === false) return "SPX feed runs 09:30–16:00 ET on weekdays";
  if (status.available === false) return "SPX live-bar script not found on the server";
  return "Start the SPX feed to see live intraday bars";
}

// Start/Stop control for the dedicated live SPX bar sidecar (mirrors the heatmap
// feed button). Refuses to start outside the RTH window.
function SpxFeedButton({ feed }: { feed?: SpxFeedControl }) {
  if (!feed) return null;
  const status = feed.status;
  const running = Boolean(status?.running);
  const btnStyle: CSSProperties = {
    background: "#111827",
    border: "1px solid #334155",
    color: "#cbd5e1",
    borderRadius: 6,
    padding: "2px 8px",
    fontSize: 10,
    cursor: feed.busy ? "default" : "pointer",
    whiteSpace: "nowrap",
  };
  if (running) {
    return (
      <button type="button" onClick={feed.onStop} disabled={feed.busy} style={btnStyle} title="Stop the live SPX bar feed">
        ■ Stop SPX feed
      </button>
    );
  }
  const blocked = status?.marketOpen === false || status?.available === false;
  return (
    <button
      type="button"
      onClick={feed.onStart}
      disabled={feed.busy || blocked}
      style={{ ...btnStyle, opacity: blocked ? 0.5 : 1 }}
      title={status?.marketOpen === false ? "Market closed — the SPX feed only runs 09:30–16:00 ET, Mon–Fri" : "Start the live SPX bar feed"}
    >
      {feed.busy ? "Starting…" : "▶ Start SPX feed"}
    </button>
  );
}

// Cone on/off pill + legend. The ±1.645σ band is the credit-seller's ~0.05Δ frontier.
function ConeControls({ enabled, onToggle, cone }: { enabled: boolean; onToggle: () => void; cone: ExpectedMoveCone | null }) {
  const pill: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    borderRadius: 999,
    border: `1px solid ${enabled ? "#38bdf8" : "#334155"}`,
    background: enabled ? "#0f243a" : "#0a0f1a",
    color: enabled ? "#7dd3fc" : "#9ca3af",
    fontSize: 10.5,
    fontWeight: 700,
    cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
      <button type="button" aria-pressed={enabled} onClick={onToggle} style={pill} title="Forward expected-move band from spot to 16:00 ET">
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: enabled ? "#38bdf8" : "#475569" }} />
        Expected-move cone
      </button>
      {enabled && cone && (
        <span
          style={{ ...muted, display: "inline-flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}
          title={`Gaussian expected move from spot to 16:00 ET (s = r·√t). ±1.645σ ≈ the ~0.05Δ short strike a credit seller targets (one-sided ~5% tail). Width is scaled to ${cone.scaleKind === "implied" ? "today's implied vol, backed out of your live spreads" : "a typical day (no live spreads on screen)"}. Jumps and fat tails breach it more than the nominal rate.`}
        >
          <ConeKey color="#38bdf8" label="1σ" />
          <ConeKey color="#f59e0b" label="1.6σ · 0.05Δ" dashed />
          <ConeKey color="#94a3b8" label="2σ" />
          <span style={{ color: "#64748b" }}>
            ±{Math.round(cone.sAtClose)}pt → close · {cone.scaleKind === "implied" ? "live IV" : "typical day"}
          </span>
        </span>
      )}
    </div>
  );
}

function ConeKey({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span aria-hidden="true" style={{ width: 14, borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`, display: "inline-block" }} />
      <span style={{ color: "#cbd5e1" }}>{label}</span>
    </span>
  );
}

function UnpairedNote({ count }: { count: number }) {
  return (
    <p style={{ ...muted, marginTop: 8, marginBottom: 0, color: "#d97706" }}>
      {count} 0DTE SPX leg{count === 1 ? "" : "s"} could not be paired into a vertical (still counted in the aggregate).
    </p>
  );
}

function Sparkline({ curve, level }: { curve: Array<{ level: number; pnl: number }>; level: number }) {
  const W = 96, H = 30;
  if (curve.length < 2) return <svg width={W} height={H} />;
  const xs = curve.map((p) => p.level);
  const ys = curve.map((p) => p.pnl);
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const xpx = (v: number) => ((v - xMin) / (xMax - xMin || 1)) * W;
  const ypx = (v: number) => H - ((v - yMin) / (yMax - yMin || 1)) * H;
  const path = curve.map((p, i) => `${i ? "L" : "M"}${xpx(p.level).toFixed(1)},${ypx(p.pnl).toFixed(1)}`).join(" ");
  const lx = Math.min(Math.max(level, xMin), xMax);
  return (
    <svg width={W} height={H} role="img" aria-label="spread P/L sparkline">
      {yMin < 0 && yMax > 0 && <line x1={0} y1={ypx(0)} x2={W} y2={ypx(0)} stroke="#374151" strokeDasharray="2 2" />}
      <path d={path} fill="none" stroke="#38bdf8" strokeWidth={1.5} />
      <line x1={xpx(lx)} y1={0} x2={xpx(lx)} y2={H} stroke="#64748b" strokeWidth={1} />
    </svg>
  );
}

function AggregateChart({ response, level, pnlAtLevel }: { response: ReturnType<typeof buildPortfolioResponse>; level: number; pnlAtLevel: number }) {
  const VW = 580, VH = 190, ML = 50, MR = 12, MT = 10, MB = 22;
  const PW = VW - ML - MR, PH = VH - MT - MB;
  const xs = response.aggregate.map((p) => p.level);
  const ys = response.aggregate.map((p) => p.pnl);
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys);
  const yPad = (yMax - yMin) * 0.08 || 1;
  const yLo = yMin - yPad, yHi = yMax + yPad;
  const xpx = (v: number) => ML + ((v - xMin) / (xMax - xMin || 1)) * PW;
  const ypx = (v: number) => MT + (1 - (v - yLo) / (yHi - yLo || 1)) * PH;
  const path = response.aggregate.map((p, i) => `${i ? "L" : "M"}${xpx(p.level).toFixed(1)},${ypx(p.pnl).toFixed(1)}`).join(" ");
  const lx = Math.min(Math.max(level, xMin), xMax);
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", height: "auto", marginTop: 8, display: "block" }} role="img" aria-label="portfolio P/L vs SPX level">
      <rect x={ML} y={MT} width={PW} height={PH} fill="#0a0f1a" stroke="#1f2937" />
      {yLo < 0 && yHi > 0 && (
        <>
          <line x1={ML} y1={ypx(0)} x2={ML + PW} y2={ypx(0)} stroke="#475569" strokeDasharray="3 3" />
          <text x={4} y={ypx(0) + 3} fill="#6b7280" fontSize={9}>$0</text>
        </>
      )}
      <text x={4} y={ypx(yHi) + 8} fill="#6b7280" fontSize={9}>{fmtUsd(yHi)}</text>
      <text x={4} y={ypx(yLo)} fill="#6b7280" fontSize={9}>{fmtUsd(yLo)}</text>
      <path d={path} fill="none" stroke="#38bdf8" strokeWidth={2} />
      <line x1={xpx(response.spot)} y1={MT} x2={xpx(response.spot)} y2={MT + PH} stroke="#64748b" strokeWidth={1} />
      <text x={xpx(response.spot)} y={VH - 6} fill="#94a3b8" fontSize={9} textAnchor="middle">spot {response.spot.toFixed(0)}</text>
      <line x1={xpx(lx)} y1={MT} x2={xpx(lx)} y2={MT + PH} stroke={pnlAtLevel >= 0 ? "#22c55e" : "#ef4444"} strokeWidth={1.5} />
      <circle cx={xpx(lx)} cy={ypx(pnlAtLevel)} r={4} fill={pnlAtLevel >= 0 ? "#22c55e" : "#ef4444"} />
      {[xMin, xMax].map((p, i) => (
        <text key={i} x={xpx(p)} y={VH - 6} fill="#6b7280" fontSize={9} textAnchor={i === 0 ? "start" : "end"}>{p.toFixed(0)}</text>
      ))}
    </svg>
  );
}
