import {
  ColorType,
  type CandlestickData,
  type ChartOptions,
  type DeepPartial,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { formatEasternHm } from "../easternDate";

type ChartPalette = {
  gridColor?: string;
  paneSeparatorColor?: string;
  textColor?: string;
  timeBorderColor?: string;
};

export function rubiconChartOptions({
  overrides = {},
  palette = {},
}: {
  overrides?: DeepPartial<ChartOptions>;
  palette?: ChartPalette;
} = {}): DeepPartial<ChartOptions> {
  const textColor = palette.textColor ?? "#8f9bad";
  const gridColor = palette.gridColor ?? "rgba(132, 150, 170, 0.08)";
  const timeBorderColor = palette.timeBorderColor ?? "rgba(132, 150, 170, 0.18)";
  const paneSeparatorColor = palette.paneSeparatorColor ?? "#1e2632";

  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor,
      panes: { separatorColor: paneSeparatorColor },
      ...overrides.layout,
    },
    grid: {
      vertLines: { color: gridColor, ...overrides.grid?.vertLines },
      horzLines: { color: gridColor, ...overrides.grid?.horzLines },
    },
    crosshair: {
      mode: 0,
      ...overrides.crosshair,
    },
    rightPriceScale: {
      borderColor: timeBorderColor,
      ...overrides.rightPriceScale,
    },
    timeScale: {
      borderColor: timeBorderColor,
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: formatEasternHm,
      ...overrides.timeScale,
    },
    localization: {
      timeFormatter: (time: unknown) => `${formatEasternHm(time)} EST`,
      ...overrides.localization,
    },
    ...overrides,
  };
}

export function toCandlestickData<T extends { close: number; high: number; low: number; open: number; time: number }>(
  bars: T[],
): CandlestickData<UTCTimestamp>[] {
  return bars.map((bar) => ({
    close: bar.close,
    high: bar.high,
    low: bar.low,
    open: bar.open,
    time: bar.time as UTCTimestamp,
  }));
}

export function toLineData<T extends { time: number }>(
  points: T[],
  selector: (point: T) => number,
): LineData<UTCTimestamp>[] {
  return points
    .map((point) => ({ time: point.time as UTCTimestamp, value: selector(point) }))
    .filter((point) => Number.isFinite(point.value));
}
