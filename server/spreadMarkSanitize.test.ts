import { describe, expect, it } from "vitest";
import type { SpreadMark, TradeRecord } from "../shared/types.ts";
import { sanitizeSpreadMarksForTrades } from "./dataImporter.ts";

const TRADE = {
  id: "T1",
  width: 5,
  priceType: "Credit",
  strategy: "Put Credit Spread",
} as unknown as TradeRecord;

function mark(overrides: Partial<SpreadMark>): SpreadMark {
  return {
    tradeId: "T1",
    time: 0,
    timestampEt: "2026-06-09T10:00:00-04:00",
    label: "10:00",
    value: -1,
    source: "IBKR_TRADES_5s_ohlc_ffill_nickel",
    entrySequence: 1,
    permId: "1",
    ...overrides,
  } as SpreadMark;
}

describe("sanitizeSpreadMarksForTrades — stale-leg flip carry + post-close trim", () => {
  it("carries the last trusted value over a stale-leg full-width flip (the sawtooth)", () => {
    const marks = [
      mark({ time: 100, value: -3.7, staleLegCount: 0 }),
      // fresh print on one leg + stale print on the other: repeated flips toward 0
      mark({ time: 160, timestampEt: "2026-06-09T10:01:00-04:00", value: -0.05, staleLegCount: 1 }),
      mark({ time: 220, timestampEt: "2026-06-09T10:02:00-04:00", value: -0.2, staleLegCount: 2 }),
      mark({ time: 280, timestampEt: "2026-06-09T10:03:00-04:00", value: -3.6, staleLegCount: 0 }),
    ];
    const out = sanitizeSpreadMarksForTrades(marks, [TRADE]);
    expect(out.map((m) => m.value)).toEqual([-3.7, -3.7, -3.7, -3.6]);
    expect(out[1].source).toContain("rubicon_stale_leg_carry");
    expect(out[2].source).toContain("rubicon_stale_leg_carry");
    expect(out[3].source).not.toContain("rubicon_stale_leg_carry");
  });

  it("keeps large moves when both legs printed (a real market move)", () => {
    const marks = [
      mark({ time: 100, value: -1.0, staleLegCount: 0 }),
      mark({ time: 160, timestampEt: "2026-06-09T10:01:00-04:00", value: -4.2, staleLegCount: 0 }),
    ];
    const out = sanitizeSpreadMarksForTrades(marks, [TRADE]);
    expect(out.map((m) => m.value)).toEqual([-1.0, -4.2]);
  });

  it("allows small stale-leg drift through (only width-scale flips are artifacts)", () => {
    const marks = [
      mark({ time: 100, value: -2.0, staleLegCount: 0 }),
      mark({ time: 160, timestampEt: "2026-06-09T10:01:00-04:00", value: -2.4, staleLegCount: 1 }),
    ];
    const out = sanitizeSpreadMarksForTrades(marks, [TRADE]);
    expect(out.map((m) => m.value)).toEqual([-2.0, -2.4]);
  });

  it("never rewrites quote/midpoint-sourced marks", () => {
    const marks = [
      mark({ time: 100, value: -3.7, staleLegCount: 0, source: "IBKR_MIDPOINT_5s_ohlc_ffill_nickel" }),
      mark({ time: 160, timestampEt: "2026-06-09T10:01:00-04:00", value: -0.1, staleLegCount: 1, source: "IBKR_MIDPOINT_5s_ohlc_ffill_nickel" }),
    ];
    const out = sanitizeSpreadMarksForTrades(marks, [TRADE]);
    expect(out.map((m) => m.value)).toEqual([-3.7, -0.1]);
  });

  it("drops the phantom forward-filled tail after the 16:00 close", () => {
    const marks = [
      mark({ time: 100, timestampEt: "2026-06-09T15:59:00-04:00", value: -2.1, staleLegCount: 0 }),
      mark({ time: 160, timestampEt: "2026-06-09T16:00:00-04:00", value: -2.1, staleLegCount: 0 }),
      mark({ time: 220, timestampEt: "2026-06-09T16:05:00-04:00", value: -2.1, staleLegCount: 2 }),
      mark({ time: 280, timestampEt: "2026-06-09T16:14:00-04:00", value: -2.1, staleLegCount: 2 }),
    ];
    const out = sanitizeSpreadMarksForTrades(marks, [TRADE]);
    expect(out).toHaveLength(2);
    expect(out.at(-1)!.timestampEt).toContain("16:00:00");
  });

  it("still width-clamps out-of-band values before the sequential pass", () => {
    const marks = [mark({ time: 100, value: -6.4, staleLegCount: 0 })];
    const out = sanitizeSpreadMarksForTrades(marks, [TRADE]);
    expect(out[0].value).toBe(-5);
    expect(out[0].source).toContain("rubicon_width_clamped");
  });

  it("leaves leading stale marks untouched when there is no trusted baseline yet", () => {
    const marks = [
      mark({ time: 100, value: -0.5, staleLegCount: 1 }),
      mark({ time: 160, timestampEt: "2026-06-09T10:01:00-04:00", value: -0.6, staleLegCount: 0 }),
    ];
    const out = sanitizeSpreadMarksForTrades(marks, [TRADE]);
    expect(out.map((m) => m.value)).toEqual([-0.5, -0.6]);
  });
});
