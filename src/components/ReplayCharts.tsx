import { useMemo, useState } from "react";
import type { OpenInterestPoint, ReplayPayload, SpxBar, SpreadMark, SpreadRangeBar, TradeRecord, VolumePoint } from "../../shared/types";
import { MarketChart } from "./MarketChart";
import { formatNumber } from "../format";
import { nearestPoint, pointValue, tradeBoundaryEvents } from "../tradeChartEvents";

type VolumeMode = "both" | "calls" | "puts" | "split";
type SpreadChartMode = "hl" | "line";

type ReplayChartsProps = {
  replay: ReplayPayload | null;
  selectedTrade: TradeRecord | null;
  replayIndex: number;
  replayMode: boolean;
};

export function ReplayCharts({ replay, replayIndex, replayMode, selectedTrade }: ReplayChartsProps) {
  const [volumeMode, setVolumeMode] = useState<VolumeMode>("both");
  const [spreadChartMode, setSpreadChartMode] = useState<SpreadChartMode>("line");

  const currentTime = replayCutoffTime(replay, replayIndex, replayMode);
  const visibleSpx = useMemo(() => takeThrough(replay?.spxBars ?? [], currentTime), [currentTime, replay]);
  const visibleSpread = useMemo(
    () => takeThrough((replay?.spreadMarks ?? []).filter((mark) => mark.tradeId === selectedTrade?.id), currentTime),
    [currentTime, replay, selectedTrade],
  );
  const visibleSpreadBars = useMemo(() => buildSpreadRangeBars(visibleSpread), [visibleSpread]);
  const oiData = useMemo(() => buildOiData(replay?.openInterest ?? []), [replay]);
  const volumeData = useMemo(() => buildVolumeProfile(replay?.volume ?? [], currentTime), [currentTime, replay]);
  const spxEvents = useMemo(() => tradeEvents(selectedTrade, currentTime, "spx", visibleSpx), [currentTime, selectedTrade, visibleSpx]);
  const spreadEvents = useMemo(
    () => tradeEvents(selectedTrade, currentTime, "spread", visibleSpread),
    [currentTime, selectedTrade, visibleSpread],
  );

  if (!replay) {
    return <div className="empty-panel">Loading replay...</div>;
  }

  return (
    <div className="replay-grid">
      <MarketChart kind="candles" data={visibleSpx} title="SPX Intraday" accent="#2dd4bf" events={spxEvents} />
      {spreadChartMode === "hl" ? (
        <MarketChart
          kind="spread-bars"
          data={visibleSpreadBars}
          title={selectedTrade ? selectedTrade.strategy : "Selected Spread"}
          accent="#f59e0b"
          events={spreadEvents}
          toolbar={<SpreadChartToggle mode={spreadChartMode} onChange={setSpreadChartMode} />}
        />
      ) : (
        <MarketChart
          kind="line"
          data={visibleSpread}
          title={selectedTrade ? selectedTrade.strategy : "Selected Spread"}
          accent="#f59e0b"
          events={spreadEvents}
          toolbar={<SpreadChartToggle mode={spreadChartMode} onChange={setSpreadChartMode} />}
        />
      )}
      <section className="chart-panel">
        <div className="panel-title">
          <span>0DTE Open Interest</span>
        </div>
        <ProfileChart data={oiData} mode="both" label="0DTE open interest by strike" />
      </section>
      <section className="chart-panel">
        <div className="panel-title">
          <span>Volume Profile</span>
          <div className="micro-segment" role="group" aria-label="Volume side">
            {(["both", "split", "calls", "puts"] as VolumeMode[]).map((mode) => (
              <button className={volumeMode === mode ? "active" : ""} key={mode} onClick={() => setVolumeMode(mode)} type="button">
                {mode}
              </button>
            ))}
          </div>
        </div>
        <ProfileChart data={volumeData.map((point) => ({ ...point, label: String(point.strike) }))} mode={volumeMode} label="0DTE volume profile by strike" />
      </section>
    </div>
  );
}

function SpreadChartToggle({ mode, onChange }: { mode: SpreadChartMode; onChange: (mode: SpreadChartMode) => void }) {
  return (
    <div className="micro-segment" role="group" aria-label="Spread chart style">
      {(["hl", "line"] as SpreadChartMode[]).map((nextMode) => (
        <button className={mode === nextMode ? "active" : ""} key={nextMode} onClick={() => onChange(nextMode)} type="button">
          {nextMode === "hl" ? "HL" : "Line"}
        </button>
      ))}
    </div>
  );
}

type TradeChartEvent = {
  kind: "entry" | "exit";
  label: string;
  time: number;
  value: number | null;
};

function tradeEvents(
  selectedTrade: TradeRecord | null,
  currentTime: number,
  chartKind: "spx" | "spread",
  visibleData: Array<SpxBar | SpreadMark>,
): TradeChartEvent[] {
  if (!selectedTrade) {
    return [];
  }
  const events: TradeChartEvent[] = [];

  for (const boundary of tradeBoundaryEvents(selectedTrade, { includeSyntheticExpirationExit: true })) {
    if (boundary.time > currentTime) {
      continue;
    }
    const matchedPoint = nearestPoint(visibleData, boundary.time);
    events.push({
      kind: boundary.kind,
      label: `${boundary.kind === "entry" ? "Entry" : "Exit"} ${boundary.timeLabel}`,
      time: matchedPoint?.time ?? boundary.time,
      value: chartKind === "spx"
        ? boundary.kind === "entry"
          ? selectedTrade.spxEntry ?? pointValue(matchedPoint)
          : selectedTrade.spxExit ?? pointValue(matchedPoint)
        : boundary.kind === "entry"
          ? selectedTrade.entryPrice
          : selectedTrade.exitPrice ?? pointValue(matchedPoint),
    });
  }

  return events;
}

export function buildSpreadRangeBars(marks: SpreadMark[]): SpreadRangeBar[] {
  return marks.map((mark, index) => {
    const hasSourceRange = [mark.open, mark.high, mark.low, mark.close].every((value) => Number.isFinite(value));
    const previous = marks[index - 1]?.value ?? mark.value;
    const open = finiteOr(mark.open, previous);
    const close = finiteOr(mark.close, mark.value);
    const high = Math.max(finiteOr(mark.high, Math.max(open, close)), open, close);
    const low = Math.min(finiteOr(mark.low, Math.min(open, close)), open, close);
    return {
      tradeId: mark.tradeId,
      timestampEt: mark.timestampEt,
      label: mark.label,
      time: mark.time,
      open,
      high,
      low,
      close,
      source: mark.source,
      constructed: !hasSourceRange,
    };
  });
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

type ProfilePoint = {
  label: string;
  strike: number;
  calls: number;
  puts: number;
};

function ProfileChart({ data, label, mode }: { data: ProfilePoint[]; label: string; mode: VolumeMode }) {
  if (mode === "split") {
    return <SplitProfileChart data={data} label={label} />;
  }

  return (
    <div className="bar-chart-stage">
      <ProfileSvg data={data} label={label} mode={mode} />
    </div>
  );
}

function SplitProfileChart({ data, label }: { data: ProfilePoint[]; label: string }) {
  const points = data.filter((point) => point.calls > 0 || point.puts > 0);
  if (!points.length) {
    return <div className="split-profile-empty">No volume yet at this replay time.</div>;
  }

  const callTotal = points.reduce((sum, point) => sum + point.calls, 0);
  const putTotal = points.reduce((sum, point) => sum + point.puts, 0);
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.calls, point.puts]));

  const width = 640;
  const height = 240;
  const margin = { top: 18, right: 16, bottom: 32, left: 52 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const halfHeight = chartHeight / 2;
  const centerY = margin.top + halfHeight;
  const barStep = chartWidth / points.length;
  const barWidth = Math.max(2, Math.min(18, barStep * 0.72));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const tickRatios = [0.5, 1];

  return (
    <div className="split-profile-stage">
      <div className="split-profile-summary">
        <span className="calls">Calls {formatNumber(callTotal)} up</span>
        <span>Peak {formatNumber(maxValue)} per side</span>
        <span className="puts">Puts {formatNumber(putTotal)} down</span>
      </div>
      <div className="bar-chart-stage">
        <svg aria-label={label} role="img" viewBox={`0 0 ${width} ${height}`}>
          {tickRatios.map((ratio) => {
            const offset = ratio * halfHeight;
            const value = formatNumber(Math.round(maxValue * ratio));
            return (
              <g key={ratio}>
                <line className="profile-grid-line" x1={margin.left} x2={width - margin.right} y1={centerY - offset} y2={centerY - offset} />
                <line className="profile-grid-line" x1={margin.left} x2={width - margin.right} y1={centerY + offset} y2={centerY + offset} />
                <text className="profile-axis-label" x={margin.left - 8} y={centerY - offset + 4} textAnchor="end">{value}</text>
                <text className="profile-axis-label" x={margin.left - 8} y={centerY + offset + 4} textAnchor="end">{value}</text>
              </g>
            );
          })}
          {points.map((point, index) => {
            const x = margin.left + index * barStep + (barStep - barWidth) / 2;
            const callHeight = (point.calls / maxValue) * halfHeight;
            const putHeight = (point.puts / maxValue) * halfHeight;
            const labelVisible = index % labelEvery === 0;
            return (
              <g key={`${point.strike}-${index}`}>
                <title>{`${point.label}: calls ${formatNumber(point.calls)}, puts ${formatNumber(point.puts)}`}</title>
                {point.calls > 0 && <rect className="profile-bar calls" height={callHeight} width={barWidth} x={x} y={centerY - callHeight} />}
                {point.puts > 0 && <rect className="profile-bar puts" height={putHeight} width={barWidth} x={x} y={centerY} />}
                {labelVisible && (
                  <text className="profile-axis-label" textAnchor="middle" x={x + barWidth / 2} y={height - 10}>
                    {point.label}
                  </text>
                )}
              </g>
            );
          })}
          <line className="profile-axis-line" x1={margin.left} x2={width - margin.right} y1={centerY} y2={centerY} />
        </svg>
      </div>
    </div>
  );
}

function ProfileSvg({ data, label, mode }: { data: ProfilePoint[]; label: string; mode: Exclude<VolumeMode, "split"> }) {
  const width = 640;
  const height = 220;
  const margin = { top: 18, right: 16, bottom: 32, left: 52 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const totals = data.map((point) => valueForMode(point, mode));
  const maxValue = Math.max(1, ...totals);
  const barStep = data.length > 0 ? chartWidth / data.length : chartWidth;
  const barWidth = Math.max(2, Math.min(18, barStep * 0.72));
  const labelEvery = Math.max(1, Math.ceil(data.length / 8));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxValue * ratio));

  return (
      <svg aria-label={label} role="img" viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((tick, index) => {
          const y = margin.top + chartHeight - (tick / maxValue) * chartHeight;
          return (
            <g key={`${tick}-${index}`}>
              <line className="profile-grid-line" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
              <text className="profile-axis-label" x={margin.left - 8} y={y + 4} textAnchor="end">
                {formatNumber(tick)}
              </text>
            </g>
          );
        })}
        {data.map((point, index) => {
          const x = margin.left + index * barStep + (barStep - barWidth) / 2;
          const callValue = mode === "puts" ? 0 : point.calls;
          const putValue = mode === "calls" ? 0 : point.puts;
          const putHeight = (putValue / maxValue) * chartHeight;
          const callHeight = (callValue / maxValue) * chartHeight;
          const baseY = margin.top + chartHeight;
          const labelVisible = index % labelEvery === 0;
          return (
            <g key={`${point.strike}-${index}`}>
              <title>{`${point.label}: puts ${formatNumber(point.puts)}, calls ${formatNumber(point.calls)}`}</title>
              {putValue > 0 && <rect className="profile-bar puts" height={putHeight} width={barWidth} x={x} y={baseY - putHeight} />}
              {callValue > 0 && (
                <rect className="profile-bar calls" height={callHeight} width={barWidth} x={x} y={baseY - putHeight - callHeight} />
              )}
              {labelVisible && (
                <text className="profile-axis-label" textAnchor="middle" x={x + barWidth / 2} y={height - 10}>
                  {point.label}
                </text>
              )}
            </g>
          );
        })}
        <line className="profile-axis-line" x1={margin.left} x2={width - margin.right} y1={margin.top + chartHeight} y2={margin.top + chartHeight} />
      </svg>
  );
}

function valueForMode(point: ProfilePoint, mode: VolumeMode): number {
  if (mode === "calls") {
    return point.calls;
  }
  if (mode === "puts") {
    return point.puts;
  }
  return point.calls + point.puts;
}

export function replayCutoffTime(replay: ReplayPayload | null, replayIndex: number, replayMode: boolean): number {
  if (!replayMode) {
    return Number.MAX_SAFE_INTEGER;
  }
  return replay?.spxBars[replayIndex]?.time ?? Number.MAX_SAFE_INTEGER;
}

export function takeThrough<T extends { time: number }>(items: T[], time: number): T[] {
  return items.filter((item) => item.time <= time);
}

function buildOiData(points: OpenInterestPoint[]): Array<{ label: string; strike: number; calls: number; puts: number }> {
  const grouped = new Map<number, { label: string; strike: number; calls: number; puts: number }>();
  for (const point of points) {
    const current = grouped.get(point.strike) ?? { label: String(point.strike), strike: point.strike, calls: 0, puts: 0 };
    if (point.right === "C") {
      current.calls += point.openInterest;
    } else {
      current.puts += point.openInterest;
    }
    grouped.set(point.strike, current);
  }
  return [...grouped.values()].sort((a, b) => a.strike - b.strike);
}

function buildVolumeProfile(points: VolumePoint[], time: number): Array<{ strike: number; calls: number; puts: number }> {
  const latest = new Map<string, VolumePoint>();
  for (const point of points) {
    if (point.time <= time) {
      latest.set(`${point.right}-${point.strike}`, point);
    }
  }

  const grouped = new Map<number, { strike: number; calls: number; puts: number }>();
  for (const point of latest.values()) {
    const current = grouped.get(point.strike) ?? { strike: point.strike, calls: 0, puts: 0 };
    if (point.right === "C") {
      current.calls += point.cumulativeVolume;
    } else {
      current.puts += point.cumulativeVolume;
    }
    grouped.set(point.strike, current);
  }
  return [...grouped.values()].sort((a, b) => a.strike - b.strike);
}
