import type { DailySyncStatusResult, DailySyncStep, DailySyncStepProgress, DailySyncStepStatus } from "../shared/types";

export type DailySyncProgressTone = "idle" | "running" | "complete" | "warning" | "error";

export type DailySyncProgressStep = {
  id: string;
  label: string;
  progress?: DailySyncStepProgress;
  status: DailySyncStepStatus;
  detail?: string;
  ordinal: number;
  total: number;
};

export type DailySyncProgressModel = {
  available: boolean;
  completedSteps: number;
  countLabel: string;
  currentStepId?: string;
  currentStepLabel?: string;
  detail: string;
  label: string;
  percent: number;
  steps: DailySyncProgressStep[];
  tone: DailySyncProgressTone;
  totalSteps: number;
};

const DEFAULT_STEPS: Array<Pick<DailySyncStep, "id" | "label" | "status" | "detail" | "progress">> = [
  { id: "sync-started", label: "Sync started", status: "pending", detail: "Waiting to start." },
  { id: "core-sync", label: "Data Collection", status: "pending", detail: "Waiting for local pull files." },
  { id: "rubicon-ingest", label: "Rubicon Ingest", status: "pending", detail: "Waiting to publish local data into Rubicon state." },
  { id: "sheet-payload", label: "Sheet payload", status: "pending", detail: "Waiting for compact tracker payload generation." },
  { id: "google-upload", label: "Google Upload", status: "pending", detail: "Waiting to update tracker rows in Google Sheets." },
  { id: "tc2000-open", label: "Open TC2000", status: "pending", detail: "Waiting to verify TC2000 is open before scanner export." },
  { id: "tc2000-export", label: "TC2000 export", status: "pending", detail: "Waiting to export Qullamaggie scanner rows from TC2000." },
  { id: "qullamaggie-report", label: "Qullamaggie report/email", status: "pending", detail: "Waiting for a fresh TC2000 export." },
  { id: "tc2000-bars", label: "TC2000 daily bars", status: "pending", detail: "Waiting for daily-bar refresh." },
  { id: "option-spx-spread-legs", label: "Option SPX spread legs", status: "pending", detail: "Waiting to retry failed or missing SPX spread-leg option data." },
  { id: "option-spx-chain-band", label: "Option SPX chain band", status: "pending", detail: "Waiting to retry failed or missing SPX 0DTE chain-band option data." },
  { id: "option-owned-symbols", label: "Option owned symbols", status: "pending", detail: "Waiting to retry failed or missing owned/traded option data." },
  { id: "option-open-interest", label: "Option open interest", status: "pending", detail: "Waiting to retry failed or missing option open-interest data." },
  { id: "option-rubicon-refresh", label: "Option Rubicon refresh", status: "pending", detail: "Waiting to refresh replay and spread-speed state if retry changes option files." },
];

const FINISHED_STEP_STATUSES = new Set<DailySyncStepStatus>(["complete", "warning"]);

function normalizeSteps(status: DailySyncStatusResult | null | undefined): DailySyncProgressStep[] {
  const source = status?.steps?.length ? status.steps : DEFAULT_STEPS;
  const total = source.length;
  return source.map((step, index) => ({
    detail: step.detail,
    id: step.id,
    label: step.label,
    ordinal: index + 1,
    progress: normalizeStepProgress(step.progress),
    status: step.status,
    total,
  }));
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function isCompletedStatus(status: DailySyncStatusResult | null | undefined): boolean {
  return status?.state === "completed" || status?.pipelineState === "completed";
}

function isFailedStatus(status: DailySyncStatusResult | null | undefined): boolean {
  return status?.state === "failed" || status?.pipelineState === "failed" || status?.pipelineState === "failed-with-stage-errors";
}

function firstLine(value: string | undefined): string | undefined {
  return value?.split(/\r?\n/).find((line) => line.trim())?.trim();
}

function normalizeStepProgress(progress: DailySyncStepProgress | undefined): DailySyncStepProgress | undefined {
  if (!progress || !Number.isFinite(progress.current) || !Number.isFinite(progress.total) || progress.total <= 0) {
    return undefined;
  }
  const current = Math.max(0, Math.min(progress.current, progress.total));
  return {
    ...progress,
    current,
    total: progress.total,
  };
}

function stepProgressFraction(step: DailySyncProgressStep | undefined): number {
  if (!step?.progress) {
    return 0;
  }
  return step.progress.total > 0 ? step.progress.current / step.progress.total : 0;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatStepProgressLabel(progress: DailySyncStepProgress | undefined): string | undefined {
  if (!progress) {
    return undefined;
  }
  return `${formatCount(progress.current)} / ${formatCount(progress.total)} ${progress.unit}`;
}

export function buildDailySyncProgress(status: DailySyncStatusResult | null | undefined): DailySyncProgressModel {
  const steps = normalizeSteps(status);
  const totalSteps = steps.length;
  const completeOrWarningCount = steps.filter((step) => FINISHED_STEP_STATUSES.has(step.status)).length;
  const runningStep = steps.find((step) => step.status === "running");
  const failedStep = steps.find((step) => step.status === "failed");
  const hasWarnings = steps.some((step) => step.status === "warning") || Boolean(status?.warnings?.length);
  const failed = Boolean(failedStep) || isFailedStatus(status);
  const completed = isCompletedStatus(status) && !failed;
  const completedSteps = completed ? totalSteps : completeOrWarningCount;

  let progressUnits = completeOrWarningCount;
  if (completed) {
    progressUnits = totalSteps;
  } else if (runningStep) {
    progressUnits = completeOrWarningCount + stepProgressFraction(runningStep);
  } else if (failedStep) {
    progressUnits = Math.max(completeOrWarningCount, failedStep.ordinal - 0.5);
  }

  const tone: DailySyncProgressTone = failed
    ? "error"
    : status?.state === "running" || runningStep
      ? "running"
      : completed && hasWarnings
        ? "warning"
        : completed
          ? "complete"
          : "idle";

  const currentStep = runningStep ?? failedStep;
  const currentStepProgressLabel = formatStepProgressLabel(currentStep?.progress);
  const label = failedStep
    ? `Stopped at ${failedStep.label}`
    : runningStep
      ? `Running: ${runningStep.label}`
      : completed && hasWarnings
        ? "Completed with warnings"
        : completed
          ? "Completed"
          : "Ready to run";
  const baseDetail =
    currentStep?.progress?.detail ||
    currentStep?.progress?.label ||
    currentStep?.detail ||
    firstLine(status?.message) ||
    (completed ? "Daily pipeline finished." : "Daily pipeline is idle.");
  const detail =
    runningStep && !runningStep.progress
      ? `${baseDetail} Waiting for data update.`
      : baseDetail;

  return {
    available: Boolean(status),
    completedSteps,
    countLabel: currentStepProgressLabel ?? `${completedSteps} / ${totalSteps} steps`,
    currentStepId: currentStep?.id,
    currentStepLabel: currentStep?.label,
    detail,
    label,
    percent: totalSteps ? clampPercent((progressUnits / totalSteps) * 100) : 0,
    steps,
    tone,
    totalSteps,
  };
}
