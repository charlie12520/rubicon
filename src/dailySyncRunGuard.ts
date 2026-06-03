import type { DailySyncStatusResult } from "../shared/types";

export type DailySyncRunGuard = {
  disabled: boolean;
  title: string;
};

const RUN_TITLE = "Launch the local AI STUFF daily SPX/IBKR sync and staged sheet-payload builder";

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
      title: "Daily SPX/IBKR sync is already running.",
    };
  }

  const plan = status.targetPlan;
  if (plan.mode === "auto" && !plan.afterCutoff && today && plan.estimatedTargetDate !== today) {
    return {
      disabled: true,
      title: `Auto would still target ${plan.estimatedTargetDate}. Use Preflight Sync for checks; Run Daily Sync unlocks after ${plan.cutoffTimeEt} ET.`,
    };
  }

  return { disabled: false, title: RUN_TITLE };
}
