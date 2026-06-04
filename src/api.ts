import type {
  DesktopAlertResult,
  DailySyncStatusResult,
  DailyReviewNote,
  FplIndicatorManifest,
  FplIndicatorPayload,
  FplLiveStatus,
  GodelAlertBridgeStatus,
  GoogleSnapshotRefreshResult,
  IbkrHoldingsRefreshResult,
  IbkrHoldingsSnapshot,
  IbkrWalletRefreshResult,
  MorningBriefPayload,
  MorningAiNotesPayload,
  MorningLiveUpdatesPayload,
  ReplayPayload,
  RrgBarsPayload,
  SpreadSpeedPayload,
  SpxHeatmapLiveStatus,
  SpxHeatmapPayload,
  SpxLiveBarsLiveStatus,
  SpxLiveBarsPayload,
  TrackerSnapshot,
  TradeJournalSnapshotSaveResult,
  TradeReviewFlag,
  WalletSnapshot,
} from "../shared/types";
import type { TradeJournalEntry } from "./tradeJournal";

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      throw new Error(parsed.message ?? parsed.error ?? response.statusText);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(body || response.statusText);
      }
      throw error;
    }
  }
  return response.json() as Promise<T>;
}

export function fetchTracker(signal?: AbortSignal): Promise<TrackerSnapshot> {
  return readJson<TrackerSnapshot>("/api/tracker", { signal });
}

export function refreshGoogleSnapshot(): Promise<GoogleSnapshotRefreshResult> {
  return readJson<GoogleSnapshotRefreshResult>("/api/google-snapshot/refresh", {
    method: "POST",
  });
}

export function refreshIbkrWallet(): Promise<IbkrWalletRefreshResult> {
  return readJson<IbkrWalletRefreshResult>("/api/ibkr-wallet/refresh", {
    method: "POST",
  });
}

export function fetchIbkrHoldings(signal?: AbortSignal): Promise<IbkrHoldingsSnapshot> {
  return readJson<IbkrHoldingsSnapshot>("/api/ibkr-holdings", { signal });
}

export function refreshIbkrHoldings(): Promise<IbkrHoldingsRefreshResult> {
  return readJson<IbkrHoldingsRefreshResult>("/api/ibkr-holdings/refresh", {
    method: "POST",
  });
}

export function fetchDailySyncStatus(signal?: AbortSignal): Promise<DailySyncStatusResult> {
  return readJson<DailySyncStatusResult>("/api/daily-sync/status", { signal });
}

export function runDailySync(date = "auto", options: { dryRun?: boolean } = {}): Promise<DailySyncStatusResult> {
  return readJson<DailySyncStatusResult>("/api/daily-sync/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, dryRun: options.dryRun === true }),
  });
}

export function fetchReplay(date: string, tradeId?: string, signal?: AbortSignal): Promise<ReplayPayload> {
  const params = new URLSearchParams({ date });
  if (tradeId) {
    params.set("tradeId", tradeId);
  }
  return readJson<ReplayPayload>(`/api/replay?${params.toString()}`, { signal });
}

export function fetchSpreadSpeed(date: string, signal?: AbortSignal): Promise<SpreadSpeedPayload> {
  return readJson<SpreadSpeedPayload>(`/api/spread-speed?${new URLSearchParams({ date }).toString()}`, { signal });
}

export function fetchRrgBars(signal?: AbortSignal): Promise<RrgBarsPayload> {
  return readJson<RrgBarsPayload>("/api/rrg/bars", { signal });
}

export function fetchSectorRrgBars(signal?: AbortSignal): Promise<RrgBarsPayload> {
  return readJson<RrgBarsPayload>("/api/rrg/sectors", { signal });
}

export function fetchSpxHeatmap(signal?: AbortSignal): Promise<SpxHeatmapPayload> {
  return readJson<SpxHeatmapPayload>("/api/spx-heatmap", { signal });
}

export function fetchSpxHeatmapLiveStatus(signal?: AbortSignal): Promise<SpxHeatmapLiveStatus> {
  return readJson<SpxHeatmapLiveStatus>("/api/spx-heatmap/live/status", { signal });
}

export function startSpxHeatmapLive(): Promise<SpxHeatmapLiveStatus> {
  return readJson<SpxHeatmapLiveStatus>("/api/spx-heatmap/live/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function stopSpxHeatmapLive(): Promise<SpxHeatmapLiveStatus> {
  return readJson<SpxHeatmapLiveStatus>("/api/spx-heatmap/live/stop", { method: "POST" });
}

export function fetchSpxLiveBars(signal?: AbortSignal): Promise<SpxLiveBarsPayload> {
  return readJson<SpxLiveBarsPayload>("/api/spx-live-bars", { signal });
}

export function fetchSpxLiveBarsStatus(signal?: AbortSignal): Promise<SpxLiveBarsLiveStatus> {
  return readJson<SpxLiveBarsLiveStatus>("/api/spx-live-bars/live/status", { signal });
}

export function startSpxLiveBars(): Promise<SpxLiveBarsLiveStatus> {
  return readJson<SpxLiveBarsLiveStatus>("/api/spx-live-bars/live/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function stopSpxLiveBars(): Promise<SpxLiveBarsLiveStatus> {
  return readJson<SpxLiveBarsLiveStatus>("/api/spx-live-bars/live/stop", { method: "POST" });
}

export function fetchMorningBrief(date: string, signal?: AbortSignal, options: { refresh?: boolean } = {}): Promise<MorningBriefPayload> {
  const params = new URLSearchParams({ date });
  if (options.refresh) {
    params.set("refresh", "1");
  }
  return readJson<MorningBriefPayload>(`/api/morning?${params.toString()}`, { signal });
}

export function fetchMorningLiveUpdates(signal?: AbortSignal): Promise<MorningLiveUpdatesPayload> {
  return readJson<MorningLiveUpdatesPayload>(`/api/morning/live-updates?${new URLSearchParams({ refresh: String(Date.now()) }).toString()}`, { signal });
}

export function fetchGodelAlertBridgeStatus(signal?: AbortSignal): Promise<GodelAlertBridgeStatus> {
  return readJson<GodelAlertBridgeStatus>("/api/godel-alert-bridge/status", { signal });
}

export function fetchMorningAiNotes(date: string, signal?: AbortSignal): Promise<MorningAiNotesPayload> {
  return readJson<MorningAiNotesPayload>(`/api/morning/ai-notes?${new URLSearchParams({ date }).toString()}`, { signal });
}

export function saveTradeJournalSnapshot(
  entries: Record<string, TradeJournalEntry>,
): Promise<TradeJournalSnapshotSaveResult> {
  return readJson<TradeJournalSnapshotSaveResult>("/api/journal-snapshot", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

export function triggerCalendarDesktopAlert(payload: {
  body: string;
  detail?: string;
  title?: string;
}): Promise<DesktopAlertResult> {
  return readJson<DesktopAlertResult>("/api/desktop-alert/calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function triggerLiveUpdateDesktopAlert(payload: {
  body: string;
  detail?: string;
  title?: string;
}): Promise<DesktopAlertResult> {
  return readJson<DesktopAlertResult>("/api/desktop-alert/live-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function saveWallet(netLiquidation: number): Promise<WalletSnapshot> {
  return readJson<WalletSnapshot>("/api/wallet", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ netLiquidation }),
  });
}

export function saveReviewNote(date: string, note: string, tradeFlags?: Record<string, TradeReviewFlag>): Promise<DailyReviewNote> {
  return readJson<DailyReviewNote>(`/api/review-notes/${date}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note, tradeFlags }),
  });
}

export function fetchFplManifest(signal?: AbortSignal): Promise<FplIndicatorManifest> {
  return readJson<FplIndicatorManifest>("/api/fpl-indicator/manifest", { signal });
}

export function fetchFplIndicator(
  date: string,
  live: boolean,
  signal?: AbortSignal,
): Promise<FplIndicatorPayload> {
  const params = new URLSearchParams({ date, live: String(live) });
  return readJson<FplIndicatorPayload>(`/api/fpl-indicator?${params.toString()}`, { signal });
}

export function fetchFplLiveStatus(signal?: AbortSignal): Promise<FplLiveStatus> {
  return readJson<FplLiveStatus>("/api/fpl-indicator/live/status", { signal });
}

export function startFplLivePredictor(port?: number, clientId?: number): Promise<FplLiveStatus> {
  return readJson<FplLiveStatus>("/api/fpl-indicator/live/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ port, clientId }),
  });
}

export function stopFplLivePredictor(): Promise<FplLiveStatus> {
  return readJson<FplLiveStatus>("/api/fpl-indicator/live/stop", { method: "POST" });
}
