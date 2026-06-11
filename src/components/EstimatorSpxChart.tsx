import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SpxBar } from "../../shared/types";
import type { ExpectedMoveCone } from "../expectedMoveCone";
import { aggregateSpxBars } from "./replayChartsData";
import { rubiconChartOptions, toCandlestickData } from "./lightweightChartHelpers";

// SPX intraday 2-min candles with two horizontal price lines:
//   • a "Target" line at the estimator's target-level slider (color tracks the
//     P/L sign at that level — green when positive, red when negative)
//   • a faint dashed "spot" line at the live SPX
// plus an optional forward EXPECTED-MOVE CONE (±1σ / ±1.645σ frontier / ±2σ) drawn
// from the latest bar to 16:00 ET as paired line series.
//
// The chart is created once and updated in place: `series.setData` on new bars
// (the live feed refreshes every ~20s) and `priceLine.applyOptions` on slider
// ticks — neither recreates the chart, so there's no flicker.

type Props = {
  bars: SpxBar[];
  targetLevel: number;
  spot: number | null;
  pnlSign: 1 | -1 | 0; // sign of portfolio P/L at the target level — drives line colour
  emptyNote?: string;
  cone?: ExpectedMoveCone | null; // forward expected-move band; null/undefined ⇒ no overlay
  anchorEpochOverride?: number; // pin the cone anchor to a specific bar epoch (replay)
};

const TARGET_GREEN = "#22c55e";
const TARGET_RED = "#ef4444";
const TARGET_NEUTRAL = "#38bdf8";
const SPOT_GRAY = "#64748b";

// Which k-levels the cone draws, with styling. Matched to cone.levels by `k`.
const CONE_RENDER_LEVELS = [
  { k: 1, color: "#38bdf8", style: LineStyle.Solid, width: 1 as const }, // ±1σ — sky
  { k: 1.645, color: "#f59e0b", style: LineStyle.Dashed, width: 2 as const }, // ±1.645σ — 0.05Δ frontier, amber
  { k: 2, color: "rgba(148,163,184,0.55)", style: LineStyle.Solid, width: 1 as const }, // ±2σ — faint slate
];

function targetColor(pnlSign: 1 | -1 | 0): string {
  if (pnlSign > 0) return TARGET_GREEN;
  if (pnlSign < 0) return TARGET_RED;
  return TARGET_NEUTRAL;
}

export function EstimatorSpxChart({ bars, targetLevel, spot, pnlSign, emptyNote, cone, anchorEpochOverride }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const targetLineRef = useRef<IPriceLine | null>(null);
  const spotLineRef = useRef<IPriceLine | null>(null);
  const coneSeriesRef = useRef<Array<{ k: number; upper: ISeriesApi<"Line">; lower: ISeriesApi<"Line"> }>>([]);
  const fittedRef = useRef(false);
  const coneFittedRef = useRef(false);
  // Mount-time props for the once-only chart-create effect. The initializer runs
  // exactly once, which is all that effect can ever observe (it never re-runs);
  // later target/spot/sign changes flow through the applyOptions effects below.
  const initial = useRef({ targetLevel, spot, pnlSign });

  // Create the chart + series + price lines + cone series exactly once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart: IChartApi = createChart(container, rubiconChartOptions());
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
      priceLineVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    targetLineRef.current = series.createPriceLine({
      price: initial.current.targetLevel,
      color: targetColor(initial.current.pnlSign),
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "Target",
    });
    if (initial.current.spot != null && Number.isFinite(initial.current.spot)) {
      spotLineRef.current = series.createPriceLine({
        price: initial.current.spot,
        color: SPOT_GRAY,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "spot",
      });
    }
    // Cone line series (upper + lower per level) — created empty, fed by the cone effect.
    coneSeriesRef.current = CONE_RENDER_LEVELS.map((rl) => {
      const opts = {
        color: rl.color,
        lineWidth: rl.width,
        lineStyle: rl.style,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      };
      return { k: rl.k, upper: chart.addSeries(LineSeries, opts), lower: chart.addSeries(LineSeries, opts) };
    });
    return () => {
      chartRef.current = null;
      seriesRef.current = null;
      targetLineRef.current = null;
      spotLineRef.current = null;
      coneSeriesRef.current = [];
      fittedRef.current = false;
      coneFittedRef.current = false;
      chart.remove();
    };
  }, []);

  // Push new bar data without recreating the chart; fit the time scale once when
  // the first bars arrive (later updates keep the user's pan/zoom).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(toCandlestickData(aggregateSpxBars(bars, 2)));
    if (!fittedRef.current && bars.length > 0) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
  }, [bars]);

  // Draw / update the forward expected-move cone. Anchored at the latest bar's epoch,
  // extended to 16:00 (anchorMinutesToClose ahead) so the future band stretches the axis.
  useEffect(() => {
    const coneSeries = coneSeriesRef.current;
    if (!coneSeries.length) return;
    const agg = aggregateSpxBars(bars, 2);
    const last = agg.at(-1);
    const anchorEpoch = anchorEpochOverride ?? last?.time;
    if (!cone || anchorEpoch == null || !Number.isFinite(anchorEpoch)) {
      coneSeries.forEach((cs) => {
        cs.upper.setData([]);
        cs.lower.setData([]);
      });
      coneFittedRef.current = false;
      return;
    }
    coneSeries.forEach((cs) => {
      const level = cone.levels.find((l) => l.k === cs.k);
      if (!level) {
        cs.upper.setData([]);
        cs.lower.setData([]);
        return;
      }
      const up = level.points.map((p) => ({ time: (anchorEpoch + p.elapsedMinutes * 60) as UTCTimestamp, value: p.upper }));
      const lo = level.points.map((p) => ({ time: (anchorEpoch + p.elapsedMinutes * 60) as UTCTimestamp, value: p.lower }));
      cs.upper.setData(up);
      cs.lower.setData(lo);
    });
    // Fit once so the forward cone (past the last candle) is visible; later cone
    // updates keep the user's pan/zoom.
    if (!coneFittedRef.current && bars.length > 0) {
      chartRef.current?.timeScale().fitContent();
      coneFittedRef.current = true;
    }
  }, [bars, cone, anchorEpochOverride]);

  // Slider-driven target line: cheap applyOptions, no rebuild.
  useEffect(() => {
    if (!Number.isFinite(targetLevel)) return;
    targetLineRef.current?.applyOptions({ price: targetLevel, color: targetColor(pnlSign) });
  }, [targetLevel, pnlSign]);

  // Spot drifts as live holdings refresh.
  useEffect(() => {
    if (spot == null || !Number.isFinite(spot)) return;
    spotLineRef.current?.applyOptions({ price: spot });
  }, [spot]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 220,
        background: "#0a0f1a",
        border: "1px solid #1f2937",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {bars.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6b7280",
            fontSize: 11,
            pointerEvents: "none",
          }}
        >
          {emptyNote ?? "Waiting for SPX intraday bars"}
        </div>
      )}
    </div>
  );
}
