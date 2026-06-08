import type { DailySyncStatusResult } from "../shared/types";

export type DailySyncReadiness = {
  detail: string;
  label: string;
  tone: "ok" | "warning" | "error";
};

function minutesUntilCutoff(nowEt: string, cutoffTimeEt: string): number | null {
  const nowMatch = nowEt.match(/^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}) ET$/);
  const cutoffMatch = cutoffTimeEt.match(/^(\d{2}):(\d{2})$/);

  if (!nowMatch || !cutoffMatch) {
    return null;
  }

  const nowMinutes = Number(nowMatch[1]) * 60 + Number(nowMatch[2]);
  const cutoffMinutes = Number(cutoffMatch[1]) * 60 + Number(cutoffMatch[2]);
  const remaining = cutoffMinutes - nowMinutes;

  return remaining > 0 ? remaining : null;
}

function formatCutoffCountdown(nowEt: string, cutoffTimeEt: string): string {
  const minutes = minutesUntilCutoff(nowEt, cutoffTimeEt);

  if (minutes === null) {
    return "";
  }

  return minutes === 1 ? ", about 1 minute from now" : `, about ${minutes} minutes from now`;
}

export function buildDailySyncReadiness(
  status: DailySyncStatusResult | null | undefined,
  today: string,
  latestTradeDate: string | null | undefined,
): DailySyncReadiness {
  if (today && latestTradeDate === today) {
    return {
      detail: `Today's archive ${today} is already imported. Refresh if the source files change again.`,
      label: "Today imported",
      tone: "ok",
    };
  }

  if (isWeekendDate(today)) {
    return {
      detail: `Today is a weekend date (${today}), so no same-day archive is expected. Auto can keep using the latest trading session ${latestTradeDate ?? "available"} until the next market day.`,
      label: "Market closed",
      tone: "ok",
    };
  }

  if (!status?.targetPlan) {
    return {
      detail: "Daily pipeline status has not loaded yet, so the app cannot estimate the auto target.",
      label: "Pipeline readiness unknown",
      tone: "warning",
    };
  }

  const plan = status.targetPlan;
  const target = plan.estimatedTargetDate;

  if (!status.ok || status.state === "failed") {
    return {
      detail: `${status.message} Last auto target estimate was ${target}.`,
      label: "Pipeline needs attention",
      tone: "error",
    };
  }

  if (status.state === "running") {
    return {
      detail: `The daily sync is running for target ${target}. Watch the diagnostics below for log-tail errors.`,
      label: "Pipeline running",
      tone: "ok",
    };
  }

  if (plan.mode === "auto" && !plan.afterCutoff && today && target !== today) {
    const countdown = formatCutoffCountdown(plan.nowEt, plan.cutoffTimeEt);

    return {
      detail: `Auto is still targeting ${target}. Today's ${today} pipeline opens after ${plan.cutoffTimeEt} ET${countdown}.`,
      label: `Same-day pipeline opens at ${plan.cutoffTimeEt} ET`,
      tone: "warning",
    };
  }

  if (plan.mode === "auto" && today && target === today) {
    return {
      detail: `Auto is targeting today's archive ${today}. Run Daily Pipeline when TWS/Gateway and local pulls are ready.`,
      label: "Today pipeline ready",
      tone: "ok",
    };
  }

  return {
    detail: `Auto target estimate is ${target}. ${plan.note}`,
    label: "Pipeline target estimated",
    tone: plan.afterCutoff ? "ok" : "warning",
  };
}

function isWeekendDate(date: string): boolean {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  const day = new Date(parsed).getUTCDay();
  return day === 0 || day === 6;
}
