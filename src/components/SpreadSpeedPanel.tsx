import { useMemo } from "react";
import type { SpreadSpeedFrame, SpreadSpeedPayload, SpreadSpeedPick, SpreadSpeedRow } from "../../shared/types";

const REGIME_COLOR: Record<string, string> = { FAST: "#16a34a", MED: "#d97706", DEAD: "#6b7280" };

function frameForLabel(payload: SpreadSpeedPayload, label: string): SpreadSpeedFrame | null {
  if (!payload.frames.length) return null;
  const exact = payload.frames.find((f) => f.label === label);
  if (exact) return exact;
  let best: SpreadSpeedFrame | null = null;
  for (const f of payload.frames) {
    if (f.label <= label) best = f;
  }
  return best ?? payload.frames[payload.frames.length - 1];
}

function Pick({ pick }: { pick: SpreadSpeedPick }) {
  if (!pick) return <span style={{ color: "#6b7280" }}>none live</span>;
  return (
    <span>
      <strong>{pick.shortStrike}/{pick.longStrike}</strong>{" "}
      <span style={{ color: REGIME_COLOR[pick.regime] }}>${pick.dollarPerPoint}/pt</span>{" "}
      <span style={{ color: "#9ca3af" }}>Δ{pick.shortDelta.toFixed(2)}{pick.value != null ? ` · $${pick.value.toFixed(2)}` : ""}</span>
    </span>
  );
}

function Ladder({ rows }: { rows: SpreadSpeedRow[] }) {
  const max = Math.max(0.001, ...rows.map((r) => r.netDelta));
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {rows.map((r) => (
        <div key={`${r.side}-${r.shortStrike}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span style={{ width: 70, color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
            {r.shortStrike}/{r.longStrike}
          </span>
          <span style={{ width: 8, height: 8, borderRadius: 8, background: REGIME_COLOR[r.regime] }} />
          <span style={{ width: 44, textAlign: "right", color: "#e5e7eb", fontVariantNumeric: "tabular-nums" }}>
            ${r.dollarPerPoint}
          </span>
          <span style={{ flex: 1, height: 6, background: "#1f2937", borderRadius: 4, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(r.netDelta / max) * 100}%`, background: REGIME_COLOR[r.regime] }} />
          </span>
          <span style={{ width: 36, textAlign: "right", color: "#6b7280", fontVariantNumeric: "tabular-nums" }}>{r.distEm}EM</span>
        </div>
      ))}
    </div>
  );
}

export function SpreadSpeedPanel({
  payload,
  currentLabel,
}: {
  payload: SpreadSpeedPayload | null;
  currentLabel: string;
}) {
  const frame = useMemo(
    () => (payload && payload.available ? frameForLabel(payload, currentLabel) : null),
    [payload, currentLabel],
  );

  return (
    <section
      style={{
        marginTop: 12,
        padding: "12px 14px",
        background: "#0b1220",
        border: "1px solid #1f2937",
        borderRadius: 10,
        color: "#e5e7eb",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Spread Speed — net-delta rule</h3>
        {frame ? (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            {frame.label} · SPX {frame.spot} · EM {frame.em}pt · {frame.minutesToClose}m left · speed limit ${Math.round(frame.speedCeiling * 100)}/pt (max any 5-wide can move)
          </span>
        ) : null}
      </div>

      {!payload || !payload.available ? (
        <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 0 }}>
          {payload?.note || "No spread-speed data for this date (needs the SPXW 0DTE option-leg pull)."}
        </p>
      ) : !frame ? (
        <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 0 }}>No frame at {currentLabel}.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
          {frame.pcsFastLow == null && frame.ccsFastLow == null ? (
            <div style={{ gridColumn: "1 / -1", fontSize: 11.5, color: "#d97706" }}>
              ⚠ Nothing ≥ $5/pt right now — every 5-wide is below the live threshold. Widen the spread or wait for EM to fall.
            </div>
          ) : null}
          {(["PCS", "CCS"] as const).map((side) => {
            const rows = side === "PCS" ? frame.pcs : frame.ccs;
            const rec = side === "PCS" ? frame.recommendPcs : frame.recommendCcs;
            return (
              <div key={side}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  {side === "PCS" ? "PUT credit (below spot)" : "CALL credit (above spot)"}
                </div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: "#9ca3af" }}>Recommended: </span>
                  <Pick pick={rec} />
                </div>
                <Ladder rows={rows} />
              </div>
            );
          })}
        </div>
      )}
      <p style={{ fontSize: 10.5, color: "#6b7280", marginTop: 8, marginBottom: 0 }}>
        net delta = $ moved per 1pt SPX (×100/lot). Green ≥ $5/pt (FAST/live) · amber $2–5 · gray dead.
        Recommended = OTM spread nearest {payload?.targetNetDelta ?? 0.05} net δ (the live edge). Model greeks from spot + ATM straddle IV.
      </p>
    </section>
  );
}
