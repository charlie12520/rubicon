import type { SpxBar } from "./types";

/**
 * Resample intraday OHLC bars into `intervalMinutes`-minute candles. Buckets are
 * anchored to absolute epoch time (`floor(time / bucketSeconds) * bucketSeconds`)
 * so a given minute always lands in the same candle regardless of where the slice
 * starts — which lets a current session's candles stitch seamlessly onto prior
 * sessions' warmup bars for moving-average math. Each candle takes its bucket's
 * first bar's identity (timestampEt/label) and open, the max high, the min low,
 * and the last bar's close. A still-forming final bucket is returned as a partial
 * candle. The input array is never mutated.
 *
 * Shared by the client charts (ReviewEntryExitChart, ReplayCharts) and the server
 * warmup feed (spxMaContext) so resampling is byte-for-byte identical on both sides.
 */
export function resampleBars(bars: SpxBar[], intervalMinutes: number): SpxBar[] {
  if (intervalMinutes <= 1 || bars.length === 0) {
    return bars;
  }
  const bucketSeconds = intervalMinutes * 60;
  const sorted = [...bars].sort((a, b) => a.time - b.time);
  const buckets = new Map<number, SpxBar>();
  const order: number[] = [];
  for (const bar of sorted) {
    const bucketTime = Math.floor(bar.time / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketTime);
    if (existing) {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
    } else {
      buckets.set(bucketTime, { ...bar, time: bucketTime });
      order.push(bucketTime);
    }
  }
  return order.map((key) => buckets.get(key) as SpxBar);
}
