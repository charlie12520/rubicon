import type { DailyPnlSimulationPoint } from "../dailyPnlSimulator";
import { formatNumber, formatSignedCurrency } from "../format";

export function DailyPnlSimulatorChart({
  points,
  showLegend = true,
  variant = "panel",
}: {
  points: DailyPnlSimulationPoint[];
  showLegend?: boolean;
  variant?: "panel" | "overlay";
}) {
  if (!points.length) {
    return <div className="review-empty">No reconstructed spread marks are loaded for this date yet.</div>;
  }

  const width = 760;
  const height = 260;
  const margin = { top: 18, right: 20, bottom: 34, left: 66 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const minTime = points[0].time;
  const maxTime = points.at(-1)?.time ?? minTime + 1;
  const rawLow = Math.min(0, ...points.map((point) => point.totalPnl), ...points.map((point) => point.realizedPnl));
  const rawHigh = Math.max(0, ...points.map((point) => point.totalPnl), ...points.map((point) => point.realizedPnl));
  const padding = Math.max(25, (rawHigh - rawLow) * 0.12);
  const yMin = rawLow - padding;
  const yMax = rawHigh + padding;
  const totalPath = linePath(points.map((point) => [xScale(point.time), yScale(point.totalPnl)]));
  const realizedPath = linePath(points.map((point) => [xScale(point.time), yScale(point.realizedPnl)]));
  const zeroY = yScale(0);
  const areaPath = `${totalPath} L ${xScale(points.at(-1)?.time ?? minTime)} ${zeroY} L ${xScale(points[0].time)} ${zeroY} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => yMin + (yMax - yMin) * ratio);
  const xTicks = pickXTicks(points, 5);
  const finalPoint = points.at(-1) ?? points[0];
  const highPoint = points.reduce((best, point) => (point.totalPnl > best.totalPnl ? point : best), points[0]);
  const lowPoint = points.reduce((best, point) => (point.totalPnl < best.totalPnl ? point : best), points[0]);

  function xScale(time: number): number {
    if (maxTime === minTime) {
      return margin.left + chartWidth / 2;
    }
    return margin.left + ((time - minTime) / (maxTime - minTime)) * chartWidth;
  }

  function yScale(value: number): number {
    return margin.top + chartHeight - ((value - yMin) / (yMax - yMin || 1)) * chartHeight;
  }

  return (
    <div className={`pnl-sim-stage ${variant}`}>
      <svg aria-label="All positions reconstructed P/L through the day" className="pnl-sim-svg" role="img" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="pnlSimArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(45, 212, 191, 0.28)" />
            <stop offset="100%" stopColor="rgba(45, 212, 191, 0.02)" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={tick}>
              <line className="pnl-sim-grid" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
              <text className="pnl-sim-axis" textAnchor="end" x={margin.left - 10} y={y + 4}>
                {formatSignedCurrency(tick)}
              </text>
            </g>
          );
        })}
        {xTicks.map((point) => (
          <text className="pnl-sim-axis" key={`${point.time}-${point.label}`} textAnchor="middle" x={xScale(point.time)} y={height - 10}>
            {point.label}
          </text>
        ))}
        <line className="pnl-sim-zero" x1={margin.left} x2={width - margin.right} y1={zeroY} y2={zeroY} />
        <path className="pnl-sim-area" d={areaPath} />
        <path className="pnl-sim-realized" d={realizedPath} />
        <path className="pnl-sim-total" d={totalPath} />
        <PnlPoint point={highPoint} x={xScale(highPoint.time)} y={yScale(highPoint.totalPnl)} tone="high" />
        <PnlPoint point={lowPoint} x={xScale(lowPoint.time)} y={yScale(lowPoint.totalPnl)} tone="low" />
        <PnlPoint point={finalPoint} x={xScale(finalPoint.time)} y={yScale(finalPoint.totalPnl)} tone="final" />
      </svg>
      {showLegend && (
        <div className="pnl-sim-legend">
          <span className="total">Total simulated P/L</span>
          <span className="realized">Realized after exits</span>
          <span>{formatNumber(points.length)} time steps</span>
        </div>
      )}
    </div>
  );
}

function PnlPoint({ point, tone, x, y }: { point: DailyPnlSimulationPoint; tone: "final" | "high" | "low"; x: number; y: number }) {
  return (
    <g className={`pnl-sim-point ${tone}`}>
      <title>
        {`${point.label}: total ${formatSignedCurrency(point.totalPnl)}, open ${formatSignedCurrency(point.openPnl)}, realized ${formatSignedCurrency(point.realizedPnl)}, open trades ${point.openTradeCount}`}
      </title>
      <circle cx={x} cy={y} r={tone === "final" ? 4.5 : 3.5} />
    </g>
  );
}

function linePath(points: Array<[number, number]>): string {
  if (!points.length) {
    return "";
  }
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
}

function pickXTicks(points: DailyPnlSimulationPoint[], count: number): DailyPnlSimulationPoint[] {
  if (points.length <= count) {
    return points;
  }
  return Array.from({ length: count }, (_, index) => {
    const pointIndex = Math.round((index / (count - 1)) * (points.length - 1));
    return points[pointIndex];
  });
}
