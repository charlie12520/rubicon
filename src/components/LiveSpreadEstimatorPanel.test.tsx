// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IbkrHoldingPosition, IbkrHoldingsSnapshot } from "../../shared/types";

// The SPX 2-min chart renders a real lightweight-charts instance (needs a real
// DOM: matchMedia/ResizeObserver). This panel test is about the chip rail,
// subtitle, and P/L readout — stub the chart child so jsdom doesn't choke.
vi.mock("./EstimatorSpxChart", () => ({ EstimatorSpxChart: () => null }));

import { LiveSpreadEstimatorPanel, currentMinutesToClose } from "./LiveSpreadEstimatorPanel";

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

function snapshot(positions: IbkrHoldingPosition[]): IbkrHoldingsSnapshot {
  return {
    count: positions.length,
    fetchedAt: "2026-06-03T18:00:00.000Z",
    grossCostBasis: null,
    message: "",
    positions,
    source: "test",
    status: "ok",
  };
}

afterEach(cleanup);

describe("LiveSpreadEstimatorPanel", () => {
  it("shows a waiting state before any IBKR pull", () => {
    render(<LiveSpreadEstimatorPanel holdings={null} todayEt="2026-06-03" />);
    expect(screen.getByText(/Waiting for the IBKR positions pull/i)).toBeTruthy();
  });

  it("renders the live spreads and the aggregate portfolio readout", () => {
    const holdings = snapshot([
      pos({ localSymbol: "SPXW C6620", right: "C", strike: 6620, position: -3, marketPrice: 3.0 }),
      pos({ localSymbol: "SPXW C6625", right: "C", strike: 6625, position: 3, marketPrice: 1.2 }),
      pos({ localSymbol: "SPXW P6580", right: "P", strike: 6580, position: -2, marketPrice: 2.5 }),
      pos({ localSymbol: "SPXW P6575", right: "P", strike: 6575, position: 2, marketPrice: 1.1 }),
    ]);
    render(<LiveSpreadEstimatorPanel holdings={holdings} todayEt="2026-06-03" />);

    expect(screen.getByText(/Your live 0DTE SPX spreads/i)).toBeTruthy();
    // Subtitle copy distinguishes open from closed now that closed-trade chips
    // exist alongside open ones (A148).
    expect(screen.getByText(/2 open spreads/i)).toBeTruthy();
    // CCS/PCS labels render in both the chip rail and the per-spread detail card;
    // getAllByText so neither duplicate trips the assertion.
    expect(screen.getAllByText(/CCS 6620\/6625/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PCS 6580\/6575/).length).toBeGreaterThan(0);
    expect(screen.getByText(/portfolio P\/L if SPX/i)).toBeTruthy();
  });
});

describe("currentMinutesToClose", () => {
  it("counts the wall clock down to 16:00 ET so the cone + theta advance as time passes", () => {
    // Fixed UTC instants → ET (EDT, UTC-4 in June): 11:00, 11:20, 15:00 ET.
    const at1100 = currentMinutesToClose(new Date("2026-06-08T15:00:00Z"));
    const at1120 = currentMinutesToClose(new Date("2026-06-08T15:20:00Z"));
    const at1500 = currentMinutesToClose(new Date("2026-06-08T19:00:00Z"));
    // Strictly decreasing as time passes — the property the cone fix relies on.
    expect(at1100).toBeGreaterThan(at1120);
    expect(at1120).toBeGreaterThan(at1500);
    // And it is the real minutes to the 16:00 close.
    expect(at1100).toBeCloseTo(300, 0);
    expect(at1100 - at1120).toBeCloseTo(20, 0);
    expect(at1500).toBeCloseTo(60, 0);
  });
});
