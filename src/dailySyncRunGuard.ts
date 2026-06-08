import type { DailySyncStatusResult } from "../shared/types";

export type DailySyncRunGuard = {
  disabled: boolean;
  title: string;
};

const RUN_TITLE = "Launch the local daily pipeline: Data Collection, Rubicon Ingest, and Google Upload";

export function buildDailySyncRunGuard(
  status: DailySyncStatusResult | null | undefined,
  today: string,
): DailySyncRunGuard {
  if (!status?.targetPlan) {
    return { disabled: false, title: RUN_TITLE };
  }

  if (status.state === "running") {
    return {
      disabled: true,
      title: "Daily pipeline is already running.",
    };
  }

  const plan = status.targetPlan;
  if (plan.mode === "auto" && !plan.afterCutoff && today && plan.estimatedTargetDate !== today) {
    return {
      disabled: true,
      title: `Auto would still target ${plan.estimatedTargetDate}. Use Preflight Pipeline for checks; Run Daily Pipeline unlocks after ${plan.cutoffTimeEt} ET.`,
    };
  }

  return { disabled: false, title: RUN_TITLE };
}
