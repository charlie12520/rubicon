import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHoldingsSnapshotPayload, shouldFireIbkrHoldingsAutoRefresh, shouldFireIntradayHoldingsRefresh } from "./ibkrHoldings.ts";

const ORIGINAL_AUTO_REFRESH = process.env.IBKR_HOLDINGS_AUTO_REFRESH;
const ORIGINAL_AUTO_REFRESH_TIME = process.env.IBKR_HOLDINGS_AUTO_REFRESH_TIME;

describe("IBKR holdings helpers", () => {
  afterEach(() => {
    restoreEnv("IBKR_HOLDINGS_AUTO_REFRESH", ORIGINAL_AUTO_REFRESH);
    restoreEnv("IBKR_HOLDINGS_AUTO_REFRESH_TIME", ORIGINAL_AUTO_REFRESH_TIME);
    vi.restoreAllMocks();
  });

  it("normalizes live IBKR positions for the Morning holdings review", () => {
    const snapshot = normalizeHoldingsSnapshotPayload(
      {
        account: "U1",
        count: 2,
        fetchedAt: "2026-05-29T08:30:00-04:00",
        grossCostBasis: "12,345.67",
        grossCurrentValue: "1,750.00",
        manualGreeksSummary: {
          computed: "1",
          ibkr: "0",
          manual: "1",
          missing: "0",
          optionCount: "1",
          source: "black_scholes_fallback",
        },
        marketDataSummary: {
          optionCount: "1",
          withDelta: "1",
          withMarketPrice: "1",
          withTheta: "1",
        },
        port: 7496,
        earningsEventsBySymbol: {
          AAPL: {
            date: "2026-06-01",
            daysUntil: "1",
            epsForecast: "$1.65",
            name: "Apple Inc.",
            source: "Nasdaq earnings calendar",
            time: "after-close",
            warning: "red",
          },
        },
        positions: [
          {
            account: "U1",
            ask: "8.90",
            averageCost: "123.45",
            bid: "8.70",
            costBasis: "246.90",
            currentValue: "1750",
            delta: "0.42",
            earnings: {
              date: "2026-06-01",
              daysUntil: "1",
              epsForecast: "$1.65",
              name: "Apple Inc.",
              source: "Nasdaq earnings calendar",
              time: "after-close",
              warning: "red",
            },
            expiration: "20260619",
            greeksSource: "manual_black_scholes",
            impliedVol: "0.31",
            last: "8.80",
            localSymbol: "AAPL 260619C00200000",
            manualGreeksStatus: "computed",
            marketDataStatus: "ok",
            marketPrice: "8.75",
            position: "2",
            positionDelta: "84",
            positionTheta: "-16",
            right: "C",
            realizedPnl: "0",
            securityType: "OPT",
            strike: "200",
            symbol: "AAPL",
            theta: "-0.08",
            underlyingPrice: "201.25",
            unrealizedPnl: "1503.10",
          },
        ],
      },
      "snapshot.json",
    );

    expect(snapshot.status).toBe("ok");
    expect(snapshot.count).toBe(2);
    expect(snapshot.grossCostBasis).toBe(12345.67);
    expect(snapshot.grossCurrentValue).toBe(1750);
    expect(snapshot.manualGreeksSummary).toEqual({
      computed: 1,
      ibkr: 0,
      manual: 1,
      missing: 0,
      optionCount: 1,
      source: "black_scholes_fallback",
    });
    expect(snapshot.marketDataSummary).toEqual({
      optionCount: 1,
      withDelta: 1,
      withMarketPrice: 1,
      withTheta: 1,
    });
    expect(snapshot.positions[0]).toMatchObject({
      ask: 8.9,
      bid: 8.7,
      costBasis: 246.9,
      currentValue: 1750,
      delta: 0.42,
      earnings: {
        date: "2026-06-01",
        daysUntil: 1,
        epsForecast: "$1.65",
        name: "Apple Inc.",
        time: "after-close",
        warning: "red",
      },
      greeksSource: "manual_black_scholes",
      impliedVol: 0.31,
      last: 8.8,
      localSymbol: "AAPL 260619C00200000",
      manualGreeksStatus: "computed",
      marketDataStatus: "ok",
      marketPrice: 8.75,
      position: 2,
      positionDelta: 84,
      positionTheta: -16,
      realizedPnl: 0,
      right: "C",
      strike: 200,
      symbol: "AAPL",
      theta: -0.08,
      underlyingPrice: 201.25,
      unrealizedPnl: 1503.1,
    });
    expect(snapshot.earningsEventsBySymbol?.AAPL).toMatchObject({
      date: "2026-06-01",
      daysUntil: 1,
      epsForecast: "$1.65",
      name: "Apple Inc.",
      time: "after-close",
      warning: "red",
    });
  });

  it("fires the holdings auto-refresh once in the 8:30 ET weekday window", () => {
    const first = shouldFireIbkrHoldingsAutoRefresh(new Date("2026-05-29T12:30:00.000Z"), null);
    const repeated = shouldFireIbkrHoldingsAutoRefresh(new Date("2026-05-29T12:31:00.000Z"), "2026-05-29");
    const weekend = shouldFireIbkrHoldingsAutoRefresh(new Date("2026-05-31T12:30:00.000Z"), null);

    expect(first.shouldFire).toBe(true);
    expect(repeated.shouldFire).toBe(false);
    expect(weekend.shouldFire).toBe(false);
  });

  it("unrefs the auto-refresh interval so it does not keep the backend alive", async () => {
    vi.resetModules();
    process.env.IBKR_HOLDINGS_AUTO_REFRESH = "true";
    process.env.IBKR_HOLDINGS_AUTO_REFRESH_TIME = "23:59";
    const unref = vi.fn();
    vi.spyOn(globalThis, "setInterval").mockReturnValue({ unref } as unknown as ReturnType<typeof setInterval>);

    const { armIbkrHoldingsAutoRefresh } = await import("./ibkrHoldings.ts");
    armIbkrHoldingsAutoRefresh();

    expect(unref).toHaveBeenCalledOnce();
  });

  it("fires the intraday holdings refresh inside the ET market window on the interval", () => {
    const opts = { enabled: true, intervalMs: 5 * 60_000, windowStart: "09:30", windowEnd: "16:15" };
    const inWindow = new Date("2026-06-03T18:00:00.000Z"); // 14:00 ET, Wednesday
    const nowMs = inWindow.getTime();

    expect(shouldFireIntradayHoldingsRefresh(inWindow, null, opts).shouldFire).toBe(true);
    expect(shouldFireIntradayHoldingsRefresh(inWindow, nowMs - 4 * 60_000, opts).shouldFire).toBe(false);
    expect(shouldFireIntradayHoldingsRefresh(inWindow, nowMs - 6 * 60_000, opts).shouldFire).toBe(true);

    expect(shouldFireIntradayHoldingsRefresh(new Date("2026-06-03T12:00:00.000Z"), null, opts).shouldFire).toBe(false); // 08:00 ET, before open
    expect(shouldFireIntradayHoldingsRefresh(new Date("2026-06-03T20:30:00.000Z"), null, opts).shouldFire).toBe(false); // 16:30 ET, past window
    expect(shouldFireIntradayHoldingsRefresh(new Date("2026-06-06T18:00:00.000Z"), null, opts).shouldFire).toBe(false); // Saturday
    expect(shouldFireIntradayHoldingsRefresh(inWindow, null, { ...opts, enabled: false }).shouldFire).toBe(false);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
