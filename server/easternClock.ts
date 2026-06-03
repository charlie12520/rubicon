export type EasternClock = {
  date: string;
  time: string;
  weekday: number;
};

export type DailyWindowDecision = {
  date: string;
  shouldFire: boolean;
  time: string;
};

const WEEKDAY_BY_SHORT_NAME: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function easternClock(now: Date = new Date()): EasternClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
    weekday: WEEKDAY_BY_SHORT_NAME[get("weekday")] ?? 0,
  };
}

export function timeDeltaMinutes(hhmmA: string, hhmmB: string): number {
  const [ah, am] = hhmmA.split(":").map(Number);
  const [bh, bm] = hhmmB.split(":").map(Number);
  return Math.abs((ah * 60 + am) - (bh * 60 + bm));
}

export function shouldFireDailyWindow({
  catchupMinutes = 5,
  configuredTime,
  enabled,
  lastFiredDate,
  now = new Date(),
}: {
  catchupMinutes?: number;
  configuredTime: string;
  enabled: boolean;
  lastFiredDate: string | null;
  now?: Date;
}): DailyWindowDecision {
  const clock = easternClock(now);
  const isWeekday = clock.weekday >= 1 && clock.weekday <= 5;
  const delta = timeDeltaMinutes(clock.time, configuredTime);
  return {
    date: clock.date,
    shouldFire: enabled && isWeekday && lastFiredDate !== clock.date && clock.time >= configuredTime && delta <= catchupMinutes,
    time: clock.time,
  };
}
