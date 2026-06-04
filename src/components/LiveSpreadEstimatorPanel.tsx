import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { IbkrHoldingsSnapshot } from "../../shared/types";
import { buildPortfolioResponse } from "../portfolioResponse";
import { selectOpenZeroDteSpxSpreads } from "../spreadEstimator";
import { minutesToCloseFromLabel } from "../spreadResponse";
import type { EstimatorLiveState } from "../estimatorLiveState";

type Props = {
  holdings: IbkrHoldingsSnapshot | null;
  todayEt: string; // selected/today ET date, "YYYY-MM-DD"
  refreshing?: boolean;
  onRefresh?: () => void;
  live?: EstimatorLiveState; // auto-refresh / freshness state for the LIVE pill
};

const muted: CSSProperties = { fontSize: 11, color: "#9ca3af" };

function currentMinutesToClose(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return minutesToCloseFromLabel(`${hour === "24" ? "00" : hour}:${minute}`) ?? 60;
}

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

export function LiveSpreadEstimatorPanel({ holdings, todayEt, refreshing, onRefresh, live }: Props) {
  const selection = useMemo(
    () => selectOpenZeroDteSpxSpreads(holdings?.positions ?? [], todayEt),
    [holdings, todayEt],
  );
  const minutesToClose = useMemo(() => currentMinutesToClose(), [holdings]);
  const response = useMemo(() => {
    if (selection.spot == null || selection.spreads.length === 0) return null;
    return buildPortfolioResponse(selection.spreads, { spot: selection.spot, minutesToClose });
  }, [selection, minutesToClose]);

  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => setLevel(selection.spot), [selection.spot]);
  const activeLevel = level ?? selection.spot ?? 0;

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
    return (
      <section style={wrap}>
        <Header asOf={holdings?.fetchedAt} count={0} totalContracts={0} spot={selection.spot} refreshBtn={refreshBtn} live={live} />
        <p style={{ ...muted, marginTop: 10 }}>
          {holdings == null
            ? "Waiting for the IBKR positions pull…"
            : selection.spot == null
              ? "No open 0DTE SPX option positions found in the live IBKR pull."
              : "No 0DTE SPX vertical spreads could be formed from the current legs."}
        </p>
        {selection.unpaired.length > 0 && <UnpairedNote count={selection.unpaired.length} />}
      </section>
    );
  }

  const pnlAtLevel = interpPnl(response.aggregate, activeLevel);
  const pnls = response.aggregate.map((p) => p.pnl);
  const worst = Math.min(...pnls);
  const best = Math.max(...pnls);

  return (
    <section style={wrap}>
      <Header asOf={holdings?.fetchedAt} count={response.rows.length} totalContracts={response.totalContracts} spot={selection.spot} refreshBtn={refreshBtn} live={live} />

      {/* Aggregate portfolio P/L vs SPX */}
      <div style={{ marginTop: 10, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div style={muted}>portfolio P/L if SPX → {activeLevel.toFixed(0)} (move {activeLevel - response.spot >= 0 ? "+" : ""}{(activeLevel - response.spot).toFixed(0)}pt)</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: pnlAtLevel >= 0 ? "#22c55e" : "#ef4444" }}>{fmtUsd(pnlAtLevel)}</div>
        </div>
        <div>
          <div style={muted}>worst / best in range</div>
          <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "#ef4444" }}>{fmtUsd(worst)}</span> · <span style={{ color: "#22c55e" }}>{fmtUsd(best)}</span>
          </div>
        </div>
      </div>

      <AggregateChart response={response} level={activeLevel} pnlAtLevel={pnlAtLevel} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <span style={muted}>target level</span>
        <input
          type="range"
          min={response.levelMin}
          max={response.levelMax}
          step={1}
          value={Math.min(Math.max(activeLevel, response.levelMin), response.levelMax)}
          onChange={(e) => setLevel(Number(e.target.value))}
          style={{ flex: 1, minWidth: 160 }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {([["spot", response.spot], ["−25", response.spot - 25], ["+25", response.spot + 25], ["−50", response.spot - 50], ["+50", response.spot + 50]] as const).map(([lab, val]) => (
            <button key={lab} type="button" onClick={() => setLevel(val)} style={{ background: "#111827", border: "1px solid #334155", color: "#cbd5e1", borderRadius: 5, padding: "2px 6px", fontSize: 10.5, cursor: "pointer" }}>{lab}</button>
          ))}
        </div>
      </div>

      {/* Per-spread list */}
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ ...muted, fontWeight: 600 }}>spreads</div>
        {response.rows.map((row) => {
          const pnl = interpPnl(row.curve, activeLevel);
          const s = row.spread;
          return (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 10, alignItems: "center", padding: "6px 8px", background: "#0a0f1a", border: "1px solid #1f2937", borderRadius: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: s.side === "call_credit" ? "#fca5a5" : "#93c5fd" }}>
                  {s.side === "call_credit" ? "CCS" : "PCS"} {s.shortStrike}/{s.longStrike}
                </div>
                <div style={muted}>{s.contracts}x · w{s.width} · credit {s.creditNow != null ? `$${s.creditNow.toFixed(2)}` : "—"}</div>
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
            </div>
          );
        })}
      </div>

      {selection.unpaired.length > 0 && <UnpairedNote count={selection.unpaired.length} />}

      <p style={{ ...muted, marginTop: 8, marginBottom: 0 }}>
        Self-calibrated from each spread's live credit (Bachelier model), held to ~{Math.round(minutesToClose)}m to close. Aggregate sums all legs and is exact regardless of how legs were paired.
      </p>
    </section>
  );
}

const wrap: CSSProperties = { marginTop: 4, padding: "12px 14px", background: "#0b1220", border: "1px solid #1f2937", borderRadius: 10, color: "#e5e7eb" };

function Header({ asOf, count, totalContracts, spot, refreshBtn, live }: { asOf?: string | null; count: number; totalContracts: number; spot: number | null; refreshBtn: ReactNode; live?: EstimatorLiveState }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Your live 0DTE SPX spreads</h3>
          <LivePill live={live} />
        </div>
        <div style={muted}>
          {count} spread{count === 1 ? "" : "s"} · {totalContracts} contracts · SPX {spot != null ? spot.toFixed(2) : "—"} · positions as of {timeOnly(asOf)}
        </div>
      </div>
      {refreshBtn}
    </div>
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
