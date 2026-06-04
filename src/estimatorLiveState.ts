// Live / stale / closed state for the Morning Estimator's "is it live?" indicator.
//
// Pure and client-only: the badge is truthful from data the client already holds —
// the snapshot's freshness (`fetchedAt`), whether the server scheduler is configured
// (`autoRefreshEt != null`), and a New York market-window check — with no server
// round-trip. The ET clock is reimplemented here (mirroring src/morningAutoArm.ts)
// because the client cannot import the server-only server/easternClock.ts.

export type EstimatorLivePhase = "LIVE" | "STALE" | "PRE_MARKET" | "CLOSED";

export type EstimatorLiveState = {
  phase: EstimatorLivePhase;
  pulsing: boolean; // drives the pulsing green dot — LIVE only
  label: string; // short pill text: "LIVE" | "Stale" | "Pre-market" | "Market closed"
  detail: string; // secondary line, e.g. "auto every 5m · updated 14:03:21"
  ageSeconds: number | null; // snapshot freshness in whole seconds (null when no fetchedAt)
  shouldPoll: boolean; // whether the client poll loop should run right now
};

export type EstimatorLiveInputs = {
  now?: Date;
  fetchedAt: string | null; // IbkrHoldingsSnapshot.fetchedAt
  autoRefreshConfigured: boolean; // snapshot.autoRefreshEt != null
  tracksToday: boolean; // the selected Morning date === ET today
  intervalMinutes?: number; // server intraday pull interval (default 5)
  windowStart?: string; // "HH:MM" ET, default 09:30
  windowEnd?: string; // "HH:MM" ET, default 16:00 (badge cutoff, see note below)
  graceMinutes?: number; // freshness grace on top of 2× interval (default 1)
};

type EtParts = { date: string; time: string; weekday: number };

function easternParts(now: Date): EtParts {
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

// Render an ISO timestamp as New York "HH:MM:SS" for the "updated …" detail.
function easternClockTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}

export function estimatorLiveState(input: EstimatorLiveInputs): EstimatorLiveState {
  const now = input.now ?? new Date();
  const intervalMinutes = input.intervalMinutes ?? 5;
  const windowStart = input.windowStart ?? "09:30";
  // The badge greys at 16:00 even though the server's pull window runs to 16:15:
  // the 16:00–16:15 settlement tail has unreliable SPX prints, so we never claim
  // "LIVE" there (matches the heatmap's isMarketPullWindow 16:00 cutoff).
  const windowEnd = input.windowEnd ?? "16:00";
  const graceMinutes = input.graceMinutes ?? 1;

  const clock = easternParts(now);
  const isWeekday = clock.weekday >= 1 && clock.weekday <= 5;
  const inWindow = isWeekday && clock.time >= windowStart && clock.time < windowEnd;

  const parsedAge = input.fetchedAt ? now.getTime() - Date.parse(input.fetchedAt) : null;
  const ageMs = parsedAge === null || Number.isNaN(parsedAge) ? null : parsedAge;
  const ageSeconds = ageMs === null ? null : Math.max(0, Math.round(ageMs / 1000));
  const freshMs = (2 * intervalMinutes + graceMinutes) * 60_000;
  const updatedEt = input.fetchedAt ? easternClockTime(input.fetchedAt) : "—";

  // Holdings are always "now", so a live badge on a past Morning date would lie.
  if (!input.tracksToday) {
    return { phase: "CLOSED", pulsing: false, label: "Market closed", detail: "viewing a past date", ageSeconds, shouldPoll: false };
  }

  if (!inWindow) {
    if (isWeekday && clock.time < windowStart) {
      return { phase: "PRE_MARKET", pulsing: false, label: "Pre-market", detail: `auto-refresh starts ${windowStart} ET`, ageSeconds, shouldPoll: false };
    }
    return { phase: "CLOSED", pulsing: false, label: "Market closed", detail: "outside market hours", ageSeconds, shouldPoll: false };
  }

  // In the weekday live window, tracking today → poll, then judge freshness.
  if (!input.autoRefreshConfigured) {
    return { phase: "STALE", pulsing: false, label: "Stale", detail: "auto-refresh disabled", ageSeconds, shouldPoll: true };
  }
  if (ageMs === null) {
    return { phase: "STALE", pulsing: false, label: "Stale", detail: "waiting for first pull", ageSeconds, shouldPoll: true };
  }
  if (ageMs <= freshMs) {
    return { phase: "LIVE", pulsing: true, label: "LIVE", detail: `auto every ${intervalMinutes}m · updated ${updatedEt}`, ageSeconds, shouldPoll: true };
  }
  const ageMinutes = Math.max(1, Math.round(ageMs / 60_000));
  return { phase: "STALE", pulsing: false, label: "Stale", detail: `last pull ${ageMinutes}m ago — TWS may be down`, ageSeconds, shouldPoll: true };
}
