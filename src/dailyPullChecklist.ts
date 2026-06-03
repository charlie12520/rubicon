import type { DailySummary, DailySyncStatusResult, DailySyncStep, SourceHealth } from "../shared/types";

export type DailyPullStepStatus = "complete" | "warning" | "failed";
export type DailyPullCoverageImportance = "core" | "support" | "breadth";

export type DailyPullChecklistStep = {
  id: string;
  action: string;
  evidence: string;
  status: DailyPullStepStatus;
  notes: string[];
  warnings: string[];
  failures: string[];
};

export type DailyPullCoverageItem = {
  importance: DailyPullCoverageImportance;
  id: string;
  label: string;
  basis: string;
  expected: number | null;
  expectedLabel: string;
  pulled: number | null;
  pulledLabel: string;
  missing: number | null;
  missingLabel: string;
  coveragePct: number | null;
  status: DailyPullStepStatus;
  readinessLabel: string;
  unit: string;
  notes: string[];
  warnings: string[];
  failures: string[];
};

export type DailyPullChecklist = {
  blockingCount: number;
  blockingMissingOutputRows: number;
  coverageCompleteCount: number;
  coverageItems: DailyPullCoverageItem[];
  coverageProblemCount: number;
  completeCount: number;
  coreItemCount: number;
  coreReadyCount: number;
  date: string;
  diagnosticGapCount: number;
  failedCount: number;
  missingOutputRows: number;
  readinessLabel: string;
  readinessStatus: DailyPullStepStatus;
  steps: DailyPullChecklistStep[];
  warningCount: number;
};

export type DailyPullChecklistInput = {
  dailySyncStatus?: DailySyncStatusResult | null;
  latestTradeDate?: string | null;
  selectedDate: string;
  sourceHealth: SourceHealth[];
  summary?: DailySummary | null;
  today?: string;
  tradeCount: number;
};

const OK_STATUSES = new Set(["ok", "ok_with_errors", "uploaded", "up_to_date", "skipped", "skipped_no_non_spx_options", "disabled", "no_contracts"]);
const REQUIRED_PAYLOAD_TAB_COUNT = 11;

export function buildDailyPullChecklist({
  dailySyncStatus,
  latestTradeDate,
  selectedDate,
  sourceHealth,
  summary,
  today,
  tradeCount,
}: DailyPullChecklistInput): DailyPullChecklist {
  const visibleSourceHealth = sourceHealth.filter((source) => !isIbkrWalletSource(source));
  const sourceByLabel = new Map(visibleSourceHealth.map((source) => [source.label, source]));
  const syncStatusApplies = dailySyncStatusAppliesToDate(dailySyncStatus, selectedDate);
  const selectedDateSyncStatus = syncStatusApplies ? dailySyncStatus : null;
  const coverageItems = buildCoverageItems(summary, visibleSourceHealth, selectedDateSyncStatus);
  const coreItems = coverageItems.filter((item) => item.importance === "core");
  const blockingItems = coverageItems.filter((item) => item.status === "failed");
  const diagnosticItems = coverageItems.filter((item) => item.status === "warning");
  const coreReadyCount = coreItems.filter((item) => item.status === "complete").length;
  const coreBlockingCount = coreItems.filter((item) => item.status === "failed").length;
  const readinessStatus: DailyPullStepStatus = coreBlockingCount
    ? "failed"
    : coreReadyCount === coreItems.length
      ? "complete"
      : "warning";
  const steps: DailyPullChecklistStep[] = [
    buildTargetStep(selectedDate, today, latestTradeDate, dailySyncStatus, summary),
    buildSyncStep(selectedDate, selectedDateSyncStatus, summary),
    buildTradeImportStep(summary, tradeCount),
    buildSpxBarsStep(summary),
    buildOptionIntradayStep(summary),
    buildUnderlyingIntradayStep(summary),
    buildOpenInterestStep(summary),
    buildPayloadStep(summary, selectedDateSyncStatus),
    buildRawWorkbookStep(summary, selectedDateSyncStatus),
    buildUploadStep(summary),
    buildSourceRefreshStep(visibleSourceHealth, sourceByLabel),
  ];

  return {
    blockingCount: blockingItems.length,
    blockingMissingOutputRows: blockingItems
      .filter((item) => item.unit === "rows")
      .reduce((total, item) => total + Math.max(0, item.missing ?? 0), 0),
    coverageCompleteCount: coverageItems.filter((item) => item.status === "complete").length,
    coverageItems,
    coverageProblemCount: coverageItems.filter((item) => item.status !== "complete").length,
    completeCount: steps.filter((step) => step.status === "complete").length,
    coreItemCount: coreItems.length,
    coreReadyCount,
    date: selectedDate,
    diagnosticGapCount: diagnosticItems.length,
    failedCount: steps.filter((step) => step.status === "failed").length,
    missingOutputRows: coverageItems
      .filter((item) => item.unit === "rows")
      .reduce((total, item) => total + Math.max(0, item.missing ?? 0), 0),
    readinessLabel: coreBlockingCount ? "Blocked" : coreReadyCount === coreItems.length ? (blockingItems.length ? "Core ready; open gap" : "Ready") : "Usable with notes",
    readinessStatus,
    steps,
    warningCount: steps.filter((step) => step.status === "warning").length,
  };
}

function buildCoverageItems(
  summary: DailySummary | null | undefined,
  sourceHealth: SourceHealth[],
  dailySyncStatus?: DailySyncStatusResult | null,
): DailyPullCoverageItem[] {
  const optionIssues = summary?.issues.filter((issue) => /option|hmds|pacing/i.test(issue.title) && !/open interest/i.test(issue.title)) ?? [];
  const openInterestIssues = summary?.issues.filter((issue) => /open interest/i.test(issue.title)) ?? [];
  const volumeProfileIssues = summary?.issues.filter((issue) => /volume profile/i.test(issue.title)) ?? [];
  const tradeIssues = warningIssueDetails(summary, (title) => /execution|endpoint|trade/i.test(title));
  const sourceWarnings = sourceHealth.filter((source) => source.status === "warning").map((source) => `${source.label}: ${source.detail}`);
  const readySources = sourceHealth.filter((source) => source.status === "ok").length;
  const spxExpectedRows = summary?.spxIntradayExpectedRows ?? 4680;
  const spxBarSize = summary?.spxIntradayBarSize || "5s";
  const spxBarLabel = spxBarSize === "1m" ? "SPX 1m bars" : spxBarSize === "5s" ? "SPX 5s bars" : "SPX intraday bars";
  const optionBarLabel = optionIntradayShortLabel(summary?.optionIntradayBarSize);
  const optionBarBasisLabel = optionIntradayBasisLabel(summary?.optionIntradayBarSize);
  const optionIntradaySkipped = summary ? isSkippedStatus(summary.optionIntradayStatus) : false;
  const optionFailureMessages = !summary
    ? ["No summary exists, so option intraday bars cannot be verified."]
    : isBadStatus(summary.optionIntradayStatus)
      ? [`Option intraday status is ${summary.optionIntradayStatus}.`]
      : [];
  const optionWarningMessages = dedupe([
    ...optionIssues.filter((issue) => issue.severity === "warning").map((issue) => `${issue.title}: ${issue.detail}`),
    ...(summary?.optionIntradayExpectedNoDataContractCount ? [`Expected no-data contracts: ${formatNumber(summary.optionIntradayExpectedNoDataContractCount)}.`] : []),
    ...(summary?.optionIntradayEmptyContractCount ? [`Empty option contracts: ${formatNumber(summary.optionIntradayEmptyContractCount)}.`] : []),
    ...(summary && !isOkStatus(summary.optionIntradayStatus) && !isBadStatus(summary.optionIntradayStatus) ? [`Option intraday status is ${summary.optionIntradayStatus}.`] : []),
  ]);
  const optionNoteMessages = optionIssues.filter((issue) => issue.severity === "info").map((issue) => `${issue.title}: ${issue.detail}`);
  const optionExpectedRows = summary?.optionIntradayExpectedRows ?? (
    summary?.optionIntradayExpectedRowsPerContract !== undefined && summary?.optionIntradayContractCount !== undefined
      ? summary.optionIntradayExpectedRowsPerContract * summary.optionIntradayContractCount
      : null
  );
  const spreadMarkExpectedRows = summary?.spreadMarkExpectedRows ?? (
    summary?.optionIntradayExpectedRowsPerContract !== undefined && summary?.entryCount !== undefined
      ? summary.optionIntradayExpectedRowsPerContract * summary.entryCount
      : null
  );
  const underlyingExpectedRows = summary?.underlyingIntradayExpectedRows ?? (
    summary?.underlyingIntradaySymbolCount !== undefined
      ? summary.underlyingIntradaySymbolCount * 390
      : null
  );
  const optionCoveragePct = coveragePercent(summary?.optionIntradayRowCount ?? null, optionExpectedRows);
  const spreadMarkCoveragePct = coveragePercent(summary?.spreadMarkRowCount ?? null, spreadMarkExpectedRows);
  const openInterestCoveragePct = coveragePercent(summary?.openInterestValidRowCount ?? summary?.openInterestRowCount ?? null, summary?.openInterestExpectedRows ?? null);
  const volumeProfileExpectedRows = summary?.volumeProfileExpectedRows ?? optionExpectedRows;
  const volumeProfileCoveragePct = coveragePercent(summary?.volumeProfileRowCount ?? null, volumeProfileExpectedRows);
  const nonExpectedOptionWarning = optionIssues.some((issue) => issue.severity !== "info" && !/expected|no-data|hmds/i.test(`${issue.title} ${issue.detail}`));
  const optionUniverseUsable = optionIntradaySkipped || (!optionFailureMessages.length && optionCoveragePct !== null && optionCoveragePct >= 85 && !nonExpectedOptionWarning);
  const spreadMarksUsable = !summary
    ? false
    : spreadMarkCoveragePct !== null && spreadMarkCoveragePct >= 97 && (summary.spreadMarkRowCount ?? 0) > 0;
  const openInterestUsable = !openInterestIssues.some((issue) => issue.severity === "error") && openInterestCoveragePct !== null && openInterestCoveragePct >= 90;
  const volumeProfileSkipped = optionIntradaySkipped && (volumeProfileExpectedRows ?? 0) === 0;
  const volumeProfileUsable = volumeProfileSkipped || (volumeProfileCoveragePct !== null && volumeProfileCoveragePct >= 85);
  const hasOpenInterestWarningIssue = openInterestIssues.some((issue) => issue.severity === "warning");
  const hasVolumeProfileWarningIssue = volumeProfileIssues.some((issue) => issue.severity === "warning");
  const payloadHasUsableTabs = Boolean(summary && summary.uploadTabCount > 0 && summary.uploadStatus !== "missing_payload");
  const payloadSyncStep = syncStepById(dailySyncStatus, "sheet-payload");
  const rawWorkbookSyncStep = syncStepById(dailySyncStatus, "raw-workbook");
  const payloadStepReady = payloadSyncStep?.status === "complete";
  const rawWorkbookReady = Boolean(summary?.workbookPath) || rawWorkbookSyncStep?.status === "complete";
  const spreadMarkWarnings = summary && spreadMarkExpectedRows && summary.spreadMarkRowCount !== undefined && summary.spreadMarkRowCount < spreadMarkExpectedRows
    ? [`Raw replay mark gap: ${formatNumber(spreadMarkExpectedRows - summary.spreadMarkRowCount)} rows missing, ${formatPct(spreadMarkCoveragePct)} covered.`]
    : [];
  const optionUniverseWarnings = [
    ...optionWarningMessages,
    ...(optionUniverseUsable && optionExpectedRows && summary?.optionIntradayRowCount !== undefined && summary.optionIntradayRowCount < optionExpectedRows
      ? [`Raw chain gap is visible but non-blocking because traded-spread marks are checked separately.`]
      : []),
  ];
  const openInterestCoverageGap = openInterestUsable && summary?.openInterestExpectedRows && (summary.openInterestValidRowCount ?? summary.openInterestRowCount ?? 0) < summary.openInterestExpectedRows
    ? `Most near-open OI values are present: ${formatPct(openInterestCoveragePct)} covered.`
    : null;
  const openInterestWarnings = [
    ...openInterestIssues.filter((issue) => issue.severity === "warning").map((issue) => `${issue.title}: ${issue.detail}`),
    ...(hasOpenInterestWarningIssue && openInterestCoverageGap ? [openInterestCoverageGap] : []),
  ];
  const openInterestNotes = [
    ...openInterestIssues.filter((issue) => issue.severity === "info").map((issue) => `${issue.title}: ${issue.detail}`),
    ...(!hasOpenInterestWarningIssue && openInterestCoverageGap ? [openInterestCoverageGap] : []),
  ];
  const volumeProfileCoverageGap = volumeProfileUsable && volumeProfileExpectedRows && summary?.volumeProfileRowCount !== undefined && summary.volumeProfileRowCount < volumeProfileExpectedRows
    ? `Raw profile gap is visible but non-blocking at ${formatPct(volumeProfileCoveragePct)} coverage.`
    : null;
  const ibkrEndpointWorked = Boolean(summary?.ibkrEndpointConnectedCount);

  return [
    coverageItem({
      basis: summary
        ? `${formatNumber(summary.fillCount)} fill rows, ${formatNumber(summary.spreadCount)} spread rows, ${formatNumber(summary.entryCount)} entry rows, ${formatNumber(summary.optionContractCount)} contract rows.`
        : "No selected-date trade artifacts are available.",
      expected: summary?.tradeArtifactExpectedCount || 4,
      failures: summary ? [] : ["No summary exists, so trade artifacts cannot be verified."],
      id: "trade-artifacts",
      importance: "core",
      label: "IBKR trade files",
      notes: [],
      pulled: summary?.tradeArtifactReadyCount ?? null,
      readinessLabel: "Core input",
      unit: "files",
      warnings: [],
    }),
    coverageItem({
      basis: summary ? `Status ${summary.spxStatus}; ${spxBarSize} New York session 09:30-16:00.` : "No SPX summary is available.",
      expected: spxExpectedRows,
      failures: !summary ? ["No summary exists, so SPX bars cannot be verified."] : isBadStatus(summary.spxStatus) ? [`${spxBarLabel} status is ${summary.spxStatus}.`] : [],
      id: "spx-bars",
      importance: "core",
      label: spxBarLabel,
      notes: [],
      pulled: summary?.spxIntradayRowCount ?? null,
      readinessLabel: "Chart ready",
      unit: "rows",
      warnings: summary && !isOkStatus(summary.spxStatus) && !isBadStatus(summary.spxStatus) ? [`${spxBarLabel} status is ${summary.spxStatus}.`] : [],
    }),
    coverageItem({
      basis: summary
        ? `${formatNumber(summary.entryCount)} spread entries x ${formatNumber(summary.optionIntradayExpectedRowsPerContract)} replay bars; built from the traded spread legs.`
        : "No spread mark summary is available.",
      expected: spreadMarkExpectedRows,
      failures: !summary
        ? ["No summary exists, so spread marks cannot be verified."]
        : spreadMarkExpectedRows && !(summary.spreadMarkRowCount ?? 0)
          ? ["No spread replay marks were built for the selected date."]
          : [],
      id: "spread-marks",
      importance: "core",
      label: "Traded spread replay marks",
      missingStatus: "warning",
      notes: [],
      pulled: summary?.spreadMarkRowCount ?? null,
      readinessLabel: spreadMarksUsable ? "Replay ready" : "Replay gap",
      statusOverride: spreadMarksUsable ? "complete" : undefined,
      unit: "rows",
      warnings: spreadMarkWarnings,
    }),
    coverageItem({
      basis: summary
        ? `${formatNumber(summary.openInterestValidRowCount)} valid values from ${formatNumber(summary.openInterestExpectedRows)} contracts; used for the static 0DTE OI context.`
        : "No open-interest summary is available.",
      expected: summary?.openInterestExpectedRows ?? null,
      failures: [
        ...(!summary ? ["No summary exists, so open interest cannot be verified."] : []),
        ...openInterestIssues.filter((issue) => issue.severity === "error").map((issue) => `${issue.title}: ${issue.detail}`),
      ],
      id: "open-interest",
      importance: "support",
      label: "0DTE near-open OI values",
      missingStatus: "warning",
      notes: openInterestNotes,
      pulled: summary?.openInterestValidRowCount ?? summary?.openInterestRowCount ?? null,
      readinessLabel: openInterestUsable ? "OI usable" : "OI gap",
      statusOverride: openInterestUsable ? "complete" : undefined,
      unit: "rows",
      warnings: openInterestWarnings,
    }),
    coverageItem({
      basis: optionIntradaySkipped
        ? "Regular sync skipped option intraday chain breadth; no option-chain breadth rows were requested."
        : summary
        ? `${formatNumber(summary.optionIntradayContractCount)} requested contracts x ${formatNumber(summary.optionIntradayExpectedRowsPerContract)} ${optionBarBasisLabel} bars; raw chain breadth, not the replay-critical gate.`
        : "No option intraday summary is available.",
      expected: optionExpectedRows,
      failures: optionFailureMessages,
      id: "option-bars",
      importance: "breadth",
      label: `Option ${optionBarLabel} chain breadth`,
      missingStatus: "warning",
      notes: optionNoteMessages,
      pulled: summary?.optionIntradayRowCount ?? null,
      readinessLabel: optionIntradaySkipped ? "Skipped" : optionUniverseUsable ? "Usable breadth" : "Watch gaps",
      statusOverride: optionUniverseUsable ? "complete" : undefined,
      unit: "rows",
      warnings: dedupe(optionUniverseWarnings),
    }),
    coverageItem({
      basis: volumeProfileSkipped
        ? "Volume profile skipped because regular sync did not request option intraday chain rows."
        : `Volume profile is built from available option ${optionBarBasisLabel} output rows; far-chain no-data can leave raw gaps.`,
      expected: volumeProfileExpectedRows,
      failures: summary ? [] : ["No summary exists, so volume profile rows cannot be verified."],
      id: "volume-profile",
      importance: "breadth",
      label: "Option volume profile rows",
      missingStatus: "warning",
      notes: [
        ...volumeProfileIssues.filter((issue) => issue.severity === "info").map((issue) => `${issue.title}: ${issue.detail}`),
        ...(!hasVolumeProfileWarningIssue && volumeProfileCoverageGap ? [volumeProfileCoverageGap] : []),
      ],
      pulled: summary?.volumeProfileRowCount ?? null,
      readinessLabel: volumeProfileSkipped ? "Skipped" : volumeProfileUsable ? "Profile usable" : "Profile gap",
      statusOverride: volumeProfileUsable ? "complete" : undefined,
      unit: "rows",
      warnings: [
        ...volumeProfileIssues.filter((issue) => issue.severity === "warning").map((issue) => `${issue.title}: ${issue.detail}`),
        ...(hasVolumeProfileWarningIssue && volumeProfileCoverageGap ? [volumeProfileCoverageGap] : []),
      ],
    }),
    coverageItem({
      basis: summary
        ? `${formatNumber(summary.underlyingIntradaySymbolCount)} connected stock/index underlyings x 390 session minutes.`
        : "No connected-underlying summary is available.",
      expected: underlyingExpectedRows,
      failures: !summary
        ? ["No summary exists, so connected underlying 1m bars cannot be verified."]
        : summary.underlyingIntradayStatus && isBadStatus(summary.underlyingIntradayStatus)
          ? [`Connected underlying 1m status is ${summary.underlyingIntradayStatus}.`]
          : [],
      id: "underlying-bars",
      importance: "support",
      label: "Connected underlying 1m bars",
      notes: [],
      pulled: summary?.underlyingIntradayRowCount ?? null,
      readinessLabel: "Underlying data",
      unit: "rows",
      warnings: summary?.underlyingIntradayStatus && !isOkStatus(summary.underlyingIntradayStatus) && !isBadStatus(summary.underlyingIntradayStatus)
        ? [`Connected underlying 1m status is ${summary.underlyingIntradayStatus}.`]
        : [],
    }),
    coverageItem({
      basis: "Required payload tabs now include IBKR Underlying 1m.",
      expected: REQUIRED_PAYLOAD_TAB_COUNT,
      failures: summary && summary.uploadTabCount <= 0 && !payloadStepReady ? ["No Google upload payload tabs were staged."] : syncStepFailures(payloadSyncStep),
      id: "payload-tabs",
      importance: "support",
      label: "Google upload payload tabs",
      missingStatus: "warning",
      notes: syncStepNotes(payloadSyncStep),
      pulled: summary?.uploadTabCount ?? (payloadStepReady ? 1 : null),
      readinessLabel: payloadHasUsableTabs || payloadStepReady ? "Payload usable" : "Payload gap",
      statusOverride: payloadHasUsableTabs || payloadStepReady ? "complete" : undefined,
      unit: "tabs",
      warnings: summary
        ? [
            ...(summary.uploadTabCount < REQUIRED_PAYLOAD_TAB_COUNT ? [`Payload is missing ${formatNumber(REQUIRED_PAYLOAD_TAB_COUNT - summary.uploadTabCount)} required tab.`] : []),
            `Payload rows staged: ${formatNumber(summary.payloadRows)}.`,
          ]
        : syncStepWarnings(payloadSyncStep),
    }),
    coverageItem({
      basis: summary?.workbookPath ? `Workbook staged at ${summary.workbookPath}.` : rawWorkbookSyncStep?.detail ?? "No raw upload workbook evidence is available yet.",
      expected: 1,
      failures: syncStepFailures(rawWorkbookSyncStep),
      id: "raw-workbook",
      importance: "support",
      label: "Local raw upload workbook",
      missingStatus: "warning",
      notes: syncStepNotes(rawWorkbookSyncStep),
      pulled: rawWorkbookReady ? 1 : 0,
      readinessLabel: rawWorkbookReady ? "Workbook ready" : "Workbook gap",
      statusOverride: rawWorkbookReady ? "complete" : undefined,
      unit: "workbook",
      warnings: summary?.workbookPath ? [] : syncStepWarnings(rawWorkbookSyncStep),
    }),
    coverageItem({
      basis: summary?.rawUploadGoogleSheetUrl ? "Raw Google workbook receipt confirmed in the tracker." : `Upload status ${summary?.uploadStatus ?? "unknown"}.`,
      expected: 1,
      failures: summary?.uploadStatus === "missing_payload" ? ["Upload cannot be confirmed because the local payload is missing."] : [],
      id: "upload-receipt",
      importance: "support",
      label: "Google raw upload receipt",
      missingStatus: "warning",
      notes: [],
      pulled: summary?.rawUploadGoogleSheetUrl ? 1 : 0,
      readinessLabel: summary?.rawUploadGoogleSheetUrl ? "Receipt found" : "Receipt gap",
      unit: "receipt",
      warnings: summary && summary.uploadStatus !== "uploaded" ? ["No raw_upload_google_sheet_url receipt is confirmed for this date."] : [],
    }),
    coverageItem({
      basis: summary
        ? `${formatNumber(summary.fillCount)} fills -> ${formatNumber(summary.spreadCount)} spreads -> ${formatNumber(summary.entryCount)} entries.`
        : "No selected-date execution summary is available.",
      expected: ibkrEndpointWorked ? 1 : summary?.ibkrEndpointExpectedCount || null,
      failures: [],
      id: "execution-endpoints",
      importance: "support",
      label: "IBKR execution endpoints",
      missingStatus: "warning",
      notes: infoIssueDetails(summary, (title) => /execution|endpoint|trade/i.test(title)),
      pulled: ibkrEndpointWorked ? 1 : summary?.ibkrEndpointConnectedCount ?? null,
      readinessLabel: ibkrEndpointWorked ? "Endpoint ready" : "Endpoint gap",
      statusOverride: ibkrEndpointWorked ? "complete" : undefined,
      unit: "endpoints",
      warnings: tradeIssues,
    }),
    coverageItem({
      basis: "Desktop app source snapshot after the pull/upload cycle.",
      expected: sourceHealth.length || null,
      failures: [],
      id: "source-snapshot",
      importance: "support",
      label: "App source-state cards",
      missingStatus: "warning",
      notes: [],
      pulled: readySources,
      readinessLabel: "Source check",
      unit: "cards",
      warnings: sourceWarnings,
    }),
  ];
}

function buildTargetStep(
  selectedDate: string,
  today: string | undefined,
  latestTradeDate: string | null | undefined,
  status: DailySyncStatusResult | null | undefined,
  summary: DailySummary | null | undefined,
): DailyPullChecklistStep {
  const warnings: string[] = [];
  const failures: string[] = [];
  const target = status?.targetPlan?.estimatedTargetDate;

  if (!selectedDate) {
    failures.push("No trade date is selected.");
  }
  if (!status?.targetPlan && !summary) {
    warnings.push("The daily sync target plan has not loaded yet.");
  }
  if (target && selectedDate && target !== selectedDate && !summary) {
    warnings.push(`Auto sync currently targets ${target}, while the selected review date is ${selectedDate}.`);
  }

  return step({
    action: "Pick the trade date and confirm the sync target",
    evidence: target
      ? `Selected ${selectedDate}; auto target ${target}; today ${today || "unknown"}; latest import ${latestTradeDate || "none"}.`
      : `Selected ${selectedDate || "none"}; today ${today || "unknown"}; latest import ${latestTradeDate || "none"}.`,
    failures,
    id: "target",
    notes: [],
    warnings,
  });
}

function buildSyncStep(
  selectedDate: string,
  status: DailySyncStatusResult | null | undefined,
  summary: DailySummary | null | undefined,
): DailyPullChecklistStep {
  const warnings: string[] = [];
  const failures: string[] = [];
  const coreStep = syncStepById(status, "core-sync");
  const notes = syncStepNotes(coreStep);

  if (!summary && !coreStep) {
    failures.push(`No daily_sync_summary.json has been imported for ${selectedDate}.`);
  }
  failures.push(...syncStepFailures(coreStep));
  if (status && (!status.ok || status.state === "failed")) {
    failures.push(status.message);
  } else if (status?.state === "running" && coreStep?.status !== "complete") {
    warnings.push("The daily sync is still running; final row counts may change.");
  }
  warnings.push(...syncStepWarnings(coreStep));

  const latestSummary = status?.latestSummary;
  if (latestSummary && latestSummary.date !== selectedDate && !summary) {
    warnings.push(`Latest sync summary is for ${latestSummary.date}, not ${selectedDate}.`);
  }

  return step({
    action: "Run Daily Sync after the session is ready",
    evidence: summary
      ? `${summary.date}: ${formatNumber(summary.fillCount)} fills, ${formatNumber(summary.spreadCount)} spreads, ${formatNumber(summary.entryCount)} entries.`
      : "No selected-date summary is available yet.",
    failures,
    id: "sync-run",
    notes,
    warnings,
  });
}

function buildTradeImportStep(summary: DailySummary | null | undefined, tradeCount: number): DailyPullChecklistStep {
  const warnings = warningIssueDetails(summary, (title) => /execution|endpoint|trade/i.test(title));
  const notes = infoIssueDetails(summary, (title) => /execution|endpoint|trade/i.test(title));
  const failures: string[] = [];
  if (!summary) {
    failures.push("No summary exists, so fills/spreads/entries cannot be verified.");
  } else if (isBadStatus(summary.tradeStatus)) {
    failures.push(`IBKR trade status is ${summary.tradeStatus}.`);
  } else if (summary.entryCount <= 0) {
    failures.push("No entry rows were built for the selected date.");
  }

  return step({
    action: "Import IBKR fills, spread summaries, and entry rows",
    evidence: summary
      ? `${formatNumber(summary.fillCount)} fills, ${formatNumber(summary.spreadCount)} spreads, ${formatNumber(summary.entryCount)} entries; ${formatNumber(tradeCount)} SPX replay trades visible.`
      : "No selected-date import counts.",
    failures,
    id: "trade-import",
    notes,
    warnings,
  });
}

function buildSpxBarsStep(summary: DailySummary | null | undefined): DailyPullChecklistStep {
  const failures: string[] = [];
  const warnings: string[] = [];
  const spxBarSize = summary?.spxIntradayBarSize || "5s";
  const spxBarLabel = spxBarSize === "1m" ? "SPX 1m" : spxBarSize === "5s" ? "SPX 5s" : "SPX intraday";
  if (!summary) {
    failures.push("No summary exists, so SPX bars cannot be verified.");
  } else if (isBadStatus(summary.spxStatus)) {
    failures.push(`${spxBarLabel} status is ${summary.spxStatus}.`);
  } else if (!isOkStatus(summary.spxStatus)) {
    warnings.push(`${spxBarLabel} status is ${summary.spxStatus}.`);
  }

  return step({
    action: "Pull SPX intraday 5-second bars in New York time",
    evidence: summary ? `SPX status ${summary.spxStatus}; availability ${summary.availabilityStatus}.` : "No SPX status reported.",
    failures,
    id: "spx-bars",
    notes: [],
    warnings,
  });
}

function buildOptionIntradayStep(summary: DailySummary | null | undefined): DailyPullChecklistStep {
  const optionIssues = summary?.issues.filter((issue) => /option|hmds|pacing/i.test(issue.title) && !/open interest/i.test(issue.title)) ?? [];
  const failures = optionIssues.filter((issue) => issue.severity === "error").map((issue) => `${issue.title}: ${issue.detail}`);
  const warnings = optionIssues.filter((issue) => issue.severity === "warning").map((issue) => `${issue.title}: ${issue.detail}`);
  const notes = optionIssues.filter((issue) => issue.severity === "info").map((issue) => `${issue.title}: ${issue.detail}`);
  if (!summary) {
    failures.push("No summary exists, so option intraday bars cannot be verified.");
  } else if (isBadStatus(summary.optionIntradayStatus)) {
    failures.push(`Option intraday status is ${summary.optionIntradayStatus}.`);
  } else if (!isOkStatus(summary.optionIntradayStatus)) {
    warnings.push(`Option intraday status is ${summary.optionIntradayStatus}.`);
  }

  const requiredCount = summary?.tradedOptionContractCount ?? summary?.optionContractCount ?? 0;
  const pulledCount = summary?.optionIntradayContractCount ?? summary?.optionContractCount ?? 0;
  const rows = summary?.optionIntradayRowCount;

  return step({
    action: `Pull ${optionIntradayStepLabel(summary?.optionIntradayBarSize)} bars for every traded option contract`,
    evidence: summary
      ? `${formatNumber(pulledCount)} option contracts checked against ${formatNumber(requiredCount)} traded contracts${rows === undefined ? "" : `; ${formatNumber(rows)} rows`}.`
      : "No option intraday status reported.",
    failures,
    id: "option-intraday",
    notes,
    warnings: dedupe(warnings),
  });
}

function buildUnderlyingIntradayStep(summary: DailySummary | null | undefined): DailyPullChecklistStep {
  const warnings: string[] = [];
  const failures: string[] = [];
  const status = summary?.underlyingIntradayStatus;

  if (!summary) {
    failures.push("No summary exists, so connected underlying 1m bars cannot be verified.");
  } else if (!status) {
    warnings.push("This archive does not report connected underlying stock/index 1m coverage yet.");
  } else if (isBadStatus(status)) {
    failures.push(`Connected underlying 1m status is ${status}.`);
  } else if (!isOkStatus(status)) {
    warnings.push(`Connected underlying 1m status is ${status}.`);
  }

  const symbols = summary?.underlyingIntradaySymbolCount;
  const rows = summary?.underlyingIntradayRowCount;

  return step({
    action: "Pull 1-minute bars for each stock/index underlying tied to option trades",
    evidence: status
      ? `${status}; ${formatNumber(symbols)} underlyings; ${formatNumber(rows)} rows.`
      : "No connected-underlying artifact reported.",
    failures,
    id: "underlying-intraday",
    notes: [],
    warnings,
  });
}

function buildOpenInterestStep(summary: DailySummary | null | undefined): DailyPullChecklistStep {
  const oiIssues = summary?.issues.filter((issue) => /open interest/i.test(issue.title)) ?? [];
  const failures = oiIssues.filter((issue) => issue.severity === "error").map((issue) => `${issue.title}: ${issue.detail}`);
  const warnings = oiIssues.filter((issue) => issue.severity === "warning").map((issue) => `${issue.title}: ${issue.detail}`);
  const notes = oiIssues.filter((issue) => issue.severity === "info").map((issue) => `${issue.title}: ${issue.detail}`);
  if (!summary) {
    failures.push("No summary exists, so open interest cannot be verified.");
  }

  return step({
    action: "Pull 0DTE open interest for the selected option universe",
    evidence: summary ? "Open interest is checked through the option intraday summary and date issues." : "No open-interest status reported.",
    failures,
    id: "open-interest",
    notes,
    warnings,
  });
}

function buildPayloadStep(
  summary: DailySummary | null | undefined,
  status: DailySyncStatusResult | null | undefined,
): DailyPullChecklistStep {
  const failures: string[] = [];
  const warnings: string[] = [];
  const payloadStep = syncStepById(status, "sheet-payload");
  const notes = syncStepNotes(payloadStep);
  if (!summary && !payloadStep) {
    failures.push("No summary exists, so the Google Sheet payload cannot be verified.");
  } else if (summary && (!summary.payloadRows || summary.uploadStatus === "missing_payload") && payloadStep?.status !== "complete") {
    failures.push("The staged Google Sheet payload is missing or empty.");
  } else if (summary && !summary.uploadTabCount) {
    warnings.push("Payload rows exist, but tab count was not reported.");
  }
  failures.push(...syncStepFailures(payloadStep));
  warnings.push(...syncStepWarnings(payloadStep));

  return step({
    action: "Build the staged Google Sheet upload payload",
    evidence: summary ? `${formatNumber(summary.payloadRows)} rows across ${formatNumber(summary.uploadTabCount)} tabs.` : payloadStep?.detail ?? "No payload evidence.",
    failures,
    id: "payload",
    notes,
    warnings,
  });
}

function buildRawWorkbookStep(
  summary: DailySummary | null | undefined,
  status: DailySyncStatusResult | null | undefined,
): DailyPullChecklistStep {
  const rawWorkbookStep = syncStepById(status, "raw-workbook");
  const failures = syncStepFailures(rawWorkbookStep);
  const warnings = syncStepWarnings(rawWorkbookStep);
  const notes = syncStepNotes(rawWorkbookStep);
  if (!summary?.workbookPath && rawWorkbookStep?.status !== "complete" && rawWorkbookStep?.status !== "failed") {
    warnings.push("No local raw upload workbook is verified yet.");
  }

  return step({
    action: "Rebuild the local raw upload workbook",
    evidence: summary?.workbookPath ? `Workbook path: ${summary.workbookPath}.` : rawWorkbookStep?.detail ?? "No workbook evidence.",
    failures,
    id: "raw-workbook",
    notes,
    warnings,
  });
}

function buildUploadStep(summary: DailySummary | null | undefined): DailyPullChecklistStep {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (!summary) {
    failures.push("No summary exists, so the upload receipt cannot be verified.");
  } else if (summary.uploadStatus === "missing_payload") {
    failures.push("Upload cannot be confirmed because the local payload is missing.");
  } else if (summary.uploadStatus !== "uploaded" || !summary.rawUploadGoogleSheetUrl) {
    warnings.push("The local payload exists, but no raw_upload_google_sheet_url receipt is confirmed for this date.");
  }

  return step({
    action: "Confirm the raw Google upload receipt in SPX Spread Trade Tracker",
    evidence: summary?.rawUploadGoogleSheetUrl ? "Raw Google workbook receipt confirmed." : `Upload status ${summary?.uploadStatus ?? "unknown"}.`,
    failures,
    id: "upload",
    notes: [],
    warnings,
  });
}

function buildSourceRefreshStep(sourceHealth: SourceHealth[], sourceByLabel: Map<string, SourceHealth>): DailyPullChecklistStep {
  const importantLabels = [
    "Google Drive connector snapshot",
    "Staged sheet payload",
    "Google raw workbook access",
    "AI STUFF IBKR trade mirror",
    "Replay market data",
    "AI STUFF daily sync launcher",
  ];
  const importantSources = importantLabels.map((label) => sourceByLabel.get(label)).filter(Boolean) as SourceHealth[];
  const failures = importantSources.filter((source) => source.status === "missing").map((source) => `${source.label}: ${source.detail}`);
  const warnings = sourceHealth.filter((source) => source.status === "warning").map((source) => `${source.label}: ${source.detail}`);
  const readyCount = sourceHealth.filter((source) => source.status === "ok").length;

  return step({
    action: "Refresh the desktop app source snapshot after pulls/uploads finish",
    evidence: `${formatNumber(readyCount)} of ${formatNumber(sourceHealth.length)} source cards are ready.`,
    failures,
    id: "source-refresh",
    notes: [],
    warnings: dedupe(warnings),
  });
}

function step({
  action,
  evidence,
  failures,
  id,
  notes = [],
  warnings,
}: {
  action: string;
  evidence: string;
  failures: string[];
  id: string;
  notes?: string[];
  warnings: string[];
}): DailyPullChecklistStep {
  const cleanFailures = dedupe(failures.filter(Boolean));
  const cleanNotes = dedupe(notes.filter(Boolean));
  const cleanWarnings = dedupe(warnings.filter(Boolean));
  return {
    action,
    evidence,
    failures: cleanFailures,
    id,
    notes: cleanNotes,
    status: cleanFailures.length ? "failed" : cleanWarnings.length ? "warning" : "complete",
    warnings: cleanWarnings,
  };
}

function syncStepById(status: DailySyncStatusResult | null | undefined, id: string): DailySyncStep | undefined {
  return status?.steps?.find((step) => step.id === id);
}

function dailySyncStatusAppliesToDate(status: DailySyncStatusResult | null | undefined, selectedDate: string): boolean {
  if (!status || !selectedDate) {
    return false;
  }
  if (status.latestSummary?.date === selectedDate) {
    return true;
  }
  if (status.targetPlan?.estimatedTargetDate === selectedDate && (status.state === "running" || Boolean(status.steps?.length))) {
    return true;
  }
  return false;
}

function syncStepFailures(step: DailySyncStep | undefined): string[] {
  if (step?.status !== "failed") {
    return [];
  }
  return [step.detail ? `${step.label}: ${step.detail}` : `${step.label} failed.`];
}

function syncStepWarnings(step: DailySyncStep | undefined): string[] {
  if (!step || step.status === "complete" || step.status === "failed") {
    return [];
  }
  if (step.status === "running") {
    return [step.detail ? `${step.label} is running: ${step.detail}` : `${step.label} is running.`];
  }
  if (step.status === "pending") {
    return [step.detail ? `${step.label} is pending: ${step.detail}` : `${step.label} is pending.`];
  }
  return [step.detail ? `${step.label}: ${step.detail}` : `${step.label} reported a warning.`];
}

function syncStepNotes(step: DailySyncStep | undefined): string[] {
  if (step?.status !== "complete" || !step.detail) {
    return [];
  }
  return [`${step.label}: ${step.detail}`];
}

function warningIssueDetails(summary: DailySummary | null | undefined, titleMatches: (title: string) => boolean): string[] {
  return (
    summary?.issues
      .filter((issue) => issue.severity === "warning" && titleMatches(issue.title))
      .map((issue) => `${issue.title}: ${issue.detail}`) ?? []
  );
}

function infoIssueDetails(summary: DailySummary | null | undefined, titleMatches: (title: string) => boolean): string[] {
  return (
    summary?.issues
      .filter((issue) => issue.severity === "info" && titleMatches(issue.title))
      .map((issue) => `${issue.title}: ${issue.detail}`) ?? []
  );
}

function isSkippedStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === "skipped" || normalized === "disabled" || normalized === "no_contracts" || normalized.startsWith("skipped_");
}

function isIbkrWalletSource(source: SourceHealth): boolean {
  return source.label.trim().toLowerCase() === "ibkr wallet";
}

function isBadStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  if (OK_STATUSES.has(normalized)) {
    return false;
  }
  return normalized.includes("error") || normalized.includes("failed") || normalized === "missing";
}

function isOkStatus(status: string): boolean {
  return OK_STATUSES.has(status.toLowerCase());
}

function coverageItem({
  basis,
  expected,
  failures,
  id,
  importance,
  label,
  missingStatus = "failed",
  notes = [],
  pulled,
  readinessLabel,
  statusOverride,
  unit,
  warnings,
}: {
  basis: string;
  expected: number | null;
  failures: string[];
  id: string;
  importance: DailyPullCoverageImportance;
  label: string;
  missingStatus?: DailyPullStepStatus;
  notes?: string[];
  pulled: number | null;
  readinessLabel?: string;
  statusOverride?: DailyPullStepStatus;
  unit: string;
  warnings: string[];
}): DailyPullCoverageItem {
  const cleanFailures = dedupe(failures.filter(Boolean));
  const cleanNotes = dedupe(notes.filter(Boolean));
  const cleanWarnings = dedupe(warnings.filter(Boolean));
  const expectedValue = expected !== null && Number.isFinite(expected) ? Math.max(0, expected) : null;
  const pulledValue = pulled !== null && Number.isFinite(pulled) ? Math.max(0, pulled) : null;
  const missing =
    expectedValue !== null && pulledValue !== null
      ? Math.max(0, expectedValue - pulledValue)
      : expectedValue !== null
        ? expectedValue
        : null;
  const coveragePct =
    expectedValue !== null && expectedValue > 0 && pulledValue !== null
      ? Math.min(100, Math.max(0, (pulledValue / expectedValue) * 100))
      : expectedValue === 0
        ? 100
        : null;
  const status: DailyPullStepStatus = cleanFailures.length
    ? "failed"
    : statusOverride
      ? statusOverride
      : missing && missing > 0
        ? missingStatus
        : cleanWarnings.length
          ? "warning"
          : "complete";

  return {
    basis,
    coveragePct,
    expected: expectedValue,
    expectedLabel: expectedValue === null ? "Unknown" : `${formatNumber(expectedValue)} ${unit}`,
    failures: cleanFailures,
    id,
    importance,
    label,
    missing,
    missingLabel: missing === null ? "Unknown" : `${formatNumber(missing)} ${unit}`,
    notes: cleanNotes,
    pulled: pulledValue,
    pulledLabel: pulledValue === null ? "Unknown" : `${formatNumber(pulledValue)} ${unit}`,
    readinessLabel: readinessLabel ?? (status === "complete" ? "Ready" : status === "warning" ? "Watch" : "Blocked"),
    status,
    unit,
    warnings: cleanWarnings,
  };
}

function coveragePercent(pulled: number | null | undefined, expected: number | null | undefined): number | null {
  const expectedValue = expected !== null && expected !== undefined && Number.isFinite(expected) ? Math.max(0, expected) : null;
  const pulledValue = pulled !== null && pulled !== undefined && Number.isFinite(pulled) ? Math.max(0, pulled) : null;
  if (expectedValue === null || pulledValue === null) {
    return null;
  }
  if (expectedValue === 0) {
    return 100;
  }
  return Math.min(100, Math.max(0, (pulledValue / expectedValue) * 100));
}

function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0);
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "Unknown";
  }
  return `${value.toFixed(1)}%`;
}

function optionIntradayBasisLabel(barSize: string | undefined): string {
  const normalized = normalizeBarSize(barSize);
  if (normalized === "1m") {
    return "1-minute";
  }
  if (normalized === "5s") {
    return "5-second";
  }
  return "intraday";
}

function optionIntradayShortLabel(barSize: string | undefined): string {
  const normalized = normalizeBarSize(barSize);
  if (normalized === "1m") {
    return "1m";
  }
  if (normalized === "5s") {
    return "5s";
  }
  return "intraday";
}

function optionIntradayStepLabel(barSize: string | undefined): string {
  const basis = optionIntradayBasisLabel(barSize);
  return basis === "intraday" ? "option intraday" : `${basis} intraday`;
}

function normalizeBarSize(barSize: string | undefined): "1m" | "5s" | null {
  const normalized = String(barSize ?? "").trim().toLowerCase();
  if (/^1\s*m(in(ute)?)?$/.test(normalized)) {
    return "1m";
  }
  if (/^5\s*s(ec(ond)?)?$/.test(normalized)) {
    return "5s";
  }
  return null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
