type MorningArmClock = {
  date: string;
  time: string;
  weekday: number;
};

export type MorningAutoArmDecision = {
  date: string;
  shouldArm: boolean;
  time: string;
};

export type MorningAutoRefreshDecision = {
  date: string;
  shouldRefresh: boolean;
  time: string;
};

export function morningAutoArmDecision(
  now = new Date(),
  lastArmedDate: string | null = null,
  configuredTime = "08:30",
  catchupMinutes = 5,
): MorningAutoArmDecision {
  const clock = easternClock(now);
  const isWeekday = clock.weekday >= 1 && clock.weekday <= 5;
  return {
    date: clock.date,
    shouldArm:
      isWeekday &&
      lastArmedDate !== clock.date &&
      clock.time >= configuredTime &&
      timeDeltaMinutes(clock.time, configuredTime) <= catchupMinutes,
    time: clock.time,
  };
}

export function morningAutoRefreshDecision(
  now = new Date(),
  lastRefreshedDate: string | null = null,
  selectedDate: string,
  configuredTime = "08:30",
): MorningAutoRefreshDecision {
  const clock = easternClock(now);
  const isWeekday = clock.weekday >= 1 && clock.weekday <= 5;
  return {
    date: clock.date,
    shouldRefresh: isWeekday && selectedDate === clock.date && lastRefreshedDate !== clock.date && clock.time >= configuredTime,
    time: clock.time,
  };
}

function easternClock(now: Date): MorningArmClock {
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
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = get("hour") === "24" ? "00" : get("hour");
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

function timeDeltaMinutes(hhmmA: string, hhmmB: string): number {
  const [ah, am] = hhmmA.split(":").map(Number);
  const [bh, bm] = hhmmB.split(":").map(Number);
  return Math.abs((ah * 60 + am) - (bh * 60 + bm));
}
