import type { SpreadSide } from "../spreadResponse";
import type { ThetaSpeedCurve } from "../thetaSpeedCurve";

// θ/speed-across-strikes curve: the time-edge ratio (favorable decay per hour ÷ $ at
// risk per index point) as a function of the short strike. U-shaped — lowest near the
// money, rising the further OTM you sit. Current portfolio spreads are dotted onto the
// curve so you can see where each one's edge ratio lands. A graph, not a per-spread list.

export type ThetaSpeedMarker = { strike: number; side: SpreadSide; label: string };

const LINE = "#38bdf8";
const CALL = "#fca5a5";
const PUT = "#93c5fd";
const SPOT = "#64748b";

function interpRatio(curve: ThetaSpeedCurve, strike: number): number | null {
  const p = curve.points;
  if (p.length < 2 || strike < p[0].strike || strike > p[p.length - 1].strike) return null;
  for (let i = 1; i < p.length; i++) {
    if (strike <= p[i].strike) {
      const a = p[i - 1], b = p[i];
      const w = b.strike === a.strike ? 0 : (strike - a.strike) / (b.strike - a.strike);
      return a.thetaPerSpeed + w * (b.thetaPerSpeed - a.thetaPerSpeed);
    }
  }
  return p[p.length - 1].thetaPerSpeed;
}

export function ThetaSpeedCurvePanel({ curve, markers = [] }: { curve: ThetaSpeedCurve; markers?: ThetaSpeedMarker[] }) {
  const pts = curve.points;
  if (pts.length < 2) {
    return <div style={{ fontSize: 11, color: "#6b7280", padding: "8px 0" }}>Not enough range to draw the θ/speed curve.</div>;
  }
  const VW = 580, VH = 180, ML = 40, MR = 12, MT = 12, MB = 24;
  const PW = VW - ML - MR, PH = VH - MT - MB;
  const xMin = pts[0].strike, xMax = pts[pts.length - 1].strike;
  const yMax = Math.max(1, ...pts.map((p) => p.thetaPerSpeed)) * 1.08;
  const xpx = (strike: number) => ML + ((strike - xMin) / (xMax - xMin)) * PW;
  const ypx = (ratio: number) => MT + (1 - ratio / yMax) * PH;
  const path = pts.map((p, i) => `${i ? "L" : "M"}${xpx(p.strike).toFixed(1)},${ypx(p.thetaPerSpeed).toFixed(1)}`).join(" ");

  const yTicks = [0, yMax / 2, yMax];
  const xTicks = [xMin, curve.spot, xMax];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", height: "auto", marginTop: 6, display: "block" }} role="img" aria-label="theta per speed across strikes">
      <rect x={ML} y={MT} width={PW} height={PH} fill="#0a0f1a" stroke="#1f2937" />
      {yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line x1={ML} y1={ypx(t)} x2={ML + PW} y2={ypx(t)} stroke="#1f2937" strokeDasharray="3 3" />
          <text x={ML - 4} y={ypx(t) + 3} fill="#6b7280" fontSize={9} textAnchor="end">{t.toFixed(1)}x</text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={`x${i}`} x={xpx(t)} y={VH - 6} fill="#6b7280" fontSize={9} textAnchor="middle">{t.toFixed(0)}</text>
      ))}
      {/* spot marker */}
      <line x1={xpx(curve.spot)} y1={MT} x2={xpx(curve.spot)} y2={MT + PH} stroke={SPOT} strokeDasharray="2 3" />
      <text x={xpx(curve.spot)} y={MT + 9} fill={SPOT} fontSize={9} textAnchor="middle">spot</text>
      {/* the curve */}
      <path d={path} fill="none" stroke={LINE} strokeWidth={2} />
      {/* current spreads dotted onto the curve */}
      {markers.map((m, i) => {
        const r = interpRatio(curve, m.strike);
        if (r == null) return null;
        const color = m.side === "call_credit" ? CALL : PUT;
        return (
          <g key={`m${i}`}>
            <circle cx={xpx(m.strike)} cy={ypx(r)} r={3.5} fill={color} stroke="#0a0f1a" strokeWidth={1} />
            <text x={xpx(m.strike)} y={ypx(r) - 6} fill={color} fontSize={8.5} textAnchor="middle">{m.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
