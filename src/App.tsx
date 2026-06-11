// New to this codebase? Read codebase.md at the repo root first — it maps the whole project.
// NOTE: this file is ~3,000 lines / ~20 components. Grep within it; the screens live here:
// JournalScreen, DailyPullScreen, DailyReviewScreen (+ TradeTable, SourceLedger).
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleX,
  ClipboardList,
  Copy,
  Database,
  Download,
  Flag,
  Gauge,
  LogIn,
  LogOut,
  Pause,
  PencilLine,
  Play,
  RefreshCcw,
  Save,
  ShieldCheck,
  Target,
  Trash2,
} from "lucide-react";
import type { DailySummary, DailySyncStatusResult, DailySyncStepStatus, ReplayPayload, SourceHealth, SpreadMark, SpreadSpeedPayload, SpxBar, SpxLiveBarsLiveStatus, TrackerSnapshot, TradeRecord, WalletSnapshot } from "../shared/types";
import { fetchDailySyncStatus, fetchLiveSpreadSpeed, fetchLiveSpreadSpeedStatus, fetchReplay, fetchSpreadSpeed, fetchTracker, refreshGoogleSnapshot, runDailyOptionPull, runDailySync, saveTradeJournalSnapshot, startLiveSpreadSpeed, stopLiveSpreadSpeed } from "./api";
import { previousTradingSessionDate, rangePresets, tradesInRange, type RangeId } from "./dateRanges";
import { formatCurrency, formatNumber, formatPercent, formatSignedCurrency } from "./format";
import { buildDailyReview, REPLAY_SPEEDS, summarizeTrades } from "./stats";
import { buildDailyReviewStatItems } from "./dailyReviewStats";
import { reviewActionDirectionLabel } from "./dailyReviewSide";
import { buildDailyPnlSimulation, summarizeDailyPnlSimulation } from "./dailyPnlSimulator";
import { marketDateFromSnapshot, selectDateAfterTrackerRefresh } from "./refreshLogic";
import { buildQuickSpreadGroups, quickSpreadAriaLabel, quickSpreadKey, quickSpreadLabel } from "./quickTrades";
import { tradeClockLabel, tradeExitClockLabel, tradeHeldLabel } from "./tradeTime";
import { countTradesByDate, mapTradesById, selectTradeById, selectTradeByIdOrFirst, sortTradesByEntryTime, tradesForDate } from "./tradeSelectors";
import { buildDailySyncDiagnostics } from "./dailySyncDiagnostics";
import { buildDailySyncProgress, type DailySyncProgressModel } from "./dailySyncProgress";
import { buildDailySyncReadiness } from "./dailySyncReadiness";
import { buildDailySyncRunGuard } from "./dailySyncRunGuard";
import { dailySyncCompletionRefreshKey, shouldRefreshTrackerAfterDailySyncStatus } from "./dailySyncRefresh";
import { marketFreshness } from "./marketFreshness";
import { buildDateIssueIndex, type DateIssueBadge } from "./dateIssueBadges";
import { buildDailyReviewMarkdown, dailyReviewExportFilename } from "./dailyReviewExport";
import { buildUploadReceiptCheck } from "./uploadReceiptCheck";
import { buildDailyPullChecklist, type DailyPullChecklistStep, type DailyPullCoverageItem, type DailyPullStepStatus } from "./dailyPullChecklist";
import { buildDailyPullReviewModel, type DailyPullIssueBucket, type DailyPullIssueEntry, type DailyPullViewModel } from "./dailyPullReviewModel";
import { refreshToLatestVersion } from "./appRefresh";
import { AppUpdateButton } from "./components/AppUpdateButton";
import { canAttemptClipboardCopy, copyTextToClipboard } from "./clipboard";
import { coverageImpactSummary } from "./reviewImpact";
import { easternDateOffset } from "./easternDate";
import { visibleReplayDateTabs } from "./replayDateTabs";
import {
  JOURNAL_STORAGE_KEY,
  buildJournalCoverage,
  defaultJournalEntry,
  journalAspectChecklistForTrade,
  mergeJournalEntry,
  nextUnreviewedTradeId,
  parseJournalEntries,
  serializeJournalEntries,
  splitJournalTags,
  type JournalAspectKey,
  type JournalEmotion,
  type JournalGrade,
  type JournalStatus,
  type TradeJournalEntry,
} from "./tradeJournal";
import { ReplayCharts } from "./components/ReplayCharts";
import { ReviewEntryExitChart } from "./components/ReviewEntryExitChart";
import { useSpxMaContext } from "./useSpxMaContext";
import { MorningDashboard } from "./components/MorningDashboard";
import { RrgPanel } from "./components/RrgPanel";
import "./App.css";
import "./FplIndicator.css";

type AppPortion = "morning" | "replay" | "rotation";
type ViewMode = "replay" | "pull" | "review" | "journal";
type ReviewExportStatus = "idle" | "copied" | "downloaded" | "copy_unavailable";

const EMPTY_WALLET: WalletSnapshot = { netLiquidation: null, source: "not_loaded", updatedAt: null };
const AUTO_IMPORT_REFRESH_MS = 60_000;
const DAILY_SYNC_STATUS_REFRESH_MS = 60_000;
const DAILY_SYNC_RUNNING_STATUS_REFRESH_MS = 5_000;
const ACCEPTED_PULL_ISSUE_DATES_KEY = "rubicon.acceptedPullIssueDates.v1";
const REVIEW_CHART_INTERVALS = [1, 2, 5, 15, 30] as const;
type ReviewChartInterval = (typeof REVIEW_CHART_INTERVALS)[number];
const JOURNAL_EMOTIONS: JournalEmotion[] = ["Focused", "Calm", "FOMO", "Hesitant", "Impulsive"];
const JOURNAL_GRADES: JournalGrade[] = ["A", "B", "C", "D", "F"];
const JOURNAL_SETUP_OPTIONS = [
  "Opening drive fade",
  "Trend continuation",
  "Failed breakout",
  "Mean reversion",
  "News / macro reaction",
  "Late-day scalp",
  "Other",
];

function newestFirstDates(dates: string[]): string[] {
  return [...dates].sort((a, b) => b.localeCompare(a));
}

function App() {
  const [snapshot, setSnapshot] = useState<TrackerSnapshot | null>(null);
  const [replay, setReplay] = useState<ReplayPayload | null>(null);
  const [range, setRange] = useState<RangeId>("today");
  const [customDate, setCustomDate] = useState("");
  const [morningDate, setMorningDate] = useState("");
  const [morningTracksToday, setMorningTracksToday] = useState(true);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTradeId, setSelectedTradeId] = useState<string | undefined>();
  const [selectedSpreadKey, setSelectedSpreadKey] = useState<string | undefined>();
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayMode, setReplayMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [portion, setPortion] = useState<AppPortion>("morning");
  const [view, setView] = useState<ViewMode>("replay");
  const [refreshing, setRefreshing] = useState(false);
  const [googleSnapshotRefreshing, setGoogleSnapshotRefreshing] = useState(false);
  const [googleSnapshotRefreshMessage, setGoogleSnapshotRefreshMessage] = useState("");
  const [dailySyncRunning, setDailySyncRunning] = useState(false);
  const [dailySyncPreflighting, setDailySyncPreflighting] = useState(false);
  const [dailySyncMessage, setDailySyncMessage] = useState("");
  const [dailySyncStatus, setDailySyncStatus] = useState<DailySyncStatusResult | null>(null);
  const [dailyOptionRetrying, setDailyOptionRetrying] = useState(false);
  const [lastImportCheck, setLastImportCheck] = useState("");
  const [replayRefreshToken, setReplayRefreshToken] = useState(0);
  const [morningSpreadSpeed, setMorningSpreadSpeed] = useState<SpreadSpeedPayload | null>(null);
  const [morningLiveSpreadSpeed, setMorningLiveSpreadSpeed] = useState<SpreadSpeedPayload | null>(null);
  const [morningLiveStatus, setMorningLiveStatus] = useState<SpxLiveBarsLiveStatus | null>(null);
  const [morningLiveBusy, setMorningLiveBusy] = useState(false);
  const [journalEntries, setJournalEntries] = useState<Record<string, TradeJournalEntry>>(readJournalEntriesFromStorage);
  const [acceptedPullIssueDates, setAcceptedPullIssueDates] = useState<Set<string>>(readAcceptedPullIssueDatesFromStorage);
  const [journalSelectedTradeId, setJournalSelectedTradeId] = useState<string | undefined>();
  const replayIntentRef = useRef({ playing: false, replayIndex: 0, replayMode: false });
  const dailySyncCompletionRefreshKeyRef = useRef<string | null>(null);

  useEffect(() => {
    void saveTradeJournalSnapshot(journalEntries).catch((nextError: unknown) => {
      console.warn("Could not save journal snapshot for Codex automation.", nextError);
    });
  }, [journalEntries]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTracker(controller.signal)
      .then((next) => {
        const marketDate = marketDateFromSnapshot(next);
        setSnapshot(next);
        setSelectedDate(marketDate);
        setCustomDate(marketDate);
        setMorningDate(easternDateOffset(0));
        setMorningTracksToday(true);
        setLastImportCheck(formatRefreshTime());
      })
      .catch((nextError: Error) => {
        if (!isAbortLike(nextError)) {
          setError(nextError.message);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!morningTracksToday) {
      return;
    }
    const updateMorningToday = () => {
      const todayEt = easternDateOffset(0);
      setMorningDate((current) => (current === todayEt ? current : todayEt));
    };
    updateMorningToday();
    const interval = window.setInterval(updateMorningToday, 60_000);
    return () => window.clearInterval(interval);
  }, [morningTracksToday]);

  const marketToday = snapshot?.availableDates.includes(snapshot.today)
    ? snapshot.today
    : snapshot?.latestTradeDate ?? snapshot?.today ?? "";

  const visibleTrades = useMemo(
    () => tradesInRange(snapshot?.trades ?? [], range, marketToday, customDate || selectedDate || marketToday),
    [customDate, marketToday, range, selectedDate, snapshot],
  );
  const stats = useMemo(() => summarizeTrades(visibleTrades, snapshot?.wallet ?? EMPTY_WALLET), [snapshot, visibleTrades]);
  const tradesForSelectedDate = useMemo(
    () => tradesForDate(snapshot?.trades ?? [], selectedDate),
    [selectedDate, snapshot],
  );
  const selectedTrade = useMemo(
    () => selectTradeByIdOrFirst(tradesForSelectedDate, selectedTradeId),
    [selectedTradeId, tradesForSelectedDate],
  );
  const quickSpreadGroups = useMemo(() => buildQuickSpreadGroups(tradesForSelectedDate), [tradesForSelectedDate]);
  const activeSpreadKey = selectedSpreadKey ?? (selectedTrade ? quickSpreadKey(selectedTrade) : undefined);
  const selectedSpreadGroup = useMemo(
    () => quickSpreadGroups.find((group) => group.key === activeSpreadKey) ?? null,
    [activeSpreadKey, quickSpreadGroups],
  );
  const selectedChartTrades = useMemo(
    () => selectedSpreadGroup?.trades ?? (selectedTrade ? [selectedTrade] : []),
    [selectedSpreadGroup, selectedTrade],
  );
  const selectedReplayLabel = selectedSpreadGroup ? quickSpreadLabel(selectedSpreadGroup) : selectedTrade?.strategy ?? "Selected Spread";
  const selectedSummary = useMemo(
    () => snapshot?.dailySummaries.find((summary) => summary.date === selectedDate) ?? null,
    [selectedDate, snapshot],
  );
  const tradeCountsByDate = useMemo(() => countTradesByDate(snapshot?.trades ?? []), [snapshot?.trades]);
  const visibleSourceHealth = useMemo(
    () => (snapshot?.sourceHealth ?? []).filter((source) => !isIbkrWalletSource(source)),
    [snapshot?.sourceHealth],
  );
  const rawDateIssueBadges = useMemo(
    () =>
      buildDateIssueIndex(snapshot?.dailySummaries ?? [], {
        sourceHealth: visibleSourceHealth,
        tradeCountsByDate,
      }),
    [snapshot?.dailySummaries, tradeCountsByDate, visibleSourceHealth],
  );
  const dateIssueBadges = useMemo(() => {
    if (!acceptedPullIssueDates.size) {
      return rawDateIssueBadges;
    }
    const nextBadges = new Map(rawDateIssueBadges);
    for (const date of acceptedPullIssueDates) {
      nextBadges.delete(date);
    }
    return nextBadges;
  }, [acceptedPullIssueDates, rawDateIssueBadges]);
  const acceptedIssueDates = useMemo(() => {
    if (!acceptedPullIssueDates.size) {
      return new Set<string>();
    }
    const nextDates = new Set<string>();
    for (const date of acceptedPullIssueDates) {
      if (rawDateIssueBadges.has(date)) {
        nextDates.add(date);
      }
    }
    return nextDates;
  }, [acceptedPullIssueDates, rawDateIssueBadges]);
  const acceptPullDateIssues = useCallback((date: string) => {
    setAcceptedPullIssueDates((current) => {
      if (current.has(date)) {
        return current;
      }
      const next = new Set(current);
      next.add(date);
      writeAcceptedPullIssueDatesToStorage(next);
      return next;
    });
  }, []);
  const freshness = useMemo(() => (snapshot ? marketFreshness(snapshot, selectedDate) : null), [selectedDate, snapshot]);
  const dateScopedReplay = replay?.date === selectedDate ? replay : null;
  const needsReplayPayload = portion === "replay" && (view === "replay" || view === "review");

  const refreshSnapshot = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (refreshing) {
        return;
      }

      setRefreshing(true);
      if (!silent) {
        setError(null);
      }

      try {
        const next = await fetchTracker();
        const previousMarketDate = marketToday;
        const nextMarketDate = marketDateFromSnapshot(next);
        const nextSelectedDate = selectDateAfterTrackerRefresh({
          nextMarketDate,
          previousMarketDate,
          range,
          selectedDate,
        });

        setSnapshot(next);
        setSelectedDate(nextSelectedDate);
        if (nextSelectedDate !== selectedDate) {
          setCustomDate(nextSelectedDate);
        }
        setLastImportCheck(formatRefreshTime());
        setReplayRefreshToken((token) => token + 1);
      } catch (nextError) {
        if (!silent && nextError instanceof Error) {
          setError(nextError.message);
        }
      } finally {
        setRefreshing(false);
      }
    },
    [marketToday, range, refreshing, selectedDate],
  );

  useEffect(() => {
    if (!selectedTrade && tradesForSelectedDate[0]) {
      setSelectedTradeId(tradesForSelectedDate[0].id);
    }
  }, [selectedTrade, tradesForSelectedDate]);

  useEffect(() => {
    if (selectedSpreadKey && !quickSpreadGroups.some((group) => group.key === selectedSpreadKey)) {
      setSelectedSpreadKey(undefined);
    }
  }, [quickSpreadGroups, selectedSpreadKey]);

  useEffect(() => {
    replayIntentRef.current = { playing, replayIndex, replayMode };
  }, [playing, replayIndex, replayMode]);

  useEffect(() => {
    if (!selectedDate || !needsReplayPayload) {
      setReplayLoading(false);
      if (!needsReplayPayload) {
        setReplay(null);
      }
      return;
    }
    const controller = new AbortController();
    setReplayLoading(true);
    fetchReplay(selectedDate, undefined, controller.signal)
      .then((nextReplay) => {
        if (controller.signal.aborted || nextReplay.date !== selectedDate) {
          return;
        }
        const nextLastIndex = Math.max(0, nextReplay.spxBars.length - 1);
        const replayIntent = replayIntentRef.current;
        setReplay(nextReplay);
        if (replayIntent.replayMode || replayIntent.playing) {
          setReplayMode(true);
          setReplayIndex(Math.min(replayIntent.replayIndex, nextLastIndex));
          setPlaying(replayIntent.playing);
        } else {
          setReplayIndex(nextLastIndex);
          setReplayMode(false);
          setPlaying(false);
        }
      })
      .catch((nextError: Error) => {
        if (!isAbortLike(nextError)) {
          setError(nextError.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setReplayLoading(false);
        }
      });
    return () => controller.abort();
  }, [needsReplayPayload, replayRefreshToken, selectedDate]);

  useEffect(() => {
    if (!morningDate) {
      setMorningSpreadSpeed(null);
      return;
    }
    const controller = new AbortController();
    // For the live "today" view, fall back to the most recent completed session
    // when today's chain hasn't been pulled yet. Explicit past-date selections
    // stay exact so the user sees that date's stack (or its honest empty state).
    fetchSpreadSpeed(morningDate, controller.signal, { fallback: morningTracksToday })
      .then(setMorningSpreadSpeed)
      .catch((nextError: Error) => {
        if (!isAbortLike(nextError)) {
          setMorningSpreadSpeed(null);
        }
      });
    return () => controller.abort();
  }, [morningDate, morningTracksToday, replayRefreshToken]);

  // Live SPXW 0DTE Signal-Stack feed: only while tracking today. Polls the live
  // snapshot (and feed status) every 20s; when it reports `available`, the live
  // payload is preferred over the EOD fallback below.
  useEffect(() => {
    if (!morningTracksToday) {
      setMorningLiveSpreadSpeed(null);
      setMorningLiveStatus(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const poll = () => {
      fetchLiveSpreadSpeed(controller.signal)
        .then((payload) => {
          if (!cancelled) setMorningLiveSpreadSpeed(payload);
        })
        .catch((nextError: Error) => {
          if (!cancelled && !isAbortLike(nextError)) setMorningLiveSpreadSpeed(null);
        });
      fetchLiveSpreadSpeedStatus(controller.signal)
        .then((status) => {
          if (!cancelled) setMorningLiveStatus(status);
        })
        .catch(() => undefined);
    };
    poll();
    const interval = window.setInterval(poll, 20_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [morningTracksToday, replayRefreshToken]);

  const runMorningLiveAction = useCallback((action: () => Promise<SpxLiveBarsLiveStatus>) => {
    setMorningLiveBusy(true);
    action()
      .then(setMorningLiveStatus)
      .catch(() => undefined)
      .finally(() => setMorningLiveBusy(false));
  }, []);

  // Prefer the live frame while tracking today and the feed reports data;
  // otherwise the EOD payload (which itself falls back to the last session).
  const effectiveMorningSpreadSpeed =
    morningTracksToday && morningLiveSpreadSpeed?.available ? morningLiveSpreadSpeed : morningSpreadSpeed;

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshSnapshot({ silent: true });
      }
    }, AUTO_IMPORT_REFRESH_MS);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshSnapshot({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshSnapshot, snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible" || dailySyncRunning || dailySyncPreflighting) {
        return;
      }

      const controller = new AbortController();
      fetchDailySyncStatus(controller.signal)
        .then((status) => {
          setDailySyncStatus(status);
          setDailySyncRunning(status.state === "running");
          if (status.state !== "running") {
            setDailyOptionRetrying(false);
          }
          if (status.state !== "idle") {
            setDailySyncMessage(dailySyncStatusMessage(status));
          }
          const decision = shouldRefreshTrackerAfterDailySyncStatus(dailySyncCompletionRefreshKeyRef.current, status);
          dailySyncCompletionRefreshKeyRef.current = decision.nextKey;
          if (decision.shouldRefresh) {
            void refreshSnapshot({ silent: true });
          }
        })
        .catch((nextError: Error) => {
          if (!isAbortLike(nextError)) {
            setDailySyncMessage(nextError.message);
          }
        });
    }, DAILY_SYNC_STATUS_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [dailySyncPreflighting, dailySyncRunning, refreshSnapshot, snapshot]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDailySyncStatus(controller.signal)
      .then((status) => {
        setDailySyncStatus(status);
        setDailySyncRunning(status.state === "running");
        if (status.state !== "running") {
          setDailyOptionRetrying(false);
        }
        setDailySyncMessage(dailySyncStatusMessage(status));
        dailySyncCompletionRefreshKeyRef.current = dailySyncCompletionRefreshKey(status);
      })
      .catch((nextError: Error) => {
        if (!isAbortLike(nextError)) {
          setDailySyncMessage(nextError.message);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!dailySyncRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      const controller = new AbortController();
      fetchDailySyncStatus(controller.signal)
        .then((status) => {
          setDailySyncStatus(status);
          setDailySyncRunning(status.state === "running");
          if (status.state !== "running") {
            setDailyOptionRetrying(false);
          }
          setDailySyncMessage(dailySyncStatusMessage(status));
          const decision = shouldRefreshTrackerAfterDailySyncStatus(dailySyncCompletionRefreshKeyRef.current, status);
          dailySyncCompletionRefreshKeyRef.current = decision.nextKey;
          if (decision.shouldRefresh) {
            void refreshSnapshot({ silent: true });
          }
        })
        .catch((nextError: Error) => {
          if (!isAbortLike(nextError)) {
            setDailySyncMessage(nextError.message);
          }
        });
    }, DAILY_SYNC_RUNNING_STATUS_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [dailySyncRunning, refreshSnapshot]);

  useEffect(() => {
    if (!playing || !replayMode || !dateScopedReplay?.spxBars.length) {
      return;
    }

    const interval = window.setInterval(() => {
      setReplayIndex((index) => {
        if (index >= dateScopedReplay.spxBars.length - 1) {
          setPlaying(false);
          return index;
        }
        return index + 1;
      });
    }, Math.max(80, 650 / speed));

    return () => window.clearInterval(interval);
  }, [dateScopedReplay, playing, replayMode, speed]);

  function persistJournalEntry(entry: TradeJournalEntry) {
    setJournalEntries((current) => {
      const next = { ...current, [entry.tradeId]: entry };
      writeJournalEntriesToStorage(next);
      return next;
    });
  }

  function deleteJournalEntry(tradeId: string) {
    setJournalEntries((current) => {
      const next = { ...current };
      delete next[tradeId];
      writeJournalEntriesToStorage(next);
      return next;
    });
  }

  async function refreshGoogleSnapshotFromApp() {
    if (googleSnapshotRefreshing) {
      return;
    }
    setGoogleSnapshotRefreshing(true);
    setGoogleSnapshotRefreshMessage("");
    setError(null);
    try {
      const result = await refreshGoogleSnapshot();
      setGoogleSnapshotRefreshMessage(result.ok ? "" : result.message);
      await refreshSnapshot({ silent: true });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setGoogleSnapshotRefreshMessage(message);
    } finally {
      setGoogleSnapshotRefreshing(false);
    }
  }

  async function runDailySyncFromApp() {
    if (dailySyncRunning || dailySyncPreflighting) {
      return;
    }
    setDailySyncRunning(true);
    setDailySyncMessage("");
    setError(null);
    try {
      const result = await runDailySync("auto");
      setDailySyncStatus(result);
      setDailySyncRunning(result.state === "running");
      setDailySyncMessage(dailySyncStatusMessage(result));
      await refreshSnapshot({ silent: true });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setDailySyncRunning(false);
      setDailySyncMessage(message);
    }
  }

  async function preflightDailySyncFromApp() {
    if (dailySyncRunning || dailySyncPreflighting) {
      return;
    }
    setDailySyncPreflighting(true);
    setDailySyncMessage("");
    setError(null);
    try {
      const result = await runDailySync("auto", { dryRun: true });
      const enrichedResult = {
        ...result,
        latestLogPath: result.latestLogPath ?? dailySyncStatus?.latestLogPath,
        latestLogTail: result.latestLogTail ?? dailySyncStatus?.latestLogTail,
        latestSummary: result.latestSummary ?? dailySyncStatus?.latestSummary,
      };
      setDailySyncStatus(enrichedResult);
      setDailySyncMessage(dailySyncStatusMessage(enrichedResult));
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setDailySyncMessage(message);
    } finally {
      setDailySyncPreflighting(false);
    }
  }

  async function runDailyOptionPullFromApp() {
    if (dailySyncRunning || dailySyncPreflighting || !selectedDate) {
      return;
    }
    setDailyOptionRetrying(true);
    setDailySyncRunning(true);
    setDailySyncMessage("");
    setError(null);
    let stillRunning = false;
    try {
      const result = await runDailyOptionPull(selectedDate);
      setDailySyncStatus(result);
      stillRunning = result.state === "running";
      setDailySyncRunning(stillRunning);
      setDailySyncMessage(dailySyncStatusMessage(result));
      await refreshSnapshot({ silent: true });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setDailySyncRunning(false);
      setDailySyncMessage(message);
    } finally {
      if (!stillRunning) {
        setDailyOptionRetrying(false);
      }
    }
  }

  if (!snapshot) {
    return (
      <main className="loading-shell">
        <Activity />
        <span>Loading SPX trade history...</span>
        {error && <strong>{error}</strong>}
      </main>
    );
  }

  const replayLastIndex = Math.max(0, (dateScopedReplay?.spxBars.length ?? 1) - 1);
  const currentTime = replayMode ? dateScopedReplay?.spxBars[replayIndex]?.label ?? "--:--" : "Session";
  const replayControlsDisabled = replayLoading || !dateScopedReplay;

  function openReplayToday() {
    setPortion("replay");
    if (marketToday) {
      setRange("today");
      setSelectedDate(marketToday);
      setCustomDate(marketToday);
      setSelectedTradeId(undefined);
      setSelectedSpreadKey(undefined);
    }
    setReplayMode(false);
    setPlaying(false);
    setView("replay");
  }

  function openReplayForMorningDate() {
    const targetDate = morningDate || easternDateOffset(0);
    setSelectedDate(targetDate);
    setCustomDate(targetDate);
    setRange("custom");
    setSelectedSpreadKey(undefined);
    setPortion("replay");
    setView("replay");
    showFullDayReplay();
  }

  function selectMorningCalendarDate(date: string) {
    setMorningDate(date);
    setMorningTracksToday(date === easternDateOffset(0));
  }

  function showFullDayReplay() {
    setReplayMode(false);
    setPlaying(false);
    setReplayIndex(replayLastIndex);
  }

  function startReplayMode({ reset = false }: { reset?: boolean } = {}) {
    setReplayMode(true);
    if (reset || replayIndex >= replayLastIndex) {
      setReplayIndex(0);
    }
  }

  function togglePlayback() {
    if (playing) {
      setPlaying(false);
      return;
    }

    if (!replayMode || replayIndex >= replayLastIndex) {
      setReplayMode(true);
      setReplayIndex(0);
    }
    setPlaying(true);
  }

  return (
    <main className={`terminal-shell portion-${portion} view-${view}`} role="application" aria-label="Rubicon trading cockpit">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">
            <Gauge size={22} />
          </div>
          <div>
            <h1>Rubicon</h1>
            <p>Morning intelligence and SPX replay - {snapshot.availableDates.length} synced sessions - New York / EST chart time</p>
          </div>
        </div>
        <div className="source-strip">
          <div className="portion-toggle" role="tablist" aria-label="Rubicon portion">
            <button
              type="button"
              role="tab"
              className={portion === "morning" ? "active" : ""}
              aria-selected={portion === "morning"}
              onClick={() => setPortion("morning")}
            >
              Morning
            </button>
            <button
              type="button"
              role="tab"
              className={portion === "replay" ? "active" : ""}
              aria-selected={portion === "replay"}
              onClick={() => setPortion("replay")}
            >
              Replay
            </button>
            <button
              type="button"
              role="tab"
              className={portion === "rotation" ? "active" : ""}
              aria-selected={portion === "rotation"}
              onClick={() => setPortion("rotation")}
            >
              Rotation
            </button>
          </div>
          <span className={`refresh-status ${refreshing ? "active" : ""}`} title="Automatic local import check">
            {refreshing ? "Scanning" : lastImportCheck ? `Checked ${lastImportCheck}` : "Auto import on"}
          </span>
          <AppUpdateButton onBundleRefresh={refreshToLatestVersion} />
          <button
            aria-label="Refresh local import"
            className="icon-button"
            disabled={refreshing}
            onClick={() => void refreshSnapshot()}
            title="Refresh local import"
            type="button"
          >
            <RefreshCcw size={17} />
          </button>
        </div>
      </header>

      {portion === "replay" && (
        <section className="replay-subheader" aria-label="Replay workspace">
          <div className="morning-screen-tabs replay-screen-tabs" role="tablist" aria-label="Replay workspace view">
            <button
              type="button"
              role="tab"
              className={view === "pull" ? "active" : ""}
              aria-selected={view === "pull"}
              onClick={() => setView("pull")}
            >
              Daily Pull
            </button>
            <button
              type="button"
              role="tab"
              className={view === "replay" ? "active" : ""}
              aria-selected={view === "replay"}
              onClick={openReplayToday}
            >
              Replay
            </button>
            <button
              type="button"
              role="tab"
              className={view === "review" ? "active" : ""}
              aria-selected={view === "review"}
              onClick={() => setView("review")}
            >
              Daily Review
            </button>
            <button
              type="button"
              role="tab"
              className={view === "journal" ? "active" : ""}
              aria-selected={view === "journal"}
              onClick={() => setView("journal")}
            >
              Journal
            </button>
          </div>
        </section>
      )}

      {portion === "replay" && (
      <section className="kpi-grid">
          <Kpi label="Net P/L" value={formatSignedCurrency(stats.netPnl)} tone={stats.netPnl >= 0 ? "good" : "bad"} />
          <Kpi label="Avg P/L" value={formatSignedCurrency(stats.avgPnl)} tone={stats.avgPnl >= 0 ? "good" : "bad"} />
          <Kpi label="Win Rate" value={formatPercent(stats.winRate)} />
        <Kpi label="Trades" value={`${stats.totalTrades}`} />
        <Kpi label="Call Max Position" value={formatNumber(stats.callMaxPosition)} />
        <Kpi label="Put Max Position" value={formatNumber(stats.putMaxPosition)} />
      </section>
      )}

      {portion === "replay" && freshness && <MarketFreshnessBanner freshness={freshness} />}

      {error && <div className="error-banner">{error}</div>}

      {portion === "rotation" ? (
        <RrgPanel />
      ) : portion === "morning" ? (
        <MorningDashboard
          onOpenReplay={openReplayForMorningDate}
          onSelectDate={selectMorningCalendarDate}
          selectedDate={morningDate || easternDateOffset(0)}
          spreadSpeed={effectiveMorningSpreadSpeed}
          liveFeed={{
            status: morningLiveStatus,
            busy: morningLiveBusy,
            tracksToday: morningTracksToday,
            onStart: () => runMorningLiveAction(startLiveSpreadSpeed),
            onStop: () => runMorningLiveAction(stopLiveSpreadSpeed),
          }}
          trades={snapshot?.trades ?? []}
        />
      ) : view === "pull" ? (
        <DailyPullScreen
          allTrades={snapshot.trades}
          availableDates={snapshot.availableDates}
          dailySyncMessage={dailySyncMessage}
          dailyOptionRetrying={dailyOptionRetrying}
          dailySyncPreflighting={dailySyncPreflighting}
          dailySyncRunning={dailySyncRunning}
          dailySyncStatus={dailySyncStatus}
          dailySummaries={snapshot.dailySummaries}
          dateIssueBadges={dateIssueBadges}
          acceptedIssueDates={acceptedIssueDates}
          googleSnapshotRefreshMessage={googleSnapshotRefreshMessage}
          googleSnapshotRefreshing={googleSnapshotRefreshing}
          latestTradeDate={snapshot.latestTradeDate}
          onPreflightDailySync={() => void preflightDailySyncFromApp()}
          onRefreshGoogleSnapshot={() => void refreshGoogleSnapshotFromApp()}
          onAcceptDateIssues={acceptPullDateIssues}
          onRunDailyOptionPull={() => void runDailyOptionPullFromApp()}
          onRunDailySync={() => void runDailySyncFromApp()}
          onSelectDate={(date) => {
            setSelectedDate(date);
            setCustomDate(date);
            setRange("custom");
            setSelectedSpreadKey(undefined);
          }}
          selectedDate={selectedDate}
          sourceHealth={visibleSourceHealth}
          summary={selectedSummary}
          today={snapshot.today}
        />
      ) : view === "journal" ? (
        <JournalScreen
          allTrades={snapshot.trades}
          availableDates={snapshot.availableDates}
          dateIssueBadges={dateIssueBadges}
          acceptedIssueDates={acceptedIssueDates}
          entries={journalEntries}
          onDeleteEntry={deleteJournalEntry}
          onOpenDailyReview={() => setView("review")}
          onReplayTrade={(trade) => {
            setSelectedDate(trade.date);
            setCustomDate(trade.date);
            setSelectedTradeId(trade.id);
            setSelectedSpreadKey(undefined);
            setJournalSelectedTradeId(trade.id);
            setPortion("replay");
            setView("replay");
          }}
          onSaveEntry={persistJournalEntry}
          onSelectDate={(date) => {
            setSelectedDate(date);
            setCustomDate(date);
            setRange("custom");
            setSelectedSpreadKey(undefined);
            setJournalSelectedTradeId(undefined);
          }}
          onSelectTrade={(trade) => {
            setSelectedTradeId(trade.id);
            setSelectedSpreadKey(undefined);
            setJournalSelectedTradeId(trade.id);
          }}
          selectedDate={selectedDate}
          selectedTradeId={journalSelectedTradeId ?? selectedTrade?.id}
          trades={tradesForSelectedDate}
        />
      ) : view === "review" ? (
        <DailyReviewScreen
          availableDates={snapshot.availableDates}
          allTrades={snapshot.trades}
          dateIssueBadges={dateIssueBadges}
          acceptedIssueDates={acceptedIssueDates}
          spxBars={dateScopedReplay?.spxBars ?? []}
          spreadMarks={dateScopedReplay?.spreadMarks ?? []}
          selectedDate={selectedDate}
          selectedTradeId={selectedTrade?.id}
          summary={selectedSummary}
          trades={tradesForSelectedDate}
          sourceHealth={visibleSourceHealth}
          onReplayTrade={(trade) => {
            setSelectedDate(trade.date);
            setCustomDate(trade.date);
            setSelectedTradeId(trade.id);
            setSelectedSpreadKey(undefined);
            setPortion("replay");
            setView("replay");
          }}
          onSelectDate={(date) => {
            setSelectedDate(date);
            setCustomDate(date);
            setRange("custom");
            setSelectedSpreadKey(undefined);
          }}
        />
      ) : (
        <>
      <div className="workspace-grid">
        <aside className="range-rail">
          <div className="rail-title">
            <CalendarDays size={16} />
            Session
          </div>
          <div className="range-stack">
            {rangePresets.map((preset) => (
              <button
                className={range === preset.id ? "active" : ""}
                key={preset.id}
                onClick={() => {
                  setRange(preset.id);
                  if (preset.id === "today") {
                    setSelectedDate(marketToday);
                    setCustomDate(marketToday);
                    setSelectedSpreadKey(undefined);
                    showFullDayReplay();
                  }
                  if (preset.id === "yesterday") {
                    const yesterday = previousTradingSessionDate(marketToday);
                    setSelectedDate(yesterday);
                    setCustomDate(yesterday);
                    setSelectedSpreadKey(undefined);
                    showFullDayReplay();
                  }
                }}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            className="date-input"
            max={marketToday}
            onChange={(event) => {
              setCustomDate(event.target.value);
              setSelectedDate(event.target.value);
              setRange("custom");
              setSelectedSpreadKey(undefined);
              showFullDayReplay();
            }}
            type="date"
            value={customDate}
          />
          <div className="date-list">
            {newestFirstDates(visibleReplayDateTabs(snapshot.availableDates)).map((date) => {
              const issueBadge = dateIssueBadges.get(date);
              const acceptedIssues = acceptedIssueDates.has(date);
              const tradeCount = tradeCountsByDate.get(date) ?? 0;
              return (
                <button
                  aria-label={dateButtonAriaLabel(date, tradeCount, issueBadge, acceptedIssues)}
                  className={dateButtonClass(selectedDate === date, issueBadge)}
                  key={date}
                  onClick={() => {
                    setSelectedDate(date);
                    setCustomDate(date);
                    setSelectedSpreadKey(undefined);
                    showFullDayReplay();
                  }}
                  title={issueBadge?.title ?? (acceptedIssues ? `${date}: issues accepted` : undefined)}
                  type="button"
                >
                  <span className="date-button-main">
                    <span className="date-label">{date}</span>
                    {issueBadge && <DateIssueBadgePill badge={issueBadge} />}
                  </span>
                  <DateTradeCount count={tradeCount} />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="trade-console">
          <div className="section-header">
            <div>
              <span className="eyeless-label">Trade History</span>
              <h2>Trades</h2>
            </div>
            <a className="sheet-link" href={snapshot.googleSheetUrl} rel="noreferrer" target="_blank">
              <Database size={15} />
              Tracker Sheet
            </a>
          </div>
          <TradeTable
            selectedTradeId={selectedTrade?.id}
            trades={visibleTrades}
            onSelect={(trade) => {
              setSelectedDate(trade.date);
              setCustomDate(trade.date);
              setSelectedTradeId(trade.id);
              setSelectedSpreadKey(undefined);
              showFullDayReplay();
            }}
          />
        </section>

        <section className="replay-console">
          <div className="section-header replay-header">
            <div>
              <span className="eyeless-label">Replay Cockpit</span>
              <h2>{selectedDate}{replayMode ? ` at ${currentTime}` : ""}</h2>
              {selectedSpreadGroup ? (
                <p className="trade-entry-meta spread-mode">
                  Spread {selectedSpreadGroup.side} {selectedSpreadGroup.shortStrike}/{selectedSpreadGroup.longStrike} - {selectedSpreadGroup.trades.length} entries - {formatNumber(selectedSpreadGroup.contracts)} contracts - {formatSignedCurrency(selectedSpreadGroup.pnl)}
                </p>
              ) : selectedTrade ? (
                <p className="trade-entry-meta">
                  Entry {tradeClockLabel(selectedTrade.entryTime)} EST - {selectedTrade.side} {selectedTrade.shortStrike}/{selectedTrade.longStrike} - {formatNumber(selectedTrade.contracts)}
                </p>
              ) : null}
            </div>
            <div className="replay-selection-panel">
              <div className="replay-selection-row">
                <span className="eyeless-label">Spreads</span>
                <div className="quick-spreads" aria-label={`${quickSpreadGroups.length} selectable spreads`}>
                  {quickSpreadGroups.map((group) => {
                    const selected = selectedSpreadGroup?.key === group.key;
                    const sideClass = group.side.toLowerCase();
                    return (
                      <button
                        aria-label={quickSpreadAriaLabel(group)}
                        aria-pressed={selected}
                        className={selected ? "active" : ""}
                        data-spread-key={group.key}
                        data-testid="quick-spread-button"
                        key={group.key}
                        onClick={() => {
                          setSelectedSpreadKey(group.key);
                          setSelectedTradeId(group.trades[0]?.id);
                          showFullDayReplay();
                        }}
                        title={`${quickSpreadLabel(group)} - ${formatNumber(group.contracts)} contracts - ${formatSignedCurrency(group.pnl)}`}
                        type="button"
                      >
                        <span className={`spread-side-dot ${sideClass}`} aria-hidden="true" />
                        <span>{quickSpreadLabel(group)}</span>
                        <span className={`quick-spread-pnl ${group.pnl >= 0 ? "profit" : "loss"}`}>{formatSignedCurrency(group.pnl)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <ReplayCharts replay={dateScopedReplay} replayIndex={replayIndex} replayMode={replayMode} selectedTrade={selectedTrade} selectedTrades={selectedChartTrades} selectionLabel={selectedReplayLabel} />
          <div className="scrubber">
            <div className="replay-mode-toggle micro-segment" role="group" aria-label="Replay chart mode">
              <button className={!replayMode ? "active" : ""} disabled={replayControlsDisabled} onClick={showFullDayReplay} type="button">
                Session
              </button>
              <button className={replayMode ? "active" : ""} disabled={replayControlsDisabled} onClick={() => startReplayMode({ reset: true })} type="button">
                Replay Mode
              </button>
            </div>
            <button className="play-button" disabled={replayControlsDisabled} onClick={togglePlayback} type="button">
              {playing ? <Pause size={17} /> : <Play size={17} />}
              {replayLoading ? "Loading" : playing ? "Pause" : "Play"}
            </button>
            <input
              disabled={replayControlsDisabled || !replayMode}
              max={replayLastIndex}
              min={0}
              onChange={(event) => {
                setReplayMode(true);
                setPlaying(false);
                setReplayIndex(Number(event.target.value));
              }}
              type="range"
              value={replayMode ? replayIndex : replayLastIndex}
            />
            <span className="scrubber-time" aria-live="polite">{replayLoading ? "Loading trade..." : currentTime}</span>
            <label>
              Speed
              <select onChange={(event) => setSpeed(Number(event.target.value))} value={speed}>
                {REPLAY_SPEEDS.map((nextSpeed) => (
                  <option key={nextSpeed} value={nextSpeed}>{nextSpeed}x</option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>
      </>
      )}
    </main>
  );
}

function JournalScreen({
  acceptedIssueDates,
  allTrades,
  availableDates,
  dateIssueBadges,
  entries,
  onDeleteEntry,
  onOpenDailyReview,
  onReplayTrade,
  onSaveEntry,
  onSelectDate,
  onSelectTrade,
  selectedDate,
  selectedTradeId,
  trades,
}: {
  acceptedIssueDates: Set<string>;
  allTrades: TradeRecord[];
  availableDates: string[];
  dateIssueBadges: Map<string, DateIssueBadge>;
  entries: Record<string, TradeJournalEntry>;
  onDeleteEntry: (tradeId: string) => void;
  onOpenDailyReview: () => void;
  onReplayTrade: (trade: TradeRecord) => void;
  onSaveEntry: (entry: TradeJournalEntry) => void;
  onSelectDate: (date: string) => void;
  onSelectTrade: (trade: TradeRecord) => void;
  selectedDate: string;
  selectedTradeId?: string;
  trades: TradeRecord[];
}) {
  const [draft, setDraft] = useState<TradeJournalEntry | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "draft" | "reviewed">("idle");
  const sortedTrades = useMemo(() => sortTradesByEntryTime(trades), [trades]);
  const selectedTrade = useMemo(() => selectTradeByIdOrFirst(sortedTrades, selectedTradeId), [selectedTradeId, sortedTrades]);
  const currentEntry = selectedTrade ? entries[selectedTrade.id] : undefined;
  const coverage = useMemo(() => buildJournalCoverage(sortedTrades, entries), [entries, sortedTrades]);
  const aspectChecklist = useMemo(
    () => selectedTrade ? journalAspectChecklistForTrade(selectedTrade) : [],
    [selectedTrade],
  );
  const requiredAspectCount = aspectChecklist.filter((item) => !item.optional).length;
  const requiredAspectComplete = aspectChecklist.filter((item) => !item.optional && draft?.aspectChecks[item.key]).length;
  const countsByDate = useMemo(() => countTradesByDate(allTrades), [allTrades]);

  useEffect(() => {
    if (!selectedTrade) {
      setDraft(null);
      return;
    }
    setDraft(currentEntry ?? defaultJournalEntry(selectedTrade));
    setSaveStatus("idle");
  }, [currentEntry, selectedTrade]);

  function updateDraft(patch: Partial<TradeJournalEntry>) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        ...patch,
        status: current.status === "reviewed" ? "reviewed" : "draft",
      };
    });
    setSaveStatus("idle");
  }

  function updateAspectCheck(key: JournalAspectKey, checked: boolean) {
    if (!draft) {
      return;
    }
    updateDraft({
      aspectChecks: {
        ...draft.aspectChecks,
        [key]: checked,
      },
    });
  }

  function saveJournal(status: JournalStatus, { advance = false }: { advance?: boolean } = {}) {
    if (!selectedTrade || !draft) {
      return;
    }
    const saved = mergeJournalEntry(selectedTrade, currentEntry, { ...draft, status }, new Date().toISOString());
    const nextEntries = { ...entries, [saved.tradeId]: saved };
    onSaveEntry(saved);
    setDraft(saved);
    setSaveStatus(status === "reviewed" ? "reviewed" : "draft");
    if (advance) {
      const nextTradeId = nextUnreviewedTradeId(sortedTrades, nextEntries, saved.tradeId);
      const nextTrade = selectTradeById(sortedTrades, nextTradeId);
      if (nextTrade) {
        onSelectTrade(nextTrade);
      }
    }
  }

  function clearJournalEntry() {
    if (!selectedTrade) {
      return;
    }
    onDeleteEntry(selectedTrade.id);
    setDraft(defaultJournalEntry(selectedTrade));
    setSaveStatus("idle");
  }

  const journalStatus = draft?.status ?? "todo";
  return (
    <section className="journal-shell">
      <aside className="review-date-rail journal-date-rail" aria-label="Journal dates">
        <div className="rail-title">
          <CalendarDays size={16} />
          Journal Dates
        </div>
        <div className="date-list">
          {newestFirstDates(visibleReplayDateTabs(availableDates)).map((date) => {
            const issueBadge = dateIssueBadges.get(date);
            const acceptedIssues = acceptedIssueDates.has(date);
            const tradeCount = countsByDate.get(date) ?? 0;
            return (
              <button
                aria-label={dateButtonAriaLabel(date, tradeCount, issueBadge, acceptedIssues)}
                className={dateButtonClass(selectedDate === date, issueBadge)}
                key={date}
                onClick={() => onSelectDate(date)}
                title={issueBadge?.title ?? (acceptedIssues ? `${date}: issues accepted` : undefined)}
                type="button"
              >
                <span className="date-button-main">
                  <span className="date-label">{date}</span>
                  {issueBadge && <DateIssueBadgePill badge={issueBadge} />}
                </span>
                <DateTradeCount count={tradeCount} />
              </button>
            );
          })}
        </div>
      </aside>

      <section className="journal-main">
        <div className="journal-hero">
          <div>
            <span className="eyeless-label">Trade Journal</span>
            <h2>{selectedDate} review queue</h2>
          </div>
          <div className="journal-hero-actions">
            <button className="review-action-button" disabled={!selectedTrade} onClick={() => selectedTrade && onReplayTrade(selectedTrade)} type="button">
              <Play size={16} />
              Replay Trade
            </button>
            <button className="review-action-button" onClick={onOpenDailyReview} type="button">
              <BookOpen size={16} />
              Daily Review
            </button>
          </div>
        </div>

        <div className="journal-stat-grid">
          <JournalStat label="Reviewed" value={`${coverage.reviewed}/${coverage.total}`} detail={`${coverage.drafted} drafted`} />
          <JournalStat label="Follow-ups" value={`${coverage.followUps}`} detail="active queue" />
          <JournalStat label="Process" value={formatNumber(coverage.avgProcessScore, 1)} detail="avg score / 5" />
          <JournalStat label="Selected" value={selectedTrade ? formatSignedCurrency(selectedTrade.pnl) : "-"} detail={selectedTrade ? `${tradeClockLabel(selectedTrade.entryTime)} EST` : "no trade"} tone={selectedTrade && selectedTrade.pnl < 0 ? "bad" : "good"} />
        </div>

        <div className="journal-layout">
          <aside className="journal-queue-panel">
            <div className="review-panel-heading">
              <div>
                <span className="eyeless-label">Queue</span>
                <h3>Trades to Journal</h3>
              </div>
              <span className="panel-count">{sortedTrades.length} trades</span>
            </div>
            <div className="journal-trade-list">
              {sortedTrades.map((trade) => {
                const entry = entries[trade.id];
                const status = entry?.status ?? "todo";
                const aspectProgress = journalAspectProgress(trade, entry);
                return (
                  <button
                    aria-pressed={selectedTrade?.id === trade.id}
                    className={`journal-trade-card ${selectedTrade?.id === trade.id ? "active" : ""} ${status}`}
                    key={trade.id}
                    onClick={() => onSelectTrade(trade)}
                    type="button"
                  >
                    <span className="journal-trade-main">
                      <span className="journal-trade-time">{tradeClockLabel(trade.entryTime)}</span>
                      <span className={`side-pill ${trade.side.toLowerCase()}`}>{trade.side}</span>
                      <b>{trade.shortStrike}/{trade.longStrike}</b>
                    </span>
                    <span className="journal-trade-sub">
                      <small>{formatNumber(trade.contracts)}x {formatNumber(trade.entryPrice, 2)} {trade.priceType.toLowerCase()}</small>
                      <b className={trade.pnl >= 0 ? "profit" : "loss"}>{formatSignedCurrency(trade.pnl)}</b>
                    </span>
                    <span className="journal-trade-meta">
                      {aspectProgress && (
                        <span
                          className={`journal-aspect-pill ${aspectProgress.complete === aspectProgress.total ? "complete" : ""}`}
                          title={`Four Aspects required checks: ${aspectProgress.complete}/${aspectProgress.total}`}
                        >
                          {aspectProgress.complete}/{aspectProgress.total} aspects
                        </span>
                      )}
                      <span className={`journal-status-pill ${status}`}>{journalStatusLabel(status)}</span>
                    </span>
                  </button>
                );
              })}
              {!sortedTrades.length && (
                <div className="review-empty">No trades found for this date.</div>
              )}
            </div>
          </aside>

          <section className="journal-editor-panel">
            {selectedTrade && draft ? (
              <>
                <div className="review-panel-heading">
                  <div>
                    <span className="eyeless-label">Selected Trade</span>
                    <h3>{tradeClockLabel(selectedTrade.entryTime)} {selectedTrade.side} {selectedTrade.shortStrike}/{selectedTrade.longStrike}</h3>
                  </div>
                  <span className={`journal-status-pill ${journalStatus}`}>{journalStatusLabel(journalStatus)}</span>
                </div>

                <div className="journal-editor-grid">
                  <label className="journal-field">
                    <span>Setup / playbook</span>
                    <input
                      list="journal-setup-options"
                      maxLength={120}
                      onChange={(event) => updateDraft({ setup: event.target.value })}
                      value={draft.setup}
                    />
                    <datalist id="journal-setup-options">
                      {JOURNAL_SETUP_OPTIONS.map((setup) => <option key={setup} value={setup} />)}
                    </datalist>
                  </label>

                  <label className="journal-field">
                    <span>Tags</span>
                    <input
                      aria-label="Journal tags"
                      maxLength={180}
                      onChange={(event) => updateDraft({ tags: splitJournalTags(event.target.value) })}
                      placeholder="opening, chase, rule break"
                      value={draft.tags.join(", ")}
                    />
                  </label>
                </div>

                <label className="journal-field">
                  <span>Thesis before entry</span>
                  <textarea
                    maxLength={1200}
                    onChange={(event) => updateDraft({ thesis: event.target.value })}
                    value={draft.thesis}
                  />
                </label>

                <label className="journal-field">
                  <span>Execution / what happened</span>
                  <textarea
                    maxLength={1200}
                    onChange={(event) => updateDraft({ execution: event.target.value })}
                    value={draft.execution}
                  />
                </label>

                {aspectChecklist.length > 0 && (
                  <section className="journal-aspect-panel" aria-label="Four Aspects checklist">
                    <div className="journal-aspect-heading">
                      <span>Four Aspects</span>
                      <b>{requiredAspectComplete}/{requiredAspectCount} required</b>
                    </div>
                    <div className="journal-aspect-list">
                      {aspectChecklist.map((item) => (
                        <label className="journal-aspect-check" key={item.key}>
                          <input
                            checked={draft.aspectChecks[item.key]}
                            onChange={(event) => updateAspectCheck(item.key, event.target.checked)}
                            type="checkbox"
                          />
                          <span>{item.label}</span>
                          {item.optional && <small>Optional</small>}
                        </label>
                      ))}
                    </div>
                  </section>
                )}

                <div className="journal-editor-grid three">
                  <div className="journal-field">
                    <span>Emotion</span>
                    <div className="journal-segment" role="group" aria-label="Journal emotion">
                      {JOURNAL_EMOTIONS.map((emotion) => (
                        <button
                          aria-pressed={draft.emotion === emotion}
                          className={draft.emotion === emotion ? "active" : ""}
                          key={emotion}
                          onClick={() => updateDraft({ emotion })}
                          type="button"
                        >
                          {emotion}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="journal-field">
                    <span>Process score</span>
                    <div className="journal-score-row" role="group" aria-label="Journal process score">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button
                          aria-pressed={draft.processScore === score}
                          className={draft.processScore === score ? "active" : ""}
                          key={score}
                          onClick={() => updateDraft({ processScore: score })}
                          type="button"
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="journal-field">
                    <span>Grade</span>
                    <div className="journal-score-row" role="group" aria-label="Journal grade">
                      {JOURNAL_GRADES.map((grade) => (
                        <button
                          aria-pressed={draft.grade === grade}
                          className={draft.grade === grade ? "active" : ""}
                          key={grade}
                          onClick={() => updateDraft({ grade })}
                          type="button"
                        >
                          {grade}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="journal-actions">
                  <label className="journal-follow-up">
                    <input
                      checked={draft.followUp}
                      onChange={(event) => updateDraft({ followUp: event.target.checked })}
                      type="checkbox"
                    />
                    <Flag size={14} />
                    <span>Needs follow-up</span>
                  </label>
                  <div className="journal-save-stack">
                    <span aria-live="polite">
                      {saveStatus === "reviewed"
                        ? "Reviewed and saved"
                        : saveStatus === "draft"
                          ? "Draft saved"
                          : currentEntry?.updatedAt
                            ? `Saved ${currentEntry.updatedAt.slice(0, 16).replace("T", " ")}`
                            : "Local draft only"}
                    </span>
                    <button className="review-action-button secondary" onClick={() => saveJournal("draft")} type="button">
                      <Save size={16} />
                      Save Draft
                    </button>
                    <button className="review-action-button secondary" disabled={!currentEntry} onClick={clearJournalEntry} type="button">
                      <Trash2 size={16} />
                      Clear Entry
                    </button>
                    <button className="review-action-button" onClick={() => saveJournal("reviewed")} type="button">
                      <CheckCircle2 size={16} />
                      Mark Reviewed
                    </button>
                    <button className="review-action-button" onClick={() => saveJournal("reviewed", { advance: true })} type="button">
                      <ArrowRight size={16} />
                      Save & Next
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="review-empty">Select a dated trade to start journaling.</div>
            )}
          </section>

          <aside className="journal-context-panel">
            <div className="review-panel-heading">
              <div>
                <span className="eyeless-label">Context</span>
                <h3>Trade Facts</h3>
              </div>
            </div>
            {selectedTrade ? (
              <>
                <div className="journal-fact-grid">
                  <span>
                    <small>Entry</small>
                    <b>{tradeClockLabel(selectedTrade.entryTime)} EST</b>
                  </span>
                  <span>
                    <small>Exit</small>
                    <b>{tradeExitClockLabel(selectedTrade)}</b>
                  </span>
                  <span>
                    <small>Premium</small>
                    <b>{formatNumber(selectedTrade.entryPrice, 2)}</b>
                  </span>
                  <span>
                    <small>Risk</small>
                    <b>{formatCurrency(selectedTrade.maxRisk)}</b>
                  </span>
                  <span>
                    <small>P/L</small>
                    <b className={selectedTrade.pnl >= 0 ? "profit" : "loss"}>{formatSignedCurrency(selectedTrade.pnl)}</b>
                  </span>
                  <span>
                    <small>Return</small>
                    <b>{formatPercent(selectedTrade.returnOnRisk)}</b>
                  </span>
                </div>
                {selectedTrade.entryChartDeviationFlag && (
                  <div className="journal-alert">
                    <AlertTriangle size={15} />
                    <span>{entryDeviationTitle(selectedTrade)}</span>
                  </div>
                )}
                <div className="journal-context-actions">
                  <button onClick={() => onReplayTrade(selectedTrade)} type="button">
                    <ArrowRight size={15} />
                    Open in Replay
                  </button>
                  <button onClick={onOpenDailyReview} type="button">
                    <PencilLine size={15} />
                    Daily chart
                  </button>
                </div>
              </>
            ) : (
              <div className="review-empty">No trade selected.</div>
            )}
          </aside>
        </div>
      </section>
    </section>
  );
}

function JournalStat({
  detail,
  label,
  tone,
  value,
}: {
  detail: string;
  label: string;
  tone?: "good" | "bad";
  value: string;
}) {
  return (
    <div className={`journal-stat ${tone ?? ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </div>
  );
}

function DailyPullScreen({
  acceptedIssueDates,
  allTrades,
  availableDates,
  dailySyncMessage,
  dailyOptionRetrying,
  dailySyncPreflighting,
  dailySyncRunning,
  dailySyncStatus,
  dailySummaries,
  dateIssueBadges,
  googleSnapshotRefreshMessage,
  googleSnapshotRefreshing,
  latestTradeDate,
  onAcceptDateIssues,
  onPreflightDailySync,
  onRefreshGoogleSnapshot,
  onRunDailyOptionPull,
  onRunDailySync,
  onSelectDate,
  selectedDate,
  sourceHealth,
  summary,
  today,
}: {
  acceptedIssueDates: Set<string>;
  allTrades: TradeRecord[];
  availableDates: string[];
  dailySyncMessage: string;
  dailyOptionRetrying: boolean;
  dailySyncPreflighting: boolean;
  dailySyncRunning: boolean;
  dailySyncStatus: DailySyncStatusResult | null;
  dailySummaries: DailySummary[];
  dateIssueBadges: Map<string, DateIssueBadge>;
  googleSnapshotRefreshMessage: string;
  googleSnapshotRefreshing: boolean;
  latestTradeDate: string | null;
  onAcceptDateIssues: (date: string) => void;
  onPreflightDailySync: () => void;
  onRefreshGoogleSnapshot: () => void;
  onRunDailyOptionPull: () => void;
  onRunDailySync: () => void;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  sourceHealth: SourceHealth[];
  summary: DailySummary | null;
  today: string;
}) {
  const countsByDate = useMemo(() => countTradesByDate(allTrades), [allTrades]);
  const selectedTradeCount = countsByDate.get(selectedDate) ?? 0;
  const checklist = useMemo(
    () =>
      buildDailyPullChecklist({
        dailySyncStatus,
        latestTradeDate,
        selectedDate,
        sourceHealth,
        summary,
        today,
        tradeCount: selectedTradeCount,
      }),
    [dailySyncStatus, latestTradeDate, selectedDate, selectedTradeCount, sourceHealth, summary, today],
  );
  const reviewModel = useMemo(
    () =>
      buildDailyPullReviewModel({
        availableDates,
        checklist,
        selectedDate,
        summaries: dailySummaries,
        summary,
        today,
        tradeCount: selectedTradeCount,
        tradeCountsByDate: countsByDate,
      }),
    [availableDates, checklist, countsByDate, dailySummaries, selectedDate, selectedTradeCount, summary, today],
  );
  const runGuard = buildDailySyncRunGuard(dailySyncStatus, today);
  const runDisabled = dailySyncRunning || dailySyncPreflighting || runGuard.disabled;
  const optionPullDisabled = dailySyncRunning || dailySyncPreflighting || !selectedDate;
  const dailySyncProgress = useMemo(() => buildDailySyncProgress(dailySyncStatus), [dailySyncStatus]);
  const visibleDailySyncMessage =
    dailySyncMessage && (dailySyncRunning || dailySyncPreflighting || dailySyncStatus?.ok === false || dailySyncStatus?.state === "running")
      ? dailySyncMessage
      : "";

  return (
    <section className="daily-pull-shell" aria-label="Daily pull review">
      <section className="daily-pull-pipeline-bar" aria-label="Daily pipeline actions">
        <div className="daily-pull-pipeline-summary">
          <div>
            <span className="eyeless-label">Pipeline</span>
            {visibleDailySyncMessage && <p>{visibleDailySyncMessage}</p>}
          </div>
          <DailySyncProgressBar progress={dailySyncProgress} />
        </div>
        <div className="daily-pull-pipeline-actions">
          <button
            className={`daily-pull-pipeline-button secondary ${dailySyncPreflighting ? "busy" : ""}`}
            disabled={dailySyncRunning || dailySyncPreflighting}
            onClick={onPreflightDailySync}
            title="Check the local daily pipeline command and target without starting the import"
            type="button"
          >
            <RefreshCcw size={14} />
            {dailySyncPreflighting ? "Preflighting" : "Preflight Pipeline"}
          </button>
          <button
            className={`daily-pull-pipeline-button primary ${dailySyncRunning ? "busy" : runGuard.disabled ? "locked" : ""}`}
            disabled={runDisabled}
            onClick={onRunDailySync}
            title={runGuard.title}
            type="button"
          >
            <RefreshCcw size={15} />
            {dailySyncRunning ? "Pipeline Running" : "Run Daily Pipeline"}
          </button>
        </div>
      </section>

      <section className="option-repull-bar" aria-label="Option data retry">
        <div>
          <span className="eyeless-label">Option Data Retry</span>
          <p>Retries failed or missing option pulls for {selectedDate}</p>
        </div>
        <div className="option-repull-actions">
          <button
            className={dailyOptionRetrying ? "busy" : ""}
            disabled={optionPullDisabled}
            onClick={onRunDailyOptionPull}
            title="Retry failed or missing SPX spread-leg, SPX chain-band, owned option, and option open-interest pulls"
            type="button"
          >
            <RefreshCcw size={14} />
            {dailyOptionRetrying ? "Retry Running" : "Retry Missing Option Data"}
          </button>
        </div>
      </section>

      <aside className="review-date-rail" aria-label="Daily pull dates">
        <div className="rail-title">
          <CalendarDays size={16} />
          Pull Dates
        </div>
        <div className="date-list">
          {newestFirstDates(visibleReplayDateTabs(availableDates)).map((date) => {
            const issueBadge = dateIssueBadges.get(date);
            const acceptedIssues = acceptedIssueDates.has(date);
            const tradeCount = countsByDate.get(date) ?? 0;
            return (
              <div className="pull-date-row" key={date}>
                <button
                  aria-label={dateButtonAriaLabel(date, tradeCount, issueBadge, acceptedIssues)}
                  className={`date-select-button ${dateButtonClass(selectedDate === date, issueBadge)}`}
                  onClick={() => onSelectDate(date)}
                  title={issueBadge?.title ?? (acceptedIssues ? `${date}: issues accepted` : undefined)}
                  type="button"
                >
                  <span className="date-button-main">
                    <span className="date-label">{date}</span>
                    {issueBadge && <DateIssueBadgePill badge={issueBadge} />}
                  </span>
                  <DateTradeCount count={tradeCount} />
                </button>
                {issueBadge && (
                  <button
                    aria-label={`Mark ${date} pull-date issues as fine and hide the issue count`}
                    className="pull-date-accept-button"
                    onClick={() => onAcceptDateIssues(date)}
                    title={issueBadge.title}
                    type="button"
                  >
                    Issues fine
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <section className="daily-pull-main">
        <div className={`daily-pull-hero ${reviewModel.verdict}`}>
          <div>
            <span className="eyeless-label">Daily Pull</span>
            <h2>{reviewModel.title}</h2>
            <h3 className="daily-pull-date-heading">{selectedDate}</h3>
            <p>{reviewModel.subtitle}</p>
          </div>
          <div className="pull-status-cluster" aria-label="Daily pull status totals">
            <PullStatusPill status={reviewModel.tone} label="Important" value={`${reviewModel.reviewItems.filter((item) => item.status === "complete").length}/${reviewModel.reviewItems.length}`} />
            <PullStatusPill status={bucketStatus(reviewModel.buckets.diagnostic)} label="Diagnostics" value={reviewModel.diagnosticProblemCount} />
            <PullStatusPill status={bucketStatus(reviewModel.buckets.archive)} label="Upload" value={reviewModel.archiveProblemCount} />
          </div>
        </div>

        {reviewModel.todayBanner && <TodayPullBanner banner={reviewModel.todayBanner} onSelectDate={onSelectDate} />}

        <DailyPullGlance model={reviewModel} selectedDate={selectedDate} />

        <DailyPullDetailSection
          bucket={reviewModel.buckets.diagnostic}
          count={reviewModel.diagnosticProblemCount}
          items={reviewModel.diagnosticItems}
          selectedDate={selectedDate}
          title="Diagnostics / Context"
        />

        <details className="pull-detail-section" data-testid="daily-pull-archive">
          <summary>
            <span>Pipeline / Upload Details</span>
            <b>{reviewModel.archiveProblemCount} item{reviewModel.archiveProblemCount === 1 ? "" : "s"}</b>
          </summary>
          <PullCoveragePanel
            countLabel={`${reviewModel.archiveProblemCount} upload item${reviewModel.archiveProblemCount === 1 ? "" : "s"}`}
            eyebrow="Upload"
            items={reviewModel.archiveItems}
            selectedDate={selectedDate}
            title="Tracker payload and Google update"
          />
          <DailyPullIssueBucketPanel bucket={reviewModel.buckets.archive} />
          <UploadReceiptCheckPanel summary={summary} />
          <details className="pull-audit-details" data-testid="daily-pull-audit">
            <summary>
              <span>Run audit</span>
              <b>{checklist.completeCount}/{checklist.steps.length} checked</b>
            </summary>
            <section className="pull-checklist" data-testid="daily-pull-checklist" aria-label={`Daily pull process checks for ${selectedDate}`}>
              <div className="review-panel-heading">
                <div>
                  <span className="eyeless-label">Process</span>
                  <h3>Pull/upload process checks</h3>
                </div>
                <span className="panel-count">{checklist.completeCount}/{checklist.steps.length} checked</span>
              </div>
              <div className="pull-step-list">
                {checklist.steps.map((step, index) => (
                  <PullStepRow index={index + 1} key={step.id} step={step} />
                ))}
              </div>
            </section>
            <SourceLedger
              dailySyncStatus={dailySyncStatus}
              googleSnapshotRefreshMessage={googleSnapshotRefreshMessage}
              googleSnapshotRefreshing={googleSnapshotRefreshing}
              latestTradeDate={latestTradeDate}
              onRefreshGoogleSnapshot={onRefreshGoogleSnapshot}
              selectedDate={selectedDate}
              sources={sourceHealth}
              today={today}
            />
          </details>
        </details>
      </section>
    </section>
  );
}

function DailySyncProgressBar({ progress }: { progress: DailySyncProgressModel }) {
  const valueNow = Math.round(progress.percent);
  return (
    <div className={`daily-sync-progress ${progress.tone}`} data-testid="daily-sync-progress">
      <div className="daily-sync-progress-copy">
        <strong>{progress.label}</strong>
        <span>{progress.countLabel}</span>
      </div>
      <div
        aria-label="Daily sync progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={valueNow}
        className="daily-sync-progress-track"
        role="progressbar"
      >
        <span style={{ width: `${valueNow}%` }} />
      </div>
      <div className="daily-sync-progress-detail">{progress.detail}</div>
    </div>
  );
}

function TodayPullBanner({ banner, onSelectDate }: { banner: NonNullable<DailyPullViewModel["todayBanner"]>; onSelectDate: (date: string) => void }) {
  return (
    <section className="today-pull-banner" data-testid="today-pull-banner">
      <AlertTriangle size={17} />
      <div>
        <b>{banner.title}</b>
        <p>{banner.detail}</p>
      </div>
      {banner.latestUsableDate && (
        <button onClick={() => onSelectDate(banner.latestUsableDate as string)} type="button">
          Open {banner.latestUsableDate}
        </button>
      )}
    </section>
  );
}

function DailyPullDetailSection({
  bucket,
  count,
  items,
  selectedDate,
  title,
}: {
  bucket: DailyPullIssueBucket;
  count: number;
  items: DailyPullCoverageItem[];
  selectedDate: string;
  title: string;
}) {
  return (
    <details className="pull-detail-section" data-testid="daily-pull-diagnostics">
      <summary>
        <span>{title}</span>
        <b>{count} item{count === 1 ? "" : "s"}</b>
      </summary>
      <PullCoveragePanel
        countLabel={`${count} diagnostic item${count === 1 ? "" : "s"}`}
        eyebrow="Diagnostics"
        items={items}
        selectedDate={selectedDate}
        title="Breadth and source-state context"
      />
      <DailyPullIssueBucketPanel bucket={bucket} />
    </details>
  );
}

function DailyPullIssueBucketPanel({ bucket }: { bucket: DailyPullIssueBucket }) {
  return (
    <section className={`pull-issue-bucket ${bucket.tone}`}>
      <div className="review-panel-heading">
        <div>
          <span className="eyeless-label">{bucket.label}</span>
          <h3>{bucket.label} items</h3>
        </div>
        <span className="panel-count">{bucket.entries.length} item{bucket.entries.length === 1 ? "" : "s"}</span>
      </div>
      {bucket.entries.length ? (
        <div className="issue-list pull-issue-list">
          {bucket.entries.map((entry) => (
            <DailyPullIssueEntryRow entry={entry} key={entry.id} />
          ))}
        </div>
      ) : (
        <p className="health-empty">{bucket.emptyText}</p>
      )}
    </section>
  );
}

function DailyPullIssueEntryRow({ entry }: { entry: DailyPullIssueEntry }) {
  const Icon = entry.tone === "error" || entry.tone === "warning" ? AlertTriangle : CheckCircle2;
  return (
    <article className={`issue-row ${entry.tone}`}>
      <Icon size={15} />
      <div>
        <div className="issue-title">
          <span>{entry.title}</span>
        </div>
        <p className="issue-impact">{entry.impact}</p>
        <details className="issue-detail-drawer" open={entry.tone === "error"}>
          <summary>Details</summary>
          <p>{compactPath(entry.detail)}</p>
        </details>
      </div>
    </article>
  );
}

function UploadReceiptCheckPanel({ summary }: { summary: DailySummary | null }) {
  const receiptCheck = summary ? buildUploadReceiptCheck(summary) : null;
  if (!summary || !receiptCheck) {
    return null;
  }

  return (
    <div className={`receipt-check ${receiptCheck.tone}`} aria-label={`Google receipt check for ${summary.date}`} data-testid="upload-receipt-check">
      <div className="receipt-check-head">
        <span className={`health-pill ${receiptCheck.tone}`}>
          <AlertTriangle size={14} />
          {receiptCheck.badge}
        </span>
        <div>
          <b>{receiptCheck.title}</b>
          <p>{receiptCheck.detail}</p>
        </div>
      </div>
      <div className="receipt-facts">
        {receiptCheck.facts.map((fact) => (
          <span key={fact.label} title={fact.value}>
            <small>{fact.label}</small>
            <b>{fact.value}</b>
          </span>
        ))}
      </div>
      <ol>
        {receiptCheck.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function DailyPullGlance({ model, selectedDate }: { model: DailyPullViewModel; selectedDate: string }) {
  const readyCount = model.reviewItems.filter((item) => item.status === "complete").length;
  const problemCount = model.reviewItems.length - readyCount;
  const tone = model.reviewItems.some((item) => item.status === "failed")
    ? "failed"
    : model.reviewItems.some((item) => item.status === "warning")
      ? "warning"
      : "complete";

  return (
    <section className={`daily-pull-glance ${tone}`} data-testid="daily-pull-glance" aria-label={`Important daily pull checks for ${selectedDate}`}>
      <div className="review-panel-heading">
        <div>
          <span className="eyeless-label">Important Checks</span>
          <h3>{problemCount ? "Important checks need attention" : "Everything important is complete"}</h3>
        </div>
        <span className={`panel-count ${tone}`}>{readyCount}/{model.reviewItems.length} complete</span>
      </div>
      <div className="glance-check-list">
        {model.reviewItems.map((item) => (
          <DailyPullGlanceRow item={item} key={item.id} />
        ))}
      </div>
      {model.buckets.review.entries.length > 0 && (
        <div className="issue-list pull-issue-list" aria-label={`Important check blockers for ${selectedDate}`}>
          {model.buckets.review.entries.map((entry) => (
            <DailyPullIssueEntryRow entry={entry} key={entry.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function DailyPullGlanceRow({ item }: { item: DailyPullCoverageItem }) {
  const Icon = item.status === "complete" ? CheckCircle2 : item.status === "warning" ? AlertTriangle : CircleX;
  const detailText = item.status === "complete" ? item.readinessLabel : coverageImpactSummary(item);
  const statusLabel = item.status === "complete" ? "Complete" : item.status === "warning" ? "Check" : "Blocked";
  const title = [detailText, ...item.failures, ...item.warnings, ...item.notes].join("\n") || item.basis;

  return (
    <article aria-label={`${item.label}. ${statusLabel}. ${title}`} className={`glance-check ${item.status}`} title={title}>
      <span className="glance-check-icon" aria-hidden="true">
        <Icon size={17} />
      </span>
      <div className="glance-check-copy">
        <b>{item.label}</b>
        <small>{detailText}</small>
      </div>
      <div className="glance-check-meta">
        <span>{item.pulledLabel}</span>
        <b>{statusLabel}</b>
      </div>
    </article>
  );
}

function PullCoveragePanel({
  countLabel,
  eyebrow = "Required Outputs",
  items,
  selectedDate,
  title = "Needed vs pulled, scored by app usability",
}: {
  countLabel?: string;
  eyebrow?: string;
  items: DailyPullCoverageItem[];
  selectedDate: string;
  title?: string;
}) {
  const blockingCount = items.filter((item) => item.status === "failed").length;
  const watchlistCount = items.filter((item) => item.status === "warning").length;

  return (
    <section className="pull-coverage" data-testid="daily-pull-coverage" aria-label={`Required output coverage for ${selectedDate}`}>
      <div className="review-panel-heading">
        <div>
          <span className="eyeless-label">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <span className="panel-count">{countLabel ?? `${blockingCount} open - ${watchlistCount} watchlist`}</span>
      </div>
      <div className="coverage-table" role="table" aria-label="Daily pull output coverage">
        <div className="coverage-header" role="row">
          <span role="columnheader">Output</span>
          <span role="columnheader">Needed</span>
          <span role="columnheader">Pulled</span>
          <span role="columnheader">Missing</span>
        </div>
        {items.map((item) => (
          <PullCoverageRow item={item} key={item.id} />
        ))}
      </div>
    </section>
  );
}

function PullCoverageRow({ item }: { item: DailyPullCoverageItem }) {
  const impactSummary = coverageImpactSummary(item);
  const title = [impactSummary, ...item.failures, ...item.warnings, ...item.notes].join("\n") || item.basis;
  const Icon = item.status === "complete" ? CheckCircle2 : item.status === "warning" ? AlertTriangle : CircleX;
  const missingTone = item.missing && item.missing > 0 ? (item.status === "failed" ? "missing" : "soft-missing") : "";
  const detailGroups = [
    { label: "Errors", messages: item.failures, tone: "failure" },
    { label: "Warnings", messages: item.warnings, tone: "warning" },
    { label: "Notes", messages: item.notes, tone: "note" },
  ].filter((group) => group.messages.length > 0);
  const detailCount = detailGroups.reduce((total, group) => total + group.messages.length, 0);
  const detailLabel = detailCount === 1 ? "1 detail" : `${detailCount} details`;
  return (
    <article
      aria-label={`${item.label}. ${item.readinessLabel}. ${title}`}
      className={`coverage-row ${item.status}`}
      role="row"
      tabIndex={detailCount ? 0 : undefined}
      title={title}
    >
      <div className="coverage-output" role="cell">
        <span className="coverage-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <div>
          <div className="coverage-title-line">
            <b>{item.label}</b>
            <span className={`coverage-scope ${item.importance}`}>{coverageImportanceLabel(item.importance)}</span>
            <span className={`coverage-readiness ${item.status}`}>{item.readinessLabel}</span>
            {detailCount > 0 && <span className={`coverage-detail-count ${item.status}`}>{detailLabel}</span>}
          </div>
          <small>{item.basis}</small>
        </div>
      </div>
      <span className="coverage-number" role="cell">{item.expectedLabel}</span>
      <span className="coverage-number" role="cell">{item.pulledLabel}</span>
      <span className={`coverage-number ${missingTone}`} role="cell">{item.missingLabel}</span>
      {detailGroups.length > 0 && (
        <div className="coverage-detail-popover" role="tooltip">
          <div className={`coverage-detail-group impact ${item.status}`}>
            <strong>Review impact</strong>
            <span>{impactSummary}</span>
          </div>
          {detailGroups.map((group) => (
            <div className={`coverage-detail-group ${group.tone}`} key={group.label}>
              <strong>{group.label}</strong>
              {group.messages.map((message) => (
                <span key={message}>{message}</span>
              ))}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function coverageImportanceLabel(importance: DailyPullCoverageItem["importance"]): string {
  if (importance === "core") {
    return "Core";
  }
  if (importance === "support") {
    return "Support";
  }
  return "Breadth";
}

function PullStatusPill({ label, status, value }: { label: string; status: DailyPullStepStatus; value: number | string }) {
  return (
    <span className={`pull-status-pill ${status}`}>
      <b>{typeof value === "number" ? formatNumber(value) : value}</b>
      {label}
    </span>
  );
}

function bucketStatus(bucket: DailyPullIssueBucket): DailyPullStepStatus {
  if (bucket.tone === "error") {
    return "failed";
  }
  if (bucket.tone === "warning") {
    return "warning";
  }
  return "complete";
}

function PullStepRow({ index, step }: { index: number; step: DailyPullChecklistStep }) {
  const statusLabel = step.status === "complete" ? "Checked" : step.status === "warning" ? "Warning" : "Failed";
  const title = [...step.failures, ...step.warnings, ...step.notes].join("\n") || step.evidence;
  const Icon = step.status === "complete" ? CheckCircle2 : step.status === "warning" ? AlertTriangle : CircleX;

  return (
    <article
      aria-label={`${index}. ${step.action}. ${statusLabel}. ${title}`}
      className={`pull-step ${step.status}`}
      tabIndex={step.warnings.length || step.failures.length || step.notes.length ? 0 : undefined}
      title={title}
    >
      <span className="pull-step-index">{index}</span>
      <span className="pull-step-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="pull-step-body">
        <b>{step.action}</b>
        <small>{step.evidence}</small>
        {step.failures.length > 0 && (
          <div className="pull-step-failures">
            {step.failures.map((failure) => (
              <span key={failure}>{failure}</span>
            ))}
          </div>
        )}
        {step.warnings.length > 0 && (
          <div className="pull-step-hover">
            {step.warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        )}
        {step.notes.length > 0 && (
          <div className="pull-step-notes">
            {step.notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </div>
        )}
      </div>
      <span className={`pull-step-badge ${step.status}`}>{statusLabel}</span>
    </article>
  );
}

function DailyReviewScreen({
  acceptedIssueDates,
  allTrades,
  availableDates,
  dateIssueBadges,
  onReplayTrade,
  onSelectDate,
  selectedDate,
  selectedTradeId,
  sourceHealth,
  spxBars,
  spreadMarks,
  summary,
  trades,
}: {
  acceptedIssueDates: Set<string>;
  allTrades: TradeRecord[];
  availableDates: string[];
  dateIssueBadges: Map<string, DateIssueBadge>;
  onReplayTrade: (trade: TradeRecord) => void;
  onSelectDate: (date: string) => void;
  selectedDate: string;
  selectedTradeId?: string;
  sourceHealth: SourceHealth[];
  spxBars: SpxBar[];
  spreadMarks: SpreadMark[];
  summary: DailySummary | null;
  trades: TradeRecord[];
}) {
  const review = useMemo(() => buildDailyReview(trades), [trades]);
  const reviewTimelineEvents = useMemo(() => review.events.filter((event) => event.kind !== "expiration"), [review.events]);
  const reviewStats = useMemo(() => summarizeTrades(trades, EMPTY_WALLET), [trades]);
  const pnlSimulation = useMemo(() => buildDailyPnlSimulation(trades, spreadMarks, spxBars), [spxBars, spreadMarks, trades]);
  const pnlSimulationSummary = useMemo(() => summarizeDailyPnlSimulation(pnlSimulation), [pnlSimulation]);
  const reviewStatItems = useMemo(() => buildDailyReviewStatItems({ trades, spxBars }), [spxBars, trades]);
  const tradeMap = useMemo(() => mapTradesById(trades), [trades]);
  const [reviewChartInterval, setReviewChartInterval] = useState<ReviewChartInterval>(2);
  const [cheatCode, setCheatCode] = useState(false);
  const maContext = useSpxMaContext(selectedDate || null, cheatCode);
  const [exportStatus, setExportStatus] = useState<ReviewExportStatus>("idle");
  const [canCopyReview, setCanCopyReview] = useState(canAttemptClipboardCopy);
  const countsByDate = useMemo(() => countTradesByDate(allTrades), [allTrades]);
  const sideRows: TradeRecord["side"][] = ["Call", "Put", "Mixed"];

  useEffect(() => {
    setExportStatus("idle");
    setCanCopyReview(canAttemptClipboardCopy());
  }, [selectedDate]);

  const reviewExportMarkdown = useMemo(
    () =>
      buildDailyReviewMarkdown({
        date: selectedDate,
        review,
        sourceHealth,
        stats: reviewStats,
        summary,
        trades,
      }),
    [review, reviewStats, selectedDate, sourceHealth, summary, trades],
  );

  async function copyReviewExport() {
    const copied = await copyTextToClipboard(reviewExportMarkdown);
    if (copied) {
      setExportStatus("copied");
      return;
    }

    setCanCopyReview(false);
    setExportStatus("copy_unavailable");
  }

  function downloadReviewExport() {
    const blob = new Blob([reviewExportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = dailyReviewExportFilename(selectedDate);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportStatus("downloaded");
  }

  return (
    <section className="daily-review-shell">
      <aside className="review-date-rail" aria-label="Daily review dates">
        <div className="rail-title">
          <CalendarDays size={16} />
          Review Dates
        </div>
        <div className="date-list">
          {newestFirstDates(visibleReplayDateTabs(availableDates)).map((date) => {
            const issueBadge = dateIssueBadges.get(date);
            const acceptedIssues = acceptedIssueDates.has(date);
            const tradeCount = countsByDate.get(date) ?? 0;
            return (
              <button
                aria-label={dateButtonAriaLabel(date, tradeCount, issueBadge, acceptedIssues)}
                className={dateButtonClass(selectedDate === date, issueBadge)}
                key={date}
                onClick={() => onSelectDate(date)}
                title={issueBadge?.title ?? (acceptedIssues ? `${date}: issues accepted` : undefined)}
                type="button"
              >
                <span className="date-button-main">
                  <span className="date-label">{date}</span>
                  {issueBadge && <DateIssueBadgePill badge={issueBadge} />}
                </span>
                <DateTradeCount count={tradeCount} />
              </button>
            );
          })}
        </div>
      </aside>

      <section className="daily-review-main">
        <div className="review-hero">
          <div>
            <span className="eyeless-label">Daily Review</span>
            <h2>{selectedDate} entries and exits</h2>
            <p>
              {reviewTimelineEvents.length} timestamped events from {review.totalEntries} entries and {review.totalExits} exits.
            </p>
          </div>
          <div className="review-hero-actions">
            {canCopyReview && (
              <button
                className="review-action-button"
                disabled={!selectedDate}
                onClick={copyReviewExport}
                type="button"
              >
                <Copy size={16} />
                Copy Review
              </button>
            )}
            <button
              className="review-action-button"
              disabled={!selectedDate}
              onClick={downloadReviewExport}
              type="button"
            >
              <Download size={16} />
              Download .md
            </button>
            <button
              className="review-action-button"
              disabled={!trades.length}
              onClick={() => trades[0] && onReplayTrade(trades[0])}
              type="button"
            >
              <Play size={17} />
              Open Replay
            </button>
          </div>
        </div>
        {exportStatus !== "idle" && (
          <div className={`review-export-status ${exportStatus}`} aria-live="polite">
            {exportStatus === "copied"
              ? "Review copied as markdown"
              : exportStatus === "downloaded"
                ? `${dailyReviewExportFilename(selectedDate)} downloaded`
                : "Copy unavailable here; Download .md is ready"}
          </div>
        )}

        <div className="review-metric-grid">
          <ReviewMetric
            detail={`${review.closedTrades} closed - ${review.openTrades} open`}
            icon={<ClipboardList size={15} />}
            label="Entries / exits"
            value={`${review.totalEntries} / ${review.totalExits}`}
          />
          <ReviewMetric
            detail={`${formatPercent(reviewStats.winRate)} win rate`}
            icon={<Target size={15} />}
            label="Net result"
            tone={review.netPnl >= 0 ? "good" : "bad"}
            value={formatSignedCurrency(review.netPnl)}
          />
          <ReviewMetric
            detail={`Best ${formatSignedCurrency(review.bestTrade)} - worst ${formatSignedCurrency(review.worstTrade)}`}
            icon={<BarChart3 size={15} />}
            label="Distribution"
            value={formatSignedCurrency(reviewStats.avgPnl)}
          />
          <ReviewMetric
            detail={`${formatCurrency(review.maxProfit)} max profit modeled`}
            icon={<ShieldCheck size={15} />}
            label="Risk carried"
            value={formatCurrency(review.maxRisk)}
          />
        </div>

        <section className="review-panel review-entry-exit-panel">
          <div className="review-panel-heading">
            <div>
              <span className="eyeless-label">Map</span>
              <h3>Entry / Exit Map</h3>
            </div>
            <div className="review-chart-controls">
              <div className="review-marker-legend">
                <span className="legend-item put">Long: PCS entries / CCS exits</span>
                <span className="legend-item call">Short: CCS entries / PCS exits</span>
                <span className="legend-item shape">Size = entry premium</span>
                <span className="legend-item pnl">P/L overlay</span>
              </div>
              <div
                aria-label={`Daily P/L overlay final ${formatSignedCurrency(pnlSimulationSummary.finalPnl)}, high ${formatSignedCurrency(pnlSimulationSummary.highPnl)}, low ${formatSignedCurrency(pnlSimulationSummary.lowPnl)}, drawdown ${formatCurrency(pnlSimulationSummary.maxDrawdown)}`}
                className="review-pnl-inline-summary"
                data-testid="daily-pnl-simulator"
                title={`P/L overlay: final ${formatSignedCurrency(pnlSimulationSummary.finalPnl)}; high/low ${formatSignedCurrency(pnlSimulationSummary.highPnl)} / ${formatSignedCurrency(pnlSimulationSummary.lowPnl)}; drawdown ${formatCurrency(pnlSimulationSummary.maxDrawdown)}; open max ${formatNumber(pnlSimulationSummary.maxOpenTrades)}`}
              >
                <span>
                  P/L <b className={pnlSimulationSummary.finalPnl >= 0 ? "profit" : "loss"}>{formatSignedCurrency(pnlSimulationSummary.finalPnl)}</b>
                </span>
                <span>
                  DD <b className="loss">{formatCurrency(pnlSimulationSummary.maxDrawdown)}</b>
                </span>
              </div>
              <div className="micro-segment" role="group" aria-label="Daily review chart timeframe">
                {REVIEW_CHART_INTERVALS.map((interval) => (
                  <button
                    aria-pressed={reviewChartInterval === interval}
                    className={reviewChartInterval === interval ? "active" : ""}
                    key={interval}
                    onClick={() => setReviewChartInterval(interval)}
                    type="button"
                  >
                    {interval}m
                  </button>
                ))}
                <button
                  aria-pressed={cheatCode}
                  className={cheatCode ? "active" : ""}
                  onClick={() => setCheatCode((enabled) => !enabled)}
                  title="Toggle cheat-code moving averages (50/200 EMA & SMA)"
                  type="button"
                >
                  CC
                </button>
              </div>
            </div>
          </div>
          <div className="review-map-stage">
            {spxBars.length ? (
              <ReviewEntryExitChart
                bars={spxBars}
                intervalMinutes={reviewChartInterval}
                pnlPoints={pnlSimulation}
                trades={trades}
                onSelectTrade={onReplayTrade}
                cheatCode={cheatCode}
                warmupCloses={maContext?.byInterval[String(reviewChartInterval)] ?? []}
              />
            ) : (
              <div className="review-empty">SPX bars are not loaded for this date yet.</div>
            )}
          </div>
        </section>

        {reviewStatItems.length > 0 && (
          <section className="review-panel review-stats-panel">
            <div className="review-panel-heading">
              <div>
                <span className="eyeless-label">Day statistics</span>
                <h3>Session &amp; Execution</h3>
              </div>
              <span className="panel-count">{reviewStatItems.length} stats</span>
            </div>
            <div className="review-stats-grid">
              {reviewStatItems.map((item) => (
                <div className={`review-stat-chip${item.tone && item.tone !== "neutral" ? ` ${item.tone}` : ""}`} key={item.key}>
                  <span className="review-stat-label">{item.label}</span>
                  <strong className="review-stat-value">{item.value}</strong>
                  {item.detail && <span className="review-stat-detail">{item.detail}</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="review-content-grid">
          <section className="review-panel event-panel">
            <div className="review-panel-heading">
              <div>
                <span className="eyeless-label">Sequence</span>
                <h3>Entry / Exit Timeline</h3>
              </div>
              <span className="panel-count">{reviewTimelineEvents.length} events</span>
            </div>
            <div className="event-timeline">
              {reviewTimelineEvents.map((event) => {
                const trade = tradeMap.get(event.tradeId);
                return (
                  <button
                    className={`timeline-event ${event.kind} ${selectedTradeId === event.tradeId ? "selected" : ""}`}
                    disabled={!trade}
                    key={`${event.tradeId}-${event.kind}-${event.time}`}
                    onClick={() => trade && onReplayTrade(trade)}
                    type="button"
                  >
                    <span className="event-kind-icon">{event.kind === "entry" ? <LogIn size={14} /> : <LogOut size={14} />}</span>
                    <span className="event-time">{event.timeLabel}</span>
                    <span className={`side-pill ${event.side.toLowerCase()}`}>{reviewActionDirectionLabel(event.side)}</span>
                    <span className="event-main">
                      <b>{event.strikes}</b>
                      <small>{event.strategy} - {formatNumber(event.contracts)} contract{event.contracts === 1 ? "" : "s"}</small>
                    </span>
                    <span className="event-detail">
                      <b>{event.kind === "entry" ? "Entry" : "Exit"} {formatNumber(event.price, 2)}</b>
                      <small>SPX {formatNumber(event.spx, 2)}</small>
                    </span>
                    <span className="event-lifecycle">
                      {trade ? (
                        <>
                          <b>Entry {tradeClockLabel(trade.entryTime)} @ {formatNumber(trade.entryPrice, 2)}</b>
                          <small>
                            Exit {tradeExitClockLabel(trade)} @ {trade.exitPrice === null ? "open" : formatNumber(trade.exitPrice, 2)} - Held {tradeHeldLabel(trade)} - P/L {formatSignedCurrency(trade.pnl)}
                          </small>
                        </>
                      ) : (
                        <>
                          <b>Trade unavailable</b>
                          <small>Entry / exit data not loaded</small>
                        </>
                      )}
                    </span>
                    <span className={event.pnl >= 0 ? "profit" : "loss"}>{formatSignedCurrency(event.pnl)}</span>
                  </button>
                );
              })}
              {!reviewTimelineEvents.length && <div className="review-empty">No entry or exit events were imported for this date.</div>}
            </div>
          </section>

          <aside className="review-side-stack">
            <section className="review-panel">
              <div className="review-panel-heading">
                <div>
                  <span className="eyeless-label">Composition</span>
                  <h3>Side Breakdown</h3>
                </div>
              </div>
              <div className="side-review-list">
                {sideRows.map((side) => {
                  const nextSide = review.sideBreakdown[side];
                  return (
                    <div className="side-review-row" key={side}>
                      <span className={`side-pill ${side.toLowerCase()}`}>{side}</span>
                      <b>{nextSide.count} trade{nextSide.count === 1 ? "" : "s"}</b>
                      <span className={nextSide.pnl >= 0 ? "profit" : "loss"}>{formatSignedCurrency(nextSide.pnl)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </aside>
        </div>

        <section className="review-panel ledger-panel">
          <div className="review-panel-heading">
            <div>
              <span className="eyeless-label">Ledger</span>
              <h3>Trade-by-trade detail</h3>
            </div>
            <span className="panel-count">{trades.length} trades</span>
          </div>
          <div className="review-ledger-wrap">
            <table className="review-ledger">
              <thead>
                <tr>
                  <th>Trade</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>Held</th>
                  <th>Credit/Debit</th>
                  <th>Risk</th>
                  <th>P/L</th>
                  <th>Return</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr className={selectedTradeId === trade.id ? "selected" : ""} key={trade.id}>
                    <td>
                      <button className="ledger-trade-button" onClick={() => onReplayTrade(trade)} type="button">
                        <span className={`side-pill ${trade.side.toLowerCase()}`}>{trade.side}</span>
                        <b>{trade.shortStrike}/{trade.longStrike}</b>
                      </button>
                    </td>
                    <td>
                      <b>{tradeClockLabel(trade.entryTime)}</b>
                      <small>SPX {formatNumber(trade.spxEntry, 2)}</small>
                    </td>
                    <td>
                      <b>{tradeExitClockLabel(trade)}</b>
                      <small>SPX {formatNumber(trade.spxExit, 2)}</small>
                    </td>
                    <td>{tradeHeldLabel(trade)}</td>
                    <td>{trade.priceType} {formatNumber(trade.entryPrice, 2)}</td>
                    <td>{formatCurrency(trade.maxRisk)}</td>
                    <td className={trade.pnl >= 0 ? "profit" : "loss"}>{formatSignedCurrency(trade.pnl)}</td>
                    <td>{formatPercent(trade.returnOnRisk)}</td>
                  </tr>
                ))}
                {!trades.length && (
                  <tr>
                    <td colSpan={8}>No trades found for this date.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </section>
  );
}

function ReviewMetric({
  detail,
  icon,
  label,
  tone,
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  tone?: "good" | "bad";
  value: string;
}) {
  return (
    <div className={`review-metric ${tone ?? ""}`}>
      <span className="metric-label">
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function MarketFreshnessBanner({ freshness }: { freshness: NonNullable<ReturnType<typeof marketFreshness>> }) {
  const Icon = freshness.tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <section className={`market-freshness ${freshness.tone}`} aria-label="Market date freshness">
      <Icon size={16} />
      <div>
        <strong>{freshness.label}</strong>
        <span>{freshness.detail}</span>
      </div>
    </section>
  );
}

function DateIssueBadgePill({ badge }: { badge: DateIssueBadge }) {
  return (
    <span aria-hidden="true" className={`date-issue-badge ${badge.tone}`} title={badge.title}>
      <AlertTriangle size={11} />
      <span>{badge.count}</span>
      <small>{badge.count === 1 ? "issue" : "issues"}</small>
    </span>
  );
}

function DateTradeCount({ count }: { count: number }) {
  return (
    <span className="date-trade-count">
      <b>{count}</b>
      <small>{count === 1 ? "trade" : "trades"}</small>
    </span>
  );
}

function dateButtonClass(active: boolean, issueBadge?: DateIssueBadge): string {
  return [active ? "active" : "", issueBadge ? `has-date-issues ${issueBadge.tone}` : ""].filter(Boolean).join(" ");
}

function dateButtonAriaLabel(date: string, tradeCount: number, issueBadge?: DateIssueBadge, acceptedIssues = false): string {
  const tradeNoun = tradeCount === 1 ? "trade" : "trades";
  const issueText = issueBadge ? `, ${issueBadge.label} need review` : acceptedIssues ? ", issues accepted" : ", clean import";
  return `${date}, ${tradeCount} ${tradeNoun}${issueText}`;
}

function isIbkrWalletSource(source: SourceHealth): boolean {
  return source.label.trim().toLowerCase() === "ibkr wallet";
}

function SourceLedger({
  dailySyncStatus,
  googleSnapshotRefreshMessage,
  googleSnapshotRefreshing,
  latestTradeDate,
  onRefreshGoogleSnapshot,
  selectedDate,
  sources,
  today,
}: {
  dailySyncStatus: DailySyncStatusResult | null;
  googleSnapshotRefreshMessage: string;
  googleSnapshotRefreshing: boolean;
  latestTradeDate: string | null;
  onRefreshGoogleSnapshot: () => void;
  selectedDate: string;
  sources: SourceHealth[];
  today: string;
}) {
  const diagnostics = buildDailySyncDiagnostics(dailySyncStatus, selectedDate);
  const readiness = buildDailySyncReadiness(dailySyncStatus, today, latestTradeDate);
  const visibleSources = sources.filter((source) => source.status !== "ok" && !isIbkrWalletSource(source));

  return (
    <section className="source-ledger" aria-label="Data source state">
      <div className="source-ledger-heading">
        <span className="eyeless-label">Source State</span>
        <div className="source-ledger-actions">
          <button
            className="source-action-button"
            disabled={googleSnapshotRefreshing}
            onClick={onRefreshGoogleSnapshot}
            title="Refresh the SPX tracker snapshot through configured Google Sheets API credentials"
            type="button"
          >
            <RefreshCcw size={13} />
            {googleSnapshotRefreshing ? "Refreshing Google" : "Refresh Google"}
          </button>
        </div>
      </div>
      {googleSnapshotRefreshMessage && <p className="source-ledger-message">{googleSnapshotRefreshMessage}</p>}
      {readiness.tone === "error" && (
        <section className={`sync-readiness ${readiness.tone}`} aria-label="Daily sync readiness">
          <AlertTriangle size={15} />
          <div>
            <strong>{readiness.label}</strong>
            <span>{readiness.detail}</span>
          </div>
        </section>
      )}
      {diagnostics.available && (
        <details className={`sync-diagnostics ${diagnostics.tone}`} open={diagnostics.tone !== "ok"}>
          <summary>
            <span>{diagnostics.title}</span>
            <b>{diagnostics.badge}</b>
          </summary>
          <div className="sync-diagnostics-facts">
            {diagnostics.facts.map((fact) => (
              <span key={fact.label}>
                <b>{fact.label}</b>
                {fact.value}
              </span>
            ))}
          </div>
          {diagnostics.stages.length > 0 && (
            <ol className="sync-step-list pipeline-stage-list" aria-label="Daily pipeline stage progress">
              {diagnostics.stages.map((stage) => {
                const Icon = pipelineStatusIcon(stage.status);
                return (
                  <li className={`sync-step-item ${stage.status}`} key={stage.id}>
                    <Icon size={13} />
                    <div>
                      <b>{stage.label}</b>
                      <span>{stage.detail || formatStatus(stage.status)}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {diagnostics.steps.length > 0 && (
            <ol className="sync-step-list" aria-label="Daily sync output progress">
              {diagnostics.steps.map((step) => {
                const Icon = syncStepIcon(step.status);
                return (
                  <li className={`sync-step-item ${step.status}`} key={step.id}>
                    <Icon size={13} />
                    <div>
                      <b>{step.label}</b>
                      <span>{step.detail || formatStatus(step.status)}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {diagnostics.warnings.length > 0 && (
            <ul className="sync-warning-list" aria-label="Daily sync warnings">
              {diagnostics.warnings.map((warning) => (
                <li key={warning}>
                  <AlertTriangle size={12} />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          )}
          {diagnostics.logPath && <p className="sync-log-path">{compactPath(diagnostics.logPath)}</p>}
          {diagnostics.logLines.length ? (
            <pre className="sync-log-tail">{diagnostics.logLines.join("\n")}</pre>
          ) : (
            <p className="sync-log-empty">No latest sync log tail was reported.</p>
          )}
        </details>
      )}
      {visibleSources.length > 0 && (
        <div className="source-ledger-grid">
          {visibleSources.map((source) => {
            const content = (
              <>
                <span className="source-ledger-title">
                  <ShieldCheck size={14} />
                  {source.label}
                </span>
                <strong>{formatStatus(source.status)}</strong>
                <small>{source.count === undefined ? source.detail : `${formatNumber(source.count)} - ${source.detail}`}</small>
              </>
            );

            return source.url ? (
              <a className={`source-ledger-item ${source.status}`} href={source.url} key={source.label} rel="noreferrer" target="_blank">
                {content}
              </a>
            ) : (
              <div className={`source-ledger-item ${source.status}`} key={source.label}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function dailySyncStatusMessage(status: DailySyncStatusResult): string {
  const evidenceSummary = status.latestSummary ?? status.latestPipelineRun;
  const summary = evidenceSummary
    ? ` Latest pipeline run ${evidenceSummary.date}: ${evidenceSummary.status ?? "unknown"} availability, ${formatNumber(evidenceSummary.entryCount ?? 0)} entries.`
    : "";
  const pid = status.pid ? ` PID ${status.pid}.` : "";
  const googleVerdict = status.googleUploaded === undefined ? "unknown" : status.googleUploaded ? "uploaded" : "not uploaded";
  const verdict = status.reviewReady !== undefined || status.googleUploaded !== undefined
    ? ` Review ${status.reviewReady ? "ready" : "not ready"}; Google ${googleVerdict}.`
    : "";
  const targetPlan = status.targetPlan ? ` ${status.targetPlan.note}` : "";
  const command = status.dryRun && status.command?.length ? ` Command: ${status.command.join(" ")}` : "";
  return `${status.message}${pid}${verdict}${summary}${targetPlan}${command}`;
}

function isAbortLike(error: Error): boolean {
  return error.name === "AbortError" || error.message.toLowerCase().includes("aborted");
}

function Kpi({ detail, label, tone, value }: { detail?: string; label: string; tone?: "good" | "bad"; value: string }) {
  return (
    <div className={`kpi-card ${tone ?? ""}`}>
      <span className="kpi-label">{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function formatStatus(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pipelineStatusIcon(status: string) {
  if (status === "complete") {
    return CheckCircle2;
  }
  if (status === "warning") {
    return AlertTriangle;
  }
  if (status === "failed") {
    return CircleX;
  }
  return Activity;
}

function syncStepIcon(status: DailySyncStepStatus) {
  return pipelineStatusIcon(status);
}

function compactPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replace(/^.*\/(IBKR Equity History Pull\/data\/ibkr_trades\/)/, "$1");
}

function formatRefreshTime(): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date());
}

function TradeTable({
  onSelect,
  selectedTradeId,
  trades,
}: {
  onSelect: (trade: TradeRecord) => void;
  selectedTradeId?: string;
  trades: TradeRecord[];
}) {
  return (
    <div className="trade-table-wrap">
      <table className="trade-table">
        <thead>
          <tr>
            <th>In</th>
            <th>Out</th>
            <th>Side</th>
            <th>Strikes</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>P/L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr className={tradeRowClass(trade, selectedTradeId)} key={trade.id} onClick={() => onSelect(trade)}>
              <td>{tradeClockLabel(trade.entryTime)}</td>
              <td>{tradeExitClockLabel(trade)}</td>
              <td>
                <span className={`side-pill ${trade.side.toLowerCase()}`}>{trade.side}</span>
              </td>
              <td>{trade.shortStrike}/{trade.longStrike}</td>
              <td>{formatNumber(trade.contracts)}</td>
              <td>
                <span className="entry-price-cell">
                  {trade.entryChartDeviationFlag && (
                    <span className="price-alert" title={entryDeviationTitle(trade)} aria-label={entryDeviationTitle(trade)}>
                      !
                    </span>
                  )}
                  <span>{trade.entryPrice.toFixed(2)}</span>
                </span>
              </td>
              <td>{trade.exitPrice === null ? "-" : trade.exitPrice.toFixed(2)}</td>
              <td className={trade.pnl >= 0 ? "profit" : "loss"}>{formatSignedCurrency(trade.pnl)}</td>
            </tr>
          ))}
          {!trades.length && (
            <tr>
              <td colSpan={8}>No trades found for this range.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function tradeRowClass(trade: TradeRecord, selectedTradeId?: string): string {
  return [selectedTradeId === trade.id ? "selected" : "", trade.entryChartDeviationFlag ? "entry-price-warning" : ""].filter(Boolean).join(" ");
}

function journalStatusLabel(status: JournalStatus): string {
  if (status === "reviewed") {
    return "Reviewed";
  }
  if (status === "draft") {
    return "Draft";
  }
  return "To review";
}

function journalAspectProgress(trade: TradeRecord, entry: TradeJournalEntry | undefined): { complete: number; total: number } | null {
  const requiredItems = journalAspectChecklistForTrade(trade).filter((item) => !item.optional);
  if (!requiredItems.length) {
    return null;
  }
  return {
    complete: requiredItems.filter((item) => entry?.aspectChecks[item.key]).length,
    total: requiredItems.length,
  };
}

function readJournalEntriesFromStorage(): Record<string, TradeJournalEntry> {
  if (typeof window === "undefined") {
    return {};
  }
  return parseJournalEntries(window.localStorage.getItem(JOURNAL_STORAGE_KEY));
}

function writeJournalEntriesToStorage(entries: Record<string, TradeJournalEntry>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(JOURNAL_STORAGE_KEY, serializeJournalEntries(entries));
}

function readAcceptedPullIssueDatesFromStorage(): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACCEPTED_PULL_ISSUE_DATES_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function writeAcceptedPullIssueDatesToStorage(dates: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ACCEPTED_PULL_ISSUE_DATES_KEY, JSON.stringify([...dates].sort()));
}

function entryDeviationTitle(trade: TradeRecord): string {
  const time = tradeClockLabel(trade.entryChartMarkTime, "entry");
  return [
    "Entry fill differs from reconstructed chart mark",
    `fill ${formatNumber(trade.entryPrice, 2)}`,
    `chart ${formatNumber(trade.entryChartMark, 2)} at ${time} EST`,
    `diff ${formatSignedPrice(trade.entryChartDeviation)}`,
    `${formatPercent(trade.entryChartDeviationPct)}`,
  ].join(" - ");
}

function formatSignedPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return value > 0 ? `+${formatNumber(value, 2)}` : formatNumber(value, 2);
}

export default App;
