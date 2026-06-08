// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IbkrHoldingPosition, MorningBriefPayload, MorningBriefSource, MorningCalendarEvent, MorningMajorEvent } from "../../shared/types";
import type { SpreadSpeedFrame, SpxLiveBarsLiveStatus } from "../../shared/types";
import { fetchGodelAlertBridgeStatus, fetchIbkrHoldings, fetchMorningAiNotes, fetchMorningBrief, fetchMorningLiveUpdates, refreshIbkrHoldings } from "../api";
import { easternDateKey } from "../easternDate";
import * as MorningDashboardModule from "./MorningDashboard";

vi.mock("../api", () => ({
  fetchGodelAlertBridgeStatus: vi.fn(),
  fetchIbkrHoldings: vi.fn(),
  fetchMorningAiNotes: vi.fn(),
  fetchMorningBrief: vi.fn(),
  fetchMorningLiveUpdates: vi.fn(),
  refreshIbkrHoldings: vi.fn(),
  triggerCalendarDesktopAlert: vi.fn(),
  triggerLiveUpdateDesktopAlert: vi.fn(),
}));

// The Signal Stack embeds the FPL panel, which runs its own fetches on mount;
// stub it so these are focused unit tests of the stale-badge / empty-state copy.
vi.mock("./FplIndicatorPanel", () => ({ FplIndicatorPanel: () => null }));

const SignalStackSection = (MorningDashboardModule as {
  SignalStackSection?: ComponentType<{
    selectedDate: string;
    signalFrame: SpreadSpeedFrame | null;
    frameDate: string | null;
    isFallback: boolean;
    isLive: boolean;
    liveFeed?: {
      status: SpxLiveBarsLiveStatus | null;
      busy: boolean;
      tracksToday: boolean;
      onStart: () => void;
      onStop: () => void;
    };
    targetNetDelta: number;
  }>;
}).SignalStackSection;

type MorningAgendaSectionProps = {
  alertsArmed: boolean;
  alertStatus: string;
  events: MorningCalendarEvent[];
  macroSource?: MorningBriefSource;
  majorEvents: MorningMajorEvent[];
  majorEventsSource?: MorningBriefSource;
  onTestAlert: () => void;
  onToggleAlerts: () => void;
  rollcallSource?: MorningBriefSource;
};

const MorningAgendaSection = (MorningDashboardModule as {
  MorningAgendaSection?: ComponentType<MorningAgendaSectionProps>;
}).MorningAgendaSection;

const Tc2000Preview = (MorningDashboardModule as {
  Tc2000Preview?: ComponentType<{ brief: MorningBriefPayload | null }>;
}).Tc2000Preview;

const MorningDashboard = MorningDashboardModule.MorningDashboard;
const fetchMorningBriefMock = vi.mocked(fetchMorningBrief);
const fetchMorningLiveUpdatesMock = vi.mocked(fetchMorningLiveUpdates);
const fetchMorningAiNotesMock = vi.mocked(fetchMorningAiNotes);
const fetchIbkrHoldingsMock = vi.mocked(fetchIbkrHoldings);
const fetchGodelAlertBridgeStatusMock = vi.mocked(fetchGodelAlertBridgeStatus);
const refreshIbkrHoldingsMock = vi.mocked(refreshIbkrHoldings);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MorningAgendaSection", () => {
  it("splits today's calendar events left and major events right", () => {
    expect(MorningAgendaSection).toBeTypeOf("function");
    if (!MorningAgendaSection) {
      throw new Error("MorningAgendaSection is not exported");
    }

    const events: MorningCalendarEvent[] = [
      {
        date: "2026-06-12",
        id: "daily-cpi",
        impact: "high",
        source: "BLS",
        sortMinute: 510,
        timeLabel: "8:30 AM",
        title: "CPI",
      },
    ];
    const majorEvents: MorningMajorEvent[] = [
      {
        date: "2026-06-19",
        id: "major-opex-2026-06-19",
        impact: "market",
        kind: "opex",
        source: "OPEX",
        sortMinute: null,
        timeLabel: "All day",
        title: "Monthly OPEX",
        window: "nextWeek",
      },
    ];

    const { container } = render(
      <MorningAgendaSection
        alertsArmed={true}
        alertStatus="Calendar alerts armed."
        events={events}
        majorEvents={majorEvents}
        onTestAlert={() => undefined}
        onToggleAlerts={() => undefined}
      />,
    );

    const body = container.querySelector(".morning-calendar-body");
    expect(body).not.toBeNull();
    expect(body?.children[0]?.classList.contains("morning-event-list")).toBe(true);
    expect(body?.children[1]?.classList.contains("morning-major-events")).toBe(true);
  });

  it("hides routine calendar source and high-importance time/source copy", () => {
    expect(MorningAgendaSection).toBeTypeOf("function");
    if (!MorningAgendaSection) {
      throw new Error("MorningAgendaSection is not exported");
    }

    const events: MorningCalendarEvent[] = [
      {
        date: "2026-06-12",
        id: "daily-cpi",
        impact: "high",
        source: "BLS",
        sortMinute: 510,
        timeLabel: "8:30 AM",
        title: "CPI",
      },
    ];
    const majorEvents: MorningMajorEvent[] = [
      {
        date: "2026-06-12",
        id: "major-cpi",
        impact: "high",
        kind: "macro",
        source: "BLS",
        sortMinute: 510,
        timeLabel: "8:30 AM",
        title: "CPI",
        window: "thisWeek",
      },
    ];

    render(
      <MorningAgendaSection
        alertsArmed={true}
        alertStatus="Calendar alerts armed."
        events={events}
        macroSource={{ detail: "Pulled CPI from US macro calendar.", label: "US macro calendar", status: "ok" }}
        majorEvents={majorEvents}
        majorEventsSource={{ detail: "Pulled high-importance official macro rows.", label: "Major events outlook", status: "ok" }}
        onTestAlert={() => undefined}
        onToggleAlerts={() => undefined}
      />,
    );

    expect(screen.queryByText(/Economic \+ presidential agenda/i)).toBeNull();
    expect(screen.queryByText(/Pulled CPI from US macro/i)).toBeNull();
    expect(screen.queryByText(/Pulled high-importance official macro/i)).toBeNull();
    expect(screen.queryByText(/8:30 AM - BLS/i)).toBeNull();
  });

  it("keeps calendar failure details visible", () => {
    expect(MorningAgendaSection).toBeTypeOf("function");
    if (!MorningAgendaSection) {
      throw new Error("MorningAgendaSection is not exported");
    }

    render(
      <MorningAgendaSection
        alertsArmed={true}
        alertStatus="Calendar alerts armed."
        events={[]}
        macroSource={{ detail: "US macro calendar pull failed.", label: "US macro calendar", status: "warning" }}
        majorEvents={[]}
        onTestAlert={() => undefined}
        onToggleAlerts={() => undefined}
      />,
    );

    expect(screen.getByText("US macro calendar pull failed.")).toBeTruthy();
  });
});

describe("Tc2000Preview", () => {
  it("highlights scanner symbol buttons that are new versus the prior list", () => {
    expect(Tc2000Preview).toBeTypeOf("function");
    if (!Tc2000Preview) {
      throw new Error("Tc2000Preview is not exported");
    }

    const brief: MorningBriefPayload = {
      combinedEvents: [],
      date: "2026-06-02",
      economicEvents: [],
      generatedAt: "2026-06-02T12:00:00.000Z",
      liveUpdates: [],
      majorEvents: [],
      sources: [],
      tc2000: {
        artifacts: [],
        available: true,
        dailyBars: {},
        dailyBarsGeneratedAt: null,
        dailyBarsSource: null,
        newSymbols: ["UIS"],
        newSymbolsComparedWithDate: "2026-06-01",
        note: "Loaded test scanner list.",
        profiles: {},
        screeners: [
          {
            name: "Three Bar Rule Spike/Base BO",
            newSymbols: ["UIS"],
            source: "csv",
            symbols: ["SPCE", "UIS"],
          },
        ],
        sourceDir: null,
        symbols: ["SPCE", "UIS"],
      },
      trumpEvents: [],
    };

    render(<Tc2000Preview brief={brief} />);

    expect(screen.getByRole("button", { name: /UIS/ }).classList.contains("new")).toBe(true);
    expect(screen.getByRole("button", { name: /SPCE/ }).classList.contains("new")).toBe(false);
    expect(screen.queryByText(/1 new/i)).toBeNull();
  });

  it("shows scanner lists without routine hit and daily-bar readiness counters", () => {
    expect(Tc2000Preview).toBeTypeOf("function");
    if (!Tc2000Preview) {
      throw new Error("Tc2000Preview is not exported");
    }

    const brief: MorningBriefPayload = {
      combinedEvents: [],
      date: "2026-06-02",
      economicEvents: [],
      generatedAt: "2026-06-02T12:00:00.000Z",
      liveUpdates: [],
      majorEvents: [],
      sources: [],
      tc2000: {
        artifacts: [],
        available: true,
        dailyBars: {
          SPCE: [{ close: 10, date: "2026-06-01", high: 11, low: 9, open: 10, volume: 1000 }],
          UIS: [{ close: 20, date: "2026-06-01", high: 21, low: 19, open: 20, volume: 1000 }],
        },
        dailyBarsGeneratedAt: "2026-06-02T12:00:00.000Z",
        dailyBarsNote: "Daily bars available for 2 / 2 TC2000 symbols.",
        dailyBarsSource: "test",
        note: "Loaded 1 TC2000 scanner list with 2 total symbols. Daily bars available for 2 / 2 TC2000 symbols.",
        profiles: {},
        screeners: [
          {
            name: "Three Bar Rule Spike/Base BO",
            source: "csv",
            symbols: ["SPCE", "UIS"],
          },
        ],
        sourceDir: null,
        symbols: ["SPCE", "UIS"],
      },
      trumpEvents: [],
    };

    render(<Tc2000Preview brief={brief} />);

    expect(screen.getByText("Three Bar Rule Spike/Base BO")).toBeTruthy();
    expect(screen.queryByText(/scanner lists/i)).toBeNull();
    expect(screen.queryByText(/Latest TC2000 screener/i)).toBeNull();
    expect(screen.queryByText(/Total hits/i)).toBeNull();
    expect(screen.queryByText(/Daily bars/i)).toBeNull();
    expect(screen.queryByText(/daily charts ready/i)).toBeNull();
  });
});

describe("MorningDashboard copy cleanup", () => {
  it("renders a date-only Morning header and hides routine source/readiness copy", async () => {
    mockMorningDashboardFetches({
      aiNotesSource: "codex_automation",
      brief: noisyBriefFixture("2026-06-02"),
    });
    fetchIbkrHoldingsMock.mockResolvedValue({
      account: "U19610351",
      count: 12,
      earningsSource: "test",
      fetchedAt: "2026-06-02T20:39:00.000Z",
      grossCostBasis: 101679,
      grossCurrentValue: 104333,
      manualGreeksSummary: { computed: 0, ibkr: 6, manual: 0, missing: 6, optionCount: 12 },
      marketDataSummary: { optionCount: 12, withDelta: 6, withMarketPrice: 12, withTheta: 6 },
      message: "Pulled 12 live IBKR positions.",
      positions: [],
      source: "test",
      status: "ok",
    });

    render(
      <MorningDashboard
        onOpenReplay={() => undefined}
        onSelectDate={() => undefined}
        selectedDate="2026-06-02"
        spreadSpeed={null}
      />,
    );

    expect(await screen.findByText("2026-06-02")).toBeTruthy();
    expect(screen.queryByText(/Rubicon Morning/i)).toBeNull();
    expect(screen.queryByText(/2026-06-02 morning brief/i)).toBeNull();
    expect(screen.queryByText(/Macro calendar/i)).toBeNull();
    expect(screen.queryByText(/FirstSquawk and Godel/i)).toBeNull();
    expect(screen.queryByText(/FirstSquawk 1 \/ Godel 1/i)).toBeNull();
    expect(screen.queryByText(/Pulled 1 US macro event/i)).toBeNull();
    expect(screen.queryByText(/Codex notes ready/i)).toBeNull();
    expect(screen.queryByText(/Event only/i)).toBeNull();
    expect(screen.queryByText(/Oval Office/i)).toBeNull();
    expect(screen.queryByText(/Generated empty-state morning notes/i)).toBeNull();
    expect(screen.queryByText(/RUBICON_GODEL_NEWS_URL/i)).toBeNull();
    expect(screen.queryByText(/godel:scrape/i)).toBeNull();
    expect(screen.queryByText(/capture-godel-news/i)).toBeNull();
    expect(screen.queryByText(/Latest scanner pulls/i)).toBeNull();
    expect(screen.queryByText(/scanner lists/i)).toBeNull();
    expect(screen.queryByText(/Total hits/i)).toBeNull();
    expect(screen.queryByText(/daily charts ready/i)).toBeNull();
    expect(screen.queryByText(/12 positions - U19610351/i)).toBeNull();
    expect(screen.queryByText(/Updated 4:39 PM EDT/i)).toBeNull();
    expect(screen.queryByText(/Value \$104,333/i)).toBeNull();
    expect(screen.queryByText(/Cost \$101,679/i)).toBeNull();
    expect(screen.queryByText(/Greeks 6\/12/i)).toBeNull();
    expect(screen.queryByText(/No 7d earnings warnings/i)).toBeNull();
    expect(screen.queryByText("2 new")).toBeNull();
    expect(screen.queryByText(/Pulled 16 items from FirstSquawk timeline/i)).toBeNull();
  });

  it("does not announce successful IBKR refreshes", async () => {
    mockMorningDashboardFetches({ brief: briefFixture("2026-06-02", []) });
    const refreshResult = deferred<Awaited<ReturnType<typeof refreshIbkrHoldings>>>();
    refreshIbkrHoldingsMock.mockReturnValue(refreshResult.promise);

    render(
      <MorningDashboard
        onOpenReplay={() => undefined}
        onSelectDate={() => undefined}
        selectedDate="2026-06-02"
        spreadSpeed={null}
      />,
    );

    const refreshButton = await screen.findByRole("button", { name: /Refresh IBKR holdings/i });
    fireEvent.click(refreshButton);
    refreshResult.resolve({
      generatedAt: "2026-06-02T12:00:00.000Z",
      message: "Refreshed IBKR live holdings from port 7497.",
      ok: true,
      snapshot: ibkrHoldingsFixture("ok"),
    });

    await waitFor(() => expect(refreshButton.hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText(/Refreshed IBKR live holdings/i)).toBeNull();
  });

  it("hides every SPX and SPXW option contract from Brief holdings regardless of expiration", async () => {
    mockMorningDashboardFetches({ brief: briefFixture("2026-06-06", []) });
    fetchIbkrHoldingsMock.mockResolvedValue({
      ...ibkrHoldingsFixture("ok"),
      count: 5,
      positions: [
        holdingPosition({
          localSymbol: "MU    260605C00106000",
          symbol: "MU",
          tradingClass: "MU",
        }),
        holdingPosition({
          expiration: "20260606",
          localSymbol: "SPXW  260606C07550000",
          symbol: "SPX",
          tradingClass: "SPXW",
        }),
        holdingPosition({
          expiration: "20260605",
          localSymbol: "SPXW  260605C07555000",
          symbol: "SPX",
          tradingClass: "SPXW",
        }),
        holdingPosition({
          expiration: "20260619",
          localSymbol: "SPX   260619P07400000",
          symbol: "SPX",
          tradingClass: "SPX",
        }),
        holdingPosition({
          expiration: "20260619",
          localSymbol: "SPY   260619P00590000",
          symbol: "SPY",
          tradingClass: "SPY",
        }),
      ],
    });

    render(
      <MorningDashboard
        onOpenReplay={() => undefined}
        onSelectDate={() => undefined}
        selectedDate="2026-06-06"
        spreadSpeed={null}
      />,
    );

    expect(await screen.findByText("2026-06-06")).toBeTruthy();
    expect(screen.getByText(/MU\s+260605C00106000/)).toBeTruthy();
    expect(screen.getByText(/SPY\s+260619P00590000/)).toBeTruthy();
    expect(screen.queryByText(/SPXW\s+260606C07550000/)).toBeNull();
    expect(screen.queryByText(/SPXW\s+260605C07555000/)).toBeNull();
    expect(screen.queryByText(/SPX\s+260619P07400000/)).toBeNull();
  });
});

describe("MorningDashboard brief races", () => {
  it("keeps the newer selected-date brief when an older date response resolves last", async () => {
    const olderBrief = deferred<MorningBriefPayload>();
    const newerBrief = deferred<MorningBriefPayload>();
    fetchMorningBriefMock.mockImplementation((date) => {
      if (date === "2026-05-28") {
        return olderBrief.promise;
      }
      if (date === "2026-05-29") {
        return newerBrief.promise;
      }
      return Promise.resolve(briefFixture(date, []));
    });
    fetchMorningLiveUpdatesMock.mockResolvedValue({
      generatedAt: "2026-05-29T12:00:00.000Z",
      liveUpdates: [],
      sources: [],
    });
    fetchMorningAiNotesMock.mockImplementation((date) =>
      Promise.resolve({
        date,
        generatedAt: "2026-05-29T12:00:00.000Z",
        message: "pending",
        previousDay: aiNotesBlock("Previous day"),
        previousWeek: aiNotesBlock("Previous week"),
        source: "pending",
      }),
    );
    fetchIbkrHoldingsMock.mockResolvedValue({
      count: 0,
      fetchedAt: null,
      grossCostBasis: null,
      message: "No holdings",
      positions: [],
      source: "test",
      status: "missing",
    });
    fetchGodelAlertBridgeStatusMock.mockResolvedValue({
      bookmarkletUrl: "http://example.test/bookmarklet",
      generatedAt: "2026-05-29T12:00:00.000Z",
      lastAlert: null,
      lastRejected: null,
      message: "idle",
      mode: "dom-bridge",
      setupUrl: "http://example.test/setup",
      validCount: 0,
    });

    const { rerender } = render(
      <MorningDashboard
        onOpenReplay={() => undefined}
        onSelectDate={() => undefined}
        selectedDate="2026-05-28"
        spreadSpeed={null}
      />,
    );
    rerender(
      <MorningDashboard
        onOpenReplay={() => undefined}
        onSelectDate={() => undefined}
        selectedDate="2026-05-29"
        spreadSpeed={null}
      />,
    );

    newerBrief.resolve(briefFixture("2026-05-29", ["NEW"]));
    expect(await screen.findByRole("button", { name: /NEW/ })).toBeTruthy();

    olderBrief.resolve(briefFixture("2026-05-28", ["OLD"]));
    await screen.findByRole("button", { name: /NEW/ });

    expect(screen.queryByRole("button", { name: /OLD/ })).toBeNull();
    expect(screen.getByRole("button", { name: /NEW/ })).toBeTruthy();
  });
});

describe("SignalStackSection", () => {
  it("shows an EOD 'as of' badge and explainer when today falls back to a prior session", () => {
    expect(SignalStackSection).toBeTypeOf("function");
    if (!SignalStackSection) {
      throw new Error("SignalStackSection is not exported");
    }

    render(
      <SignalStackSection
        frameDate="2026-06-04"
        isFallback={true}
        isLive={false}
        selectedDate="2026-06-05"
        signalFrame={null}
        targetNetDelta={0.05}
      />,
    );

    expect(screen.getByTestId("signal-stack-stale-badge").textContent).toContain("as of 2026-06-04");
    expect(screen.getByText(/last completed session \(2026-06-04\)/i)).toBeTruthy();
  });

  it("shows a green LIVE pill when the frame comes from the live feed", () => {
    if (!SignalStackSection) {
      throw new Error("SignalStackSection is not exported");
    }

    render(
      <SignalStackSection
        frameDate={easternDateKey()}
        isFallback={false}
        isLive={true}
        selectedDate={easternDateKey()}
        signalFrame={signalFrameFixture("10:14")}
        targetNetDelta={0.05}
      />,
    );

    expect(screen.getByTestId("signal-stack-live-badge").textContent).toContain("LIVE · 10:14");
    expect(screen.queryByTestId("signal-stack-stale-badge")).toBeNull();
    expect(screen.getByText(/live SPXW 0DTE snapshot at 10:14 ET/i)).toBeTruthy();
  });

  it("renders a Go live control that starts the feed when tracking today and stopped", () => {
    if (!SignalStackSection) {
      throw new Error("SignalStackSection is not exported");
    }
    const onStart = vi.fn();

    render(
      <SignalStackSection
        frameDate={null}
        isFallback={false}
        isLive={false}
        liveFeed={{
          busy: false,
          onStart,
          onStop: () => undefined,
          status: liveStatusFixture({ running: false, marketOpen: true }),
          tracksToday: true,
        }}
        selectedDate={easternDateKey()}
        signalFrame={null}
        targetNetDelta={0.05}
      />,
    );

    const button = screen.getByRole("button", { name: /Go live/i });
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("explains today's chain is not pulled yet when there is no frame for today", () => {
    if (!SignalStackSection) {
      throw new Error("SignalStackSection is not exported");
    }

    render(
      <SignalStackSection
        frameDate={null}
        isFallback={false}
        isLive={false}
        selectedDate={easternDateKey()}
        signalFrame={null}
        targetNetDelta={0.05}
      />,
    );

    expect(screen.getAllByText(/hasn't been pulled yet/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("signal-stack-stale-badge")).toBeNull();
  });

  it("uses a plain unavailable message for a past date with no data and no badge", () => {
    if (!SignalStackSection) {
      throw new Error("SignalStackSection is not exported");
    }

    render(
      <SignalStackSection
        frameDate={null}
        isFallback={false}
        isLive={false}
        selectedDate="2024-01-02"
        signalFrame={null}
        targetNetDelta={0.05}
      />,
    );

    expect(screen.getAllByText(/unavailable for this date/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("signal-stack-stale-badge")).toBeNull();
  });
});

function signalFrameFixture(label: string): SpreadSpeedFrame {
  return {
    label,
    minutesToClose: 300,
    spot: 5900,
    atmStraddle: 30,
    em: 37.6,
    speedCeiling: 0.053,
    pcs: [],
    ccs: [],
    recommendPcs: null,
    recommendCcs: null,
    fastestPcs: null,
    fastestCcs: null,
    pcsFastLow: null,
    pcsFastHigh: null,
    ccsFastLow: null,
    ccsFastHigh: null,
  };
}

function liveStatusFixture(overrides: Partial<SpxLiveBarsLiveStatus>): SpxLiveBarsLiveStatus {
  return {
    running: false,
    pid: null,
    startedAt: null,
    lastExit: null,
    logTail: [],
    script: "scripts/refresh-spx-0dte-chain.py",
    python: "python",
    available: true,
    autoStartEt: "09:28",
    autoStartLastFiredDate: null,
    marketOpen: true,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function briefFixture(date: string, symbols: string[]): MorningBriefPayload {
  return {
    combinedEvents: [],
    date,
    economicEvents: [],
    generatedAt: `${date}T12:00:00.000Z`,
    liveUpdates: [],
    majorEvents: [],
    sources: [],
    tc2000: {
      artifacts: [],
      available: true,
      dailyBars: {},
      dailyBarsGeneratedAt: null,
      dailyBarsSource: null,
      note: "Loaded test scanner list.",
      profiles: {},
      screeners: [
        {
          name: "Race test scanner",
          newSymbols: [],
          source: "csv",
          symbols,
        },
      ],
      sourceDir: null,
      symbols,
    },
    trumpEvents: [],
  };
}

function noisyBriefFixture(date: string): MorningBriefPayload {
  return {
    ...briefFixture(date, ["SPCE", "UIS"]),
    combinedEvents: [
      {
        coverage: "Event only - Interest Rate",
        date,
        id: "daily-cpi",
        impact: "high",
        location: "Oval Office",
        source: "BLS",
        sortMinute: 510,
        timeLabel: "8:30 AM",
        title: "CPI",
      },
    ],
    liveUpdates: [
      {
        author: "@FirstSquawk",
        id: "fs-1",
        kind: "post",
        publishedAt: `${date}T12:00:00.000Z`,
        source: "FirstSquawk",
        text: "Fed headline",
        timeLabel: "8:00 AM",
        trackedAccount: "FirstSquawk",
      },
      {
        author: "Godel",
        id: "godel-1",
        kind: "post",
        publishedAt: `${date}T12:05:00.000Z`,
        source: "Godel",
        text: "Market headline",
        timeLabel: "8:05 AM",
        trackedAccount: "Godel",
      },
    ],
    majorEvents: [
      {
        coverage: "4 rows - CPI, Core CPI",
        date,
        detail: "4 rows - CPI, Core CPI",
        id: "major-cpi",
        impact: "high",
        kind: "macro",
        source: "BLS",
        sortMinute: 510,
        timeLabel: "8:30 AM",
        title: "CPI",
        window: "thisWeek",
      },
    ],
    sources: [
      { detail: "Pulled 1 US macro event.", label: "US macro calendar", status: "ok" },
      {
        detail:
          "Pulled 16 items from FirstSquawk timeline; latest item 22m old; 1 repost included. Rubicon polls this timeline every 10s while Morning is open; configure X API filtered stream for true push delivery.",
        label: "FirstSquawk live feed",
        status: "warning",
      },
      { detail: "Pulled 2 live items.", label: "Live update cache", status: "ok" },
      { detail: "Loaded TC2000 scanner data.", label: "TC2000 scanner", status: "ok" },
    ],
    tc2000: {
      ...briefFixture(date, ["SPCE", "UIS"]).tc2000,
      dailyBars: {
        SPCE: [{ close: 10, date: "2026-06-01", high: 11, low: 9, open: 10, volume: 1000 }],
        UIS: [{ close: 20, date: "2026-06-01", high: 21, low: 19, open: 20, volume: 1000 }],
      },
      dailyBarsGeneratedAt: `${date}T12:00:00.000Z`,
      dailyBarsNote: "Daily bars available for 2 / 2 TC2000 symbols.",
      dailyBarsSource: "test",
      newSymbols: ["SPCE", "UIS"],
      note: "Loaded 1 TC2000 scanner list with 2 total symbols. Daily bars available for 2 / 2 TC2000 symbols.",
      screeners: [
        {
          name: "Race test scanner",
          newSymbols: ["SPCE", "UIS"],
          source: "csv",
          symbols: ["SPCE", "UIS"],
        },
      ],
    },
  };
}

function mockMorningDashboardFetches({
  aiNotesSource = "pending",
  brief,
}: {
  aiNotesSource?: "codex_automation" | "pending";
  brief: MorningBriefPayload;
}) {
  fetchMorningBriefMock.mockResolvedValue(brief);
  fetchMorningLiveUpdatesMock.mockResolvedValue({
    generatedAt: `${brief.date}T12:05:00.000Z`,
    liveUpdates: brief.liveUpdates,
    sources: [],
  });
  fetchMorningAiNotesMock.mockResolvedValue({
    date: brief.date,
    generatedAt: aiNotesSource === "codex_automation" ? `${brief.date}T12:00:00.000Z` : null,
    message:
      aiNotesSource === "codex_automation"
        ? "Generated empty-state morning notes from local journal data and available tracker dates."
        : "Codex automation has not generated AI diary notes for this Morning date yet.",
    previousDay: aiNotesBlock("Previous day"),
    previousWeek: aiNotesBlock("Previous week"),
    source: aiNotesSource,
  });
  fetchIbkrHoldingsMock.mockResolvedValue(ibkrHoldingsFixture("ok"));
  fetchGodelAlertBridgeStatusMock.mockResolvedValue({
    bookmarkletUrl: "javascript:void 0",
    generatedAt: `${brief.date}T12:00:00.000Z`,
    lastAlert: null,
    lastRejected: null,
    message:
      "Set RUBICON_GODEL_NEWS_URL with an authenticated Godel news endpoint, use the minimized-safe DOM bridge setup at /api/godel-alert-bridge/setup, run npm run godel:scrape to browser-scrape Godel, or stage data/godel-live-news.json with scripts/capture-godel-news.mjs.",
    mode: "dom-bridge",
    setupUrl: "/api/godel-alert-bridge/setup",
    validCount: 0,
  });
}

function ibkrHoldingsFixture(status: "ok" | "missing" | "error") {
  return {
    count: 0,
    fetchedAt: "2026-06-02T12:00:00.000Z",
    grossCostBasis: null,
    message: status === "ok" ? "Pulled 0 live IBKR positions." : "IBKR pull failed.",
    positions: [],
    source: "test",
    status,
  };
}

function holdingPosition(overrides: Partial<IbkrHoldingPosition>): IbkrHoldingPosition {
  return {
    account: "U1",
    averageCost: 1.25,
    expiration: "20260605",
    localSymbol: "AAPL  260605C00200000",
    position: 1,
    right: "C",
    securityType: "OPT",
    strike: 200,
    symbol: "AAPL",
    tradingClass: "AAPL",
    ...overrides,
  };
}

function aiNotesBlock(label: string) {
  return {
    available: false,
    bullets: [],
    dateRange: "pending",
    label,
  };
}
