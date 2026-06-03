import { type ReactNode, useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  LineSeries,
  type CandlestickSeriesPartialOptions,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SpxBar, SpreadMark, SpreadRangeBar } from "../../shared/types";
import { rubiconChartOptions, toCandlestickData, toLineData } from "./lightweightChartHelpers";

export const SPREAD_HL_BAR_OPTIONS = {
  upColor: "rgba(45, 212, 191, 0.34)",
  downColor: "rgba(251, 113, 133, 0.34)",
  wickUpColor: "#2dd4bf",
  wickDownColor: "#fb7185",
  borderUpColor: "#2dd4bf",
  borderDownColor: "#fb7185",
  borderVisible: true,
  wickVisible: true,
} satisfies CandlestickSeriesPartialOptions;

type TradeChartEvent = {
  kind: "entry" | "exit";
  time: number;
  label: string;
  value: number | null;
};

type MarketChartProps =
  | {
      kind: "candles";
      data: SpxBar[];
      title: string;
      accent: string;
      events?: TradeChartEvent[];
      toolbar?: ReactNode;
    }
  | {
      kind: "line";
      data: SpreadMark[];
      title: string;
      accent: string;
      events?: TradeChartEvent[];
      toolbar?: ReactNode;
    }
  | {
      kind: "spread-bars";
      data: SpreadRangeBar[];
      title: string;
      accent: string;
      events?: TradeChartEvent[];
      toolbar?: ReactNode;
    };

export function MarketChart(props: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const chart = createChart(container, rubiconChartOptions());
    const cleanups: Array<() => void> = [];

    if (props.kind === "candles") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#22c55e",
        downColor: "#ef4444",
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
        borderVisible: false,
      });
      series.setData(toCandlestickData(props.data));
      if (props.events?.length) {
        cleanups.push(renderEventCrosses(container, chart, series, props.events));
      }
    } else if (props.kind === "line") {
      const series = chart.addSeries(LineSeries, {
        color: props.accent,
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: false,
      });
      series.setData(toLineData(props.data, (mark) => mark.value));
      if (props.events?.length) {
        cleanups.push(renderEventCrosses(container, chart, series, props.events));
      }
    } else {
      const series = chart.addSeries(CandlestickSeries, SPREAD_HL_BAR_OPTIONS);
      series.setData(toCandlestickData(props.data));
      if (props.events?.length) {
        cleanups.push(renderEventCrosses(container, chart, series, props.events));
      }
    }

    chart.timeScale().fitContent();

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      chart.remove();
    };
  }, [props]);

  const countLabel = chartCountLabel(props.kind, props.data);

  return (
    <section className="chart-panel">
      <div className="panel-title">
        <span>{props.title}</span>
        <div className="chart-title-tools">
          {props.toolbar}
          {countLabel && <span className="panel-count">{countLabel}</span>}
        </div>
      </div>
      <div className="market-chart" ref={containerRef} />
    </section>
  );
}

export function chartCountLabel(kind: MarketChartProps["kind"], data: Array<SpxBar | SpreadMark | SpreadRangeBar>): string {
  void kind;
  void data;
  return "";
}

function renderEventCrosses(
  container: HTMLDivElement,
  chart: ReturnType<typeof createChart>,
  series: {
    priceToCoordinate: (price: number) => number | null;
  },
  events: TradeChartEvent[],
) {
  const overlay = document.createElement("div");
  overlay.className = "event-cross-layer";
  container.appendChild(overlay);

  const render = () => {
    overlay.replaceChildren();
    for (const event of events) {
      if (event.value === null) {
        continue;
      }
      const x = chart.timeScale().timeToCoordinate(event.time as UTCTimestamp);
      const y = series.priceToCoordinate(event.value);
      if (x === null || y === null) {
        continue;
      }
      overlay.appendChild(createCross(event, x, y, container.clientWidth));
    }
  };

  const resizeObserver = new ResizeObserver(render);
  resizeObserver.observe(container);
  chart.timeScale().subscribeVisibleTimeRangeChange(render);
  requestAnimationFrame(render);

  return () => {
    resizeObserver.disconnect();
    chart.timeScale().unsubscribeVisibleTimeRangeChange(render);
    overlay.remove();
  };
}

function createCross(event: TradeChartEvent, x: number, y: number, width: number): HTMLDivElement {
  const cross = document.createElement("div");
  cross.className = `trade-cross ${event.kind}`;
  if (y < 34) {
    cross.classList.add("label-below");
  }
  if (x > width - 110) {
    cross.classList.add("label-left");
  }
  cross.style.left = `${x}px`;
  cross.style.top = `${y}px`;

  const vertical = document.createElement("span");
  vertical.className = "trade-cross-line vertical";
  const horizontal = document.createElement("span");
  horizontal.className = "trade-cross-line horizontal";
  const dot = document.createElement("span");
  dot.className = "trade-cross-dot";
  const label = document.createElement("span");
  label.className = "trade-cross-label";
  label.textContent = `${event.label.toUpperCase()} EST`;

  cross.append(vertical, horizontal, dot, label);
  return cross;
}
