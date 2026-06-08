import { describe, expect, it } from "vitest";
import type { IbkrHoldingPosition, TradeRecord } from "../shared/types";
import {
  activeSpreadsForResponse,
  type EstimatorSpreadOption,
  liveSpreadFromTradeRecord,
  selectOpenZeroDteSpxSpreads,
  todayClosedSpxSpreads,
} from "./spreadEstimator";

function pos(overrides: Partial<IbkrHoldingPosition>): IbkrHoldingPosition {
  return {
    account: "U1",
    averageCost: 0,
    localSymbol: "",
    position: 0,
    securityType: "OPT",
    strike: null,
    symbol: "SPX",
    tradingClass: "SPXW",
    expiration: "20260603",
    underlyingPrice: 6600,
    ...overrides,
  };
}

const TODAY = "2026-06-03";

describe("selectOpenZeroDteSpxSpreads", () => {
  it("pairs 0DTE SPX legs into a call and put credit spread and excludes the rest", () => {
    const { spreads, spot } = selectOpenZeroDteSpxSpreads(
      [
        pos({ localSymbol: "SPXW C6620", right: "C", strike: 6620, position: -3, marketPrice: 3.0 }),
        pos({ localSymbol: "SPXW C6625", right: "C", strike: 6625, position: 3, marketPrice: 1.2 }),
        pos({ localSymbol: "SPXW P6580", right: "P", strike: 6580, position: -2, marketPrice: 2.5 }),
        pos({ localSymbol: "SPXW P6575", right: "P", strike: 6575, position: 2, marketPrice: 1.1 }),
        // excluded: non-SPX option
        pos({ symbol: "AAPL", tradingClass: "AAPL", localSymbol: "AAPL C200", right: "C", strike: 200, position: -1, marketPrice: 1.0 }),
        // excluded: SPX but a future weekly, not today
        pos({ localSymbol: "SPXW C6700", right: "C", strike: 6700, position: -1, expiration: "20260618", marketPrice: 2.0 }),
        // excluded: stock leg
        pos({ symbol: "SPY", tradingClass: "SPY", securityType: "STK", localSymbol: "SPY", position: 100 }),
      ],
      TODAY,
    );

    expect(spot).toBe(6600);
    expect(spreads).toHaveLength(2);

    const ccs = spreads.find((s) => s.side === "call_credit");
    expect(ccs).toMatchObject({ shortStrike: 6620, longStrike: 6625, width: 5, contracts: 3, creditNow: 1.8 });

    const pcs = spreads.find((s) => s.side === "put_credit");
    expect(pcs).toMatchObject({ shortStrike: 6580, longStrike: 6575, width: 5, contracts: 2, creditNow: 1.4 });
  });

  it("matches the lesser quantity and leaves the remainder unpaired", () => {
    const { spreads, unpaired } = selectOpenZeroDteSpxSpreads(
      [
        pos({ localSymbol: "SPXW C6620", right: "C", strike: 6620, position: -3, marketPrice: 3.0 }),
        pos({ localSymbol: "SPXW C6625", right: "C", strike: 6625, position: 5, marketPrice: 1.2 }),
      ],
      TODAY,
    );

    expect(spreads).toHaveLength(1);
    expect(spreads[0].contracts).toBe(3);
    expect(unpaired).toHaveLength(1);
    expect(unpaired[0]).toMatchObject({ strike: 6625, position: 2 });
  });

  it("returns null credit when a leg has no mark, and no spreads when nothing is 0DTE SPX", () => {
    const withMissingMark = selectOpenZeroDteSpxSpreads(
      [
        pos({ localSymbol: "SPXW C6620", right: "C", strike: 6620, position: -1, marketPrice: 3.0 }),
        pos({ localSymbol: "SPXW C6625", right: "C", strike: 6625, position: 1, marketPrice: null }),
      ],
      TODAY,
    );
    expect(withMissingMark.spreads[0].creditNow).toBeNull();

    const empty = selectOpenZeroDteSpxSpreads(
      [pos({ symbol: "AAPL", tradingClass: "AAPL", right: "C", strike: 200, position: -1 })],
      TODAY,
    );
    expect(empty.spreads).toEqual([]);
    expect(empty.spot).toBeNull();
  });
});

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    id: "T1",
    account: "U1",
    date: TODAY,
    status: "Closed",
    side: "Call",
    strategy: "vertical",
    bias: "Bearish",
    entryTime: "2026-06-03T13:45:00-04:00",
    exitTime: "2026-06-03T14:32:00-04:00",
    expiration: "20260603",
    shortStrike: 6620,
    longStrike: 6625,
    width: 5,
    contracts: 3,
    positionBefore: 0,
    positionAfter: 0,
    entryPrice: 1.8,
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    exitPrice: 0.4,
    priceType: "Credit",
    fees: 0,
    maxRisk: 0,
    maxProfit: 0,
    pnl: 0,
    returnOnRisk: null,
    winLoss: "Win",
    spxEntry: null,
    spxExit: null,
    legs: [
      { localSymbol: "SPXW 260603C06620", right: "C", strike: 6620, ratio: 1 },
      { localSymbol: "SPXW 260603C06625", right: "C", strike: 6625, ratio: 1 },
    ],
    notes: "",
    source: "test",
    ...overrides,
  };
}

describe("liveSpreadFromTradeRecord", () => {
  it("maps a closed call credit spread, frames creditNow at entryPrice, and stamps a unique id", () => {
    const spread = liveSpreadFromTradeRecord(trade({}), 6600);
    expect(spread).not.toBeNull();
    expect(spread).toMatchObject({
      id: "CCS 6620/6625 #closed-T1",
      side: "call_credit",
      shortStrike: 6620,
      longStrike: 6625,
      width: 5,
      contracts: 3,
      creditNow: 1.8, // entry credit
      spot: 6600,
      shortLocalSymbol: "SPXW 260603C06620",
      longLocalSymbol: "SPXW 260603C06625",
    });
  });

  it("returns null for Mixed-side or strike-less trades (not a clean vertical)", () => {
    expect(liveSpreadFromTradeRecord(trade({ side: "Mixed" }), 6600)).toBeNull();
    expect(liveSpreadFromTradeRecord(trade({ shortStrike: null }), 6600)).toBeNull();
  });
});

describe("todayClosedSpxSpreads", () => {
  it("returns only today's exited SPX 0DTE Credit verticals, with realised P/L and an ET exit label", () => {
    const trades: TradeRecord[] = [
      trade({ id: "T1" }), // ✓ today's closed CCS
      trade({ id: "T2", side: "Put", shortStrike: 6580, longStrike: 6575, entryPrice: 1.5, exitPrice: 0.3 }), // ✓ today's closed PCS
      trade({ id: "T-OPEN", exitTime: null, exitPrice: null, status: "Open" }), // open: excluded
      trade({ id: "T-OTHER-DAY", date: "2026-06-02", expiration: "20260602" }), // not today
      trade({ id: "T-MIXED", side: "Mixed" }), // not a clean vertical
      trade({ id: "T-NON-SPX", legs: [{ localSymbol: "SPY 260603C480", right: "C", strike: 480, ratio: 1 }] }), // non-SPXW
      trade({ id: "T-FUTURE-EXP", expiration: "20260605" }), // not 0DTE today
      trade({ id: "T-DEBIT", priceType: "Debit" }), // not a credit vertical
    ];
    const options = todayClosedSpxSpreads(trades, TODAY, 6600);
    expect(options.map((option) => option.tradeId)).toEqual(["T2", "T1"]);
    expect(options.every((option) => option.status === "closed")).toBe(true);
    // T1: (entry 1.8 − exit 0.4) × 3 × 100 = 420
    expect(options.find((option) => option.tradeId === "T1")?.realisedPnl).toBe(420);
    expect(options.find((option) => option.tradeId === "T1")?.exitTimeLabel).toBe("14:32");
  });
});

describe("activeSpreadsForResponse", () => {
  function openOption(id: string): EstimatorSpreadOption {
    return {
      status: "open",
      spread: {
        id,
        side: "call_credit",
        shortStrike: 6620,
        longStrike: 6625,
        width: 5,
        contracts: 1,
        creditNow: 1.5,
        spot: 6600,
        shortLocalSymbol: "S",
        longLocalSymbol: "L",
      },
    };
  }
  function closedOption(id: string): EstimatorSpreadOption {
    return { ...openOption(id), status: "closed", tradeId: id };
  }

  it("returns the open spreads when no spread is focused — closed are NEVER in the aggregate", () => {
    const opens = [openOption("O1"), openOption("O2")];
    const closeds = [closedOption("C1"), closedOption("C2")];
    const active = activeSpreadsForResponse(opens, [...opens, ...closeds], null);
    expect(active.map((spread) => spread.id)).toEqual(["O1", "O2"]);
  });

  it("returns just the focused spread (open or closed) when one is focused", () => {
    const opens = [openOption("O1")];
    const closeds = [closedOption("C1")];
    const allOptions = [...opens, ...closeds];
    expect(activeSpreadsForResponse(opens, allOptions, "C1").map((spread) => spread.id)).toEqual(["C1"]);
    expect(activeSpreadsForResponse(opens, allOptions, "O1").map((spread) => spread.id)).toEqual(["O1"]);
  });

  it("returns [] when the focused id doesn't resolve (stale state)", () => {
    expect(activeSpreadsForResponse([openOption("O1")], [openOption("O1")], "nope")).toEqual([]);
  });
});
