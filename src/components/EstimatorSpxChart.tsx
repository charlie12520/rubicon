import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
} from "lightweight-charts";
import type { SpxBar } from "../../shared/types";
import { aggregateSpxBars } from "./ReplayCharts";
import { rubiconChartOptions, toCandlestickData } from "./lightweightChartHelpers";

// SPX intraday 2-min candles with two horizontal price lines:
//   • a "Target" line at the estimator's target-level slider (color tracks the
//     P/L sign at that level — green when positive, red when negative)
//   • a faint dashed "spot" line at the live SPX
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
};

const TARGET_GREEN = "#22c55e";
const TARGET_RED = "#ef4444";
const TARGET_NEUTRAL = "#38bdf8";
const SPOT_GRAY = "#64748b";

function targetColor(pnlSign: 1 | -1 | 0): string {
  if (pnlSign > 0) return TARGET_GREEN;
  if (pnlSign < 0) return TARGET_RED;
  return TARGET_NEUTRAL;
}

export function EstimatorSpxChart({ bars, targetLevel, spot, pnlSign, emptyNote }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const targetLineRef = useRef<IPriceLine | null>(null);
  const spotLineRef = useRef<IPriceLine | null>(null);
  const fittedRef = useRef(false);
  // Latest props for the once-only mount effect to read without re-subscribing.
  const initial = useRef({ targetLevel, spot, pnlSign });
  initial.current = { targetLevel, spot, pnlSign };

  // Create the chart + series + price lines exactly once.
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
    return () => {
      chartRef.current = null;
      seriesRef.current = null;
      targetLineRef.current = null;
      spotLineRef.current = null;
      fittedRef.current = false;
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
