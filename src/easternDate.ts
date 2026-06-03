export function easternDateOffset(offsetDays: number, referenceDate = new Date()): string {
  return easternDateKey(new Date(referenceDate.getTime() + offsetDays * 86_400_000));
}

export function easternDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseChartTimestampSeconds(time: unknown): number {
  if (typeof time === "number") {
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
  }
  if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
    const businessDay = time as { year: number; month: number; day: number };
    return Date.UTC(businessDay.year, businessDay.month - 1, businessDay.day) / 1000;
  }
  return 0;
}

export function formatEasternHm(time: unknown): string {
  const seconds = parseChartTimestampSeconds(time);
  if (!seconds) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(seconds * 1000));
}
