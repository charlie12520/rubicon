import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  BriefcaseBusiness,
  CalendarDays,
  ExternalLink,
  Newspaper,
  Radio,
  RefreshCcw,
  Sparkles,
  Target,
} from "lucide-react";
import type {
  IbkrHoldingEarningsEvent,
  IbkrHoldingPosition,
  IbkrHoldingsSnapshot,
  GodelAlertBridgeStatus,
  MorningAiNotesBlock,
  MorningAiNotesPayload,
  MorningBriefPayload,
  MorningBriefSource,
  MorningCalendarEvent,
  MorningCompanyProfile,
  MorningDailyBar,
  MorningLiveUpdate,
  MorningLiveUpdatesPayload,
  MorningMajorEvent,
  MorningTc2000Screener,
  ReplayPayload,
  SpreadSpeedFrame,
  SpreadSpeedPayload,
  SpreadSpeedPick,
  SpxLiveBarsLiveStatus,
  SpxLiveBarsPayload,
  TradeRecord,
} from "../../shared/types";
import {
  fetchIbkrHoldings,
  fetchGodelAlertBridgeStatus,
  fetchMorningAiNotes,
  fetchMorningBrief,
  fetchMorningLiveUpdates,
  fetchReplay,
  fetchSpxLiveBars,
  fetchSpxLiveBarsStatus,
  refreshIbkrHoldings,
  startSpxLiveBars,
  stopSpxLiveBars,
  triggerCalendarDesktopAlert,
  triggerLiveUpdateDesktopAlert,
} from "../api";
import {
  calendarAlertTargets,
  formatCalendarAlertStatus,
  nextCalendarAlertTarget,
  type CalendarAlertTarget,
} from "../calendarAlerts";
import {
  alertableNewLiveUpdatesCompiled,
  compileLiveUpdateFilters,
  type CompiledLiveUpdateFilter,
  liveUpdateSearchText,
  matchingCompiledFiltersFromText,
  parseLiveUpdateFilterText,
} from "../liveUpdateFilters";
import { formatLiveUpdateDisplayText } from "../liveUpdateDisplay";
import { countNewLiveUpdates, mergeLiveUpdateList, preserveMorningBriefLiveUpdates } from "../morningLiveState";
import { formatCurrency, formatNumber, formatSignedCurrency } from "../format";
import { morningAutoArmDecision, morningAutoRefreshDecision } from "../morningAutoArm";
import { estimatorLiveState, type EstimatorLiveState } from "../estimatorLiveState";
import { easternDateKey } from "../easternDate";
import { triggerLiveUpdateDesktopAlertBatch } from "../liveUpdateAlerts";
import { FplIndicatorPanel } from "./FplIndicatorPanel";
import { LiveSpreadEstimatorPanel } from "./LiveSpreadEstimatorPanel";
import { SpreadResponsePanel } from "./SpreadResponsePanel";
import { SpxHeatmapPanel } from "./SpxHeatmapPanel";

type Props = {
  onOpenReplay: () => void;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  spreadSpeed: SpreadSpeedPayload | null;
  // Today's tracker trades (passed down from App.tsx — TrackerSnapshot.trades is
  // the source for closed-spread chips in the Estimator). May be empty before
  // the tracker fetch lands.
  trades?: TradeRecord[];
};

type MorningScreen = "brief" | "signal" | "estimator" | "heatmap";

type CalendarAlertPopup = {
  event: MorningCalendarEvent;
  eventAt: Date;
  firedAt: Date;
};

const LIVE_UPDATE_FILTER_STORAGE_KEY = "rubicon-live-update-word-filter";

export function MorningDashboard({
  selectedDate,
  spreadSpeed,
  trades,
}: Props) {
  const [brief, setBrief] = useState<MorningBriefPayload | null>(null);
  const [aiNotes, setAiNotes] = useState<MorningAiNotesPayload | null>(null);
  const [aiNotesError, setAiNotesError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertArmed, setAlertArmed] = useState(true);
  const [calendarAlertsArmed, setCalendarAlertsArmed] = useState(true);
  const [calendarAlertPopup, setCalendarAlertPopup] = useState<CalendarAlertPopup | null>(null);
  const [calendarClockTick, setCalendarClockTick] = useState(() => Date.now());
  const [holdings, setHoldings] = useState<IbkrHoldingsSnapshot | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [estimatorNowTick, setEstimatorNowTick] = useState(() => Date.now());
  const [holdingsMessage, setHoldingsMessage] = useState("");
  // Replay payload (today's SPX bars + quickTrades) for the Estimator's SPX 2m
  // chart. During a live mid-session `data/spx_intraday` may be empty until the
  // post-close pull runs — the live SPX bar feed below fills that gap.
  const [replay, setReplay] = useState<ReplayPayload | null>(null);
  // Live SPX intraday bars (dedicated IBKR sidecar) — preferred over the replay
  // bars during the session so the Estimator chart is live, not post-close.
  const [spxLiveBars, setSpxLiveBars] = useState<SpxLiveBarsPayload | null>(null);
  const [spxBarsStatus, setSpxBarsStatus] = useState<SpxLiveBarsLiveStatus | null>(null);
  const [spxFeedBusy, setSpxFeedBusy] = useState(false);
  const [liveUpdateFilterText, setLiveUpdateFilterText] = useState(() => readStoredLiveUpdateFilter());
  const [liveUpdatesRefreshing, setLiveUpdatesRefreshing] = useState(false);
  const [liveUpdatesCheckedAt, setLiveUpdatesCheckedAt] = useState<string | null>(null);
  const [liveUpdatesRefreshMessage, setLiveUpdatesRefreshMessage] = useState("");
  const [godelBridge, setGodelBridge] = useState<GodelAlertBridgeStatus | null>(null);
  const [godelBridgeMessage, setGodelBridgeMessage] = useState("");
  const [screen, setScreen] = useState<MorningScreen>("brief");
  const autoArmLastDate = useRef<string | null>(null);
  const autoRefreshLastDate = useRef<string | null>(null);
  const autoRefreshInFlight = useRef(false);
  const calendarTimers = useRef<number[]>([]);
  const knownUpdateIds = useRef<Set<string>>(new Set());
  const latestLiveUpdates = useRef<MorningLiveUpdate[]>([]);
  const liveUpdatesInFlight = useRef(false);
  const notifiedCalendarEventIds = useRef<Set<string>>(new Set());
  const audioContext = useRef<AudioContext | null>(null);
  const selectedDateRef = useRef(selectedDate);
  const holdingsRef = useRef<IbkrHoldingsSnapshot | null>(null);
  const estimatorPollInFlight = useRef(false);
  const liveUpdateFilters = useMemo(() => parseLiveUpdateFilterText(liveUpdateFilterText), [liveUpdateFilterText]);
  const compiledLiveUpdateFilters = useMemo(() => compileLiveUpdateFilters(liveUpdateFilters), [liveUpdateFilters]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  const loadBrief = useCallback(
    async (signal?: AbortSignal, options: { refresh?: boolean } = {}) => {
      if (!selectedDate) {
        return false;
      }
      const requestedDate = selectedDate;
      setLoading(true);
      setError(null);
      try {
        const next = await fetchMorningBrief(requestedDate, signal, options);
        if (signal?.aborted || requestedDate !== selectedDateRef.current || next.date !== selectedDateRef.current) {
          return false;
        }
        setBrief((current) => preserveMorningBriefLiveUpdates(current, next));
        return true;
      } catch (nextError) {
        if (!isAbortLike(nextError) && requestedDate === selectedDateRef.current) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
        return false;
      } finally {
        if (!signal?.aborted && requestedDate === selectedDateRef.current) {
          setLoading(false);
        }
      }
    },
    [selectedDate],
  );

  const loadLiveUpdates = useCallback(async (signal?: AbortSignal) => {
    if (liveUpdatesInFlight.current) {
      return;
    }
    liveUpdatesInFlight.current = true;
    try {
      const next = await fetchMorningLiveUpdates(signal);
      const newCount = countNewLiveUpdates(latestLiveUpdates.current, next.liveUpdates);
      setLiveUpdatesCheckedAt(next.generatedAt);
      setLiveUpdatesRefreshMessage(liveUpdatesRefreshStatus(next.generatedAt, next.liveUpdates, newCount, next));
      setBrief((current) =>
        current
          ? {
              ...current,
              liveUpdates: mergeLiveUpdateList(current.liveUpdates, next.liveUpdates),
              sources: mergeMorningSources(current.sources, next.sources),
            }
          : current,
      );
    } catch (nextError) {
      if (!isAbortLike(nextError)) {
        setBrief((current) =>
          current
            ? {
                ...current,
                sources: mergeMorningSources(current.sources, [
                  {
                    detail: nextError instanceof Error ? nextError.message : String(nextError),
                    label: "FirstSquawk live feed",
                    status: "warning",
                  },
                ]),
              }
          : current,
        );
      }
    } finally {
      liveUpdatesInFlight.current = false;
    }
  }, []);

  const refreshLiveUpdates = useCallback(async () => {
    setLiveUpdatesRefreshing(true);
    try {
      await loadLiveUpdates();
    } finally {
      setLiveUpdatesRefreshing(false);
    }
  }, [loadLiveUpdates]);

  const loadGodelBridge = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchGodelAlertBridgeStatus(signal);
      setGodelBridge(next);
      setGodelBridgeMessage(next.message);
    } catch (nextError) {
      if (!isAbortLike(nextError)) {
        setGodelBridgeMessage(nextError instanceof Error ? nextError.message : String(nextError));
      }
    }
  }, []);

  const loadHoldings = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchIbkrHoldings(signal);
      setHoldings(next);
    } catch (nextError) {
      if (!isAbortLike(nextError)) {
        setHoldingsMessage(nextError instanceof Error ? nextError.message : String(nextError));
      }
    }
  }, []);

  // Load today's replay payload (SPX bars) for the Estimator's SPX 2m chart.
  // The replay endpoint is the only existing source for SPX intraday bars; it
  // returns whatever the daily pull has written so far. If nothing is on disk
  // we just keep `replay = null` and let the panel render its empty-state.
  const loadReplay = useCallback(
    async (signal?: AbortSignal) => {
      if (!selectedDate) return;
      try {
        const next = await fetchReplay(selectedDate, undefined, signal);
        setReplay(next);
      } catch (nextError) {
        if (!isAbortLike(nextError)) {
          // Soft-fail: the chart will just show its waiting-state. The Estimator
          // P/L curve, chip rail, and slider all continue to work without bars.
          setReplay(null);
        }
      }
    },
    [selectedDate],
  );

  // Live SPX bars + feed status (the dedicated sidecar). Read-only; the feed is
  // a separate process that the server auto-starts ~09:28 ET (or the user starts
  // from the chart control).
  const loadSpxBars = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await fetchSpxLiveBars(signal);
      setSpxLiveBars(next);
    } catch (nextError) {
      if (!isAbortLike(nextError)) setSpxLiveBars(null);
    }
  }, []);
  const loadSpxBarsStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      setSpxBarsStatus(await fetchSpxLiveBarsStatus(signal));
    } catch {
      // status is optional chrome; ignore failures
    }
  }, []);
  const runSpxFeedAction = useCallback(
    (action: () => Promise<SpxLiveBarsLiveStatus>) => {
      setSpxFeedBusy(true);
      action()
        .then((status) => setSpxBarsStatus(status))
        .catch(() => undefined)
        .finally(() => {
          setSpxFeedBusy(false);
          // The first bars land within ~15s of starting — pull a couple of times.
          [3000, 9000, 18000].forEach((ms) => window.setTimeout(() => void loadSpxBars(), ms));
        });
    },
    [loadSpxBars],
  );

  const loadAiNotes = useCallback(
    async (signal?: AbortSignal) => {
      if (!selectedDate) {
        return;
      }
      setAiNotesError("");
      try {
        setAiNotes(await fetchMorningAiNotes(selectedDate, signal));
      } catch (nextError) {
        if (!isAbortLike(nextError)) {
          setAiNotesError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      }
    },
    [selectedDate],
  );

  const refreshHoldings = useCallback(async () => {
    setHoldingsLoading(true);
    setHoldingsMessage("");
    try {
      const result = await refreshIbkrHoldings();
      if (result.snapshot) {
        setHoldings(result.snapshot);
      } else {
        await loadHoldings();
      }
      setHoldingsMessage(!result.ok || result.snapshot?.status === "missing" || result.snapshot?.status === "error" ? result.message : "");
    } catch (nextError) {
      setHoldingsMessage(nextError instanceof Error ? nextError.message : String(nextError));
      await loadHoldings();
    } finally {
      setHoldingsLoading(false);
    }
  }, [loadHoldings]);

  useEffect(() => {
    const controller = new AbortController();
    void loadBrief(controller.signal);
    return () => controller.abort();
  }, [loadBrief]);

  useEffect(() => {
    const controller = new AbortController();
    void loadLiveUpdates(controller.signal);
    return () => controller.abort();
  }, [loadLiveUpdates]);

  useEffect(() => {
    const controller = new AbortController();
    void loadGodelBridge(controller.signal);
    return () => controller.abort();
  }, [loadGodelBridge]);

  useEffect(() => {
    const controller = new AbortController();
    void loadHoldings(controller.signal);
    return () => controller.abort();
  }, [loadHoldings]);

  useEffect(() => {
    const controller = new AbortController();
    void loadReplay(controller.signal);
    return () => controller.abort();
  }, [loadReplay]);

  // Live SPX bars + feed status — poll only while the Estimator screen is open
  // and the tab is visible (the feed file refreshes ~every 15s).
  useEffect(() => {
    if (screen !== "estimator") return;
    const controller = new AbortController();
    void loadSpxBars(controller.signal);
    void loadSpxBarsStatus(controller.signal);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadSpxBars();
        void loadSpxBarsStatus();
      }
    }, 20_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [screen, loadSpxBars, loadSpxBarsStatus]);

  useEffect(() => {
    holdingsRef.current = holdings;
  }, [holdings]);

  // 30s heartbeat so the live pill flips phases (LIVE -> STALE/CLOSED) at the
  // boundaries even when holdings aren't changing. Self-contained — not coupled to
  // the calendar-alert clock, which the user can disable.
  useEffect(() => {
    const id = window.setInterval(() => setEstimatorNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-refresh the live Estimator: while viewing today inside the weekday market
  // window, re-read the IBKR snapshot every 60s so the estimator reflects the
  // server's 5-min pull without a manual click. Read-only — it never POSTs
  // /refresh, so it can't open a competing IBKR connection (the server owns the
  // unique-client-id TWS pull).
  useEffect(() => {
    const maybeRefreshEstimatorHoldings = () => {
      if (document.visibilityState !== "visible" || estimatorPollInFlight.current) {
        return;
      }
      const state = estimatorLiveState({
        fetchedAt: holdingsRef.current?.fetchedAt ?? null,
        autoRefreshConfigured: holdingsRef.current?.autoRefreshEt != null,
        tracksToday: selectedDate === easternDateKey(),
      });
      if (!state.shouldPoll) {
        return;
      }
      estimatorPollInFlight.current = true;
      void loadHoldings().finally(() => {
        estimatorPollInFlight.current = false;
      });
    };
    maybeRefreshEstimatorHoldings();
    const interval = window.setInterval(maybeRefreshEstimatorHoldings, 60_000);
    return () => window.clearInterval(interval);
  }, [loadHoldings, selectedDate]);

  const estimatorLive = useMemo<EstimatorLiveState>(
    () =>
      estimatorLiveState({
        now: new Date(estimatorNowTick),
        fetchedAt: holdings?.fetchedAt ?? null,
        autoRefreshConfigured: holdings?.autoRefreshEt != null,
        tracksToday: selectedDate === easternDateKey(new Date(estimatorNowTick)),
      }),
    [holdings, selectedDate, estimatorNowTick],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadAiNotes(controller.signal);
    return () => controller.abort();
  }, [loadAiNotes]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadBrief();
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [loadBrief]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadLiveUpdates();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [loadLiveUpdates]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadGodelBridge();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [loadGodelBridge]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LIVE_UPDATE_FILTER_STORAGE_KEY, liveUpdateFilterText);
    } catch {
      // Local storage is optional in embedded shells.
    }
  }, [liveUpdateFilterText]);

  useEffect(() => {
    const maybeArm = () => {
      const decision = morningAutoArmDecision(new Date(), autoArmLastDate.current);
      if (!decision.shouldArm) {
        return;
      }
      autoArmLastDate.current = decision.date;
      setAlertArmed(true);
      setCalendarAlertsArmed(true);
      setCalendarClockTick(Date.now());
    };
    maybeArm();
    const interval = window.setInterval(maybeArm, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const maybeRefreshMorningState = () => {
      const decision = morningAutoRefreshDecision(new Date(), autoRefreshLastDate.current, selectedDate);
      if (!decision.shouldRefresh || autoRefreshInFlight.current) {
        return;
      }
      autoRefreshInFlight.current = true;
      void loadBrief(undefined, { refresh: true })
        .then((refreshed) => {
          if (refreshed) {
            autoRefreshLastDate.current = decision.date;
          }
        })
        .finally(() => {
          autoRefreshInFlight.current = false;
        });
    };
    maybeRefreshMorningState();
    const interval = window.setInterval(maybeRefreshMorningState, 30_000);
    return () => window.clearInterval(interval);
  }, [loadBrief, selectedDate]);

  useEffect(() => {
    latestLiveUpdates.current = brief?.liveUpdates ?? [];
  }, [brief?.liveUpdates]);

  useEffect(() => {
    const updates = brief?.liveUpdates ?? [];
    const ids = new Set(updates.map((update) => update.id));
    const hadBaseline = knownUpdateIds.current.size > 0;
    const matchingNewUpdates = alertableNewLiveUpdatesCompiled(updates, knownUpdateIds.current, compiledLiveUpdateFilters);
    if (alertArmed && hadBaseline && matchingNewUpdates.length) {
      playLiveUpdateAlerts(audioContext, matchingNewUpdates.length);
      void triggerLiveUpdateDesktopAlertBatch(matchingNewUpdates, compiledLiveUpdateFilters, triggerLiveUpdateDesktopAlert);
    }
    knownUpdateIds.current = ids;
  }, [alertArmed, brief?.liveUpdates, compiledLiveUpdateFilters]);

  useEffect(() => {
    notifiedCalendarEventIds.current.clear();
    setCalendarAlertPopup(null);
  }, [selectedDate]);

  useEffect(() => {
    if (!calendarAlertsArmed) {
      return;
    }
    const interval = window.setInterval(() => setCalendarClockTick(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [calendarAlertsArmed]);

  const dateBrief = brief?.date === selectedDate ? brief : null;
  const dateSources = dateBrief?.sources ?? [];
  const dateAiNotes = aiNotes?.date === selectedDate ? aiNotes : null;
  const calendarEvents = dateBrief?.combinedEvents ?? [];
  const nextCalendarAlert = useMemo(
    () => nextCalendarAlertTarget(calendarEvents, new Date(calendarClockTick)),
    [calendarClockTick, calendarEvents],
  );
  const calendarAlertStatus = calendarAlertsArmed
    ? formatCalendarAlertStatus(nextCalendarAlert)
    : "Arm calendar alerts to get a sound and popup 1 minute before timed events.";

  const fireCalendarAlert = useCallback(
    (target: CalendarAlertTarget) => {
      playCalendarAlert(audioContext);
      setCalendarAlertPopup({ event: target.event, eventAt: target.eventAt, firedAt: new Date() });
      void showWindowsCalendarAlert(target.event, target.eventAt);
      showBrowserNotification(target.event, target.eventAt);
    },
    [],
  );

  useEffect(() => {
    calendarTimers.current.forEach((timer) => window.clearTimeout(timer));
    calendarTimers.current = [];
    if (!calendarAlertsArmed || !calendarEvents.length) {
      return;
    }
    const targets = calendarAlertTargets(calendarEvents, new Date(calendarClockTick));
    for (const target of targets) {
      if (notifiedCalendarEventIds.current.has(target.event.id)) {
        continue;
      }
      const timer = window.setTimeout(() => {
        if (notifiedCalendarEventIds.current.has(target.event.id)) {
          return;
        }
        notifiedCalendarEventIds.current.add(target.event.id);
        fireCalendarAlert(target);
        setCalendarClockTick(Date.now());
      }, Math.min(target.millisUntilAlert, 2_147_483_647));
      calendarTimers.current.push(timer);
    }
    return () => {
      calendarTimers.current.forEach((timer) => window.clearTimeout(timer));
      calendarTimers.current = [];
    };
  }, [calendarAlertsArmed, calendarClockTick, calendarEvents, fireCalendarAlert]);

  const toggleCalendarAlerts = useCallback(() => {
    const next = !calendarAlertsArmed;
    setCalendarClockTick(Date.now());
    setCalendarAlertsArmed(next);
    if (next) {
      playAlert(audioContext);
      void requestBrowserNotificationPermission();
    } else {
      setCalendarAlertPopup(null);
    }
  }, [calendarAlertsArmed]);

  const signalFrame = useMemo(() => latestSpreadFrame(spreadSpeed), [spreadSpeed]);
  const estimatorPick = signalFrame?.recommendCcs ?? signalFrame?.recommendPcs ?? null;
  const liveSourceCounts = useMemo(() => countLiveUpdateSources(brief?.liveUpdates ?? []), [brief?.liveUpdates]);

  return (
    <section className="morning-shell" aria-label="Morning cockpit">
      {screen !== "heatmap" && (
        <div className="morning-hero">
          <div>
            <h2>{selectedDate}</h2>
          </div>
          <div className="morning-actions">
            <button className="version-refresh-button" disabled={loading} onClick={() => void loadBrief(undefined, { refresh: true })} type="button">
              <RefreshCcw size={14} />
              {loading ? "Refreshing" : "Refresh Morning"}
            </button>
          </div>
        </div>
      )}

      <div className="morning-screen-tabs" role="tablist" aria-label="Morning screen">
        <button
          className={screen === "brief" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={screen === "brief"}
          onClick={() => setScreen("brief")}
        >
          Brief
        </button>
        <button
          className={screen === "signal" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={screen === "signal"}
          onClick={() => setScreen("signal")}
        >
          Signal Stack
        </button>
        <button
          className={screen === "estimator" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={screen === "estimator"}
          onClick={() => setScreen("estimator")}
        >
          Estimator
        </button>
        <button
          className={screen === "heatmap" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={screen === "heatmap"}
          onClick={() => setScreen("heatmap")}
        >
          Heatmap
        </button>
      </div>

      {screen === "brief" && <MorningSourceStrip sources={dateSources} error={error} loading={loading} />}

      {screen === "brief" ? (
        <div className="morning-grid">
          <MorningAgendaSection
            alertsArmed={calendarAlertsArmed}
            alertStatus={calendarAlertStatus}
            events={dateBrief?.combinedEvents ?? []}
            macroSource={sourceByLabel(dateSources, "US macro")}
            majorEvents={dateBrief?.majorEvents ?? []}
            majorEventsSource={sourceByLabel(dateSources, "Major events")}
            onToggleAlerts={toggleCalendarAlerts}
            rollcallSource={sourceByLabel(dateSources, "RollCall")}
          />

          <section className="morning-panel morning-live-panel">
            <MorningPanelHeading icon={<Radio size={16} />} label="Live Updates" title="Market tape" />
            <div className="morning-live-actions">
              <div className="morning-live-action-buttons">
                <button
                  className="morning-alert-button"
                  disabled={liveUpdatesRefreshing}
                  onClick={() => void refreshLiveUpdates()}
                  type="button"
                >
                  <RefreshCcw size={15} />
                  {liveUpdatesRefreshing ? "Refreshing" : "Refresh Live"}
                </button>
                <button
                  className={`morning-alert-button ${alertArmed ? "active" : ""}`}
                  onClick={() => {
                    const next = !alertArmed;
                    setAlertArmed(next);
                    if (next && liveUpdateFilters.length) {
                      playAlert(audioContext);
                    }
                  }}
                  type="button"
                >
                  {alertArmed ? <BellRing size={15} /> : <Bell size={15} />}
                  {alertArmed ? "Alert Armed" : "Arm Alert"}
                </button>
              </div>
              <span>{liveUpdateSourceSummary(liveSourceCounts)}</span>
            </div>
            <div className="morning-live-refresh-status" aria-live="polite">
              {liveUpdatesRefreshMessage ||
                (liveUpdatesCheckedAt
                  ? `Checked ${formatLiveRefreshTime(liveUpdatesCheckedAt)}.`
                  : "Live feed checks every 10 seconds.")}
            </div>
            <GodelBridgeControls
              bridge={godelBridge}
              bridgeMessage={godelBridgeMessage}
              onRefresh={() => {
                void loadGodelBridge();
              }}
            />
            <div className="morning-live-filter">
              <label htmlFor="live-update-word-filter">Word filter</label>
              <textarea
                aria-label="Live update word filter"
                id="live-update-word-filter"
                onChange={(event) => setLiveUpdateFilterText(event.target.value)}
                placeholder="word 1, word 2"
                rows={2}
                value={liveUpdateFilterText}
              />
              <div className="morning-live-filter-terms">
                {liveUpdateFilters.length ? (
                  liveUpdateFilters.slice(0, 8).map((term) => <span key={term}>{term}</span>)
                ) : (
                  <span>No alert terms</span>
                )}
              </div>
            </div>
            <LiveUpdateList filters={compiledLiveUpdateFilters} updates={brief?.liveUpdates ?? []} />
          </section>

          <section className="morning-panel morning-holdings-panel">
            <MorningPanelHeading icon={<BriefcaseBusiness size={16} />} label="IBKR" title="Open positions" />
            <div className="morning-holdings-top">
              <button
                aria-label={holdingsLoading ? "Refreshing IBKR holdings" : "Refresh IBKR holdings"}
                className="morning-alert-button"
                disabled={holdingsLoading}
                onClick={() => void refreshHoldings()}
                title={holdingsLoading ? "Refreshing IBKR holdings" : "Refresh IBKR holdings"}
                type="button"
              >
                <RefreshCcw size={15} />
                <span className="morning-holdings-refresh-label">{holdingsLoading ? "Refreshing" : "Refresh Holdings"}</span>
              </button>
            </div>
            {holdingsMessage && <div className="morning-holdings-message">{holdingsMessage}</div>}
            <HoldingsList snapshot={holdings} todayYmd={selectedDate.replace(/-/g, "")} />
          </section>

          <section className="morning-panel morning-ainotes-panel">
            <MorningPanelHeading icon={<Sparkles size={16} />} label="AI Notes" title="Codex automation diary notes" />
            <AiNotesPanel error={aiNotesError} notes={dateAiNotes} />
          </section>

          <section className="morning-panel morning-tc2000-panel">
            <MorningPanelHeading icon={<Newspaper size={16} />} label="TC2000" title="" />
            <Tc2000Preview brief={dateBrief} />
          </section>
        </div>
      ) : screen === "signal" ? (
        <SignalStackSection
          selectedDate={selectedDate}
          signalFrame={signalFrame}
          targetNetDelta={spreadSpeed?.targetNetDelta ?? 0.05}
        />
      ) : screen === "heatmap" ? (
        <SpxHeatmapPanel />
      ) : (
        <section className="morning-panel morning-estimator-panel">
          <MorningPanelHeading icon={<Sparkles size={16} />} label="Estimator" title="0DTE SPX spread estimator" />
          <LiveSpreadEstimatorPanel
            holdings={holdings}
            todayEt={selectedDate}
            refreshing={holdingsLoading}
            onRefresh={() => void refreshHoldings()}
            live={estimatorLive}
            trades={trades ?? []}
            spxBars={spxLiveBars && spxLiveBars.bars.length > 0 ? spxLiveBars.bars : replay?.spxBars ?? []}
            spxBarsLive={Boolean(spxLiveBars && spxLiveBars.bars.length > 0)}
            spxFeed={{
              status: spxBarsStatus,
              busy: spxFeedBusy,
              onStart: () => runSpxFeedAction(startSpxLiveBars),
              onStop: () => runSpxFeedAction(stopSpxLiveBars),
            }}
          />
          <details className="morning-estimator-custom" style={{ marginTop: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#9ca3af" }}>Custom spread (what-if)</summary>
            <p className="morning-muted" style={{ marginTop: 8 }}>
              How a 5-wide 0DTE credit spread's price moves as SPX travels toward a level — self-calibrated from the current credit, prefilled from the recommended spread when a session frame is available.
            </p>
            <SpreadResponsePanel
              defaultSpot={signalFrame?.spot ?? null}
              currentLabel={signalFrame?.label}
              seedSide={signalFrame?.recommendCcs ? "call_credit" : signalFrame?.recommendPcs ? "put_credit" : undefined}
              seedShortStrike={estimatorPick?.shortStrike}
              seedWidth={estimatorPick ? Math.abs(estimatorPick.longStrike - estimatorPick.shortStrike) : undefined}
              seedCredit={estimatorPick?.value ?? undefined}
            />
          </details>
        </section>
      )}

      {calendarAlertPopup && (
        <CalendarAlertOverlay alert={calendarAlertPopup} onDismiss={() => setCalendarAlertPopup(null)} />
      )}
    </section>
  );
}

function SignalStackSection({
  selectedDate,
  signalFrame,
  targetNetDelta,
}: {
  selectedDate: string;
  signalFrame: SpreadSpeedFrame | null;
  targetNetDelta: number;
}) {
  return (
    <section className="morning-panel morning-signal-panel">
      <MorningPanelHeading icon={<Target size={16} />} label="Signal Stack" title="Recommended spread and FPL" />
      <div className="morning-signal-grid">
        <RecommendedSpreadCard side="PCS" pick={signalFrame?.recommendPcs ?? null} frame={signalFrame} />
        <RecommendedSpreadCard side="CCS" pick={signalFrame?.recommendCcs ?? null} frame={signalFrame} />
      </div>
      <p className="morning-muted">
        Net-delta target {targetNetDelta}; using the newest available frame from the selected session.
      </p>
      <div className="morning-fpl-wrap">
        <FplIndicatorPanel key={selectedDate} initialDate={selectedDate} />
      </div>
    </section>
  );
}

function MorningPanelHeading({ icon, label, title }: { icon: ReactNode; label: string; title: string }) {
  return (
    <div className="morning-panel-heading">
      <span>
        {icon}
        {label}
      </span>
      {title && <h3>{title}</h3>}
    </div>
  );
}

function GodelBridgeControls({
  bridge,
  bridgeMessage,
  onRefresh,
}: {
  bridge: GodelAlertBridgeStatus | null;
  bridgeMessage: string;
  onRefresh: () => void;
}) {
  const latest = bridge?.lastAlert?.headline ?? bridge?.lastRejected?.text ?? null;
  const statusMessage = cleanGodelBridgeMessage(bridgeMessage || bridge?.message || "");
  return (
    <div className="godel-bridge-card">
      <div className="godel-bridge-top">
        <div className="godel-bridge-signal">
          <span aria-hidden="true" />
          <strong>DOM bridge</strong>
          <small>{bridge ? `${bridge.validCount} captured` : "Status pending"}</small>
        </div>
        <div className="godel-bridge-actions">
          <a
            className="morning-alert-button"
            href={bridge?.setupUrl ?? "/api/godel-alert-bridge/setup"}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink size={14} />
            Setup
          </a>
          <button
            aria-label="Refresh bridge status"
            className="morning-icon-button"
            onClick={onRefresh}
            title="Refresh status"
            type="button"
          >
            <RefreshCcw size={14} />
          </button>
        </div>
      </div>
      {statusMessage && <p>{statusMessage}</p>}
      <div className="godel-bridge-meta">
        <span>Minimized-safe capture</span>
        {bridge?.lastAlert?.publishedAt && <span>{formatLiveRefreshTime(bridge.lastAlert.publishedAt)}</span>}
        {latest && <span>{latest}</span>}
      </div>
    </div>
  );
}

function cleanGodelBridgeMessage(message: string): string {
  return /RUBICON_GODEL_NEWS_URL|godel:scrape|capture-godel-news/i.test(message) ? "" : message;
}

function MorningSourceStrip({ sources, error, loading }: { sources: MorningBriefSource[]; error: string | null; loading: boolean }) {
  const visibleSources = sources.filter((source) => source.status !== "ok");
  if (!loading && !error && visibleSources.length === 0) {
    return null;
  }
  return (
    <div className="morning-source-strip" aria-live="polite">
      {loading && <span className="morning-source-pill loading">Refreshing morning sources</span>}
      {error && (
        <span className="morning-source-pill error">
          <AlertTriangle size={13} />
          {error}
        </span>
      )}
      {visibleSources.map((source) => (
        <span className={`morning-source-pill ${source.status}`} key={source.label} title={source.detail}>
          {source.label}
        </span>
      ))}
    </div>
  );
}

export function MorningAgendaSection({
  alertsArmed,
  alertStatus,
  events,
  macroSource,
  majorEvents,
  majorEventsSource,
  onToggleAlerts,
  rollcallSource,
}: {
  alertsArmed: boolean;
  alertStatus: string;
  events: MorningCalendarEvent[];
  macroSource?: MorningBriefSource;
  majorEvents: MorningMajorEvent[];
  majorEventsSource?: MorningBriefSource;
  onToggleAlerts: () => void;
  rollcallSource?: MorningBriefSource;
}) {
  return (
    <section className="morning-panel morning-calendar-panel">
      <div className="morning-calendar-topline">
        <MorningPanelHeading icon={<CalendarDays size={16} />} label="Calendar" title="" />
        <button
          className={`morning-alert-button calendar ${alertsArmed ? "active" : ""}`}
          onClick={onToggleAlerts}
          type="button"
        >
          {alertsArmed ? <BellRing size={15} /> : <Bell size={15} />}
          {alertsArmed ? "Calendar Alerts Armed" : "Arm Calendar Alerts"}
        </button>
      </div>
      <div className={`morning-calendar-alert-status ${alertsArmed ? "active" : ""}`}>{alertStatus}</div>
      <div className="morning-calendar-sources">
        <SourceDot source={macroSource} />
        <SourceDot source={majorEventsSource} />
        <SourceDot source={rollcallSource} />
      </div>
      <div className="morning-calendar-body">
        <div className="morning-event-list">
          {events.length ? (
            events.map((event) => <CalendarEventRow event={event} key={event.id} />)
          ) : (
            <div className="review-empty">No calendar events for this date.</div>
          )}
        </div>
        <MajorEventsOutlook events={majorEvents} />
      </div>
    </section>
  );
}

function CalendarEventRow({ event }: { event: MorningCalendarEvent }) {
  return (
    <a className="morning-event-row" href={event.url} rel="noreferrer" target="_blank">
      <span className="morning-event-time">{event.timeLabel}</span>
      <span className={`morning-event-impact ${event.impact ?? "unknown"}`}>{event.impact ?? event.source}</span>
      <span className="morning-event-copy">
        <strong>{event.title}</strong>
      </span>
      <ExternalLink size={13} />
    </a>
  );
}

function MajorEventsOutlook({ events }: { events: MorningMajorEvent[] }) {
  const thisWeek = events.filter((event) => event.window === "thisWeek");
  const nextWeek = events.filter((event) => event.window === "nextWeek");
  return (
    <div className="morning-major-events" aria-label="Major events this week and next week">
      <div className="morning-major-events-top">
        <strong>High-importance events</strong>
        <span>This week + next week</span>
      </div>
      {events.length ? (
        <div className="morning-major-events-grid">
          <MajorEventGroup label="This week" events={thisWeek} />
          <MajorEventGroup label="Next week" events={nextWeek} />
        </div>
      ) : (
        <div className="review-empty">No high-importance dates or OPEX markers found in the two-week window.</div>
      )}
    </div>
  );
}

function MajorEventGroup({ events, label }: { events: MorningMajorEvent[]; label: string }) {
  return (
    <div className="morning-major-event-group">
      <span className="morning-major-event-group-label">{label}</span>
      {events.length ? (
        events.map((event) => <MajorEventRow event={event} key={event.id} />)
      ) : (
        <small className="morning-major-empty">No major markers.</small>
      )}
    </div>
  );
}

function MajorEventRow({ event }: { event: MorningMajorEvent }) {
  const content = (
    <>
      <span className="morning-major-date">{formatMajorEventDate(event.date)}</span>
      <span className={`morning-major-kind ${event.kind}`}>{event.kind.toUpperCase()}</span>
      <span className="morning-major-copy">
        <strong>{event.title}</strong>
      </span>
    </>
  );
  return event.url ? (
    <a className="morning-major-event-row" href={event.url} rel="noreferrer" target="_blank" title={event.detail}>
      {content}
    </a>
  ) : (
    <div className="morning-major-event-row" title={event.detail}>
      {content}
    </div>
  );
}

function CalendarAlertOverlay({ alert, onDismiss }: { alert: CalendarAlertPopup; onDismiss: () => void }) {
  return (
    <div className="calendar-alert-overlay" role="alertdialog" aria-label="Calendar event alert" aria-live="assertive">
      <div className="calendar-alert-card">
        <span>Starts in 1 minute</span>
        <strong>{alert.event.title}</strong>
        <small>
          {alert.event.timeLabel}
          {alert.event.location ? ` - ${alert.event.location}` : ""}
        </small>
        <button className="review-action-button" onClick={onDismiss} type="button">
          Dismiss
        </button>
      </div>
    </div>
  );
}

function AiNotesPanel({ error, notes }: { error: string; notes: MorningAiNotesPayload | null }) {
  if (error) {
    return <div className="review-empty">AI notes automation status could not be loaded: {error}</div>;
  }
  if (!notes) {
    return <div className="review-empty">Checking Codex automation notes...</div>;
  }

  return (
    <div className="morning-ai-notes">
      <div className={`morning-diary-card ${notes.source === "codex_automation" ? "available" : ""}`}>
        <span>{notes.generatedAt ? `Generated ${formatAutomationTime(notes.generatedAt)}` : "Automation pending"}</span>
        <strong>{notes.source === "codex_automation" ? "Codex notes" : "Waiting on Codex automation"}</strong>
      </div>
      <AiNoteBlock block={notes.previousDay} />
      <AiNoteBlock block={notes.previousWeek} />
    </div>
  );
}

function AiNoteBlock({ block }: { block: MorningAiNotesBlock }) {
  return (
    <section className={`morning-ai-note-block ${block.available ? "available" : ""}`}>
      <div>
        <strong>{block.label}</strong>
        <span>{block.dateRange}</span>
      </div>
      <ul className="morning-bullet-list">
        {block.bullets.slice(0, 5).map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </section>
  );
}

function LiveUpdateList({ filters, updates }: { filters: CompiledLiveUpdateFilter[]; updates: MorningLiveUpdate[] }) {
  const visibleUpdates = useMemo(
    () =>
      updates.slice(0, 10).map((update) => {
        const matches = matchingCompiledFiltersFromText(liveUpdateSearchText(update), filters).map((filter) => filter.term);
        return {
          displayText: formatLiveUpdateDisplayText(update.text),
          isMatch: matches.length > 0,
          matches,
          metaLabel: liveUpdateMetaLabel(update),
          update,
        };
      }),
    [filters, updates],
  );

  if (!updates.length) {
    return <div className="review-empty">No live updates were pulled yet.</div>;
  }
  return (
    <div className="morning-live-list">
      {visibleUpdates.map(({ displayText, isMatch, matches, metaLabel, update }) => {
        return (
          <a
            className={`morning-live-row ${isMatch ? "filter-match" : ""}`}
            href={update.url}
            key={update.id}
            rel="noreferrer"
            target="_blank"
            title={isMatch ? `Matches: ${matches.join(", ")}` : undefined}
          >
            <span className="morning-live-time">{update.timeLabel}</span>
            <span className="morning-live-copy">
              <span className="morning-live-meta-line">
                <small className={`morning-live-source ${update.source.toLowerCase()}`}>{update.source}</small>
                {metaLabel && <small>{metaLabel}</small>}
              </span>
              <strong>{displayText}</strong>
              {isMatch && <small className="morning-live-match-label">Matched {matches.join(", ")}</small>}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function liveUpdateMetaLabel(update: MorningLiveUpdate): string | null {
  if (update.kind === "repost") {
    return [
      `Repost by ${update.repostedBy ?? `@${update.trackedAccount ?? update.source}`}`,
      update.originalAuthor ? `from ${update.originalAuthor}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (update.kind === "reply") {
    return `Reply to ${update.replyTo ?? "thread"}`;
  }
  return update.author && update.author !== `@${update.trackedAccount}` ? update.author : null;
}

function isSpxZeroDte(position: IbkrHoldingPosition, todayYmd: string): boolean {
  if (position.securityType !== "OPT") {
    return false;
  }
  const isSpx = position.symbol === "SPX" || position.tradingClass === "SPXW" || position.tradingClass === "SPX";
  if (!isSpx) {
    return false;
  }
  const expiration = (position.expiration ?? "").replace(/-/g, "");
  return expiration.length === 8 && expiration === todayYmd;
}

function HoldingsList({ snapshot, todayYmd }: { snapshot: IbkrHoldingsSnapshot | null; todayYmd: string }) {
  if (!snapshot || snapshot.status !== "ok") {
    return <div className="review-empty">Live holdings will appear after the next IBKR pull.</div>;
  }
  // Exclude SPX 0DTE option legs (e.g. SPXW spreads expiring today) from the
  // holdings panel — they are tracked separately and otherwise flood this list.
  const positions = snapshot.positions.filter((position) => !isSpxZeroDte(position, todayYmd));
  if (!positions.length) {
    return <div className="review-empty">No open IBKR positions were reported.</div>;
  }

  return (
    <div className="morning-holdings-list">
      {positions.slice(0, 12).map((position) => (
        <HoldingRow key={`${position.account}-${position.localSymbol}-${position.position}`} position={position} />
      ))}
    </div>
  );
}

function HoldingRow({ position }: { position: IbkrHoldingPosition }) {
  const contractParts = [
    position.securityType,
    position.expiration ? formatExpiration(position.expiration) : null,
    position.right && position.strike !== null ? `${formatNumber(position.strike)}${position.right}` : null,
  ].filter(Boolean);
  const markPrice = holdingMarkPrice(position);
  const avgPremium = holdingAveragePremium(position);
  const currentValue = holdingCurrentValue(position, markPrice);
  const costBasis = holdingCostBasis(position);
  const earnings = position.earnings ?? null;
  const greeksSource = greeksSourceLabel(position.greeksSource, position.manualGreeksStatus);
  const shareEquivalentDelta = holdingShareEquivalentDelta(position);
  const greekParts = [
    isFiniteNumber(position.delta) ? `Delta ${formatNumber(position.delta, 2)}/ct` : null,
    shareEquivalentDelta !== null ? `Share eq ${formatSignedNumber(shareEquivalentDelta)}` : null,
    isFiniteNumber(position.positionTheta)
      ? `Theta ${formatSignedCurrency(position.positionTheta)}/day`
      : isFiniteNumber(position.theta)
        ? `Theta/ct ${formatNumber(position.theta, 2)}`
        : null,
    greeksSource,
  ].filter(Boolean);
  const markParts = [
    markPrice !== null ? `Mark ${formatCurrency(markPrice, 2)}` : `Mark ${marketDataStatusLabel(position.marketDataStatus)}`,
    avgPremium !== null ? `Avg ${formatCurrency(avgPremium, 2)}` : null,
  ].filter(Boolean);
  return (
    <div className="morning-holding-row">
      <span className={position.position > 0 ? "long" : "short"}>{formatSignedNumber(position.position)}</span>
      <div className="morning-holding-copy">
        <div className="morning-holding-title">
          <strong>{position.localSymbol || position.symbol}</strong>
          {earnings && (
            <span
              className={`morning-earnings-warning ${earnings.warning}`}
              title={earningsWarningTitle(earnings, position.symbol)}
            >
              !
            </span>
          )}
        </div>
        <small>{contractParts.join(" - ") || position.exchange || position.currency || "IBKR position"}</small>
        <small className="morning-holding-mark-line">{markParts.join(" | ")}</small>
        {greekParts.length > 0 && <small className="morning-holding-greeks">{greekParts.join(" | ")}</small>}
      </div>
      <div className="morning-holding-price">
        <em>{currentValue === null ? "Value -" : formatCurrency(currentValue)}</em>
        {costBasis !== null && <small>Cost {formatCurrency(costBasis)}</small>}
        {isFiniteNumber(position.unrealizedPnl) && (
          <small className={position.unrealizedPnl >= 0 ? "morning-holding-pnl positive" : "morning-holding-pnl negative"}>
            P/L {formatSignedCurrency(position.unrealizedPnl)}
          </small>
        )}
      </div>
    </div>
  );
}

function marketDataStatusLabel(status: string | undefined): string {
  if (!status) {
    return "pending";
  }
  if (status.startsWith("ok:")) {
    return status.slice(3).replace(/_/g, " ");
  }
  if (status.startsWith("no_ticks")) {
    return "no ticks";
  }
  return status.replace(/_/g, " ");
}

function greeksSourceLabel(source: string | undefined, status: string | undefined): string | null {
  if (source === "manual_black_scholes") {
    return "calc";
  }
  if (source?.startsWith("ibkr_")) {
    return "IBKR";
  }
  if (status?.startsWith("missing_")) {
    return "Greek calc pending";
  }
  return null;
}

function earningsWarningTitle(event: IbkrHoldingEarningsEvent, symbol: string): string {
  const dayLabel = event.daysUntil === 0 ? "today" : event.daysUntil === 1 ? "tomorrow" : `in ${event.daysUntil} days`;
  const timeLabel = earningsTimeLabel(event.time);
  const company = event.name || symbol;
  const eps = event.epsForecast ? `, EPS est. ${event.epsForecast}` : "";
  return `${company} earnings ${event.date}${timeLabel ? ` ${timeLabel}` : ""} (${dayLabel})${eps}.`;
}

function earningsTimeLabel(time: string | undefined): string {
  if (time === "after-close") return "after close";
  if (time === "before-open") return "before open";
  if (time === "not-supplied") return "time not supplied";
  return time ?? "";
}

function RecommendedSpreadCard({
  frame,
  pick,
  side,
}: {
  frame: SpreadSpeedFrame | null | undefined;
  pick: SpreadSpeedPick;
  side: "PCS" | "CCS";
}) {
  return (
    <div className={`morning-rec-card ${side.toLowerCase()} ${pick ? "recommended" : ""}`}>
      <div className="morning-rec-card-top">
        <span>{side === "PCS" ? "Put credit spread" : "Call credit spread"}</span>
        {pick && <b>Recommended</b>}
      </div>
      {pick ? (
        <>
          <strong>{pick.shortStrike}/{pick.longStrike}</strong>
          <small>
            ${pick.dollarPerPoint}/pt - delta {pick.netDelta.toFixed(3)} - {pick.regime}
          </small>
          {pick.value != null && <em>Mark ${pick.value.toFixed(2)}</em>}
          {frame && <small>{frame.label} - SPX {formatNumber(frame.spot)} - EM {formatNumber(frame.em)}pt</small>}
        </>
      ) : (
        <>
          <strong>No live pick</strong>
          <small>{frame ? "No OTM spread met the frame rules." : "Spread-speed data is unavailable."}</small>
        </>
      )}
    </div>
  );
}

export function Tc2000Preview({ brief }: { brief: MorningBriefPayload | null }) {
  const tc2000 = brief?.tc2000;
  if (!tc2000) {
    return <div className="review-empty">TC2000 pull status will appear after Morning refreshes.</div>;
  }
  const screeners =
    tc2000.screeners?.length > 0
      ? tc2000.screeners
      : tc2000.symbols.length
        ? [
            {
              name: tc2000.screenerName ?? "TC2000 screener",
              newSymbols: tc2000.newSymbols ?? [],
              source: "ocr" as const,
              symbols: tc2000.symbols,
            },
          ]
        : [];
  return (
    <div className="morning-tc2000-content">
      <div className="morning-tc2000-meta">
        {screeners.length ? (
          <div className="morning-tc2000-screeners">
            {screeners.map((screener) => (
              <Tc2000ScreenerCard
                dailyBars={tc2000.dailyBars}
                key={`${screener.name}-${screener.symbols.join("-")}`}
                profiles={tc2000.profiles}
                screener={screener}
              />
            ))}
          </div>
        ) : (
          <div className="review-empty">No hits were found in the latest OCR pull.</div>
        )}
      </div>
    </div>
  );
}

function Tc2000ScreenerCard({
  dailyBars,
  profiles,
  screener,
}: {
  dailyBars: Record<string, MorningDailyBar[]>;
  profiles: Record<string, MorningCompanyProfile>;
  screener: MorningTc2000Screener;
}) {
  const newSymbols = new Set((screener.newSymbols ?? []).map((symbol) => symbol.toUpperCase()));
  return (
    <section className="morning-tc2000-screener-card">
      <div className="morning-tc2000-screener-head">
        <div>
          <strong>{screener.name}</strong>
        </div>
        <em>{screener.source.toUpperCase()}</em>
      </div>
      <div className="morning-symbol-strip">
        {screener.symbols.slice(0, 24).map((symbol) => (
          <SymbolChipWithPreview bars={dailyBars[symbol] ?? []} isNew={newSymbols.has(symbol.toUpperCase())} key={symbol} profile={profiles[symbol]} symbol={symbol} />
        ))}
      </div>
    </section>
  );
}

function SymbolChipWithPreview({
  bars,
  isNew,
  profile,
  symbol,
}: {
  bars: MorningDailyBar[];
  isNew?: boolean;
  profile?: MorningCompanyProfile;
  symbol: string;
}) {
  return (
    <span className="morning-symbol-chip-wrap">
      <button
        aria-label={isNew ? `${symbol} new vs prior scanner list` : `${symbol} scanner symbol`}
        className={`morning-symbol-chip ${bars.length ? "ready" : "pending"}${isNew ? " new" : ""}`}
        title={isNew ? `${symbol} is new vs the prior scanner list.` : `${symbol} daily chart preview`}
        type="button"
      >
        {symbol}
      </button>
      <div className="morning-symbol-chart-popover" role="tooltip">
        <MiniDailyChart bars={bars} profile={profile} symbol={symbol} />
      </div>
    </span>
  );
}

function MiniDailyChart({
  bars,
  profile,
  symbol,
}: {
  bars: MorningDailyBar[];
  profile?: MorningCompanyProfile;
  symbol: string;
}) {
  const visible = bars.slice(-50);
  if (visible.length < 2) {
    return (
      <div className="morning-mini-chart empty">
        <strong>{symbol} 1D</strong>
        <span>Chart preview pending.</span>
        <CompanyProfileBlurb profile={profile} symbol={symbol} />
      </div>
    );
  }

  const width = 300;
  const height = 178;
  const padTop = 28;
  const padRight = 42;
  const padBottom = 24;
  const padLeft = 10;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const minPrice = Math.min(...visible.map((bar) => bar.low));
  const maxPrice = Math.max(...visible.map((bar) => bar.high));
  const range = Math.max(0.01, maxPrice - minPrice);
  const paddedMin = minPrice - range * 0.08;
  const paddedMax = maxPrice + range * 0.08;
  const yFor = (price: number) => padTop + ((paddedMax - price) / (paddedMax - paddedMin)) * plotHeight;
  const xFor = (index: number) => padLeft + (index / Math.max(1, visible.length - 1)) * plotWidth;
  const candleWidth = Math.max(3, Math.min(7, (plotWidth / visible.length) * 0.58));
  const last = visible[visible.length - 1];
  const first = visible[0];
  const movePct = ((last.close - first.close) / first.close) * 100;
  const lastLabel = `${formatCurrency(last.close, 2)} ${movePct >= 0 ? "+" : ""}${movePct.toFixed(1)}%`;
  const priceTicks = [paddedMax, (paddedMax + paddedMin) / 2, paddedMin];

  return (
    <div className="morning-mini-chart">
      <div className="morning-mini-chart-head">
        <strong>{symbol} 1D</strong>
        <span>{lastLabel}</span>
      </div>
      <svg aria-label={`${symbol} daily chart`} height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
        <rect className="mini-chart-bg" height={height} width={width} x="0" y="0" />
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            className="mini-chart-grid"
            key={ratio}
            x1={padLeft}
            x2={width - padRight}
            y1={padTop + plotHeight * ratio}
            y2={padTop + plotHeight * ratio}
          />
        ))}
        {visible.map((bar, index) => {
          const x = xFor(index);
          const isUp = bar.close >= bar.open;
          const openY = yFor(bar.open);
          const closeY = yFor(bar.close);
          const bodyTop = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(closeY - openY));
          return (
            <g className={isUp ? "up" : "down"} key={`${bar.date}-${index}`}>
              <line className="mini-chart-wick" x1={x} x2={x} y1={yFor(bar.high)} y2={yFor(bar.low)} />
              <rect
                className="mini-chart-body"
                height={bodyHeight}
                rx="1"
                width={candleWidth}
                x={x - candleWidth / 2}
                y={bodyTop}
              />
            </g>
          );
        })}
        {priceTicks.map((price) => (
          <text className="mini-chart-axis" key={price} x={width - padRight + 7} y={yFor(price) + 3}>
            {price.toFixed(price >= 100 ? 0 : 2)}
          </text>
        ))}
        <text className="mini-chart-date start" x={padLeft} y={height - 6}>
          {formatShortDate(visible[0].date)}
        </text>
        <text className="mini-chart-date end" x={width - padRight} y={height - 6}>
          {formatShortDate(last.date)}
        </text>
      </svg>
      <CompanyProfileBlurb profile={profile} symbol={symbol} />
    </div>
  );
}

function CompanyProfileBlurb({ profile, symbol }: { profile?: MorningCompanyProfile; symbol: string }) {
  const description =
    profile?.description ||
    (profile?.name
      ? `${profile.name} profile summary is pending from the next TC2000 daily pull.`
      : `${symbol} company profile summary is pending from the next TC2000 daily pull.`);
  return (
    <div className="morning-mini-profile">
      <span>{profile?.industry ? `Industry: ${profile.industry}` : "Industry pending"}</span>
      <p>{description}</p>
    </div>
  );
}

function SourceDot({ source }: { source?: MorningBriefSource }) {
  if (!source || source.status === "ok") {
    return null;
  }
  return (
    <div className={`morning-source-note-line ${source.status}`} title={source.detail}>
      <span />
      {source.detail}
    </div>
  );
}

function sourceByLabel(sources: MorningBriefSource[] | undefined, label: string): MorningBriefSource | undefined {
  return sources?.find((source) => source.label.toLowerCase().includes(label.toLowerCase()));
}

function formatMajorEventDate(date: string): string {
  const value = new Date(`${date}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function countLiveUpdateSources(updates: MorningLiveUpdate[]): Record<MorningLiveUpdate["source"], number> {
  return updates.reduce<Record<MorningLiveUpdate["source"], number>>(
    (counts, update) => {
      counts[update.source] += 1;
      return counts;
    },
    { FirstSquawk: 0, Godel: 0 },
  );
}

function liveUpdateSourceSummary(counts: Record<MorningLiveUpdate["source"], number>): string {
  const total = counts.FirstSquawk + counts.Godel;
  return `${formatNumber(total)} live item${total === 1 ? "" : "s"}`;
}

function liveUpdatesRefreshStatus(
  checkedAt: string,
  updates: MorningLiveUpdate[],
  newCount: number,
  payload?: MorningLiveUpdatesPayload,
): string {
  const checked = formatLiveRefreshTime(checkedAt);
  const newest = newestLiveUpdateAgeLabel(updates, checkedAt);
  const sourceIssue = payload?.sources.find((source) => source.status !== "ok")?.label;
  const sourceHint = sourceIssue ? `; ${sourceIssue} warning` : "";
  const updateText =
    newCount > 0
      ? `${formatNumber(newCount)} new post${newCount === 1 ? "" : "s"}`
      : "no new posts from the last source check";
  return `Checked ${checked} - ${updateText}; ${newest}${sourceHint}.`;
}

function newestLiveUpdateAgeLabel(updates: MorningLiveUpdate[], checkedAt: string): string {
  const checkedMs = Date.parse(checkedAt);
  const referenceMs = Number.isFinite(checkedMs) ? checkedMs : Date.now();
  const latestMs = updates
    .map((update) => (update.publishedAt ? Date.parse(update.publishedAt) : Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  if (!Number.isFinite(latestMs)) {
    return "newest timestamp unavailable";
  }
  const ageMinutes = Math.max(0, Math.round((referenceMs - latestMs) / 60_000));
  return ageMinutes <= 0 ? "newest item just now" : `newest item ${formatNumber(ageMinutes)}m old`;
}

function mergeMorningSources(current: MorningBriefSource[], next: MorningBriefSource[]): MorningBriefSource[] {
  const byLabel = new Map(current.map((source) => [source.label, source]));
  for (const source of next) {
    byLabel.set(source.label, source);
  }
  return [...byLabel.values()];
}

function latestSpreadFrame(payload: SpreadSpeedPayload | null): SpreadSpeedFrame | null {
  if (!payload?.available || !payload.frames.length) {
    return null;
  }
  return payload.frames[payload.frames.length - 1];
}

function readStoredLiveUpdateFilter(): string {
  try {
    return window.localStorage.getItem(LIVE_UPDATE_FILTER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function holdingMarkPrice(position: IbkrHoldingPosition): number | null {
  if (isPositiveNumber(position.marketPrice)) {
    return position.marketPrice;
  }
  if (isPositiveNumber(position.bid) && isPositiveNumber(position.ask)) {
    return (position.bid + position.ask) / 2;
  }
  if (isPositiveNumber(position.last)) {
    return position.last;
  }
  return null;
}

function holdingAveragePremium(position: IbkrHoldingPosition): number | null {
  if (!isFiniteNumber(position.averageCost)) {
    return null;
  }
  const multiplier = Number.parseFloat(String(position.multiplier ?? ""));
  if (position.securityType.toUpperCase() === "OPT" && Number.isFinite(multiplier) && multiplier > 1) {
    return position.averageCost / multiplier;
  }
  return position.averageCost;
}

function holdingCostBasis(position: IbkrHoldingPosition): number | null {
  if (isFiniteNumber(position.costBasis)) {
    return position.costBasis;
  }
  if (!isFiniteNumber(position.averageCost)) {
    return null;
  }
  return Math.abs(position.position * position.averageCost);
}

function holdingCurrentValue(position: IbkrHoldingPosition, markPrice: number | null): number | null {
  if (isFiniteNumber(position.currentValue)) {
    return position.currentValue;
  }
  if (markPrice === null) {
    return null;
  }
  const multiplier = holdingMultiplier(position);
  return position.position * markPrice * multiplier;
}

function holdingShareEquivalentDelta(position: IbkrHoldingPosition): number | null {
  if (isFiniteNumber(position.positionDelta)) {
    return position.positionDelta;
  }
  if (!isFiniteNumber(position.delta)) {
    return null;
  }
  return position.delta * position.position * holdingMultiplier(position);
}

function holdingMultiplier(position: IbkrHoldingPosition): number {
  const multiplier = Number.parseFloat(String(position.multiplier ?? ""));
  if (position.securityType.toUpperCase() === "OPT") {
    return Number.isFinite(multiplier) && multiplier > 1 ? multiplier : 100;
  }
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: number | null | undefined): value is number {
  return isFiniteNumber(value) && value > 0;
}

function formatAutomationTime(value: string): string {
  return formatCompactDateTime(value);
}

function formatLiveRefreshTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatCompactDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    timeZoneName: "short",
  }).format(date);
}

function formatShortDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatExpiration(value: string): string {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(4, 6)}/${value.slice(6, 8)}/${value.slice(2, 4)}`;
  }
  if (/^\d{6}$/.test(value)) {
    return `${value.slice(4, 6)}/${value.slice(2, 4)}`;
  }
  return value;
}

function formatSignedNumber(value: number, digits = 0): string {
  return value > 0 ? `+${formatNumber(value, digits)}` : formatNumber(value, digits);
}

function playAlert(audioContext: MutableRefObject<AudioContext | null>) {
  try {
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    const context = audioContext.current ?? new AudioContextCtor();
    audioContext.current = context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(1320, context.currentTime + 0.16);
    gain.gain.setValueAtTime(0.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  } catch {
    // Browser audio can be blocked by policy; the visual armed state still works.
  }
}

function playLiveUpdateAlerts(audioContext: MutableRefObject<AudioContext | null>, count: number) {
  for (let index = 0; index < count; index += 1) {
    window.setTimeout(() => playAlert(audioContext), index * 420);
  }
}

function playCalendarAlert(audioContext: MutableRefObject<AudioContext | null>) {
  playAlert(audioContext);
  window.setTimeout(() => playAlert(audioContext), 360);
}

async function requestBrowserNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }
  try {
    await Notification.requestPermission();
  } catch {
    // Browser notification permission is optional; the in-app popup and sound remain active.
  }
}

function showBrowserNotification(event: MorningCalendarEvent, eventAt: Date) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  try {
    new Notification("Rubicon calendar alert", {
      body: `${event.timeLabel} starts in 1 minute: ${event.title}`,
      tag: `rubicon-calendar-${event.id}-${eventAt.getTime()}`,
    });
  } catch {
    // Some desktop shells suppress notifications; Rubicon still renders its own popup.
  }
}

async function showWindowsCalendarAlert(event: MorningCalendarEvent, eventAt: Date) {
  try {
    await triggerCalendarDesktopAlert({
      title: "Calendar event starts in 1 minute",
      body: event.title,
      detail: [event.timeLabel, event.source, event.location, event.coverage, formatEventStart(eventAt)]
        .filter(Boolean)
        .join(" - "),
    });
  } catch {
    // The browser/in-app popup still fires if the local Windows popup helper is unavailable.
  }
}

function formatEventStart(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function isAbortLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
