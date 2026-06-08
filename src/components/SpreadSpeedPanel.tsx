import { useMemo } from "react";
import type { SpreadSpeedFrame, SpreadSpeedPayload, SpreadSpeedPick } from "../../shared/types";

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
  if (!pick) return <span className="spread-speed-pick muted">none live</span>;
  return (
    <span className="spread-speed-pick">
      <strong>{pick.shortStrike}/{pick.longStrike}</strong>{" "}
      <span style={{ color: REGIME_COLOR[pick.regime] }}>${pick.dollarPerPoint}/pt</span>{" "}
      <span style={{ color: "#9ca3af" }}>d{pick.shortDelta.toFixed(2)}{pick.value != null ? ` / $${pick.value.toFixed(2)}` : ""}</span>
    </span>
  );
}

function RecommendedPick({ label, pick }: { label: string; pick: SpreadSpeedPick }) {
  return (
    <div className="spread-speed-recommendation">
      <span>{label}</span>
      <Pick pick={pick} />
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
    <section className="spread-speed-panel">
      <div className="spread-speed-header">
        <h3>Spread Speed recommended</h3>
      </div>

      {!payload || !payload.available ? (
        <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 0 }}>
          {payload?.note || "No spread-speed data for this date (needs the SPXW 0DTE option-leg pull)."}
        </p>
      ) : !frame ? (
        <p style={{ color: "#9ca3af", fontSize: 12, marginBottom: 0 }}>No frame at {currentLabel}.</p>
      ) : (
        <div className="spread-speed-recommendations">
          <RecommendedPick label="PUT credit" pick={frame.recommendPcs} />
          <RecommendedPick label="CALL credit" pick={frame.recommendCcs} />
        </div>
      )}
    </section>
  );
}
