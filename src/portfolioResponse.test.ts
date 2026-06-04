import { describe, expect, it } from "vitest";
import type { LiveSpread } from "./spreadEstimator";
import { aggregatePnlAtLevel, buildPortfolioResponse } from "./portfolioResponse";

function spread(overrides: Partial<LiveSpread>): LiveSpread {
  return {
    id: "CCS 6620/6625",
    side: "call_credit",
    shortStrike: 6620,
    longStrike: 6625,
    width: 5,
    contracts: 1,
    creditNow: 1.0,
    spot: 6600,
    shortLocalSymbol: "S",
    longLocalSymbol: "L",
    ...overrides,
  };
}

describe("buildPortfolioResponse", () => {
  it("a single spread's aggregate equals its own curve, ~0 at spot, correct sign by direction", () => {
    const response = buildPortfolioResponse([spread({})], { spot: 6600, minutesToClose: 120, steps: 81 });

    expect(response.rows).toHaveLength(1);
    response.aggregate.forEach((point, i) => expect(point.pnl).toBeCloseTo(response.rows[0].curve[i].pnl, 6));

    // no move from spot => ~no P/L
    expect(Math.abs(aggregatePnlAtLevel(response, 6600))).toBeLessThan(5);
    // call credit: SPX up (toward/through the short call) loses; SPX down profits
    expect(response.aggregate[response.aggregate.length - 1].pnl).toBeLessThan(0);
    expect(response.aggregate[0].pnl).toBeGreaterThan(0);
    // max profit can't exceed the credit kept (~$100/contract)
    expect(response.aggregate[0].pnl).toBeLessThanOrEqual(110);
  });

  it("sums multiple spreads on a shared ladder", () => {
    const ccs = spread({});
    const pcs = spread({ id: "PCS", side: "put_credit", shortStrike: 6580, longStrike: 6575, contracts: 2, creditNow: 1.2 });
    const response = buildPortfolioResponse([ccs, pcs], { spot: 6600, minutesToClose: 120, steps: 41 });

    response.aggregate.forEach((point, i) =>
      expect(point.pnl).toBeCloseTo(response.rows[0].curve[i].pnl + response.rows[1].curve[i].pnl, 6),
    );

    const levels0 = response.rows[0].curve.map((point) => point.level);
    const levels1 = response.rows[1].curve.map((point) => point.level);
    expect(levels0).toEqual(levels1);
    expect(levels0).toEqual(response.aggregate.map((point) => point.level));
    expect(response.totalContracts).toBe(3);
  });

  it("frames the ladder so each spread saturates to its full max loss / max profit at the edges", () => {
    const response = buildPortfolioResponse([spread({ creditNow: 1.2 })], { spot: 6600, minutesToClose: 120, steps: 121 });
    const credit = response.rows[0].creditReference; // ≈ live cost-to-close at spot
    const maxLoss = (credit - 5) * 100; // full −$width loss per contract (negative)
    const maxProfit = credit * 100;
    // SPX-up (loss) edge reaches ~full −$5 width loss; SPX-down edge keeps ~full credit
    expect(response.aggregate[response.aggregate.length - 1].pnl).toBeLessThan(maxLoss * 0.97);
    expect(response.aggregate[0].pnl).toBeGreaterThan(maxProfit * 0.97);
    // …without padding the SPX range far past the saturation point
    expect(response.levelMax - response.levelMin).toBeLessThan(400);
  });
});
