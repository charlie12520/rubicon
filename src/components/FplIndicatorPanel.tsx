import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineSeries,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { FplIndicatorBar, FplIndicatorPayload, FplLiveStatus } from "../../shared/types";
import {
  fetchFplIndicator,
  fetchFplManifest,
  fetchFplLiveStatus,
  startFplLivePredictor,
  stopFplLivePredictor,
} from "../api";
import { easternDateOffset } from "../easternDate";
import { rubiconChartOptions, toCandlestickData, toLineData } from "./lightweightChartHelpers";

type Props = {
  initialDate?: string;
};

const LANE_COLORS = {
  enter: "#22d3ee",
  scale_in: "#a3e635",
  scale_out: "#f59e0b",
  exit: "#f43f5e",
} as const;

const POLL_INTERVAL_MS = 10_000;

type CheatCodeKey = "ema50" | "sma50" | "ema200" | "sma200";

const CHEAT_OPTIONS: Array<{ key: CheatCodeKey; label: string; color: string; selector: (b: FplIndicatorBar) => number }> = [
  { key: "ema50", label: "2m 50 EMA", color: "#a3e635", selector: (b) => b.structural.cheatCode50Ema2m },
  { key: "sma50", label: "2m 50 SMA", color: "#facc15", selector: (b) => b.structural.cheatCode50Sma2m },
  { key: "ema200", label: "2m 200 EMA", color: "#fb7185", selector: (b) => b.structural.cheatCode200Ema2m },
  { key: "sma200", label: "2m 200 SMA", color: "#c084fc", selector: (b) => b.structural.cheatCode200Sma2m },
];

// Actionable thresholds (derived empirically on Stage 6 test slice; see
// analysis/fpl_perbar_indicator/stage6_production/thresholds_by_class.csv)
const ACTION_THRESHOLDS: Record<"enter" | "scale_in" | "scale_out" | "exit", { tight: number; loose: number }> = {
  enter:     { tight: 0.05,  loose: 0.01 },
  scale_in:  { tight: 0.02,  loose: 0.005 },
  scale_out: { tight: 0.001, loose: 0.0005 },
  exit:      { tight: 0.01,  loose: 0.005 },
};

function formatPct(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function formatProb(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(4);
}

function liveRunnerLabel(status: FplLiveStatus | null, busy: boolean): string {
  if (busy) return "working…";
  if (!status) return "";
  if (status.available === false) return "predictor script not found";
  if (status.running) {
    const last = status.logTail[status.logTail.length - 1] ?? "streaming…";
    return last.length > 72 ? `${last.slice(0, 72)}…` : last;
  }
  const schedule = status.autoStartEt ? ` · auto-start ${status.autoStartEt} ET` : "";
  if (status.lastExit) return `stopped (exit ${status.lastExit.code ?? "—"})${schedule}`;
  return `idle${schedule}`;
}

// Action signals: mark the FIRST bar of each contiguous run where a class
// probability crosses its actionable ("tight") threshold, so a strong call
// shows once on the candle instead of smearing across every armed minute.
// Only scale-in and exit are shown (user's choice for the live tool). Note both
// are the model's weak classes (~0 test precision); markers fire only when the
// probability clears its threshold, which is rare.
const MARKER_DEFS: Array<{
  selector: (b: FplIndicatorBar) => number;
  threshold: number;
  color: string;
  position: "aboveBar" | "belowBar";
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
}> = [
  { selector: (b) => b.pScaleIn, threshold: ACTION_THRESHOLDS.scale_in.tight, color: LANE_COLORS.scale_in, position: "belowBar", shape: "circle", text: "S+" },
  { selector: (b) => b.pExit, threshold: ACTION_THRESHOLDS.exit.tight, color: LANE_COLORS.exit, position: "aboveBar", shape: "arrowDown", text: "EXT" },
];

function buildActionMarkers(bars: FplIndicatorBar[]): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const def of MARKER_DEFS) {
    let prevArmed = false;
    for (const bar of bars) {
      const value = def.selector(bar);
      const armed = Number.isFinite(value) && value >= def.threshold;
      if (armed && !prevArmed) {
        markers.push({
          time: bar.time as UTCTimestamp,
          position: def.position,
          color: def.color,
          shape: def.shape,
          text: def.text,
        });
      }
      prevArmed = armed;
    }
  }
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}

export function FplIndicatorPanel({ initialDate }: Props) {
  const [manifest, setManifest] = useState<string[]>([]);
  const [date, setDate] = useState<string>(initialDate ?? "");
  const [payload, setPayload] = useState<FplIndicatorPayload | null>(null);
  const [cursorIndex, setCursorIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<FplLiveStatus | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  // Live mode == predictor is actually running. One source of truth, derived
  // from the status poll, so the user only ever has to press Start/Stop.
  const live = liveStatus?.running ?? false;
  const wantTodayRef = useRef(false);
  const dateRef = useRef(date);
  const todayEt = useMemo(() => easternDateOffset(0), []);

  const chartContainer = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);
  const cheatRefs = useRef<Record<CheatCodeKey, ReturnType<IChartApi["addSeries"]> | null>>({
    ema50: null,
    sma50: null,
    ema200: null,
    sma200: null,
  });
  const [cheatOn, setCheatOn] = useState<Record<CheatCodeKey, boolean>>({
    ema50: true,
    sma50: false,
    ema200: true,
    sma200: false,
  });
  const [cheatMenuOpen, setCheatMenuOpen] = useState(false);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [markersOn, setMarkersOn] = useState(true);

  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    fetchFplManifest(controller.signal)
      .then((m) => {
        setManifest(m.dates);
        if (!m.dates.length) return;
        const latest = m.dates[m.dates.length - 1];
        if (!date) {
          setDate(latest);
        } else if (!m.dates.includes(date)) {
          // Caller asked for a date that has no prediction CSV (model lags
          // the cockpit's IBKR data). Clamp to the latest available and
          // surface a note so the user knows why.
          setStaleNote(`Predictions unavailable for ${date}; showing latest (${latest}).`);
          setDate(latest);
        } else {
          setStaleNote(null);
        }
      })
      .catch((err: Error) => setError(err.message));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    // Wait for the manifest before fetching: fetching a date the model has not
    // predicted yet (e.g. the cockpit's latest IBKR date) 500s. The manifest
    // effect clamps `date` to the newest available session, so gate on it.
    if (!date || !manifest.includes(date)) return;
    const controller = new AbortController();
    setError(null);
    fetchFplIndicator(date, live, controller.signal)
      .then((p) => {
        setPayload(p);
        setCursorIndex(Math.max(0, p.bars.length - 1));
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [date, live, manifest]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      if (date) {
        fetchFplIndicator(date, true).then((p) => setPayload(p)).catch(() => undefined);
      }
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [date, live]);

  // Poll the live predictor process status; while it is running, refresh the
  // manifest so today's session appears and auto-select it.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await fetchFplLiveStatus();
        if (cancelled) return;
        setLiveStatus(status);
        if (status.running) {
          const next = await fetchFplManifest();
          if (cancelled) return;
          setManifest(next.dates);
          if (next.dates.includes(todayEt) && (wantTodayRef.current || dateRef.current === todayEt || !next.dates.includes(dateRef.current))) {
            setDate(todayEt);
            setStaleNote(null);
            wantTodayRef.current = false;
          }
        }
      } catch {
        /* status endpoint unreachable — ignore and retry */
      }
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [todayEt]);

  const onStartLive = async () => {
    setLiveBusy(true);
    setError(null);
    try {
      const status = await startFplLivePredictor();
      setLiveStatus(status);
      wantTodayRef.current = true;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLiveBusy(false);
    }
  };

  const onStopLive = async () => {
    setLiveBusy(true);
    try {
      const status = await stopFplLivePredictor();
      setLiveStatus(status);
      wantTodayRef.current = false;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLiveBusy(false);
    }
  };

  useEffect(() => {
    if (!chartContainer.current) return;
    const chart = createChart(chartContainer.current, rubiconChartOptions({
      overrides: {
        handleScale: false,
        handleScroll: false,
        layout: { attributionLogo: false },
      },
      palette: {
        gridColor: "rgba(56, 189, 248, 0.06)",
        textColor: "#94a3b8",
        timeBorderColor: "rgba(56, 189, 248, 0.18)",
      },
    }));
    chartRef.current = chart;
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#22d3ee",
      downColor: "#f43f5e",
      wickUpColor: "#22d3ee",
      wickDownColor: "#f43f5e",
      borderVisible: false,
    });
    cheatRefs.current = {
      ema50: chart.addSeries(LineSeries, { color: "#a3e635", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "" }),
      sma50: chart.addSeries(LineSeries, { color: "#facc15", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "" }),
      ema200: chart.addSeries(LineSeries, { color: "#fb7185", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "" }),
      sma200: chart.addSeries(LineSeries, { color: "#c084fc", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "" }),
    };
    markersRef.current = createSeriesMarkers(candleRef.current, []);

    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      cheatRefs.current = { ema50: null, sma50: null, ema200: null, sma200: null };
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!payload || !candleRef.current) return;
    candleRef.current.setData(toCandlestickData(payload.bars));

    for (const opt of CHEAT_OPTIONS) {
      const series = cheatRefs.current[opt.key];
      if (!series) continue;
      series.setData(cheatOn[opt.key] ? toLineData(payload.bars, opt.selector) : []);
    }
    markersRef.current?.setMarkers(markersOn ? buildActionMarkers(payload.bars) : []);
    if (payload.bars.length) {
      // Pin the visible window to the full RTH session (09:30 → 16:00 ET).
      // First bar is the 09:30 bar; 16:00 is +6.5h. Source SPX series stops
      // at 15:59, so without this the axis would end at 15:59.
      const from = payload.bars[0].time as UTCTimestamp;
      const to = (payload.bars[0].time + 6.5 * 3600) as UTCTimestamp;
      chartRef.current?.timeScale().setVisibleRange({ from, to });
    } else {
      chartRef.current?.timeScale().fitContent();
    }
  }, [payload, cheatOn, markersOn]);

  const currentBar: FplIndicatorBar | null = useMemo(() => {
    if (!payload?.bars.length) return null;
    const idx = Math.max(0, Math.min(cursorIndex, payload.bars.length - 1));
    return payload.bars[idx];
  }, [payload, cursorIndex]);

  return (
    <section className="fpl-panel" aria-label="FPL Indicator">
      <header className="fpl-panel-header">
        <div className="fpl-title">
          <span className="fpl-eyeless">Model</span>
          <h2>FPL Indicator</h2>
          <p className="fpl-subtitle">
            Stage 6 production · 4-class · cheat code + 0DTE structural features
          </p>
        </div>
        <div className="fpl-controls">
          <label className="fpl-control">
            <span>Session</span>
            <select
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setStaleNote(null);
              }}
            >
              {manifest.slice().reverse().map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <div className="fpl-live-runner" role="group" aria-label="Live predictor">
            <span className="fpl-runner-label">Live predictor</span>
            {liveStatus?.running ? (
              <button type="button" className="fpl-live-button stop" onClick={onStopLive} disabled={liveBusy}>
                ■ Stop
              </button>
            ) : (
              <button
                type="button"
                className="fpl-live-button start"
                onClick={onStartLive}
                disabled={liveBusy || liveStatus?.available === false}
                title="Spawns fpl_live_predict.py --live and starts polling today's session. Needs IBKR TWS/Gateway running."
              >
                ▶ Start
              </button>
            )}
            <span className={`fpl-live-state${liveStatus?.running ? " on" : ""}`}>
              {liveRunnerLabel(liveStatus, liveBusy)}
            </span>
          </div>
        </div>
      </header>

      {error && <div className="fpl-error">{error}</div>}
      {staleNote && !error && <div className="fpl-stale">{staleNote}</div>}

      <div className="fpl-grid">
        <div className="fpl-chart-wrap">
          <div className="fpl-chart-header">
            <span className="fpl-rail-label">SPX intraday · model overlays</span>
            <div className="fpl-overlay-controls">
              <button
                type="button"
                className={`fpl-overlay-toggle signal${markersOn ? " on" : ""}`}
                onClick={() => setMarkersOn((v) => !v)}
                aria-pressed={markersOn}
              >
                Signals
              </button>
              <div className="fpl-cheat-menu">
              <button
                type="button"
                className={`fpl-cheat-toggle${cheatMenuOpen ? " open" : ""}`}
                onClick={() => setCheatMenuOpen((v) => !v)}
                aria-expanded={cheatMenuOpen}
              >
                Cheat code · {CHEAT_OPTIONS.filter((o) => cheatOn[o.key]).length}/{CHEAT_OPTIONS.length}
                <span className="fpl-cheat-caret" aria-hidden>▾</span>
              </button>
              {cheatMenuOpen && (
                <div className="fpl-cheat-dropdown" role="menu">
                  {CHEAT_OPTIONS.map((opt) => (
                    <label key={opt.key} className="fpl-cheat-item">
                      <input
                        type="checkbox"
                        checked={cheatOn[opt.key]}
                        onChange={(event) =>
                          setCheatOn((prev) => ({ ...prev, [opt.key]: event.target.checked }))
                        }
                      />
                      <span className="fpl-cheat-swatch" style={{ background: opt.color }} />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            </div>
          </div>
          <div className="fpl-overlay-legend">
            <span className="lg-item sc">● scale-in</span>
            <span className="lg-item ext">▼ exit</span>
          </div>
          <div className="fpl-chart" ref={chartContainer} />
          <div className="fpl-scrubber">
            <input
              type="range"
              min={0}
              max={Math.max(0, (payload?.bars.length ?? 1) - 1)}
              value={cursorIndex}
              onChange={(event) => setCursorIndex(Number(event.target.value))}
            />
            <span className="fpl-scrubber-label">
              {currentBar?.label ?? "--:--"}
            </span>
          </div>
        </div>

        <ProbLanes bars={payload?.bars ?? []} cursorIndex={cursorIndex} />

        <SideRail bar={currentBar} />
      </div>
    </section>
  );
}

function ProbLanes({ bars, cursorIndex }: { bars: FplIndicatorBar[]; cursorIndex: number }) {
  const lanes: Array<{ key: keyof typeof LANE_COLORS; label: string; selector: (b: FplIndicatorBar) => number }> = [
    { key: "enter", label: "P(enter)", selector: (b) => b.pEnter },
    { key: "scale_in", label: "P(scale in)", selector: (b) => b.pScaleIn },
    { key: "scale_out", label: "P(scale out)", selector: (b) => b.pScaleOut },
    { key: "exit", label: "P(exit)", selector: (b) => b.pExit },
  ];
  return (
    <div className="fpl-lanes">
      {lanes.map((lane) => (
        <ProbLane
          key={lane.key}
          color={LANE_COLORS[lane.key]}
          label={lane.label}
          thresholds={ACTION_THRESHOLDS[lane.key]}
          values={bars.map(lane.selector)}
          cursorIndex={cursorIndex}
        />
      ))}
    </div>
  );
}

function ProbLane({
  color,
  label,
  thresholds,
  values,
  cursorIndex,
}: {
  color: string;
  label: string;
  thresholds: { tight: number; loose: number };
  values: number[];
  cursorIndex: number;
}) {
  const maxValue = useMemo(() => {
    let m = 0;
    for (const v of values) if (Number.isFinite(v) && v > m) m = v;
    const tip = Math.max(m, thresholds.tight);
    return tip > 0 ? tip * 1.05 : 1;
  }, [values, thresholds]);
  const width = 800;
  const height = 64;
  const pad = 4;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const yFor = (v: number) => pad + usableH * (1 - v / maxValue);
  const points = values
    .map((v, i) => {
      if (!Number.isFinite(v)) return null;
      const x = pad + (i / Math.max(1, values.length - 1)) * usableW;
      const y = yFor(v);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(" ");
  const cursorX = pad + (cursorIndex / Math.max(1, values.length - 1)) * usableW;
  const cursorValue = values[cursorIndex];
  const armed = Number.isFinite(cursorValue) && (cursorValue >= thresholds.tight)
    ? "tight"
    : Number.isFinite(cursorValue) && (cursorValue >= thresholds.loose)
      ? "loose"
      : "idle";

  const safeLabel = label.replace(/[^a-z0-9]/gi, "-");
  const tightY = yFor(Math.min(thresholds.tight, maxValue));
  const looseY = yFor(Math.min(thresholds.loose, maxValue));

  return (
    <div className={`fpl-lane fpl-lane-${armed}`}>
      <div className="fpl-lane-head">
        <span className="fpl-lane-label" style={{ color }}>{label}</span>
        <span className="fpl-lane-value">
          {Number.isFinite(cursorValue) ? cursorValue.toFixed(5) : "—"}
        </span>
        <span className="fpl-lane-thresholds">
          loose {thresholds.loose.toFixed(4)} · tight {thresholds.tight.toFixed(4)}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="fpl-lane-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${safeLabel}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          x1={pad}
          x2={width - pad}
          y1={looseY}
          y2={looseY}
          stroke={color}
          strokeOpacity="0.28"
          strokeDasharray="3 4"
          strokeWidth={1}
        />
        <line
          x1={pad}
          x2={width - pad}
          y1={tightY}
          y2={tightY}
          stroke={color}
          strokeOpacity="0.65"
          strokeDasharray="6 3"
          strokeWidth={1}
        />
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.4} />
        <polygon
          points={`${pad},${height - pad} ${points} ${width - pad},${height - pad}`}
          fill={`url(#grad-${safeLabel})`}
        />
        <line x1={cursorX} x2={cursorX} y1={0} y2={height} stroke={color} strokeOpacity="0.55" strokeWidth={1} />
      </svg>
    </div>
  );
}

function SideRail({ bar }: { bar: FplIndicatorBar | null }) {
  if (!bar) {
    return <aside className="fpl-rail empty">Select a session...</aside>;
  }
  const s = bar.structural;
  const side = bar.pSideBullish >= bar.pSideBearish ? "Bullish" : "Bearish";
  const sideColor = side === "Bullish" ? LANE_COLORS.enter : LANE_COLORS.exit;
  return (
    <aside className="fpl-rail">
      <div className="fpl-rail-section">
        <span className="fpl-rail-label">Side bias</span>
        <strong style={{ color: sideColor }}>{side}</strong>
        <div className="fpl-rail-sub">
          bull {formatProb(bar.pSideBullish)} · bear {formatProb(bar.pSideBearish)}
        </div>
      </div>

      <div className="fpl-rail-section">
        <span className="fpl-rail-label">Action argmax</span>
        <ActionArgmax bar={bar} />
      </div>

      <div className="fpl-rail-section">
        <span className="fpl-rail-label">Position state</span>
        <div className="fpl-grid-2">
          <Chip label="in pos" value={s.isInOpenPosition ? "yes" : "no"} />
          <Chip label="open n" value={Number.isFinite(s.nOpenPositions) ? s.nOpenPositions.toFixed(0) : "—"} />
          <Chip label="min open" value={Number.isFinite(s.minutesSinceOpen) ? s.minutesSinceOpen.toFixed(0) : "—"} />
          <Chip label="pnl%" value={formatPct(s.pnlPctProxy)} />
        </div>
      </div>

      <div className="fpl-rail-section">
        <span className="fpl-rail-label">Levels</span>
        <div className="fpl-grid-2">
          <Chip label="PDC dist" value={formatPct(s.distPdcPct)} />
          <Chip label="PDH dist" value={formatPct(s.distPdhPct)} />
          <Chip label="PDL dist" value={formatPct(s.distPdlPct)} />
          <Chip label="gap" value={formatPct(s.gapToPdcPct)} />
        </div>
      </div>

      <div className="fpl-rail-section">
        <span className="fpl-rail-label">Cheat code (2m)</span>
        <div className="fpl-grid-2">
          <Chip label="50 EMA Δ" value={formatPct(s.distCc50Ema2m)} />
          <Chip label="200 EMA Δ" value={formatPct(s.distCc200Ema2m)} />
        </div>
      </div>

    </aside>
  );
}

function ActionArgmax({ bar }: { bar: FplIndicatorBar }) {
  const items: Array<{ key: string; v: number; color: string }> = [
    { key: "hold", v: bar.pHold, color: "#64748b" },
    { key: "enter", v: bar.pEnter, color: LANE_COLORS.enter },
    { key: "scale_in", v: bar.pScaleIn, color: LANE_COLORS.scale_in },
    { key: "scale_out", v: bar.pScaleOut, color: LANE_COLORS.scale_out },
    { key: "exit", v: bar.pExit, color: LANE_COLORS.exit },
  ];
  const argmax = items.reduce((acc, cur) => (cur.v > acc.v ? cur : acc), items[0]);
  return (
    <div className="fpl-argmax">
      <strong style={{ color: argmax.color }}>{argmax.key}</strong>
      <span className="fpl-rail-sub">
        {items.map((it) => `${it.key} ${formatProb(it.v)}`).join("  ·  ")}
      </span>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="fpl-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
