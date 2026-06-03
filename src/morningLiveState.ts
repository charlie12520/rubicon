import type { MorningBriefPayload, MorningLiveUpdate } from "../shared/types";

export function countNewLiveUpdates(current: MorningLiveUpdate[], next: MorningLiveUpdate[]): number {
  const currentIds = new Set(current.map((update) => update.id));
  return next.filter((update) => !currentIds.has(update.id)).length;
}

export function mergeLiveUpdateList(current: MorningLiveUpdate[], next: MorningLiveUpdate[]): MorningLiveUpdate[] {
  if (next.length > 0 || current.length === 0) {
    return next;
  }
  return current;
}

export function preserveMorningBriefLiveUpdates(
  current: MorningBriefPayload | null,
  next: MorningBriefPayload,
): MorningBriefPayload {
  if (!current) {
    return next;
  }
  return {
    ...next,
    liveUpdates: mergeLiveUpdateList(current.liveUpdates, next.liveUpdates),
  };
}
