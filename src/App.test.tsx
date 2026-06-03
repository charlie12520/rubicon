// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplayPayload, SpreadSpeedPayload, TrackerSnapshot, TradeRecord } from "../shared/types";
import App from "./App";
import { fetchDailySyncStatus, fetchReplay, fetchSpreadSpeed, fetchTracker, saveTradeJournalSnapshot } from "./api";

vi.mock("./api", () => ({
  fetchDailySyncStatus: vi.fn(),
  fetchReplay: vi.fn(),
  fetchSpreadSpeed: vi.fn(),
  fetchTracker: vi.fn(),
  refreshGoogleSnapshot: vi.fn(),
  runDailySync: vi.fn(),
  saveTradeJournalSnapshot: vi.fn(),
}));

vi.mock("./components/MorningDashboard", () => ({
  MorningDashboard: () => <div data-testid="morning-dashboard" />,
}));

vi.mock("./components/RrgPanel", () => ({
  RrgPanel: () => <div data-testid="rrg-panel" />,
}));

vi.mock("./components/SpreadSpeedPanel", () => ({
  SpreadSpeedPanel: () => <div data-testid="spread-speed-panel" />,
}));

vi.mock("./components/ReplayCharts", () => ({
  ReplayCharts: ({
    replay,
    selectedTrade,
  }: {
    replay: ReplayPayload | null;
    selectedTrade: TradeRecord | null;
  }) => (
    <div data-replay-date={replay?.date ?? ""} data-selected-trade={selectedTrade?.id ?? ""} data-testid="replay-charts">
      replay {replay?.date ?? "none"} trade {selectedTrade?.id ?? "none"}
    </div>
  ),
}));

vi.mock("./components/ReviewEntryExitChart", () => ({
  ReviewEntryExitChart: () => <div data-testid="review-entry-exit-chart" />,
}));

const fetchTrackerMock = vi.mocked(fetchTracker);
const fetchReplayMock = vi.mocked(fetchReplay);
const fetchSpreadSpeedMock = vi.mocked(fetchSpreadSpeed);
const fetchDailySyncStatusMock = vi.mocked(fetchDailySyncStatus);
const saveTradeJournalSnapshotMock = vi.mocked(saveTradeJournalSnapshot);

describe("App Replay state routing", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchTrackerMock.mockResolvedValue(snapshotFixture());
    fetchSpreadSpeedMock.mockResolvedValue(spreadSpeedFixture());
    fetchDailySyncStatusMock.mockResolvedValue({
      generatedAt: "2026-06-02T12:00:00.000Z",
      message: "idle",
      ok: true,
      state: "idle",
    });
    saveTradeJournalSnapshotMock.mockResolvedValue({
      count: 0,
      generatedAt: "2026-06-02T12:00:00.000Z",
      message: "saved",
      ok: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not keep rendering a prior Replay payload after selecting a different date", async () => {
    const olderDateReplay = deferred<ReplayPayload>();
    fetchReplayMock.mockImplementation((date) => {
      if (date === "2026-06-01") {
        return olderDateReplay.promise;
      }
      return Promise.resolve(replayPayloadFixture(date));
    });

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-replay-date")).toBe("2026-06-02"));

    fireEvent.click(screen.getByRole("button", { name: /2026-06-01/ }));

    await waitFor(() => expect(fetchReplayMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("replay-charts").getAttribute("data-replay-date")).toBe("");

    olderDateReplay.resolve(replayPayloadFixture("2026-06-01"));
    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-replay-date")).toBe("2026-06-01"));
  });

  it("keeps the date-scoped Replay payload when selecting another quick trade", async () => {
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trade")).toBe("trade-new-a"));

    fireEvent.click(screen.getByRole("button", { name: /Replay 10:15 Put/ }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trade")).toBe("trade-new-b"));
    expect(fetchReplayMock).toHaveBeenCalledTimes(1);
    expect(fetchReplayMock.mock.calls[0][0]).toBe("2026-06-02");
    expect(fetchReplayMock.mock.calls[0][1]).toBeUndefined();
  });

  it("keeps Replay copy quiet for pending today and full-session state", async () => {
    fetchTrackerMock.mockResolvedValue(snapshotFixture({ today: "2026-06-03" }));
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-replay-date")).toBe("2026-06-02"));

    expect(screen.queryByText(/Today pending/i)).toBeNull();
    expect(screen.queryByText(/daily sync writes today's data/i)).toBeNull();
    expect(screen.queryByText(/trades in view/i)).toBeNull();
    expect(screen.queryByText(/full day/i)).toBeNull();
    expect(screen.queryByText(/terminal/i)).toBeNull();
    expect(screen.queryByText(/concurrent call spreads/i)).toBeNull();
    expect(screen.queryByText(/concurrent put spreads/i)).toBeNull();
    expect(screen.queryByText(/IBKR Wallet/i)).toBeNull();
  });

  it("uses terse Daily Pull status copy", async () => {
    fetchTrackerMock.mockResolvedValue(
      snapshotFixture({
        sourceHealth: [{ detail: "Wallet source should stay hidden.", label: "IBKR wallet", status: "warning" }],
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    await screen.findByRole("heading", { name: "2026-06-02" });

    expect(screen.queryByText(/data readiness/i)).toBeNull();
    expect(screen.queryByText(/core outputs ready/i)).toBeNull();
    expect(screen.queryByText(/raw row gaps/i)).toBeNull();
    expect(screen.queryByText(/\d+\/\d+ ready/i)).toBeNull();
    expect(screen.queryByText(/IBKR wallet/i)).toBeNull();
    expect(screen.queryByText(/Wallet source should stay hidden/i)).toBeNull();
  });

  it("renders Daily Pull as selected-date review readiness first", async () => {
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    expect(await screen.findByRole("heading", { name: "Ready for review" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "2026-06-02" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Trade, SPX, and replay outputs" })).toBeTruthy();
    expect(screen.getByText("No review-critical blockers for this date.")).toBeTruthy();
  });

  it("keeps archive and pipeline details collapsed by default", async () => {
    fetchTrackerMock.mockResolvedValue(
      snapshotFixture({
        dailySummaries: [
          dailySummaryFixture("2026-06-01", 1),
          dailySummaryFixture("2026-06-02", 2, {
            issues: [
              {
                detail: "The local archive has a sheet payload, but no raw_upload_google_sheet_url/upload receipt was found for this date.",
                severity: "warning",
                stage: "upload",
                title: "Live Google upload not confirmed",
              },
            ],
            rawUploadGoogleSheetUrl: undefined,
            uploadStatus: "payload_ready_unconfirmed",
          }),
        ],
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    await screen.findByRole("heading", { name: "Ready for review" });
    expect(screen.getByTestId("daily-pull-archive").hasAttribute("open")).toBe(false);
    expect(screen.getByTestId("daily-pull-diagnostics").hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("Pipeline / Archive Details"));
    expect(screen.getByTestId("daily-pull-archive").hasAttribute("open")).toBe(true);
    expect(screen.getByText("Live Google upload not confirmed")).toBeTruthy();
  });

  it("shows a today-empty banner with a latest usable date action", async () => {
    fetchTrackerMock.mockResolvedValue(
      snapshotFixture({
        availableDates: ["2026-06-02", "2026-06-03"],
        dailySummaries: [
          dailySummaryFixture("2026-06-02", 2),
          dailySummaryFixture("2026-06-03", 0, {
            availabilityStatus: "incomplete",
            entryCount: 0,
            fillCount: 0,
            payloadRows: 0,
            spxIntradayRowCount: 0,
            spxStatus: "error",
            spreadCount: 0,
            spreadMarkRowCount: 0,
            tradeCount: 0,
            tradeStatus: "empty",
            uploadStatus: "missing_payload",
            uploadTabCount: 0,
          }),
        ],
        latestTradeDate: "2026-06-03",
        today: "2026-06-03",
        trades: [tradeFixture("trade-new-a", "2026-06-02", "09:45", "Call"), tradeFixture("trade-new-b", "2026-06-02", "10:15", "Put")],
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-03"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    expect(await screen.findByRole("heading", { name: "Today not ready yet" })).toBeTruthy();
    expect(screen.getByTestId("today-pull-banner").textContent).toContain("Open 2026-06-02");

    fireEvent.click(screen.getByRole("button", { name: "Open 2026-06-02" }));
    expect(await screen.findByRole("heading", { name: "Ready for review" })).toBeTruthy();
  });

  it("hides accepted date issue badges across Replay, Daily Review, and Journal while keeping diagnostics", async () => {
    fetchTrackerMock.mockResolvedValue(
      snapshotFixture({
        dailySummaries: [
          dailySummaryFixture("2026-06-01", 1, {
            issueCount: 1,
            issues: [
              {
                detail: "SPX status is missing.",
                severity: "error",
                stage: "pull",
                title: "SPX pull missing or failed",
              },
            ],
            spxStatus: "missing",
          }),
          dailySummaryFixture("2026-06-02", 2),
        ],
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    const issueDateButton = await screen.findByRole("button", { name: /2026-06-01, 1 trade, \d+ issues? need review/i });
    fireEvent.click(issueDateButton);

    await screen.findByRole("heading", { name: "2026-06-01" });
    expect(screen.getByText("SPX pull missing or failed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Mark 2026-06-01 pull-date issues as fine/i }));
    expect(screen.getByRole("button", { name: /2026-06-01, 1 trade, issues accepted/i })).toBeTruthy();

    const replayTabs = screen.getAllByRole("tab", { name: "Replay" });
    fireEvent.click(replayTabs[replayTabs.length - 1]);
    expect(screen.getByRole("button", { name: /2026-06-01, 1 trade, issues accepted/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Daily Review" }));
    expect(screen.getByRole("button", { name: /2026-06-01, 1 trade, issues accepted/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Journal" }));
    expect(screen.getByRole("button", { name: /2026-06-01, 1 trade, issues accepted/i })).toBeTruthy();
  });

  it("hides Daily Review imported archive detail copy", async () => {
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Review" }));

    await screen.findByRole("heading", { name: /2026-06-02 entries/i });

    expect(screen.queryByText(/Imported Detail/i)).toBeNull();
    expect(screen.queryByText(/Sheet rows/i)).toBeNull();
  });

  it("keeps Daily Review focused on sequence and composition without flags or notes", async () => {
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Review" }));

    await screen.findByRole("heading", { name: "Entry / Exit Timeline" });

    expect(screen.queryByRole("heading", { name: "Review Flags" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Daily Note" })).toBeNull();
    expect(screen.queryByText(/Mistake/i)).toBeNull();
    expect(screen.queryByText(/Lesson/i)).toBeNull();
    expect(screen.getByRole("button", { name: /Open Replay/i }).className).toContain("review-action-button");
    expect(screen.getAllByText(/Entry 09:45 @ 1\.25/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Exit 15:45 @ 0\.25 - Held 6h - P\/L/i).length).toBeGreaterThan(0);
  });

  it("removes Journal queue filters and mistake lesson boxes", async () => {
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Journal" }));

    await screen.findByRole("heading", { name: "Trades to Journal" });

    expect(screen.queryByText(/still need notes/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Needs Review/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^All/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Follow-up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Winners/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Losers/i })).toBeNull();
    expect(screen.queryByText(/Mistake \/ leak/i)).toBeNull();
    expect(screen.queryByText(/Lesson \/ rule update/i)).toBeNull();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function snapshotFixture(overrides: Partial<TrackerSnapshot> = {}): TrackerSnapshot {
  const trades = [
    tradeFixture("trade-old-a", "2026-06-01", "09:45", "Call"),
    tradeFixture("trade-new-a", "2026-06-02", "09:45", "Call"),
    tradeFixture("trade-new-b", "2026-06-02", "10:15", "Put"),
  ];
    return {
    aiStuffRoot: "test",
    availableDates: ["2026-06-01", "2026-06-02"],
    dailySummaries: [
      dailySummaryFixture("2026-06-01", 1),
      dailySummaryFixture("2026-06-02", 2),
    ],
    generatedAt: "2026-06-02T12:00:00.000Z",
    googleSheetUrl: "https://example.test/sheet",
    latestTradeDate: "2026-06-02",
    reviewNotes: {},
    sourceHealth: [],
    today: "2026-06-02",
    trades,
    wallet: { netLiquidation: null, source: "test", updatedAt: null },
    ...overrides,
  };
}

function dailySummaryFixture(
  date: string,
  tradeCount: number,
  overrides: Partial<TrackerSnapshot["dailySummaries"][number]> = {},
): TrackerSnapshot["dailySummaries"][number] {
  return {
    availabilityStatus: "ok",
    date,
    entryCount: tradeCount,
    fillCount: tradeCount,
    issueCount: 0,
    issues: [],
    optionContractCount: tradeCount * 4,
    optionIntradayStatus: "ok",
    optionIntradayExpectedRows: tradeCount * 4860,
    optionIntradayExpectedRowsPerContract: 4860,
    optionIntradayRowCount: tradeCount * 4860,
    payloadRows: 10,
    rawUploadGoogleSheetUrl: "https://example.test/raw",
    spxIntradayBarSize: "5s",
    spxIntradayExpectedRows: 4680,
    spxIntradayRowCount: tradeCount > 0 ? 4680 : 0,
    spxStatus: "ok",
    spreadCount: tradeCount,
    spreadMarkExpectedRows: tradeCount * 4860,
    spreadMarkRowCount: tradeCount * 4860,
    tradeCount,
    tradeArtifactExpectedCount: 4,
    tradeArtifactReadyCount: 4,
    tradeStatus: "ok",
    uploadStatus: "uploaded",
    uploadTabCount: 1,
    ...overrides,
  };
}

function replayPayloadFixture(date: string): ReplayPayload {
  return {
    date,
    openInterest: [],
    quickTrades: [],
    selectedTradeId: null,
    spreadMarks: [],
    spxBars: [
      {
        close: 5000,
        high: 5001,
        label: "09:30",
        low: 4999,
        open: 5000,
        time: 1,
        timestampEt: `${date}T09:30:00-04:00`,
      },
    ],
    volume: [],
  };
}

function spreadSpeedFixture(): SpreadSpeedPayload {
  return {
    available: true,
    date: "2026-06-02",
    fastThreshold: 2,
    frames: [],
    generatedAt: "2026-06-02T12:00:00.000Z",
    note: "ok",
    targetNetDelta: 0.05,
  };
}

function tradeFixture(id: string, date: string, time: string, side: "Call" | "Put"): TradeRecord {
  const shortStrike = side === "Call" ? 5050 : 4950;
  const longStrike = side === "Call" ? 5060 : 4940;
  return {
    account: "DU123",
    bias: side === "Call" ? "Bearish" : "Bullish",
    contracts: 1,
    date,
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    entryPrice: 1.25,
    entryTime: `${date}T${time}:00-04:00`,
    exitPrice: 0.25,
    exitTime: `${date}T15:45:00-04:00`,
    expiration: date,
    fees: 1,
    id,
    legs: [],
    longStrike,
    maxProfit: 125,
    maxRisk: 875,
    notes: "",
    pnl: 100,
    positionAfter: 0,
    positionBefore: 0,
    priceType: "Credit",
    returnOnRisk: 0.1,
    shortStrike,
    side,
    source: "test",
    spxEntry: 5000,
    spxExit: 5005,
    status: "Closed",
    strategy: `${side} credit spread`,
    width: 10,
    winLoss: "Win",
  };
}
