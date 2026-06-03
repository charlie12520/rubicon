import { useMemo, useState, type CSSProperties } from "react";
import type { TradeRecord } from "../../shared/types";
import {
  creditCurve,
  DEFAULT_WIDTH,
  minutesToCloseFromLabel,
  predictSpreadResponse,
  type SpreadSide,
} from "../spreadResponse";

type Fields = {
  side: SpreadSide;
  shortStrike: number;
  width: number;
  spot: number;
  credit: number;
  mcNow: number;
  level: number;
  mcAtLevel: number;
};

const round5 = (x: number) => Math.round(x / 5) * 5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const defaultShortStrike = (side: SpreadSide, spot: number) =>
  side === "call_credit" ? round5(spot) + 10 : round5(spot) - 10;

export type SpreadResponseProps = {
  defaultSpot?: number | null;
  currentLabel?: string;
  selectedTrade?: TradeRecord | null;
  // explicit prefill (e.g. from a morning recommended spread); overrides the trade-derived seed
  seedSide?: SpreadSide;
  seedShortStrike?: number | null;
  seedWidth?: number | null;
  seedCredit?: number | null;
};

function seedFromProps(p: SpreadResponseProps): Fields {
  const spot = p.defaultSpot != null && Number.isFinite(p.defaultSpot) ? Math.round(p.defaultSpot * 100) / 100 : 6000;
  const side: SpreadSide = p.seedSide ?? (p.selectedTrade?.side === "Put" ? "put_credit" : "call_credit");
  const width = p.seedWidth && p.seedWidth > 0
    ? p.seedWidth
    : p.selectedTrade?.width && p.selectedTrade.width > 0 ? p.selectedTrade.width : DEFAULT_WIDTH;
  const shortStrike = p.seedShortStrike != null
    ? p.seedShortStrike
    : p.selectedTrade?.shortStrike != null ? p.selectedTrade.shortStrike : defaultShortStrike(side, spot);
  const rawCredit = p.seedCredit != null ? p.seedCredit : p.selectedTrade?.entryPrice;
  const credit = rawCredit != null && rawCredit > 0 && rawCredit < width ? rawCredit : 0.6;
  const mcNow = minutesToCloseFromLabel(p.currentLabel) ?? 180;
  return { side, shortStrike, width, spot, credit, mcNow, level: spot, mcAtLevel: mcNow };
}

const lblStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: "#9ca3af" };
const inputStyle: CSSProperties = {
  background: "#0b1220", border: "1px solid #334155", borderRadius: 6, color: "#e5e7eb",
  padding: "3px 6px", fontSize: 12, fontVariantNumeric: "tabular-nums", width: "100%",
};

function NumField(props: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <label style={lblStyle}>
      {props.label}
      <input
        type="number" style={inputStyle} value={Number.isFinite(props.value) ? props.value : 0}
        step={props.step ?? 1} min={props.min} max={props.max}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) props.onChange(v); }}
      />
    </label>
  );
}

export function SpreadResponsePanel(props: SpreadResponseProps) {
  const [f, setF] = useState<Fields>(() => seedFromProps(props));
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((cur) => ({ ...cur, [k]: v }));
  // changing the now/at-close time keeps "at level" <= "now"
  const setMcNow = (v: number) => setF((cur) => ({ ...cur, mcNow: v, mcAtLevel: Math.min(cur.mcAtLevel, v) }));
  // flipping side re-seeds the strike (and level) so the spread stays sensible for that side
  const setSide = (side: SpreadSide) =>
    setF((cur) => ({ ...cur, side, shortStrike: defaultShortStrike(side, cur.spot), level: cur.spot }));

  const { result, curve, xMin, xMax, decay } = useMemo(() => {
    const mcAt = clamp(f.mcAtLevel, 0.5, f.mcNow);
    const base = {
      side: f.side, shortStrike: f.shortStrike, width: f.width, spot: f.spot, credit: f.credit,
      minutesToClose: f.mcNow, minutesToCloseAtLevel: mcAt,
    };
    const result = predictSpreadResponse({ ...base, level: f.level });
    const loStrike = Math.min(f.shortStrike, f.shortStrike + (f.side === "call_credit" ? f.width : -f.width));
    const hiStrike = loStrike + f.width;
    const rng = clamp(3 * result.scaleNow, 20, 140);
    let xMin = Math.min(loStrike - rng, f.spot, f.level);
    let xMax = Math.max(hiStrike + rng, f.spot, f.level);
    const pad = (xMax - xMin) * 0.04;
    xMin -= pad; xMax += pad;
    const curve = creditCurve(base, xMin, xMax, 121);
    return { result, curve, xMin, xMax, decay: mcAt < f.mcNow - 0.5 };
  }, [f]);

  // SVG geometry
  const VW = 580, VH = 184, ML = 38, MR = 12, MT = 10, MB = 22;
  const PW = VW - ML - MR, PH = VH - MT - MB;
  const xpx = (price: number) => ML + ((price - xMin) / (xMax - xMin)) * PW;
  const ypx = (credit: number) => MT + (1 - credit / f.width) * PH;
  const linePath = curve.map((p, i) => `${i ? "L" : "M"}${xpx(p.level).toFixed(1)},${ypx(p.credit).toFixed(1)}`).join(" ");
  const loStrike = Math.min(f.shortStrike, f.shortStrike + (f.side === "call_credit" ? f.width : -f.width));
  const hiStrike = loStrike + f.width;
  const levelClamped = clamp(f.level, xMin, xMax);

  // neutral at ~zero move so a no-op doesn't render as an alarming loss
  const flat = Math.abs(result.deltaCredit) < 0.005;
  const adverse = !flat && result.deltaCredit > 0; // cost-to-close rose => bad for a credit seller
  const moveColor = flat ? "#9ca3af" : adverse ? "#ef4444" : "#22c55e";
  const moveSign = flat ? "" : result.deltaCredit > 0 ? "+" : "−";
  const plSign = flat ? "" : result.deltaCredit < 0 ? "+" : "−";
  const movePts = f.level - f.spot;

  return (
    <section style={{ marginTop: 12, padding: "12px 14px", background: "#0b1220", border: "1px solid #1f2937", borderRadius: 10, color: "#e5e7eb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Spread Response — credit vs level</h3>
        <button
          type="button"
          onClick={() => setF(seedFromProps(props))}
          style={{ background: "#111827", border: "1px solid #334155", color: "#9ca3af", borderRadius: 6, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}
        >
          ⟳ Sync from chart
        </button>
      </div>

      {/* inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginTop: 8 }}>
        <label style={lblStyle}>
          side
          <select style={inputStyle} value={f.side} onChange={(e) => setSide(e.target.value as SpreadSide)}>
            <option value="call_credit">Call credit</option>
            <option value="put_credit">Put credit</option>
          </select>
        </label>
        <NumField label="short strike" value={f.shortStrike} step={5} onChange={(v) => set("shortStrike", v)} />
        <NumField label="width" value={f.width} step={1} min={1} onChange={(v) => set("width", v)} />
        <NumField label="spot (SPX)" value={f.spot} step={1} onChange={(v) => set("spot", v)} />
        <NumField label="credit now" value={f.credit} step={0.05} min={0} max={f.width} onChange={(v) => set("credit", v)} />
        <NumField label="min to close" value={f.mcNow} step={5} min={1} max={390} onChange={setMcNow} />
      </div>

      {/* target level control */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>target level</span>
        <input
          type="range" min={xMin} max={xMax} step={0.25} value={levelClamped}
          onChange={(e) => set("level", Number(e.target.value))} style={{ flex: 1, minWidth: 150 }}
        />
        <input type="number" step={1} value={f.level} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set("level", v); }}
          style={{ ...inputStyle, width: 84 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {[["spot", f.spot], ["short", f.shortStrike], ["+5", f.spot + 5], ["−5", f.spot - 5], ["+10", f.spot + 10], ["−10", f.spot - 10]].map(
            ([lab, val]) => (
              <button key={lab as string} type="button" onClick={() => set("level", Number(val))}
                style={{ background: "#111827", border: "1px solid #334155", color: "#cbd5e1", borderRadius: 5, padding: "2px 6px", fontSize: 10.5, cursor: "pointer" }}>
                {lab}
              </button>
            ),
          )}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: decay ? "#e5e7eb" : "#9ca3af" }} title="Minutes to close WHEN the level is reached. Set below 'min to close' to model time decay along the way.">
          min left @ level
          <input type="number" step={5} min={1} max={f.mcNow} value={f.mcAtLevel}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) set("mcAtLevel", clamp(v, 1, f.mcNow)); }}
            style={{ ...inputStyle, width: 64 }} />
        </label>
      </div>

      {/* readout */}
      <div style={{ marginTop: 10, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>
            predicted spread price @ {f.level.toFixed(0)} (move {movePts >= 0 ? "+" : ""}{movePts.toFixed(0)}pt{decay ? `, ${f.mcAtLevel}m left` : ""})
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>${result.creditAtLevel.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>change in spread price</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: moveColor, fontVariantNumeric: "tabular-nums" }}>
            {moveSign}${Math.abs(result.deltaCredit).toFixed(2)} · {moveSign}${Math.abs(result.deltaDollarsPerContract).toFixed(0)}/contract
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>P/L for a short (per contract)</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: moveColor, fontVariantNumeric: "tabular-nums" }}>
            {plSign}${Math.abs(result.deltaDollarsPerContract).toFixed(0)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>now: $/pt · move-scale s₀</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
            ${result.dollarsPerPointNow.toFixed(0)}/pt · {result.scaleNow.toFixed(1)}pt
          </div>
        </div>
      </div>

      {/* curve */}
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", height: "auto", marginTop: 8, display: "block" }} role="img" aria-label="credit vs level curve">
        <rect x={ML} y={MT} width={PW} height={PH} fill="#0a0f1a" stroke="#1f2937" />
        <line x1={ML} y1={ypx(f.width)} x2={ML + PW} y2={ypx(f.width)} stroke="#374151" strokeDasharray="3 3" />
        <line x1={ML} y1={ypx(0)} x2={ML + PW} y2={ypx(0)} stroke="#374151" strokeDasharray="3 3" />
        <text x={4} y={ypx(f.width) + 3} fill="#6b7280" fontSize={9}>${f.width.toFixed(0)}</text>
        <text x={4} y={ypx(0) + 3} fill="#6b7280" fontSize={9}>$0</text>
        {[loStrike, hiStrike].map((k, i) => (
          xpx(k) >= ML && xpx(k) <= ML + PW ? <line key={k} x1={xpx(k)} y1={MT} x2={xpx(k)} y2={MT + PH} stroke={i === (f.side === "call_credit" ? 0 : 1) ? "#f59e0b" : "#475569"} strokeWidth={1} opacity={0.8} /> : null
        ))}
        <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth={2} />
        <line x1={xpx(f.spot)} y1={MT} x2={xpx(f.spot)} y2={MT + PH} stroke="#64748b" strokeWidth={1} />
        <circle cx={xpx(f.spot)} cy={ypx(clamp(f.credit, 0, f.width))} r={3.5} fill="#cbd5e1" />
        <line x1={xpx(levelClamped)} y1={MT} x2={xpx(levelClamped)} y2={MT + PH} stroke={moveColor} strokeWidth={1.5} />
        <circle cx={xpx(levelClamped)} cy={ypx(result.creditAtLevel)} r={4} fill={moveColor} />
        {[xMin, (xMin + xMax) / 2, xMax].map((p, i) => (
          <text key={i} x={xpx(p)} y={VH - 6} fill="#6b7280" fontSize={9} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>{p.toFixed(0)}</text>
        ))}
      </svg>

      <p style={{ fontSize: 10.5, color: "#6b7280", marginTop: 6, marginBottom: 0 }}>
        Self-calibrated Bachelier model (validated 2024-26, R²≈0.97): reads the day's move-scale s₀ from the live credit, then rolls the curve to your level.
        Spread price = cost-to-close (net credit); red = more expensive (adverse to a short), green = cheaper. Set “min left @ level” below “min to close” to model time decay. Slightly-OTM accuracy ≈ $10-16/contract.
      </p>
    </section>
  );
}
