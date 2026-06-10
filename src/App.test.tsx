// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailySyncStatusResult, DailySyncStep, ReplayPayload, SpreadSpeedPayload, TrackerSnapshot, TradeRecord } from "../shared/types";
import App from "./App";
import { fetchDailySyncStatus, fetchReplay, fetchSpreadSpeed, fetchTracker, runDailyOptionPull, saveTradeJournalSnapshot } from "./api";

vi.mock("./api", () => ({
  fetchDailySyncStatus: vi.fn(),
  fetchReplay: vi.fn(),
  fetchSpreadSpeed: vi.fn(),
  fetchTracker: vi.fn(),
  refreshGoogleSnapshot: vi.fn(),
  runDailyOptionPull: vi.fn(),
  runDailySync: vi.fn(),
  saveTradeJournalSnapshot: vi.fn(),
  // The Morning live Signal-Stack feed polls these on mount; resolve to inert
  // values so the (mocked) MorningDashboard render isn't affected.
  fetchLiveSpreadSpeed: vi.fn(async () => ({
    date: "",
    generatedAt: "",
    available: false,
    note: "",
    targetNetDelta: 0.05,
    fastThreshold: 0.05,
    frames: [],
    live: true,
  })),
  fetchLiveSpreadSpeedStatus: vi.fn(async () => ({
    running: false,
    pid: null,
    startedAt: null,
    lastExit: null,
    logTail: [],
    script: "",
    python: "",
    available: true,
    autoStartEt: null,
    autoStartLastFiredDate: null,
    marketOpen: false,
  })),
  startLiveSpreadSpeed: vi.fn(),
  stopLiveSpreadSpeed: vi.fn(),
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
    selectedTrades,
    selectionLabel,
  }: {
    replay: ReplayPayload | null;
    selectedTrade: TradeRecord | null;
    selectedTrades?: TradeRecord[];
    selectionLabel?: string;
  }) => (
    <div
      data-replay-date={replay?.date ?? ""}
      data-selected-trade={selectedTrade?.id ?? ""}
      data-selected-trades={selectedTrades?.map((trade) => trade.id).join(",") ?? ""}
      data-selection-label={selectionLabel ?? ""}
      data-testid="replay-charts"
    >
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
const runDailyOptionPullMock = vi.mocked(runDailyOptionPull);
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
    runDailyOptionPullMock.mockResolvedValue({
      generatedAt: "2026-06-02T12:00:00.000Z",
      message: "Failed/missing option data retry started.",
      ok: true,
      state: "running",
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

  it("routes the Yesterday preset on Monday to the prior Friday session", async () => {
    const trades = [
      tradeFixture("friday-trade", "2026-06-05", "09:45", "Put"),
      tradeFixture("monday-trade", "2026-06-08", "09:45", "Call"),
    ];
    fetchTrackerMock.mockResolvedValue(snapshotFixture({
      availableDates: ["2026-06-05", "2026-06-08"],
      dailySummaries: [
        dailySummaryFixture("2026-06-05", 1),
        dailySummaryFixture("2026-06-08", 1),
      ],
      latestTradeDate: "2026-06-08",
      today: "2026-06-08",
      trades,
    }));
    fetchReplayMock.mockImplementation((date) => Promise.resolve(replayPayloadFixture(date)));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-replay-date")).toBe("2026-06-08"));

    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-replay-date")).toBe("2026-06-05"));
    expect(screen.getByDisplayValue("2026-06-05")).toBeTruthy();
    expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trade")).toBe("friday-trade");
  });

  it("keeps the date-scoped Replay payload when selecting another spread", async () => {
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trade")).toBe("trade-new-a"));

    fireEvent.click(screen.getByRole("button", { name: /Replay spread Put/ }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trade")).toBe("trade-new-b"));
    expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trades")).toBe("trade-new-b");
    expect(fetchReplayMock).toHaveBeenCalledTimes(1);
    expect(fetchReplayMock.mock.calls[0][0]).toBe("2026-06-02");
    expect(fetchReplayMock.mock.calls[0][1]).toBeUndefined();
  });

  it("can select a whole spread and pass all matching entries to Replay charts", async () => {
    const date = "2026-06-02";
    const trades = [
      tradeFixture("call-a", date, "09:45", "Call"),
      tradeFixture("call-b", date, "10:15", "Call"),
      tradeFixture("put-a", date, "10:45", "Put"),
    ];
    fetchTrackerMock.mockResolvedValue(snapshotFixture({
      availableDates: [date],
      dailySummaries: [dailySummaryFixture(date, trades.length)],
      latestTradeDate: date,
      today: date,
      trades,
    }));
    fetchReplayMock.mockResolvedValue(replayPayloadFixture(date));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trades")).toBe("call-a,call-b"));
    expect(screen.queryByText("Entries")).toBeNull();
    expect(screen.queryAllByTestId("quick-trade-button")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Replay spread Call 5050\/5060 2 entries/i }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trades")).toBe("call-a,call-b"));
    expect(screen.getByTestId("replay-charts").getAttribute("data-selection-label")).toBe("Call 5050/5060 - 2 entries");

    fireEvent.click(screen.getByRole("button", { name: /Replay spread Put/i }));

    await waitFor(() => expect(screen.getByTestId("replay-charts").getAttribute("data-selected-trades")).toBe("put-a"));
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
    const glance = screen.getByTestId("daily-pull-glance");
    expect(within(glance).getByRole("heading", { name: "Everything important is complete" })).toBeTruthy();
    expect(within(glance).getByText("6/6 complete")).toBeTruthy();
    expect(within(glance).getByText("IBKR trade files")).toBeTruthy();
    expect(within(glance).getByText("SPX 5s bars")).toBeTruthy();
    expect(within(glance).getByText("Traded spread replay marks")).toBeTruthy();
    expect(within(glance).getByText("Option 5s chain")).toBeTruthy();
    expect(within(glance).getByText("Option OI")).toBeTruthy();
    expect(within(glance).getByText("Option Volume")).toBeTruthy();
    expect(screen.queryByTestId("daily-pull-review-details")).toBeNull();
    expect(screen.queryByText("Review Details")).toBeNull();
    expect(screen.queryByText("Review Critical")).toBeNull();
    expect(screen.queryByText("Review Readiness")).toBeNull();
    expect(within(glance).queryByText("No review-critical blockers for this date.")).toBeNull();
    expect(within(glance).queryByRole("heading", { name: "Trade, SPX, and replay outputs" })).toBeNull();
    const pipelineActions = screen.getByRole("region", { name: "Daily pipeline actions" });
    expect(within(pipelineActions).getByRole("button", { name: "Run Daily Pipeline" })).toBeTruthy();
    expect(within(pipelineActions).getByRole("button", { name: "Preflight Pipeline" })).toBeTruthy();
    expect(within(pipelineActions).getByText("Ready to run")).toBeTruthy();
    expect(within(pipelineActions).getByText("0 / 14 steps")).toBeTruthy();
    expect(within(pipelineActions).getByRole("progressbar", { name: "Daily sync progress" }).getAttribute("aria-valuenow")).toBe("0");
  });

  it("shows one manual option retry control for failed or missing pulls", async () => {
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    const optionRepull = await screen.findByRole("region", { name: "Option data retry" });
    expect(within(optionRepull).getByText("Retries failed or missing option pulls for 2026-06-02")).toBeTruthy();
    expect(within(optionRepull).queryByRole("button", { name: "SPX Spread Legs" })).toBeNull();
    expect(within(optionRepull).queryByRole("button", { name: "SPX Chain Band" })).toBeNull();
    expect(within(optionRepull).queryByRole("button", { name: "Owned Options" })).toBeNull();
    fireEvent.click(within(optionRepull).getByRole("button", { name: "Retry Missing Option Data" }));

    await waitFor(() => expect(runDailyOptionPullMock).toHaveBeenCalledWith("2026-06-02"));
  });

  it("keeps coverage percentage out of Daily Pull details", async () => {
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    await screen.findByRole("heading", { name: "Everything important is complete" });
    expect(screen.queryByText("Coverage")).toBeNull();

    fireEvent.click(screen.getByText("Diagnostics / Context"));
    const diagnostics = screen.getByTestId("daily-pull-diagnostics");
    expect(diagnostics.hasAttribute("open")).toBe(true);
    expect(within(diagnostics).getByRole("columnheader", { name: "Needed" })).toBeTruthy();
    expect(within(diagnostics).getByRole("columnheader", { name: "Pulled" })).toBeTruthy();
    expect(within(diagnostics).getByRole("columnheader", { name: "Missing" })).toBeTruthy();
    expect(within(diagnostics).queryByRole("columnheader", { name: "Coverage" })).toBeNull();
    expect(within(diagnostics).queryByText(/\d+\.\d%/)).toBeNull();
  });

  it("shows the running daily sync step and count in the top progress bar", async () => {
    fetchDailySyncStatusMock.mockResolvedValue(
      dailySyncStatusFixture({
        message: "Pulling SPX bars.",
        state: "running",
        steps: pipelineSteps({
          "sync-started": "complete",
          "core-sync": "running",
        }).map((step) =>
          step.id === "core-sync"
            ? { ...step, detail: "Pulling SPX bars and IBKR execution files." }
            : step,
        ),
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    const pipelineActions = await screen.findByRole("region", { name: "Daily pipeline actions" });
    await waitFor(() => expect(within(pipelineActions).getByText("Running: Data Collection")).toBeTruthy());
    expect(within(pipelineActions).getByText("1 / 14 steps")).toBeTruthy();
    expect(within(pipelineActions).getByText("Pulling SPX bars and IBKR execution files. Waiting for data update.")).toBeTruthy();
    expect(Number(within(pipelineActions).getByRole("progressbar", { name: "Daily sync progress" }).getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  });

  it("shows running daily sync sub-progress in the top progress bar", async () => {
    fetchDailySyncStatusMock.mockResolvedValue(
      dailySyncStatusFixture({
        message: "Running bounded SPX spread-leg option pull.",
        state: "running",
        steps: pipelineSteps({
          "sync-started": "complete",
          "core-sync": "complete",
          "rubicon-ingest": "complete",
          "sheet-payload": "complete",
          "google-upload": "complete",
          "tc2000-open": "complete",
          "tc2000-export": "warning",
          "qullamaggie-report": "warning",
          "tc2000-bars": "complete",
          "option-spx-spread-legs": "running",
        }).map((step) =>
          step.id === "option-spx-spread-legs"
            ? {
                ...step,
                detail: "Running bounded SPX spread-leg option pull.",
                progress: {
                  current: 7,
                  total: 24,
                  unit: "contracts" as const,
                  detail: "SPXW 260605P07450: 4,860 bars; spread marks updating",
                },
              }
            : step,
        ),
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    const pipelineActions = await screen.findByRole("region", { name: "Daily pipeline actions" });
    await waitFor(() => expect(within(pipelineActions).getByText("Running: Option SPX spread legs")).toBeTruthy());
    expect(within(pipelineActions).getByText("7 / 24 contracts")).toBeTruthy();
    expect(within(pipelineActions).getByText("SPXW 260605P07450: 4,860 bars; spread marks updating")).toBeTruthy();
  });

  it("shows failed daily sync step detail visibly in the top progress bar", async () => {
    fetchDailySyncStatusMock.mockResolvedValue(
      dailySyncStatusFixture({
        message: "Daily pipeline completed with stage errors.",
        pipelineState: "failed-with-stage-errors",
        state: "completed",
        steps: pipelineSteps({
          "sync-started": "complete",
          "core-sync": "complete",
          "rubicon-ingest": "complete",
          "sheet-payload": "complete",
          "google-upload": "failed",
        }).map((step) =>
          step.id === "google-upload"
            ? { ...step, detail: "Google tracker update failed; local review is still usable." }
            : step,
        ),
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    const pipelineActions = await screen.findByRole("region", { name: "Daily pipeline actions" });
    await waitFor(() => expect(within(pipelineActions).getByText("Stopped at Google Upload")).toBeTruthy());
    expect(within(pipelineActions).getByText("Google tracker update failed; local review is still usable.")).toBeTruthy();
    expect(Number(within(pipelineActions).getByRole("progressbar", { name: "Daily sync progress" }).getAttribute("aria-valuenow"))).toBeLessThan(100);
  });

  it("shows completed daily sync progress at 100 percent", async () => {
    fetchDailySyncStatusMock.mockResolvedValue(
      dailySyncStatusFixture({
        message: "Daily pipeline completed.",
        pipelineState: "completed",
        state: "completed",
        steps: pipelineSteps({
          "sync-started": "complete",
          "core-sync": "complete",
          "rubicon-ingest": "complete",
          "sheet-payload": "complete",
          "google-upload": "complete",
          "tc2000-open": "complete",
          "option-spx-spread-legs": "complete",
          "option-spx-chain-band": "complete",
          "option-owned-symbols": "complete",
          "option-open-interest": "complete",
          "option-rubicon-refresh": "complete",
          "tc2000-export": "complete",
          "qullamaggie-report": "complete",
          "tc2000-bars": "complete",
        }),
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    const pipelineActions = await screen.findByRole("region", { name: "Daily pipeline actions" });
    await waitFor(() => expect(within(pipelineActions).getByText("Completed")).toBeTruthy());
    expect(within(pipelineActions).getByText("14 / 14 steps")).toBeTruthy();
    expect(within(pipelineActions).getByRole("progressbar", { name: "Daily sync progress" }).getAttribute("aria-valuenow")).toBe("100");
  });

  it("keeps archive and pipeline details collapsed by default", async () => {
    fetchTrackerMock.mockResolvedValue(
      snapshotFixture({
        dailySummaries: [
          dailySummaryFixture("2026-06-01", 1),
          dailySummaryFixture("2026-06-02", 2, {
            issues: [
              {
                detail: "The compact tracker payload exists, but no successful Google tracker update is recorded in the daily summary.",
                severity: "warning",
                stage: "upload",
                title: "Google tracker upload not confirmed",
              },
            ],
            rawUploadGoogleSheetUrl: undefined,
            uploadStatus: "payload_ready_unconfirmed",
          }),
        ],
      }),
    );
    fetchDailySyncStatusMock.mockResolvedValue({
      generatedAt: "2026-06-02T12:00:00.000Z",
      googleUploaded: true,
      message: "Daily pipeline completed with sidecar warnings.",
      ok: true,
      reviewReady: true,
      state: "completed",
      steps: [
        {
          id: "tc2000-open",
          label: "Open TC2000",
          status: "warning",
          detail: "TC2000 could not be opened automatically.",
        },
        {
          id: "tc2000-export",
          label: "TC2000 export",
          status: "warning",
          detail: "TC2000 export failed or did not produce a fresh non-empty CSV.",
        },
        {
          id: "qullamaggie-report",
          label: "Qullamaggie report/email",
          status: "warning",
          detail: "Skipped Qullamaggie report/email because TC2000 export did not produce a fresh scanner CSV.",
        },
        {
          id: "tc2000-bars",
          label: "TC2000 daily bars",
          status: "complete",
          detail: "Daily bars refreshed.",
        },
      ],
    });
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    await screen.findByRole("heading", { name: "Ready for review" });
    expect(screen.getByTestId("daily-pull-archive").hasAttribute("open")).toBe(false);
    expect(screen.getByTestId("daily-pull-diagnostics").hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("Pipeline / Upload Details"));
    expect(screen.getByTestId("daily-pull-archive").hasAttribute("open")).toBe(true);
    expect(screen.getByTestId("daily-pull-audit").hasAttribute("open")).toBe(false);
    expect(screen.getAllByText("Google tracker upload not confirmed").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Run audit"));
    expect(screen.getByTestId("daily-pull-audit").hasAttribute("open")).toBe(true);
    expect(screen.getByText("Open TC2000")).toBeTruthy();
    expect(screen.getByText("TC2000 export")).toBeTruthy();
    expect(screen.getByText("Qullamaggie report/email")).toBeTruthy();
    expect(screen.getByText("TC2000 daily bars")).toBeTruthy();
  });

  it("does not duplicate Daily Pull pipeline controls inside expanded details", async () => {
    fetchDailySyncStatusMock.mockResolvedValue(
      dailySyncStatusFixture({
        steps: pipelineSteps({
          "sync-started": "complete",
          "core-sync": "complete",
        }),
      }),
    );
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Pull" }));

    await screen.findByRole("heading", { name: "Ready for review" });
    fireEvent.click(screen.getByText("Pipeline / Upload Details"));

    expect(screen.getAllByRole("button", { name: "Run Daily Pipeline" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Preflight Pipeline" })).toHaveLength(1);
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
    expect(screen.getAllByText("SPX pull missing or failed").length).toBeGreaterThan(0);

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
    const date = "2026-06-02";
    const trades = [
      tradeFixture("trade-new-a", date, "09:45", "Call"),
      tradeFixture("trade-new-b", date, "10:15", "Put"),
      {
        ...tradeFixture("expired-eod", date, "11:00", "Call"),
        exitPrice: null,
        exitTime: `${date}T16:00:00-04:00`,
        pnl: -875,
        status: "Expired",
        winLoss: "Loss" as const,
      },
    ];
    fetchTrackerMock.mockResolvedValue(snapshotFixture({
      availableDates: [date],
      dailySummaries: [dailySummaryFixture(date, trades.length)],
      latestTradeDate: date,
      today: date,
      trades,
    }));
    fetchReplayMock.mockResolvedValue(replayPayloadFixture("2026-06-02"));

    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Replay" }));
    fireEvent.click(screen.getByRole("tab", { name: "Daily Review" }));

    await screen.findByRole("heading", { name: "Entry / Exit Timeline" });

    expect(screen.queryByRole("heading", { name: "Review Flags" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Daily Note" })).toBeNull();
    expect(screen.queryByText(/Mistake/i)).toBeNull();
    expect(screen.queryByText(/Lesson/i)).toBeNull();
    expect(screen.queryByText(/expir/i)).toBeNull();
    expect(screen.queryByText(/Expiry/i)).toBeNull();
    expect(screen.getByText("5 events")).toBeTruthy();
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
    optionIntradayBarSize: "5s",
    optionIntradayStatus: "ok",
    optionIntradayExpectedRows: tradeCount * 4860,
    optionIntradayExpectedRowsPerContract: 4860,
    optionIntradayRowCount: tradeCount * 4860,
    openInterestExpectedRows: tradeCount * 4,
    openInterestRowCount: tradeCount * 4,
    openInterestValidRowCount: tradeCount * 4,
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
    volumeProfileExpectedRows: tradeCount * 4860,
    volumeProfileRowCount: tradeCount * 4860,
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

function dailySyncStatusFixture(overrides: Partial<DailySyncStatusResult> = {}): DailySyncStatusResult {
  return {
    generatedAt: "2026-06-03T12:00:00.000Z",
    message: "Daily pipeline status.",
    ok: true,
    state: "idle",
    ...overrides,
  };
}

function pipelineSteps(statuses: Partial<Record<string, DailySyncStep["status"]>> = {}): DailySyncStep[] {
  return [
    { id: "sync-started", label: "Sync started", status: statuses["sync-started"] ?? "pending" },
    { id: "core-sync", label: "Data Collection", status: statuses["core-sync"] ?? "pending" },
    { id: "rubicon-ingest", label: "Rubicon Ingest", status: statuses["rubicon-ingest"] ?? "pending" },
    { id: "sheet-payload", label: "Sheet payload", status: statuses["sheet-payload"] ?? "pending" },
    { id: "google-upload", label: "Google Upload", status: statuses["google-upload"] ?? "pending" },
    { id: "tc2000-open", label: "Open TC2000", status: statuses["tc2000-open"] ?? "pending" },
    { id: "tc2000-export", label: "TC2000 export", status: statuses["tc2000-export"] ?? "pending" },
    { id: "qullamaggie-report", label: "Qullamaggie report/email", status: statuses["qullamaggie-report"] ?? "pending" },
    { id: "tc2000-bars", label: "TC2000 daily bars", status: statuses["tc2000-bars"] ?? "pending" },
    { id: "option-spx-spread-legs", label: "Option SPX spread legs", status: statuses["option-spx-spread-legs"] ?? "pending" },
    { id: "option-spx-chain-band", label: "Option SPX chain band", status: statuses["option-spx-chain-band"] ?? "pending" },
    { id: "option-owned-symbols", label: "Option owned symbols", status: statuses["option-owned-symbols"] ?? "pending" },
    { id: "option-open-interest", label: "Option open interest", status: statuses["option-open-interest"] ?? "pending" },
    { id: "option-rubicon-refresh", label: "Option Rubicon refresh", status: statuses["option-rubicon-refresh"] ?? "pending" },
  ];
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
