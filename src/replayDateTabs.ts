const HIDDEN_REPLAY_DATE_TABS = new Set(["2026-05-26", "2026-05-27"]);

export function visibleReplayDateTabs(availableDates: string[]): string[] {
  return availableDates.filter((date) => !HIDDEN_REPLAY_DATE_TABS.has(date));
}
