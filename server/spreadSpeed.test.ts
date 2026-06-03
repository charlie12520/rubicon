import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSafeSpxBars: vi.fn(),
  loadSpxBars: vi.fn(),
  optionLegTradeCsvCandidates: vi.fn(),
  readCsv: vi.fn(),
  readFirstCsv: vi.fn(),
  safeSpxCsvCandidates: vi.fn(),
}));

vi.mock("./dataImporter.ts", () => ({
  IBKR_TRADES_ROOT: "C:/rubicon-spread-speed-test",
  loadSafeSpxBars: mocks.loadSafeSpxBars,
  loadSpxBars: mocks.loadSpxBars,
  optionLegTradeCsvCandidates: mocks.optionLegTradeCsvCandidates,
  readCsv: mocks.readCsv,
  readFirstCsv: mocks.readFirstCsv,
  safeSpxCsvCandidates: mocks.safeSpxCsvCandidates,
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
    mocks.optionLegTradeCsvCandidates.mockReturnValue(["option-leg-sidecar.csv"]);
    mocks.readCsv.mockResolvedValue([]);
    mocks.readFirstCsv.mockResolvedValue([]);
    mocks.safeSpxCsvCandidates.mockReturnValue(["spx-sidecar.csv"]);
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
