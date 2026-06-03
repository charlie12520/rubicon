import type { DailyReview, TradeStats } from "./stats";
import type { DailySummary, SourceHealth, TradeRecord } from "../shared/types";
import { formatNumber, formatPercent, formatSignedCurrency } from "./format";
import { tradeClockLabel, tradeHeldLabel } from "./tradeTime";

type DailyReviewExportInput = {
  date: string;
  review: DailyReview;
  sourceHealth: SourceHealth[];
  stats: TradeStats;
  summary: DailySummary | null;
  trades: TradeRecord[];
};

export function dailyReviewExportFilename(date: string): string {
  return `spx-daily-review-${date.replace(/[^0-9-]/g, "") || "session"}.md`;
}

export function buildDailyReviewMarkdown({
  date,
  review,
  sourceHealth,
  stats,
  summary,
  trades,
}: DailyReviewExportInput): string {
  const sortedTrades = [...trades].sort((a, b) => a.entryTime.localeCompare(b.entryTime));
  const issueLines = summary?.issues.length
    ? summary.issues.map((issue) => {
        const count = issue.count === undefined ? "" : ` (${formatNumber(issue.count)})`;
        return `- ${issue.severity.toUpperCase()} ${issue.stage}: ${issue.title}${count} - ${compactText(issue.detail)}`;
      })
    : ["- None"];
  const sourceIssueLines = sourceStateLines(sourceHealth);

  return [
    `# SPX Daily Review - ${date}`,
    "",
    "## Session",
    `- Trades: ${formatNumber(stats.totalTrades)} total / ${formatNumber(stats.terminalTrades)} closed`,
    `- Net P/L: ${formatSignedCurrency(review.netPnl)}`,
    `- Avg P/L: ${formatSignedCurrency(stats.avgPnl)}`,
    `- Win rate: ${formatPercent(stats.winRate)}`,
    `- Call max position: ${formatNumber(stats.callMaxPosition)}`,
    `- Put max position: ${formatNumber(stats.putMaxPosition)}`,
    `- Entries / exits / expiries: ${formatNumber(review.totalEntries)} / ${formatNumber(review.totalExits)} / ${formatNumber(review.totalExpirations)}`,
    `- Best / worst: ${formatSignedCurrency(review.bestTrade)} / ${formatSignedCurrency(review.worstTrade)}`,
    "",
    "## Import Health",
    `- Upload: ${summary?.uploadStatus ?? "unknown"}`,
    `- Fills / spreads / entries: ${formatNumber(summary?.fillCount)} / ${formatNumber(summary?.spreadCount)} / ${formatNumber(summary?.entryCount)}`,
    `- Option contracts / staged rows: ${formatNumber(summary?.optionContractCount)} / ${formatNumber(summary?.payloadRows)}`,
    ...issueLines,
    "",
    "## Source State",
    `- Ready: ${formatNumber(sourceHealth.filter((source) => source.status === "ok").length)} / ${formatNumber(sourceHealth.length)}`,
    ...sourceIssueLines,
    "",
    "## Ledger",
    "| Time | Side | Strikes | Qty | Entry | Exit | Held | P/L | Return |",
    "| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: |",
    ...sortedTrades.map((trade) =>
      [
        tradeClockLabel(trade.entryTime),
        trade.side,
        strikeLabel(trade),
        formatNumber(trade.contracts),
        formatNumber(trade.entryPrice, 2),
        trade.exitPrice === null ? "-" : formatNumber(trade.exitPrice, 2),
        tradeHeldLabel(trade, { expirationAsEod: true }),
        formatSignedCurrency(trade.pnl),
        formatPercent(trade.returnOnRisk),
      ].map(tableCell).join(" | "),
    ).map((row) => `| ${row} |`),
    "",
  ].join("\n");
}

function sourceStateLines(sourceHealth: SourceHealth[]): string[] {
  if (!sourceHealth.length) {
    return ["- No source-state cards were reported."];
  }

  const actionable = sourceHealth.filter((source) => source.status !== "ok");
  if (!actionable.length) {
    return ["- All source-state cards were ready."];
  }

  return actionable.map((source) => {
    const count = source.count === undefined ? "" : ` (${formatNumber(source.count)})`;
    return `- ${source.status.toUpperCase()} ${source.label}${count} - ${compactText(source.detail)}`;
  });
}

function compactText(value: string): string {
  return value.replaceAll("\\", "/").replace(/\s+/g, " ").trim();
}

function tableCell(value: string): string {
  return compactText(value).replaceAll("|", "\\|");
}

function strikeLabel(trade: TradeRecord): string {
  if (trade.shortStrike === null || trade.longStrike === null) {
    return "Unmapped";
  }
  return `${trade.shortStrike}/${trade.longStrike}`;
}
