import type { DailySyncStatusResult, DailySyncStep } from "../shared/types";

export type DailySyncDiagnostics = {
  available: boolean;
  badge: string;
  facts: Array<{ label: string; value: string }>;
  logLines: string[];
  logPath: string;
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
      steps: [],
      title: "Latest sync diagnostics unavailable",
      tone: "warning",
      warnings: [],
    };
  }

  const logLines = splitLogTail(status.latestLogTail);
  const flaggedCount = logLines.filter((line) => FLAGGED_LOG_LINE.test(line)).length;
  const steps = Array.isArray(status.steps) ? status.steps : [];
  const warnings = Array.isArray(status.warnings) ? status.warnings.filter(Boolean) : [];
  const failedStepCount = steps.filter((step) => step.status === "failed").length;
  const warningStepCount = steps.filter((step) => step.status === "warning").length;
  const warningCount = warnings.length + warningStepCount;
  const failed = !status.ok || status.state === "failed";
  const tone = failed || failedStepCount ? "error" : flaggedCount || warningCount ? "warning" : "ok";
  const latestSummaryLabel = selectedDate && status.latestSummary?.date && status.latestSummary.date !== selectedDate
    ? "Latest pipeline run"
    : "Latest summary";

  return {
    available: true,
    badge: failed || failedStepCount
      ? "Sync failed"
      : warningCount
        ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
        : flaggedCount
          ? `${flaggedCount} flagged line${flaggedCount === 1 ? "" : "s"}`
          : "No flagged tail lines",
    facts: [
      { label: "State", value: status.state },
      { label: "Target", value: targetLabel(status) },
      { label: latestSummaryLabel, value: summaryLabel(status) },
      { label: "Updated", value: status.generatedAt },
    ],
    logLines,
    logPath: status.latestLogPath ?? status.logPath ?? "",
    steps,
    title: "Latest sync diagnostics",
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
  if (!status.latestSummary) {
    return "No summary yet";
  }
  const entries = status.latestSummary.entryCount ?? 0;
  const availability = status.latestSummary.status ?? "unknown";
  return `${status.latestSummary.date}: ${availability}, ${entries} entr${entries === 1 ? "y" : "ies"}`;
}
