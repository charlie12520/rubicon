import { describe, expect, it } from "vitest";
import { ColorType } from "lightweight-charts";
import { rubiconChartOptions, toCandlestickData, toLineData } from "./lightweightChartHelpers";

describe("lightweight chart helpers", () => {
  it("builds shared Rubicon chart options with Eastern time formatting", () => {
    const options = rubiconChartOptions();

    expect(options.autoSize).toBe(true);
    expect(options.layout?.background).toEqual({ type: ColorType.Solid, color: "transparent" });
    expect(options.timeScale?.timeVisible).toBe(true);
    const timeFormatter = options.localization?.timeFormatter as ((time: unknown) => string) | undefined;
    expect(timeFormatter?.("2026-05-28T10:15:00-04:00")).toBe("10:15 EST");
  });

  it("allows chart-specific palette and option overrides", () => {
    const options = rubiconChartOptions({
      overrides: { handleScroll: false, leftPriceScale: { visible: false } },
      palette: {
        gridColor: "rgba(56, 189, 248, 0.06)",
        textColor: "#94a3b8",
        timeBorderColor: "rgba(56, 189, 248, 0.18)",
      },
    });

    expect(options.layout?.textColor).toBe("#94a3b8");
    expect(options.grid?.vertLines?.color).toBe("rgba(56, 189, 248, 0.06)");
    expect(options.rightPriceScale?.borderColor).toBe("rgba(56, 189, 248, 0.18)");
    expect(options.handleScroll).toBe(false);
    expect(options.leftPriceScale?.visible).toBe(false);
  });

  it("maps candle and line data with finite line filtering", () => {
    expect(toCandlestickData([{ time: 10, open: 1, high: 3, low: 0.5, close: 2 }])).toEqual([
      { time: 10, open: 1, high: 3, low: 0.5, close: 2 },
    ]);
    expect(toLineData([{ time: 10, value: 1 }, { time: 20, value: Number.NaN }], (point) => point.value)).toEqual([
      { time: 10, value: 1 },
    ]);
  });
});
