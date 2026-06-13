import type { DailySyncStatusResult } from "../shared/types.ts";
import { easternClock, timeDeltaMinutes, type EasternClock } from "./easternClock.ts";
import { startDailySync } from "./dailySync.ts";

const DEFAULT_AUTO_RUN_TIME_ET = "16:15";
const DEFAULT_CATCHUP_MINUTES = 5;
const TICK_MS = 30_000;

type StartDailySync = (input: { date: "auto" }) => Promise<DailySyncStatusResult>;

type AutoRunConfig = {
  catchupMinutes: number;
  configuredTimeEt: string;
  enabled: boolean;
};

type AutoRunAttempt = NonNullable<DailySyncStatusResult["autoRun"]>["lastAttempt"];

export type DailySyncAutoRunDecision = {
  action: "fire" | "skip" | "wait";
  date: string;
  reason: string;
  time: string;
};

export type DailySyncAutoRunController = {
  arm: () => void;
  getStatus: () => NonNullable<DailySyncStatusResult["autoRun"]>;
  stop: () => void;
  tick: (now?: Date) => Promise<DailySyncAutoRunDecision>;
};

export function readDailySyncAutoRunConfig(env: Record<string, string | undefined> = process.env): AutoRunConfig {
  return {
    catchupMinutes: parseCatchupMinutes(env.RUBICON_DAILY_SYNC_AUTO_RUN_CATCHUP_MINUTES),
    configuredTimeEt: parseConfiguredTime(env.RUBICON_DAILY_SYNC_AUTO_RUN_TIME),
    enabled: String(env.RUBICON_DAILY_SYNC_AUTO_RUN ?? "true").toLowerCase() !== "false",
  };
}

export function evaluateDailySyncAutoRunDecision({
  catchupMinutes,
  clock,
  configuredTimeEt,
  enabled,
  lastFiredDate,
  lastSkippedDate,
}: {
  catchupMinutes: number;
  clock: EasternClock;
  configuredTimeEt: string;
  enabled: boolean;
  lastFiredDate: string | null;
  lastSkippedDate: string | null;
}): DailySyncAutoRunDecision {
  if (!enabled) {
    return { action: "wait", date: clock.date, reason: "auto-run disabled", time: clock.time };
  }
  if (clock.weekday < 1 || clock.weekday > 5) {
    return { action: "wait", date: clock.date, reason: "weekend", time: clock.time };
  }
  if (lastFiredDate === clock.date) {
    return { action: "wait", date: clock.date, reason: "already fired today", time: clock.time };
  }
  if (clock.time < configuredTimeEt) {
    return { action: "wait", date: clock.date, reason: "before configured time", time: clock.time };
  }
  if (timeDeltaMinutes(clock.time, configuredTimeEt) > catchupMinutes) {
    return {
      action: lastSkippedDate === clock.date ? "wait" : "skip",
      date: clock.date,
      reason: "missed catch-up window",
      time: clock.time,
    };
  }
  return { action: "fire", date: clock.date, reason: "inside configured window", time: clock.time };
}

export function createDailySyncAutoRunController({
  catchupMinutes = DEFAULT_CATCHUP_MINUTES,
  clock = easternClock,
  configuredTimeEt = DEFAULT_AUTO_RUN_TIME_ET,
  enabled = true,
  start = startDailySync,
}: Partial<AutoRunConfig> & {
  clock?: (now?: Date) => EasternClock;
  start?: StartDailySync;
} = {}): DailySyncAutoRunController {
  let lastAttempt: AutoRunAttempt | undefined;
  let lastFiredDate: string | null = null;
  let lastSkippedDate: string | null = null;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const getStatus = (): NonNullable<DailySyncStatusResult["autoRun"]> => ({
    catchupMinutes,
    configuredTimeEt,
    enabled,
    lastAttempt,
    lastFiredDate: lastFiredDate ?? undefined,
    lastSkippedDate: lastSkippedDate ?? undefined,
    tickSeconds: TICK_MS / 1000,
  });

  const tick = async (now?: Date): Promise<DailySyncAutoRunDecision> => {
    if (running) {
      const current = clock(now);
      return { action: "wait", date: current.date, reason: "auto-run tick already running", time: current.time };
    }
    const current = clock(now);
    const decision = evaluateDailySyncAutoRunDecision({
      catchupMinutes,
      clock: current,
      configuredTimeEt,
      enabled,
      lastFiredDate,
      lastSkippedDate,
    });
    if (decision.action === "skip") {
      lastSkippedDate = decision.date;
      return decision;
    }
    if (decision.action !== "fire") {
      return decision;
    }

    running = true;
    lastFiredDate = decision.date;
    try {
      const result = await start({ date: "auto" });
      lastAttempt = {
        at: new Date().toISOString(),
        date: decision.date,
        message: result.message,
        ok: result.ok,
        runId: result.runId,
        state: result.state,
        targetDate: result.targetDate,
        timeEt: decision.time,
      };
    } catch (error) {
      lastAttempt = {
        at: new Date().toISOString(),
        date: decision.date,
        message: error instanceof Error ? error.message : String(error),
        ok: false,
        state: "error",
        timeEt: decision.time,
      };
    } finally {
      running = false;
    }
    return decision;
  };

  const arm = (): void => {
    if (!enabled || timer) return;
    timer = setInterval(() => {
      void tick().catch(() => {});
    }, TICK_MS);
    timer.unref?.();
  };

  const stop = (): void => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  return { arm, getStatus, stop, tick };
}

const defaultController = createDailySyncAutoRunController({
  ...readDailySyncAutoRunConfig(),
  start: startDailySync,
});

export function armDailySyncAutoRun(): void {
  defaultController.arm();
}

export function getDailySyncAutoRunStatus(): NonNullable<DailySyncStatusResult["autoRun"]> {
  return defaultController.getStatus();
}

function parseConfiguredTime(value: string | undefined): string {
  const trimmed = String(value ?? "").trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : DEFAULT_AUTO_RUN_TIME_ET;
}

function parseCatchupMinutes(value: string | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CATCHUP_MINUTES;
}
