import { minutesToCloseFromLabel } from "./spreadResponse";

export function currentMinutesToClose(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return minutesToCloseFromLabel(`${hour === "24" ? "00" : hour}:${minute}`) ?? 60;
}
