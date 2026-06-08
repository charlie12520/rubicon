import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSafeSpxBars: vi.fn(),
  loadSpxBars: vi.fn(),
  optionLegTradeCsvCandidates: vi.fn(),
  readCsv: vi.fn(),
  readFirstCsv: vi.fn(),
  safeSpxCsvCandidates: vi.fn(),
  tradeDates: vi.fn(),
}));

vi.mock("./dataImporter.ts", () => ({
  IBKR_TRADES_ROOT: "C:/rubicon-spread-speed-test",
  loadSafeSpxBars: mocks.loadSafeSpxBars,
  loadSpxBars: mocks.loadSpxBars,
  optionLegTradeCsvCandidates: mocks.optionLegTradeCsvCandidates,
  readCsv: mocks.readCsv,
  readFirstCsv: mocks.readFirstCsv,
  safeSpxCsvCandidates: mocks.safeSpxCsvCandidates,
  tradeDates: mocks.tradeDates,
}));

describe("loadSpreadSpeed", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadSafeSpxBars.mockReset();
    mocks.loadSpxBars.mockReset();
    mocks.optionLegTradeCsvCandidates.mockReset();
    mocks.readCsv.mockReset();
    mocks.readFirstCsv.mockReset();
    mocks.safeSpxCsvCandidates.mockReset();
    mocks.tradeDates.mockReset();
    mocks.optionLegTradeCsvCandidates.mockReturnValue(["option-leg-sidecar.csv"]);
    mocks.readCsv.mockResolvedValue([]);
    mocks.readFirstCsv.mockResolvedValue([]);
    mocks.safeSpxCsvCandidates.mockReturnValue(["spx-sidecar.csv"]);
    mocks.tradeDates.mockResolvedValue([]);
  });

  it("uses sidecar-only SPX bars instead of the payload-fallback SPX loader", async () => {
    const { loadSpreadSpeed } = await import("./spreadSpeed.ts");
    mocks.loadSafeSpxBars.mockResolvedValue([]);
    mocks.loadSpxBars.mockResolvedValue([
      {
        close: 5900,
        high: 5901,
        label: "09:30",
        low: 5899,
        open: 5900,
        time: 1,
        timestampEt: "2026-06-01 09:30:00",
      },
    ]);

    const payload = await loadSpreadSpeed("2026-06-01");

    expect(mocks.loadSafeSpxBars).toHaveBeenCalledWith("2026-06-01");
    expect(mocks.loadSpxBars).not.toHaveBeenCalled();
    expect(payload.available).toBe(false);
    expect(payload.note).toBe("No SPX intraday bars for this date.");
  });

  it("keeps stale full-mode callers on the sidecar-only state path", async () => {
    const { loadSpreadSpeed } = await import("./spreadSpeed.ts");
    mocks.loadSafeSpxBars.mockResolvedValue([]);
    mocks.loadSpxBars.mockResolvedValue([
      {
        close: 5900,
        high: 5901,
        label: "09:30",
        low: 5899,
        open: 5900,
        time: 1,
        timestampEt: "2026-06-01 09:30:00",
      },
    ]);

    const payload = await loadSpreadSpeed("2026-06-01", { mode: "full" } as never);

    expect(mocks.loadSafeSpxBars).toHaveBeenCalledWith("2026-06-01");
    expect(mocks.loadSpxBars).not.toHaveBeenCalled();
    expect(payload.available).toBe(false);
    expect(payload.note).toBe("No SPX intraday bars for this date.");
  });
});

describe("loadSpreadSpeedWithFallback", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadSafeSpxBars.mockReset();
    mocks.loadSpxBars.mockReset();
    mocks.optionLegTradeCsvCandidates.mockReset();
    mocks.readCsv.mockReset();
    mocks.readFirstCsv.mockReset();
    mocks.safeSpxCsvCandidates.mockReset();
    mocks.tradeDates.mockReset();
    mocks.safeSpxCsvCandidates.mockReturnValue(["spx-sidecar.csv"]);
    mocks.readFirstCsv.mockResolvedValue([]);
  });

  // Wire the mocks so exactly `availableDate` assembles a frame (SPX bar + an
  // ATM straddle from a single-strike SPXW option-leg sidecar); every other date
  // returns no bars (unavailable).
  function makeDateAvailable(availableDate: string): void {
    const contractMonth = availableDate.replace(/-/g, "");
    mocks.loadSafeSpxBars.mockImplementation(async (date: string) =>
      date === availableDate
        ? [{ close: 5900, high: 5901, label: "09:30", low: 5899, open: 5900, time: 1, timestampEt: `${availableDate} 09:30:00` }]
        : [],
    );
    mocks.optionLegTradeCsvCandidates.mockImplementation((date: string) => [`legs-${date}.csv`]);
    const legRow = (right: "C" | "P") => ({
      trading_class: "SPXW",
      last_trade_date_or_contract_month: contractMonth,
      strike: "5900",
      right,
      close: "30",
      timestamp_et: `${availableDate} 09:30:00`,
    });
    mocks.readCsv.mockImplementation(async (candidate: string) =>
      candidate === `legs-${availableDate}.csv` ? [legRow("C"), legRow("P")] : [],
    );
  }

  it("returns the requested date untagged-as-fallback when it has a frame", async () => {
    const { loadSpreadSpeedWithFallback } = await import("./spreadSpeed.ts");
    makeDateAvailable("2026-06-05");
    mocks.tradeDates.mockResolvedValue(["2026-06-04", "2026-06-05"]);

    const payload = await loadSpreadSpeedWithFallback("2026-06-05");

    expect(payload.available).toBe(true);
    expect(payload.fallback).toBe(false);
    expect(payload.requestedDate).toBe("2026-06-05");
    expect(payload.date).toBe("2026-06-05");
  });

  it("falls back to the most recent earlier session when today has no frame", async () => {
    const { loadSpreadSpeedWithFallback } = await import("./spreadSpeed.ts");
    makeDateAvailable("2026-06-04");
    mocks.tradeDates.mockResolvedValue(["2026-06-02", "2026-06-03", "2026-06-04"]);

    const payload = await loadSpreadSpeedWithFallback("2026-06-05");

    expect(payload.available).toBe(true);
    expect(payload.fallback).toBe(true);
    expect(payload.requestedDate).toBe("2026-06-05");
    expect(payload.date).toBe("2026-06-04");
  });

  it("returns the empty requested payload when no earlier session has a frame", async () => {
    const { loadSpreadSpeedWithFallback } = await import("./spreadSpeed.ts");
    makeDateAvailable("never");
    mocks.tradeDates.mockResolvedValue(["2026-06-03", "2026-06-04"]);

    const payload = await loadSpreadSpeedWithFallback("2026-06-05");

    expect(payload.available).toBe(false);
    expect(payload.fallback).toBe(false);
    expect(payload.requestedDate).toBe("2026-06-05");
    expect(payload.date).toBe("2026-06-05");
  });
});
