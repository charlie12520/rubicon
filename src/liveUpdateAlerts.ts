import type { MorningLiveUpdate } from "../shared/types";
import { formatLiveUpdateDisplayText } from "./liveUpdateDisplay";
import { matchingCompiledLiveUpdateFilters, type CompiledLiveUpdateFilter } from "./liveUpdateFilters";

export type LiveUpdateDesktopAlertPayload = {
  body: string;
  detail?: string;
  title: string;
};

export type LiveUpdateDesktopAlertSender = (payload: LiveUpdateDesktopAlertPayload) => Promise<unknown>;

export function buildLiveUpdateDesktopAlertPayload(
  updates: MorningLiveUpdate[],
  filters: CompiledLiveUpdateFilter[],
): LiveUpdateDesktopAlertPayload | null {
  const update = updates[0];
  if (!update) {
    return null;
  }

  const matchedTerms = matchingCompiledLiveUpdateFilters(update, filters).map((filter) => filter.term);
  const matchedLabel = matchedTerms.length ? `Matched ${matchedTerms.join(", ")}` : "Matched live update";
  const detail = [
    matchedLabel,
    update.source,
    update.timeLabel,
    updates.length > 1 ? `${updates.length} matching updates` : null,
  ]
    .filter(Boolean)
    .join(" - ");

  return {
    body: formatLiveUpdateDisplayText(update.text),
    detail,
    title: "Live update matched your word filter",
  };
}

export async function triggerLiveUpdateDesktopAlertBatch(
  updates: MorningLiveUpdate[],
  filters: CompiledLiveUpdateFilter[],
  sendDesktopAlert: LiveUpdateDesktopAlertSender,
): Promise<void> {
  const payload = buildLiveUpdateDesktopAlertPayload(updates, filters);
  if (!payload) {
    return;
  }
  try {
    await sendDesktopAlert(payload);
  } catch {
    // Sound and row highlighting still run if the local Windows popup helper is unavailable.
  }
}
