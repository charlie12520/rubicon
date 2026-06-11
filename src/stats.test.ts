import { describe, expect, it } from "vitest";
import type { TradeRecord, WalletSnapshot } from "../shared/types";
import { chartCountLabel, SPREAD_HL_BAR_OPTIONS } from "./components/marketChartMarkers";
import {
  aggregateReviewBars,
  buildReviewMarkers,
  buildReviewPnlLineData,
  compactReviewPnlAxisTicks,
  entryPremiumAmount,
  expandReviewPnlAutoscaleInfo,
  formatCompactPnlAxis,
  groupReviewMarkers,
  premiumArrowHeadScale,
  premiumArrowScale,
  premiumArrowStemWidth,
  reviewArrowDimensionsForPlacement,
  reviewHoverReadoutForTime,
  reviewArrowBox,
  reviewArrowDimensions,
  type MarkerEvent,
} from "./components/reviewEntryExitChartLogic";
import { buildSpreadRangeBars } from "./components/replayChartsData";
import { buildDailyReview, REPLAY_SPEEDS, summarizeTrades } from "./stats";

const WALLET: WalletSnapshot = { netLiquidation: 100000, source: "test", updatedAt: null };

describe("trade stats", () => {
  it("offers 16x as a replay speed option", () => {
    expect(REPLAY_SPEEDS).toContain(16);
  });

  it("computes call and put max position from concurrently open spreads", () => {
    const stats = summarizeTrades(
      [
        trade({ contracts: 10, entryTime: "2026-05-28T09:30:00-04:00", exitTime: "2026-05-28T09:40:00-04:00", side: "Call" }),
        trade({ contracts: 5, entryTime: "2026-05-28T09:35:00-04:00", exitTime: "2026-05-28T09:45:00-04:00", side: "Call" }),
        trade({ contracts: 20, entryTime: "2026-05-28T09:45:00-04:00", exitTime: "2026-05-28T10:00:00-04:00", side: "Call" }),
        trade({ contracts: 3, entryTime: "2026-05-28T09:31:00-04:00", exitTime: null, side: "Put" }),
        trade({ contracts: 7, entryTime: "2026-05-28T15:00:00-04:00", exitTime: "2026-05-28T15:10:00-04:00", side: "Put" }),
      ],
      WALLET,
    );

    expect(stats.callMaxPosition).toBe(20);
    expect(stats.putMaxPosition).toBe(10);
  });

  it("builds a daily review with all entries and terminal exits", () => {
    const review = buildDailyReview([
      trade({
        contracts: 2,
        entryPrice: 0.35,
        entryTime: "2026-05-28T09:31:00-04:00",
        exitPrice: 0.08,
        exitTime: "2026-05-28T09:46:00-04:00",
        id: "closed-call",
        maxProfit: 70,
        maxRisk: 930,
        pnl: 48,
        returnOnRisk: 0.052,
        side: "Call",
        spxEntry: 5901.25,
        spxExit: 5897.5,
        status: "Closed",
        winLoss: "Win",
      }),
      trade({
        contracts: 1,
        entryPrice: 0.42,
        entryTime: "2026-05-28T10:11:00-04:00",
        exitPrice: null,
        exitTime: null,
        id: "open-put",
        maxProfit: 42,
        maxRisk: 458,
        pnl: 0,
        returnOnRisk: null,
        side: "Put",
        spxEntry: 5888,
        status: "Open",
        winLoss: "Open",
      }),
    ]);

    expect(review.events.map((event) => `${event.kind}:${event.tradeId}:${event.timeLabel}`)).toEqual([
      "entry:closed-call:09:31",
      "exit:closed-call:09:46",
      "entry:open-put:10:11",
    ]);
    expect(review.events.map((event) => `${event.kind}:${event.tradeId}:${event.side}`)).toEqual([
      "entry:closed-call:Call",
      "exit:closed-call:Put",
      "entry:open-put:Put",
    ]);
    expect(review.closedTrades).toBe(1);
    expect(review.openTrades).toBe(1);
    expect(review.totalEntries).toBe(2);
    expect(review.totalExits).toBe(1);
    expect(review.totalExpirations).toBe(0);
    expect(review.netPnl).toBe(48);
    expect(review.sideBreakdown).toEqual({
      Call: { count: 1, pnl: 48 },
      Mixed: { count: 0, pnl: 0 },
      Put: { count: 1, pnl: 0 },
    });
  });

  it("labels synthetic expiration exits as EOD in daily review events", () => {
    const review = buildDailyReview([
      trade({
        entryTime: "2026-05-28T13:27:27-04:00",
        exitPrice: 0,
        exitTime: "2026-05-28T16:00:00-04:00",
        id: "expired-call",
        side: "Call",
        status: "Expired",
        winLoss: "Win",
      }),
    ]);

    expect(review.events.map((event) => `${event.kind}:${event.tradeId}:${event.timeLabel}`)).toEqual([
      "entry:expired-call:13:27",
      "expiration:expired-call:EOD",
    ]);
    expect(review.totalEntries).toBe(1);
    expect(review.totalExits).toBe(0);
    expect(review.totalExpirations).toBe(1);
  });

  it("counts regular Daily Review exits by closing action side", () => {
    const review = buildDailyReview([
      trade({
        entryTime: "2026-05-28T09:30:00-04:00",
        exitTime: "2026-05-28T10:00:00-04:00",
        id: "ccs-exit",
        side: "Call",
      }),
      trade({
        entryTime: "2026-05-28T09:31:00-04:00",
        exitTime: "2026-05-28T10:01:00-04:00",
        id: "pcs-exit",
        side: "Put",
      }),
      trade({
        entryTime: "2026-05-28T09:32:00-04:00",
        exitTime: "2026-05-28T16:00:00-04:00",
        id: "ccs-expiry",
        side: "Call",
        status: "Expired",
      }),
    ]);

    expect(review.events.map((event) => `${event.kind}:${event.tradeId}:${event.side}`)).toEqual([
      "entry:ccs-exit:Call",
      "entry:pcs-exit:Put",
      "entry:ccs-expiry:Call",
      "exit:ccs-exit:Put",
      "exit:pcs-exit:Call",
      "expiration:ccs-expiry:Call",
    ]);
  });

  it("uses real reconstructed spread high-low fields for spread bars", () => {
    const bars = buildSpreadRangeBars([
      {
        activeLegCount: 2,
        close: -0.9,
        entrySequence: 7,
        high: -0.5,
        label: "10:15",
        low: -3.1,
        open: -1.5,
        permId: "997697617",
        source: "IBKR_TRADES_1m_ohlc_ffill_nickel",
        time: Math.floor(Date.parse("2026-05-28T10:15:00-04:00") / 1000),
        timestampEt: "2026-05-28T10:15:00-04:00",
        tradeId: "IBKR-997697617-7",
        value: -0.9,
      },
    ]);

    expect(bars[0]).toMatchObject({
      open: -1.5,
      high: -0.5,
      low: -3.1,
      close: -0.9,
      constructed: false,
    });
  });

  it("renders spread high-low mode as visibly thick range bars without count labels", () => {
    expect(SPREAD_HL_BAR_OPTIONS.wickVisible).toBe(true);
    expect(SPREAD_HL_BAR_OPTIONS.borderVisible).toBe(true);

    expect(
      chartCountLabel("spread-bars", [
        {
          close: -0.9,
          constructed: false,
          high: -0.5,
          label: "10:15",
          low: -3.1,
          open: -1.5,
          source: "test",
          time: 1,
          timestampEt: "2026-05-28T10:15:00-04:00",
          tradeId: "spread",
        },
        {
          close: -0.9,
          constructed: false,
          high: -0.9,
          label: "10:16",
          low: -0.9,
          open: -0.9,
          source: "test",
          time: 2,
          timestampEt: "2026-05-28T10:16:00-04:00",
          tradeId: "spread",
        },
      ]),
    ).toBe("");
    expect(chartCountLabel("line", [])).toBe("");
  });

  it("does not draw Daily Review chart arrows for synthetic expirations", () => {
    const bars = [
      spxBar("2026-05-28T15:58:00-04:00", 7564.4),
      spxBar("2026-05-28T15:59:00-04:00", 7563.43),
    ];
    const expired = trade({
      entryTime: "2026-05-28T13:27:27-04:00",
      exitPrice: 0,
      exitTime: "2026-05-28T16:00:00-04:00",
      id: "expired-call",
      side: "Call",
      spxExit: 7563.43,
      status: "Expired",
      winLoss: "Win",
    });

    const markers = buildReviewMarkers(bars, [expired]);

    expect(markers.map((marker) => marker.kind)).toEqual(["entry"]);
    expect(markers.some((marker) => marker.kind === "expiration")).toBe(false);
  });

  it("scales daily-review arrow stems from entered contract premium", () => {
    const small = trade({ contracts: 1, entryPrice: -0.25 });
    const medium = trade({ contracts: 10, entryPrice: -0.35 });
    const large = trade({ contracts: 50, entryPrice: -2.2 });

    expect(entryPremiumAmount(medium)).toBeCloseTo(3.5);
    expect(premiumArrowStemWidth(medium)).toBeGreaterThan(premiumArrowStemWidth(small));
    expect(premiumArrowStemWidth(large)).toBeGreaterThan(premiumArrowStemWidth(medium));
    expect(premiumArrowStemWidth(large)).toBeLessThanOrEqual(5.2);
  });

  it("groups same-candle daily-review markers into one coordinated arrow", () => {
    const first = trade({ contracts: 10, entryPrice: -0.35, id: "first-call", side: "Call" });
    const second = trade({ contracts: 5, entryPrice: -0.85, id: "second-call", side: "Call" });
    const put = trade({ contracts: 2, entryPrice: -0.5, id: "put", side: "Put" });
    const events = [
      reviewEvent(first, { key: "first-call-entry", time: 100, timeLabel: "09:30" }),
      reviewEvent(second, { key: "second-call-entry", time: 100, timeLabel: "09:34" }),
      reviewEvent(put, { key: "put-entry", time: 100, timeLabel: "09:34" }),
    ];

    const grouped = groupReviewMarkers(events);
    const callGroup = grouped.find((marker) => marker.trade.side === "Call");
    const putGroup = grouped.find((marker) => marker.trade.side === "Put");

    expect(grouped).toHaveLength(2);
    expect(callGroup?.groupedEvents).toHaveLength(2);
    expect(callGroup?.actionLabel).toBe("2 Entries");
    expect(callGroup?.premiumAmount).toBeCloseTo(7.75);
    expect(callGroup?.totalContracts).toBe(15);
    expect(putGroup?.groupedEvents).toBeUndefined();
  });

  it("keeps same-spread entries and exits on opposite action sides", () => {
    const opened = trade({ contracts: 10, entryPrice: -0.8, id: "opened", side: "Put" });
    const closed = trade({ contracts: 3, entryPrice: -0.35, id: "closed", side: "Put" });
    const grouped = groupReviewMarkers([
      reviewEvent(opened, { actionSide: "Put", key: "opened-entry", kind: "entry", time: 100, timeLabel: "10:55" }),
      reviewEvent(closed, { actionSide: "Call", key: "closed-exit", kind: "exit", time: 100, timeLabel: "10:42" }),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped.map((marker) => `${marker.kind}:${marker.actionSide}`)).toEqual(expect.arrayContaining(["entry:Put", "exit:Call"]));
  });

  it("builds Daily Review chart exit markers using closing action side", () => {
    const call = trade({ id: "ccs", side: "Call", spxEntry: 7580, spxExit: 7582 });
    const put = trade({ id: "pcs", side: "Put", spxEntry: 7570, spxExit: 7568 });
    const markers = buildReviewMarkers(
      [
        spxBar("2026-05-28T09:30:00-04:00", 7580),
        spxBar("2026-05-28T09:40:00-04:00", 7575),
      ],
      [call, put],
    );

    expect(markers.find((marker) => marker.key === "ccs-entry")?.actionSide).toBe("Call");
    expect(markers.find((marker) => marker.key === "ccs-exit")?.actionSide).toBe("Put");
    expect(markers.find((marker) => marker.key === "pcs-entry")?.actionSide).toBe("Put");
    expect(markers.find((marker) => marker.key === "pcs-exit")?.actionSide).toBe("Call");
  });

  it("does not label expirations as ordinary exits in grouped arrows", () => {
    const entry = trade({ contracts: 5, entryPrice: -0.85, id: "entry", side: "Call" });
    const expired = trade({ contracts: 5, entryPrice: -0.65, id: "expired", side: "Call", status: "Expired" });
    const grouped = groupReviewMarkers([
      reviewEvent(entry, { key: "entry", kind: "entry", time: 100, timeLabel: "15:30" }),
      reviewEvent(expired, { actionLabel: "Expired EOD", key: "expired", kind: "expiration", time: 100, timeLabel: "15:30" }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.actionLabel).toBe("1 Entry / 1 Expiry");
    expect(grouped[0]?.actionLabel).not.toContain("Exit");
  });

  it("slightly scales the full daily-review arrow from total premium", () => {
    const small = reviewArrowDimensions(0.25);
    const medium = reviewArrowDimensions(7.75);
    const large = reviewArrowDimensions(45);

    expect(premiumArrowScale(7.75)).toBeGreaterThan(premiumArrowScale(0.25));
    expect(medium.width).toBeGreaterThan(small.width);
    expect(medium.height).toBeGreaterThan(small.height);
    expect(medium.clearance).toBeGreaterThanOrEqual(30);
    expect(large.width).toBeGreaterThanOrEqual(medium.width);
    expect(large.height).toBeGreaterThanOrEqual(medium.height);
    expect(large.clearance).toBeGreaterThanOrEqual(medium.clearance);
    expect(premiumArrowScale(45)).toBeLessThanOrEqual(1.6);
  });

  it("tightens daily-review arrow clearance near the chart top and bottom", () => {
    const base = reviewArrowDimensions(16);
    const topEdge = reviewArrowDimensionsForPlacement(16, true, 50, 592);
    const bottomEdge = reviewArrowDimensionsForPlacement(16, false, 540, 592);
    const middle = reviewArrowDimensionsForPlacement(16, true, 220, 592);

    expect(topEdge.clearance).toBeLessThan(base.clearance);
    expect(bottomEdge.clearance).toBeLessThan(base.clearance);
    expect(topEdge.clearance).toBeGreaterThanOrEqual(8);
    expect(bottomEdge.clearance).toBeGreaterThanOrEqual(8);
    expect(50 - topEdge.height - topEdge.clearance).toBeGreaterThanOrEqual(4);
    expect(540 + bottomEdge.height + bottomEdge.clearance).toBeLessThanOrEqual(588);
    expect(middle.clearance).toBe(base.clearance);
  });

  it("scales daily-review arrowheads by premium without exceeding the current size cap", () => {
    const small = reviewArrowDimensions(0.25);
    const medium = reviewArrowDimensions(7.75);
    const large = reviewArrowDimensions(45);

    expect(medium.headLength).toBeGreaterThan(small.headLength);
    expect(medium.headHalfWidth).toBeGreaterThan(small.headHalfWidth);
    expect(large.headLength).toBeGreaterThanOrEqual(medium.headLength);
    expect(premiumArrowHeadScale(0.25)).toBeLessThan(premiumArrowScale(0.25));
    expect(premiumArrowHeadScale(7.75)).toBeLessThan(premiumArrowScale(7.75));
    expect(premiumArrowHeadScale(45)).toBe(premiumArrowScale(45));
  });

  it("keeps zoom-edge arrow boxes inside the chart", () => {
    const centered = reviewArrowBox(42, 0, 336);
    const leftEdge = reviewArrowBox(1, -30, 336);
    const rightEdge = reviewArrowBox(335, 30, 336);

    expect(centered.stemX).toBe(centered.targetX);
    expect(leftEdge.left).toBeGreaterThanOrEqual(0);
    expect(leftEdge.left + leftEdge.width).toBeLessThanOrEqual(336);
    expect(rightEdge.left).toBeGreaterThanOrEqual(0);
    expect(rightEdge.left + rightEdge.width).toBeLessThanOrEqual(336);
  });

  it("aggregates daily-review SPX candles for higher timeframe review", () => {
    const bars = [
      spxBar("2026-05-28T09:30:00-04:00", 7560),
      spxBar("2026-05-28T09:31:00-04:00", 7562),
      spxBar("2026-05-28T09:34:00-04:00", 7558),
      spxBar("2026-05-28T09:35:00-04:00", 7570),
    ];

    const aggregated = aggregateReviewBars(bars, 5);
    const twoMinute = aggregateReviewBars(bars, 2);

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0]).toMatchObject({
      close: 7558,
      high: 7563,
      label: "09:30",
      low: 7557,
      open: 7560,
    });
    expect(aggregated[1]?.label).toBe("09:35");
    expect(twoMinute).toHaveLength(2);
    expect(twoMinute[0]).toMatchObject({
      close: 7562,
      high: 7563,
      label: "09:30",
      low: 7559,
      open: 7560,
    });
    expect(twoMinute[1]).toMatchObject({
      close: 7570,
      high: 7571,
      label: "09:34",
      low: 7557,
      open: 7558,
    });
  });

  it("keeps the Daily Review P/L overlay inside the SPX chart timeframe", () => {
    const bars = [
      spxBar("2026-05-28T09:30:00-04:00", 7560),
      spxBar("2026-05-28T10:00:00-04:00", 7570),
      spxBar("2026-05-28T15:59:00-04:00", 7580),
    ];
    const points = [
      pnlPoint("2026-05-28T09:29:00-04:00", -50),
      pnlPoint("2026-05-28T09:30:00-04:00", 0),
      pnlPoint("2026-05-28T10:00:00-04:00", 125),
      pnlPoint("2026-05-28T15:59:00-04:00", 575),
      pnlPoint("2026-05-28T16:00:00-04:00", 900),
    ];

    const lineData = buildReviewPnlLineData(points, bars);

    expect(lineData.map((point) => point.value)).toEqual([0, 125, 575]);
    expect(lineData.map((point) => point.time)).toEqual([bars[0].time, Math.floor(Date.parse("2026-05-28T10:00:00-04:00") / 1000), bars[2].time]);
  });

  it("aligns Daily Review P/L overlay timestamps to displayed candles to avoid visual candle gaps", () => {
    const bars = [
      spxBar("2026-05-28T10:00:00-04:00", 7560),
      spxBar("2026-05-28T10:02:00-04:00", 7562),
      spxBar("2026-05-28T10:04:00-04:00", 7558),
    ];
    const points = [
      pnlPoint("2026-05-28T10:00:00-04:00", 0),
      pnlPoint("2026-05-28T10:01:00-04:00", 50),
      pnlPoint("2026-05-28T10:02:00-04:00", 125),
      pnlPoint("2026-05-28T10:03:00-04:00", 200),
      pnlPoint("2026-05-28T10:04:00-04:00", 250),
    ];

    const lineData = buildReviewPnlLineData(points, bars);

    expect(lineData.map((point) => point.time)).toEqual(bars.map((bar) => bar.time));
    expect(lineData.map((point) => point.value)).toEqual([0, 125, 250]);
    expect(lineData.some((point) => point.time === Math.floor(Date.parse("2026-05-28T10:01:00-04:00") / 1000))).toBe(false);
    expect(lineData.some((point) => point.time === Math.floor(Date.parse("2026-05-28T10:03:00-04:00") / 1000))).toBe(false);
  });

  it("keeps the Daily Review P/L axis dynamic while including zero", () => {
    expect(
      expandReviewPnlAutoscaleInfo({
        priceRange: { minValue: 125, maxValue: 575 },
      }),
    ).toMatchObject({
      margins: { above: 14, below: 14 },
      priceRange: { minValue: 0, maxValue: 575 },
    });
    expect(
      expandReviewPnlAutoscaleInfo({
        priceRange: { minValue: -1247, maxValue: -200 },
      }),
    ).toMatchObject({
      priceRange: { minValue: -1247, maxValue: 0 },
    });
  });

  it("uses compact Daily Review P/L axis labels so candles keep chart width", () => {
    expect(formatCompactPnlAxis(0)).toBe("$0");
    expect(formatCompactPnlAxis(575)).toBe("+$575");
    expect(formatCompactPnlAxis(-1247)).toBe("-$1.2k");
    expect(formatCompactPnlAxis(12500)).toBe("+$13k");
    expect(compactReviewPnlAxisTicks([125, 575])).toEqual([575, 287.5]);
    expect(compactReviewPnlAxisTicks([-1247, -200])).toEqual([-623.5, -1247]);
  });

  it("builds a bottom hover readout with nearest SPX and P/L values", () => {
    const bars = [
      spxBar("2026-05-28T09:30:00-04:00", 7560),
      spxBar("2026-05-28T09:32:00-04:00", 7575),
    ];
    const points = [
      pnlPoint("2026-05-28T09:30:00-04:00", -25),
      pnlPoint("2026-05-28T09:32:00-04:00", 125),
    ];
    const time = Math.floor(Date.parse("2026-05-28T09:31:30-04:00") / 1000);

    expect(reviewHoverReadoutForTime(time, bars, points)).toMatchObject({
      label: "09:32",
      pnl: 125,
      spxClose: 7575,
      spxHigh: 7576,
      spxLow: 7574,
      spxOpen: 7575,
    });
    expect(reviewHoverReadoutForTime(null, bars, points)).toBeNull();
  });

  it("anchors daily-review arrows to the displayed candle edge rather than the SPX fill price", () => {
    const bars = aggregateReviewBars(
      [
        spxBar("2026-05-28T10:00:00-04:00", 7560),
        spxBar("2026-05-28T10:01:00-04:00", 7570),
        spxBar("2026-05-28T10:04:00-04:00", 7550),
      ],
      5,
    );
    const callEntry = trade({ entryTime: "2026-05-28T10:04:00-04:00", side: "Call", spxEntry: 7544 });
    const putEntry = trade({ entryTime: "2026-05-28T10:04:00-04:00", side: "Put", spxEntry: 7599 });

    const [callMarker, putMarker] = buildReviewMarkers(bars, [callEntry, putEntry]).filter((marker) => marker.kind === "entry");

    expect(callMarker?.time).toBe(bars[0].time);
    expect(callMarker?.price).toBe(bars[0].high);
    expect(putMarker?.time).toBe(bars[0].time);
    expect(putMarker?.price).toBe(bars[0].low);
  });
});

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    account: "test",
    bias: "Neutral",
    contracts: 1,
    date: "2026-05-28",
    entryPrice: 0.3,
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    entryTime: "2026-05-28T09:30:00-04:00",
    expiration: "2026-05-28",
    exitPrice: 0,
    exitTime: "2026-05-28T09:40:00-04:00",
    fees: 0,
    id: `${overrides.side ?? "Call"}-${overrides.entryTime ?? "entry"}-${overrides.contracts ?? 1}`,
    legs: [],
    longStrike: 7570,
    maxProfit: 30,
    maxRisk: 470,
    notes: "",
    pnl: 0,
    positionAfter: 0,
    positionBefore: 0,
    priceType: "Credit",
    returnOnRisk: null,
    shortStrike: 7565,
    side: "Call",
    source: "test",
    spxEntry: null,
    spxExit: null,
    status: "Closed",
    strategy: "Test Spread",
    width: 5,
    winLoss: "Flat",
    ...overrides,
  };
}

function reviewEvent(item: TradeRecord, overrides: Partial<MarkerEvent> = {}): MarkerEvent {
  return {
    ...baseReviewEvent(item),
    ...overrides,
  };
}

function baseReviewEvent(item: TradeRecord): MarkerEvent {
  return {
    actionLabel: "Entry",
    actionSide: item.side,
    key: `${item.id}-entry`,
    kind: "entry" as const,
    price: item.side === "Put" ? 7570 : 7585,
    time: 100,
    timeLabel: "09:30",
    trade: item,
  };
}

function spxBar(timestampEt: string, close: number) {
  return {
    close,
    high: close + 1,
    label: timestampEt.slice(11, 16),
    low: close - 1,
    open: close,
    time: Math.floor(Date.parse(timestampEt) / 1000),
    timestampEt,
  };
}

function pnlPoint(timestampEt: string, totalPnl: number) {
  return {
    label: timestampEt.slice(11, 16),
    missingOpenMarkCount: 0,
    openPnl: totalPnl,
    openTradeCount: 0,
    realizedPnl: 0,
    time: Math.floor(Date.parse(timestampEt) / 1000),
    timestampEt,
    totalPnl,
  };
}
