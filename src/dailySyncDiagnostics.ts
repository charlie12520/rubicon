import type { DailyPipelineStage, DailySyncAutoRunStatus, DailySyncStatusResult, DailySyncStep } from "../shared/types";

export type DailySyncDiagnostics = {
  available: boolean;
  badge: string;
  facts: Array<{ label: string; value: string }>;
  logLines: string[];
  logPath: string;
  stages: DailyPipelineStage[];
  steps: DailySyncStep[];
  title: string;
  tone: "ok" | "warning" | "error";
  warnings: string[];
};

const FLAGGED_LOG_LINE = /\b(error|failed|exception|timeout|unauthorized|quota|hmds query returned no data)\b/i;

export function buildDailySyncDiagnostics(status: DailySyncStatusResult | null | undefined, selectedDate?: string): DailySyncDiagnostics {
  if (!status) {
    return {
      available: false,
      badge: "Not loaded",
      facts: [],
      logLines: [],
      logPath: "",
      stages: [],
      steps: [],
      title: "Pipeline diagnostics unavailable",
      tone: "warning",
      warnings: [],
    };
  }

  const logLines = splitLogTail(status.latestLogTail);
  const flaggedCount = logLines.filter((line) => FLAGGED_LOG_LINE.test(line)).length;
  const stages = status.stages ? Object.values(status.stages) : [];
  const steps = Array.isArray(status.steps) ? status.steps : [];
  const warnings = Array.isArray(status.warnings) ? status.warnings.filter(Boolean) : [];
  const failedStepCount = steps.filter((step) => step.status === "failed").length;
  const warningStepCount = steps.filter((step) => step.status === "warning").length;
  const failedStageCount = stages.filter((stage) => stage.status === "failed").length;
  const warningStageCount = stages.filter((stage) => stage.status === "warning").length;
  const warningCount = warnings.length + warningStepCount + warningStageCount;
  const failed = !status.ok || status.state === "failed";
  const tone = failed || failedStepCount || failedStageCount ? "error" : flaggedCount || warningCount ? "warning" : "ok";
  const evidenceSummary = status.latestSummary ?? status.latestPipelineRun;
  const latestSummaryLabel = selectedDate && evidenceSummary?.date && evidenceSummary.date !== selectedDate
    ? "Latest pipeline run"
    : status.latestSummary
      ? "Current summary"
      : "Latest pipeline run";

  return {
    available: true,
    badge: failed || failedStepCount || failedStageCount
      ? "Pipeline failed"
      : warningCount
        ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
        : flaggedCount
          ? `${flaggedCount} flagged line${flaggedCount === 1 ? "" : "s"}`
          : "No flagged tail lines",
    facts: [
      { label: "State", value: status.state },
      ...(status.pipelineState ? [{ label: "Pipeline", value: status.pipelineState }] : []),
      ...(status.reviewReady !== undefined ? [{ label: "Review", value: status.reviewReady ? "ready" : "not ready" }] : []),
      ...(status.googleUploaded !== undefined ? [{ label: "Google", value: status.googleUploaded ? "uploaded" : "not uploaded" }] : []),
      ...(status.runId ? [{ label: "Run ID", value: status.runId }] : []),
      { label: "Target", value: targetLabel(status) },
      ...(status.autoRun ? [{ label: "Auto-run", value: autoRunLabel(status.autoRun) }] : []),
      { label: latestSummaryLabel, value: summaryLabel(status) },
      { label: "Updated", value: status.generatedAt },
    ],
    logLines,
    logPath: status.latestLogPath ?? status.logPath ?? "",
    stages,
    steps,
    title: "Pipeline diagnostics",
    tone,
    warnings,
  };
}

function splitLogTail(value: string | undefined): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);
}

function targetLabel(status: DailySyncStatusResult): string {
  if (!status.targetPlan) {
    return "Not reported";
  }
  return `${status.targetPlan.estimatedTargetDate} (${status.targetPlan.mode}, cutoff ${status.targetPlan.cutoffTimeEt} ET)`;
}

function summaryLabel(status: DailySyncStatusResult): string {
  const summary = status.latestSummary ?? status.latestPipelineRun;
  if (!summary) {
    return "No summary yet";
  }
  const entries = summary.entryCount ?? 0;
  const availability = summary.status ?? "unknown";
  return `${summary.date}: ${availability}, ${entries} entr${entries === 1 ? "y" : "ies"}`;
}

function autoRunLabel(autoRun: DailySyncAutoRunStatus): string {
  const base = `${autoRun.enabled ? "enabled" : "disabled"} (${autoRun.configuredTimeEt} ET, ${autoRun.catchupMinutes}m catch-up)`;
  if (autoRun.lastAttempt) {
    const outcome = autoRun.lastAttempt.ok ? "last fired" : "last failed";
    return `${base}; ${outcome} ${autoRun.lastAttempt.date} ${autoRun.lastAttempt.timeEt} ET: ${autoRun.lastAttempt.message}`;
  }
  if (autoRun.lastFiredDate) {
    return `${base}; last fired ${autoRun.lastFiredDate}`;
  }
  if (autoRun.lastSkippedDate) {
    return `${base}; last skipped ${autoRun.lastSkippedDate}`;
  }
  return `${base}; not fired yet`;
}
