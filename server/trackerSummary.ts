import path from "node:path";
import type { DailySummary, DataIssue } from "../shared/types.ts";
import { mtimeMs, pathExists, readJson, writeJsonAtomic } from "./jsonStore.ts";
import { asArray, asRecord, firstNumber, firstString, type JsonRecord } from "./normalize.ts";

export const RUBICON_TRACKER_SUMMARY_FILE = "rubicon_tracker_summary.json";

const RUBICON_TRACKER_SUMMARY_SCHEMA = "rubicon-tracker-summary";
const RUBICON_TRACKER_SUMMARY_VERSION = 5;
const REQUIRED_PAYLOAD_TAB_COUNT = 1;

type SummaryBuildContext = {
  date: string;
  payloadExists?: boolean;
  payloadPath?: string;
  workbookExists?: boolean;
  workbookPath?: string;
};

type RubiconTrackerSummaryCache = {
  schema: typeof RUBICON_TRACKER_SUMMARY_SCHEMA;
  version: number;
  generatedAt: string;
  source: {
    dailySyncSummaryMtimeMs?: number;
    dailySyncSummaryPath: string;
  };
  description: {
    role: string;
    loadPolicy: string;
    artifacts: Array<{
      name: string;
      path: string;
      role: string;
      loadPolicy: string;
    }>;
  };
  summary: DailySummary;
};

function issue(stage: DataIssue["stage"], severity: DataIssue["severity"], title: string, detail: string, count?: number): DataIssue {
  return { stage, severity, title, detail, ...(count === undefined ? {} : { count }) };
}

function describeError(value: unknown): string {
  const record = asRecord(value);
  const bits = [
    record.host && record.port ? `${record.host}:${record.port}` : "",
    record.local_symbol ? String(record.local_symbol) : "",
    record.code ? `code ${record.code}` : "",
    record.error ? String(record.error) : "",
    record.message ? String(record.message) : "",
  ].filter(Boolean);
  return bits.join(" - ") || JSON.stringify(value);
}

function outputsReady(outputs: JsonRecord, keys: string[]): number {
  return keys.filter((key) => firstString(outputs[key])).length;
}

function normalizeBarSize(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  if (normalized === "5secs" || normalized === "5s") {
    return "5s";
  }
  if (normalized === "1min" || normalized === "1m") {
    return "1m";
  }
  return value;
}

function estimateTrackerPayloadRows(input: { entryCount: number }): number {
  return 1 + Math.max(0, input.entryCount);
}

export function buildRubiconDailySummaryFromSyncSummary(local: JsonRecord, context: SummaryBuildContext): DailySummary {
  const trades = asRecord(local.trades);
  const spx = asRecord(local.spx);
  const spxPartition = asRecord(spx.target_partition);
  const optionIntraday = asRecord(local.ibkr_option_trades);
  const availability = asRecord(local.availability);
  const localReviewStatus = asRecord(local.localReviewStatus);
  const availabilitySpx = asRecord(availability.spx_intraday);
  const availabilityTrades = asRecord(availability.trades_and_spreads);
  const availabilityTradeCounts = asRecord(availabilityTrades.counts);
  const availabilityOptionIntraday = asRecord(availability.ibkr_option_intraday);
  const availabilityCounts = asRecord(availabilityOptionIntraday.counts);
  const openInterest = asRecord(optionIntraday.open_interest);
  const volumeProfile = asRecord(optionIntraday.volume_profile);
  const underlyingIntraday = asRecord(optionIntraday.underlying_intraday);
  const tradeOutputs = asRecord(trades.outputs);
  const expectedTradeOutputs = ["fills_csv", "spreads_csv", "entries_csv", "contracts_csv"];
  const tradeConnections = asArray(trades.connections).map(asRecord);
  const tradeErrors = asArray(trades.errors);
  const optionErrors = asArray(optionIntraday.errors);
  const googleUpload = asRecord(local.googleUpload);

  const date = firstString(local.target_trade_date_et, optionIntraday.date, availability.date, context.date) ?? context.date;
  const fillCount = firstNumber(trades.trade_count, trades.fill_count, availabilityTradeCounts.trade_count, availabilityTradeCounts.fill_count);
  const spreadCount = firstNumber(trades.spread_count, availabilityTradeCounts.spread_count);
  const entryCount = firstNumber(trades.entry_count, availabilityTradeCounts.entry_count);
  const optionContractCount = firstNumber(trades.option_contract_count, availabilityTradeCounts.option_contract_count);
  const optionIntradayContractCount = firstNumber(optionIntraday.contract_count, availabilityCounts.contract_count);
  const optionExpectedRowsPerContract = firstNumber(optionIntraday.expected_rows_per_contract);
  const optionExpectedRows = optionExpectedRowsPerContract && optionIntradayContractCount ? optionExpectedRowsPerContract * optionIntradayContractCount : 0;
  const optionIntradayRows = firstNumber(optionIntraday.leg_trade_rows, availabilityCounts.leg_trade_rows);
  const spreadMarkRows = firstNumber(optionIntraday.spread_trade_mark_rows, availabilityCounts.spread_mark_rows);
  const openInterestExpectedRows = firstNumber(openInterest.contract_count, availabilityCounts.contract_count, optionIntradayContractCount);
  const openInterestRows = firstNumber(openInterest.row_count, availabilityCounts.open_interest_rows);
  const openInterestValidRows = firstNumber(openInterest.ok_count, openInterest.non_null_open_interest_count, openInterestRows);
  const volumeProfileRows = firstNumber(volumeProfile.profile_row_count, availabilityCounts.volume_profile_rows);
  const underlyingRows = firstNumber(underlyingIntraday.row_count, availabilityCounts.underlying_1m_rows);
  const underlyingSymbolCount = firstNumber(underlyingIntraday.symbol_count, availabilityCounts.underlying_1m_symbol_count);
  const spxRows = firstNumber(spxPartition.rows, spx.rows, availabilitySpx.rows);
  const spxExpectedRows = firstNumber(spxPartition.expected_rows, availabilitySpx.expected_rows, spxRows);
  const rawUploadGoogleSheetUrl = firstString(local.raw_upload_google_sheet_url, local.rawUploadGoogleSheetUrl);
  const googleUploadStatus = firstString(local.google_upload_status, googleUpload.status);
  const googleUploaded = Boolean(rawUploadGoogleSheetUrl) || googleUploadStatus === "complete" || googleUploadStatus === "uploaded";
  const payloadRows = estimateTrackerPayloadRows({
    entryCount,
  });
  const issues: DataIssue[] = [
    issue(
      "pull",
      "info",
      "Validated IBKR archive summary",
      "Rubicon is using the compact validated daily summary; row-level IBKR artifacts stay in the archive and load only for replay/detail checks.",
    ),
  ];

  if (tradeErrors.length) {
    const connected = tradeConnections.filter((connection) => connection.connected === true);
    issues.push(
      issue(
        "pull",
        connected.length && fillCount ? "info" : "warning",
        connected.length && fillCount ? "Secondary IBKR endpoint did not connect" : "IBKR execution pull returned errors",
        tradeErrors.map(describeError).slice(0, 3).join(" | "),
        tradeErrors.length,
      ),
    );
  }

  const optionStatus = firstString(optionIntraday.status) ?? "missing";
  if (optionStatus === "error" || optionStatus === "missing") {
    issues.push(issue("pull", "error", "Option intraday pull failed", `Option intraday status is ${optionStatus}.`));
  }

  const unexpectedErrorCount = firstNumber(optionIntraday.unexpected_error_count, availabilityCounts.unexpected_error_count);
  if (unexpectedErrorCount > 0) {
    issues.push(
      issue(
        "pull",
        "info",
        "Validated option intraday exceptions",
        `${unexpectedErrorCount} option-data exceptions were recorded in the validated daily sync summary; Rubicon does not re-scan row-level payloads on dashboard load.`,
        unexpectedErrorCount,
      ),
    );
  }

  const expectedNoDataCount = firstNumber(optionIntraday.expected_no_data_error_count, availabilityCounts.expected_no_data_error_count);
  if (expectedNoDataCount > 0 || optionErrors.length) {
    issues.push(
      issue(
        "pull",
        "info",
        "Expected HMDS no-data responses",
        `${expectedNoDataCount || optionErrors.length} expected no-data responses were recorded in the validated option pull summary.`,
        expectedNoDataCount || optionErrors.length,
      ),
    );
  }

  const oiStatus = firstString(openInterest.status);
  if (oiStatus && oiStatus !== "ok") {
    issues.push(
      issue(
        "pull",
        openInterestValidRows > 0 ? "info" : "warning",
        "Open interest pull not fully clean",
        `Open interest status ${oiStatus}; ${openInterestValidRows} / ${openInterestExpectedRows} contracts returned usable values.`,
      ),
    );
  }

  const availabilityStatus = firstString(availability.status) ?? "missing";
  const availabilityIssues = asArray(availability.issues);
  if (availabilityStatus && !["ok", "partial"].includes(availabilityStatus)) {
    issues.push(issue("availability", availabilityStatus === "missing" || availabilityStatus === "error" ? "error" : "warning", "Availability check not clean", `Availability status is ${availabilityStatus}.`));
  } else if (availabilityStatus === "partial" || availabilityIssues.length) {
    issues.push(
      issue(
        "availability",
        "info",
        "Validated partial archive availability",
        availabilityIssues.length ? availabilityIssues.map(String).slice(0, 3).join(" | ") : "The archive was validated as partial by the daily sync summary.",
        availabilityIssues.length || undefined,
      ),
    );
  }

  if (!context.payloadExists) {
    issues.push(issue("upload", "error", "Google Sheet upload payload missing", `No payload found for ${date} at ${context.payloadPath}.`));
  } else {
    issues.push(issue("upload", "info", "Google tracker payload ready", `Compact tracker payload is staged at ${context.payloadPath}.`));
  }

  if (!googleUploaded) {
    issues.push(
      issue(
        "upload",
        "warning",
        "Google tracker upload not confirmed",
        "The compact tracker payload exists, but no successful Google tracker update is recorded in the daily summary.",
      ),
    );
  }

  return {
    date,
    tradeCount: fillCount,
    fillCount,
    spreadCount,
    entryCount,
    optionContractCount,
    spxStatus: firstString(spx.status, spxPartition.status, availabilitySpx.status) ?? "missing",
    spxIntradayBarSize: normalizeBarSize(firstString(spxPartition.bar_size, availabilitySpx.bar_size)),
    spxIntradayExpectedRows: spxExpectedRows,
    spxIntradayRowCount: spxRows,
    reviewMode: firstString(availability.review_mode),
    reviewReady: local.reviewReady === true || local.review_ready === true,
    localReviewStatus: firstString(localReviewStatus.status, local.local_review_status),
    tradeStatus: firstString(trades.status, availabilityTrades.status) ?? "missing",
    ibkrEndpointExpectedCount: tradeConnections.length,
    ibkrEndpointConnectedCount: tradeConnections.filter((connection) => connection.connected === true).length,
    tradeArtifactExpectedCount: expectedTradeOutputs.length,
    tradeArtifactReadyCount: outputsReady(tradeOutputs, expectedTradeOutputs),
    optionIntradayStatus: optionStatus,
    optionIntradayBarSize: normalizeBarSize(firstString(optionIntraday.bar_size)),
    optionIntradayContractCount,
    optionIntradayExpectedRowsPerContract: optionExpectedRowsPerContract,
    optionIntradayExpectedRows: optionExpectedRows,
    optionIntradayRowCount: optionIntradayRows,
    optionIntradayExpectedNoDataContractCount: firstNumber(optionIntraday.expected_no_data_contract_count, availabilityCounts.expected_no_data_contract_count),
    optionIntradayEmptyContractCount: firstNumber(optionIntraday.empty_contract_count, availabilityCounts.empty_contract_count),
    optionIntradayUnexpectedErrorCount: unexpectedErrorCount,
    tradedOptionContractCount: firstNumber(optionIntraday.traded_option_contract_count, availabilityCounts.traded_option_contract_count, optionContractCount),
    spreadMarkExpectedRows: optionExpectedRowsPerContract && entryCount ? optionExpectedRowsPerContract * entryCount : 0,
    spreadMarkRowCount: spreadMarkRows,
    volumeProfileExpectedRows: optionExpectedRows,
    volumeProfileRowCount: volumeProfileRows,
    openInterestExpectedRows,
    openInterestRowCount: openInterestRows,
    openInterestValidRowCount: openInterestValidRows,
    underlyingIntradayStatus: firstString(underlyingIntraday.status, availabilityCounts.underlying_1m_status),
    underlyingIntradayExpectedRows: underlyingSymbolCount ? underlyingSymbolCount * 390 : 0,
    underlyingIntradaySymbolCount: underlyingSymbolCount,
    underlyingIntradayRowCount: underlyingRows,
    underlyingIntradayPath: firstString(asRecord(asRecord(underlyingIntraday).outputs).csv),
    availabilityStatus,
    uploadStatus: googleUploaded ? "uploaded" : context.payloadExists ? "payload_ready_unconfirmed" : "missing_payload",
    logPath: firstString(local.log_path),
    payloadPath: context.payloadExists ? context.payloadPath : undefined,
    generatedAtLocal: firstString(local.generated_at_local, trades.pulled_at_et, optionIntraday.pulled_at_utc),
    issueCount: issues.filter((nextIssue) => nextIssue.severity !== "info").length,
    issues,
    uploadTabCount: context.payloadExists ? REQUIRED_PAYLOAD_TAB_COUNT : 0,
    payloadRows,
    rawUploadGoogleSheetUrl,
  };
}

function buildCache(dayDir: string, summary: DailySummary, dailySyncSummaryPath: string, dailySyncSummaryMtimeMs?: number): RubiconTrackerSummaryCache {
  const payloadPath = path.join(dayDir, "google_sheet_upload_payload.json");
  return {
    schema: RUBICON_TRACKER_SUMMARY_SCHEMA,
    version: RUBICON_TRACKER_SUMMARY_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      dailySyncSummaryMtimeMs,
      dailySyncSummaryPath,
    },
    description: {
      role: "Compact serving-layer summary for Rubicon's /api/tracker dashboard.",
      loadPolicy: "Rubicon reads this file on the dashboard hot path and leaves row-level IBKR/Google artifacts for replay, audit, and explicit detail views.",
      artifacts: [
        {
          name: "daily_sync_summary.json",
          path: dailySyncSummaryPath,
          role: "Validated daily pull status, counts, and source artifact pointers.",
          loadPolicy: "Small summary input; safe for dashboard load.",
        },
        {
          name: "google_sheet_upload_payload.json",
          path: payloadPath,
          role: "Compact Google tracker upload payload.",
          loadPolicy: "Small tracker-only payload; row-level IBKR artifacts stay in the local archive.",
        },
      ],
    },
    summary,
  };
}

function isFreshCache(cache: RubiconTrackerSummaryCache | null, dailySyncSummaryMtimeMs?: number): cache is RubiconTrackerSummaryCache {
  return Boolean(
    cache &&
    cache.schema === RUBICON_TRACKER_SUMMARY_SCHEMA &&
    cache.version === RUBICON_TRACKER_SUMMARY_VERSION &&
    cache.summary &&
    (dailySyncSummaryMtimeMs === undefined || cache.source.dailySyncSummaryMtimeMs === dailySyncSummaryMtimeMs),
  );
}

export async function loadMissingRubiconDailySummary(dayDir: string): Promise<DailySummary> {
  const date = path.basename(dayDir);
  const dailySyncSummaryPath = path.join(dayDir, "daily_sync_summary.json");
  const payloadPath = path.join(dayDir, "google_sheet_upload_payload.json");
  const payloadExists = await pathExists(payloadPath);
  const issues: DataIssue[] = [
    issue("pull", "error", "Daily sync summary missing", `No daily_sync_summary.json found for ${date} at ${dailySyncSummaryPath}.`),
  ];

  if (!payloadExists) {
    issues.push(issue("upload", "error", "Google Sheet upload payload missing", `No payload found for ${date} at ${payloadPath}.`));
  } else {
    issues.push(issue("upload", "info", "Google tracker payload ready", `Compact tracker payload is staged at ${payloadPath}.`));
  }

  issues.push(
    issue(
      "upload",
      "warning",
      "Google tracker upload not confirmed",
      "No compact daily sync summary/tracker upload receipt was found for this date.",
    ),
  );

  return {
    date,
    tradeCount: 0,
    fillCount: 0,
    spreadCount: 0,
    entryCount: 0,
    optionContractCount: 0,
    spxStatus: "missing",
    reviewMode: "trade_review",
    reviewReady: false,
    localReviewStatus: "blocked",
    tradeStatus: "missing",
    optionIntradayStatus: "missing",
    availabilityStatus: "missing",
    uploadStatus: payloadExists ? "payload_ready_unconfirmed" : "missing_payload",
    payloadPath: payloadExists ? payloadPath : undefined,
    issueCount: issues.filter((nextIssue) => nextIssue.severity !== "info").length,
    issues,
    uploadTabCount: 0,
    payloadRows: 0,
  };
}

export async function loadOrBuildRubiconDailySummary(dayDir: string): Promise<DailySummary | null> {
  const date = path.basename(dayDir);
  const cachePath = path.join(dayDir, RUBICON_TRACKER_SUMMARY_FILE);
  const dailySyncSummaryPath = path.join(dayDir, "daily_sync_summary.json");
  const dailySyncSummaryMtimeMs = (await mtimeMs(dailySyncSummaryPath)) ?? undefined;
  const cached = await readJson<RubiconTrackerSummaryCache | null>(cachePath, null);
  if (isFreshCache(cached, dailySyncSummaryMtimeMs)) {
    return cached.summary;
  }

  const local = await readJson<JsonRecord | null>(dailySyncSummaryPath, null);
  if (!local) {
    return null;
  }

  const payloadPath = path.join(dayDir, "google_sheet_upload_payload.json");
  const payloadExists = await pathExists(payloadPath);
  const summary = buildRubiconDailySummaryFromSyncSummary(local, {
    date,
    payloadExists,
    payloadPath,
  });
  const cache = buildCache(dayDir, summary, dailySyncSummaryPath, dailySyncSummaryMtimeMs);
  await writeJsonAtomic(cachePath, cache);
  return summary;
}

export async function refreshRubiconDailySummary(tradeRoot: string, date: string): Promise<DailySummary | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  return loadOrBuildRubiconDailySummary(path.join(tradeRoot, date));
}
