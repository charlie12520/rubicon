import { useEffect, useMemo, useRef, useState } from "react";
import {
  RRG_QUADRANT_LABEL,
  rrgBounds,
  type RrgQuadrant,
  type RrgSeries,
  type Timeframe,
} from "../relativeRotation";
import { splineSegments } from "../rrgSpline";
import "./RelativeRotationGraph.css";

// Distinct hues that stay legible on the near-black cockpit background. Assigned
// by the caller's series order so a symbol keeps its colour across re-renders.
const SERIES_PALETTE = [
  "#38bdf8", "#a3e635", "#f472b6", "#facc15", "#fb7185", "#34d399",
  "#c084fc", "#fbbf24", "#60a5fa", "#4ade80", "#f87171", "#e879f9",
  "#2dd4bf", "#fde047", "#fca5a5", "#93c5fd", "#5eead4", "#d8b4fe",
];

const QUADRANT_COLOR: Record<RrgQuadrant, string> = {
  leading: "#22c55e",
  weakening: "#f59e0b",
  lagging: "#ef4444",
  improving: "#38bdf8",
};

function colorForSeries(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

type RelativeRotationGraphProps = {
  series: RrgSeries[];
  benchmarkLabel: string;
  asOf: string;
  timeframe: Timeframe;
  /** Optional fixed axis bounds; defaults to padded bounds of the data. */
  bounds?: { min: number; max: number };
  highlightSymbol?: string | null;
  onHighlightSymbol?: (symbol: string | null) => void;
  showLegend?: boolean;
  /** Above this many visible series, head labels are hidden to avoid an unreadable
   * blob; dots stay and the focused/hovered series is always labelled. Default 16. */
  maxLabels?: number;
};

type HoverState = { symbol: string; x: number; y: number };

export function RelativeRotationGraph({
  series,
  benchmarkLabel,
  asOf,
  timeframe,
  bounds,
  highlightSymbol = null,
  onHighlightSymbol,
  showLegend = true,
  maxLabels = 16,
}: RelativeRotationGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const colorBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    series.forEach((s, i) => map.set(s.symbol, colorForSeries(i)));
    return map;
  }, [series]);

  const view = useMemo(() => {
    const margin = { top: 20, right: 20, bottom: 40, left: 48 };
    // Square plot (height tracks width) so equal RS-units map to equal pixels and
    // rotations read as circles, not horizontally-stretched ellipses.
    const plotW = Math.max(120, width - margin.left - margin.right);
    const plotH = Math.max(120, width - margin.top - margin.bottom);
    const span = bounds ?? rrgBounds(series);
    const range = span.max - span.min || 1;
    const xOf = (ratio: number) => margin.left + ((ratio - span.min) / range) * plotW;
    const yOf = (mom: number) => margin.top + (1 - (mom - span.min) / range) * plotH;
    // Integer ticks each side of 100, skipping the origin itself.
    const reach = Math.floor((span.max - 100) / 2);
    const ticks: number[] = [];
    for (let k = -reach; k <= reach; k += 1) {
      if (k !== 0) ticks.push(100 + k * 2);
    }
    return { margin, plotW, plotH, span, xOf, yOf, x0: xOf(100), y0: yOf(100), ticks };
  }, [width, bounds, series]);

  const activeHighlight = hover?.symbol ?? highlightSymbol;

  if (series.length === 0) {
    return (
      <div className="rrg" ref={containerRef}>
        <div className="rrg-empty">
          No securities have enough history to plot at these settings.
          <br />
          Widen the date range, lower the windows, or pick a different benchmark.
        </div>
      </div>
    );
  }

  const { margin, plotW, plotH, xOf, yOf, x0, y0, ticks } = view;
  const right = margin.left + plotW;
  const bottom = margin.top + plotH;

  const quadrants: Array<{ q: RrgQuadrant; x: number; y: number; anchor: "start" | "end" }> = [
    { q: "leading", x: right - 8, y: margin.top + 16, anchor: "end" },
    { q: "weakening", x: right - 8, y: bottom - 8, anchor: "end" },
    { q: "lagging", x: margin.left + 8, y: bottom - 8, anchor: "start" },
    { q: "improving", x: margin.left + 8, y: margin.top + 16, anchor: "start" },
  ];

  return (
    <div className="rrg" ref={containerRef}>
      <svg
        className="rrg-svg"
        viewBox={`0 0 ${width} ${width}`}
        role="img"
        aria-label={`Relative rotation graph of ${series.length} securities versus ${benchmarkLabel}, ${timeframe}, as of ${asOf}`}
        onMouseLeave={() => setHover(null)}
      >
        {/* quadrant fills */}
        <rect className="rrg-quadrant-fill" x={x0} y={margin.top} width={right - x0} height={y0 - margin.top} fill={QUADRANT_COLOR.leading} />
        <rect className="rrg-quadrant-fill" x={x0} y={y0} width={right - x0} height={bottom - y0} fill={QUADRANT_COLOR.weakening} />
        <rect className="rrg-quadrant-fill" x={margin.left} y={y0} width={x0 - margin.left} height={bottom - y0} fill={QUADRANT_COLOR.lagging} />
        <rect className="rrg-quadrant-fill" x={margin.left} y={margin.top} width={x0 - margin.left} height={y0 - margin.top} fill={QUADRANT_COLOR.improving} />

        {/* grid ticks */}
        {ticks.map((t) => (
          <g key={`gx-${t}`}>
            <line className="rrg-grid-line" x1={xOf(t)} y1={margin.top} x2={xOf(t)} y2={bottom} />
            <text className="rrg-axis-text" x={xOf(t)} y={bottom + 14} textAnchor="middle">{t}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={`gy-${t}`}>
            <line className="rrg-grid-line" x1={margin.left} y1={yOf(t)} x2={right} y2={yOf(t)} />
            <text className="rrg-axis-text" x={margin.left - 8} y={yOf(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}

        {/* origin cross at 100 / 100 */}
        <line className="rrg-origin-line" x1={x0} y1={margin.top} x2={x0} y2={bottom} />
        <line className="rrg-origin-line" x1={margin.left} y1={y0} x2={right} y2={y0} />

        {/* quadrant labels */}
        {quadrants.map(({ q, x, y, anchor }) => (
          <text key={q} className="rrg-quadrant-label" x={x} y={y} textAnchor={anchor} fill={QUADRANT_COLOR[q]}>
            {RRG_QUADRANT_LABEL[q]}
          </text>
        ))}

        {/* axis titles */}
        <text className="rrg-axis-title" x={margin.left + plotW / 2} y={bottom + 32} textAnchor="middle">
          JdK RS-Ratio
        </text>
        <text
          className="rrg-axis-title"
          x={14}
          y={margin.top + plotH / 2}
          textAnchor="middle"
          transform={`rotate(-90 14 ${margin.top + plotH / 2})`}
        >
          JdK RS-Momentum
        </text>

        {/* series tails + heads */}
        {series.map((s) => {
          const color = colorBySymbol.get(s.symbol) ?? "#9ca3af";
          const dimmed = activeHighlight != null && activeHighlight !== s.symbol;
          // Hide labels when the cloud is dense (keep dots); always label the focused one.
          const showLabel = activeHighlight ? activeHighlight === s.symbol : series.length <= maxLabels;
          const pts = s.points.map((p) => ({ x: xOf(p.rsRatio), y: yOf(p.rsMomentum) }));
          const segs = splineSegments(pts);
          const denom = Math.max(1, segs.length);
          const last = pts.length - 1;
          const hx = pts[last].x;
          const hy = pts[last].y;
          return (
            <g key={s.symbol} className={`rrg-series${dimmed ? " dimmed" : ""}`}>
              {/* smooth curve, tapering thicker + more opaque toward the head (now) */}
              {segs.map((d, i) => {
                const t = (i + 1) / denom;
                return (
                  <path
                    key={i}
                    className="rrg-tail-seg"
                    d={d}
                    stroke={color}
                    strokeWidth={(0.8 + 2.4 * t).toFixed(2)}
                    opacity={(0.16 + 0.8 * t).toFixed(2)}
                  />
                );
              })}
              {/* hollow ring at each past observation */}
              {pts.slice(0, -1).map((pt, i) => (
                <circle
                  key={s.points[i].date}
                  className="rrg-node"
                  cx={pt.x}
                  cy={pt.y}
                  r={2.3}
                  fill="#070c16"
                  stroke={color}
                  strokeWidth={1.3}
                  opacity={(0.32 + 0.5 * (i / Math.max(1, last))).toFixed(2)}
                />
              ))}
              <circle
                className="rrg-head"
                cx={hx}
                cy={hy}
                r={5.5}
                fill={color}
                onMouseEnter={() => setHover({ symbol: s.symbol, x: hx, y: hy })}
                onMouseMove={() => onHighlightSymbol?.(s.symbol)}
              />
              {showLabel && (
                <text className="rrg-head-label" x={hx + 9} y={hy + 4} fill={color}>
                  {s.symbol}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover && (() => {
        const s = series.find((entry) => entry.symbol === hover.symbol);
        if (!s) return null;
        const color = colorBySymbol.get(s.symbol) ?? "#9ca3af";
        const left = (hover.x / width) * 100;
        return (
          <div className="rrg-tooltip" style={{ left: `${left}%`, top: hover.y }}>
            <div className="rrg-tooltip-symbol">
              <span className="rrg-tooltip-swatch" style={{ background: color }} />
              {s.symbol}
            </div>
            <div className="rrg-tooltip-row"><span>RS-Ratio</span><b>{s.head.rsRatio.toFixed(2)}</b></div>
            <div className="rrg-tooltip-row"><span>RS-Mom</span><b>{s.head.rsMomentum.toFixed(2)}</b></div>
            <div className="rrg-tooltip-row"><span>As of</span><b>{s.head.date}</b></div>
            <div className="rrg-tooltip-quadrant" style={{ color: QUADRANT_COLOR[s.quadrant] }}>
              {RRG_QUADRANT_LABEL[s.quadrant]}
            </div>
          </div>
        );
      })()}

      {showLegend && (
        <div className="rrg-legend">
          {series.map((s) => {
            const color = colorBySymbol.get(s.symbol) ?? "#9ca3af";
            const dimmed = activeHighlight != null && activeHighlight !== s.symbol;
            return (
              <button
                key={s.symbol}
                type="button"
                className={`rrg-legend-chip${activeHighlight === s.symbol ? " active" : ""}${dimmed ? " dimmed" : ""}`}
                onMouseEnter={() => onHighlightSymbol?.(s.symbol)}
                onMouseLeave={() => onHighlightSymbol?.(null)}
                onClick={() => onHighlightSymbol?.(activeHighlight === s.symbol ? null : s.symbol)}
              >
                <span className="rrg-legend-swatch" style={{ background: color }} />
                {s.symbol}
                <span className="rrg-legend-quadrant" style={{ color: QUADRANT_COLOR[s.quadrant] }}>
                  {RRG_QUADRANT_LABEL[s.quadrant].slice(0, 4)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
