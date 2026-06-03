import { describe, expect, it } from "vitest";
import type { DailySummary, TradeRecord, WalletSnapshot } from "../shared/types";
import { buildDailyReview, summarizeTrades } from "./stats";
import { buildDailyReviewMarkdown, dailyReviewExportFilename } from "./dailyReviewExport";

const WALLET: WalletSnapshot = { netLiquidation: null, source: "test", updatedAt: null };

describe("daily review export", () => {
  it("builds a compact markdown review with stats, issues, source state, and ledger rows", () => {
    const trades = [
      trade({
        contracts: 10,
        entryTime: "2026-05-29T09:35:00-04:00",
        id: "one",
        pnl: 250,
        returnOnRisk: 0.12,
        side: "Call",
        status: "Closed",
      }),
      trade({
        contracts: 4,
        entryTime: "2026-05-29T14:15:00-04:00",
        exitTime: "2026-05-29T16:00:00-04:00",
        id: "two",
        pnl: -120,
        returnOnRisk: -0.08,
        side: "Put",
        status: "Expired",
      }),
    ];
    const summary: DailySummary = {
      availabilityStatus: "partial",
      date: "2026-05-29",
      entryCount: 19,
      fillCount: 136,
      issueCount: 1,
      issues: [
        {
          count: 65,
          detail: "65 unexpected option-data errors remained.",
          severity: "error",
          stage: "pull",
          title: "Unexpected option pull errors",
        },
      ],
      optionContractCount: 12,
      optionIntradayStatus: "partial",
      payloadRows: 59333,
      spxStatus: "up_to_date",
      spreadCount: 24,
      tradeCount: 136,
      tradeStatus: "ok_with_errors",
      uploadStatus: "payload_ready_unconfirmed",
      uploadTabCount: 10,
    };

    const markdown = buildDailyReviewMarkdown({
      date: "2026-05-29",
      review: buildDailyReview(trades),
      sourceHealth: [
        {
          detail: "Automatic Google tracker snapshot refresh is waiting for a reusable Google Sheets credential.",
          label: "Google API snapshot refresh",
          status: "warning",
        },
        {
          count: 59333,
          detail: "2026-05-29: 10 staged tabs and 59,333 rows available locally.",
          label: "Staged sheet payload",
          status: "ok",
        },
      ],
      stats: summarizeTrades(trades, WALLET),
      summary,
      trades,
    });

    expect(markdown).toContain("# SPX Daily Review - 2026-05-29");
    expect(markdown).toContain("- Trades: 2 total / 2 closed");
    expect(markdown).not.toContain("terminal");
    expect(markdown).toContain("- Entries / exits / expiries: 2 / 1 / 1");
    expect(markdown).toContain("- Upload: payload_ready_unconfirmed");
    expect(markdown).toContain("- ERROR pull: Unexpected option pull errors (65)");
    expect(markdown).toContain("## Source State");
    expect(markdown).toContain("- Ready: 1 / 2");
    expect(markdown).toContain("- WARNING Google API snapshot refresh - Automatic Google tracker snapshot refresh is waiting for a reusable Google Sheets credential.");
    expect(markdown).not.toContain("## Flags");
    expect(markdown).not.toContain("## Note");
    expect(markdown).toContain("| 14:15 | Put | 7565/7570 | 4 | 0.30 | 0.00 | EOD | -$120 | -8.0% |");
  });

  it("uses a stable markdown filename", () => {
    expect(dailyReviewExportFilename("2026-05-29")).toBe("spx-daily-review-2026-05-29.md");
  });
});

function trade(overrides: Partial<TradeRecord>): TradeRecord {
  return {
    account: "test",
    bias: "Neutral",
    contracts: 1,
    date: "2026-05-29",
    entryChartDeviation: null,
    entryChartDeviationFlag: false,
    entryChartDeviationPct: null,
    entryChartMark: null,
    entryChartMarkTime: null,
    entryChartRangeHigh: null,
    entryChartRangeLow: null,
    entryChartWithinRange: null,
    entryPrice: 0.3,
    entryTime: "2026-05-29T09:30:00-04:00",
    expiration: "2026-05-29",
    exitPrice: 0,
    exitTime: "2026-05-29T09:40:00-04:00",
    fees: 0,
    id: "trade",
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
    spxEntry: 7555,
    spxExit: 7560,
    status: "Closed",
    strategy: "Test Spread",
    width: 5,
    winLoss: "Flat",
    ...overrides,
  };
}
