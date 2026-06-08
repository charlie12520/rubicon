import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { RrgBarsPayload } from "../../shared/types";
import { fetchRrgBars, fetchSectorRrgBars } from "../api";
import {
  computeRrg,
  defaultWindows,
  rrgBounds,
  type BenchmarkSpec,
  type DailyBar,
  type RrgQuadrant,
  type Timeframe,
} from "../relativeRotation";

const QUADRANT_TABS: Array<{ key: "all" | RrgQuadrant; label: string; color: string }> = [
  { key: "all", label: "All", color: "#cbd5e1" },
  { key: "leading", label: "Leading", color: "#22c55e" },
  { key: "weakening", label: "Weakening", color: "#f59e0b" },
  { key: "lagging", label: "Lagging", color: "#ef4444" },
  { key: "improving", label: "Improving", color: "#38bdf8" },
];
import { RelativeRotationGraph } from "./RelativeRotationGraph";
import "./RrgPanel.css";

const BASKET_VALUE = "__basket__";

// The Rotation tab defaults to the canonical SPY sector-rotation RRG (11 SPDR sector
// ETFs benchmarked to SPY), auto-refreshed daily from Yahoo. "Stocks" switches to the
// TC2000 screener universe (basket benchmark, most-rotated names preselected).
type Universe = "sectors" | "stocks";
const SECTOR_BENCHMARK = "SPY";

// Apply the right default benchmark + plotted set for a freshly-loaded universe.
function universeDefaults(payload: RrgBarsPayload, universe: Universe): {
  benchmarkValue: string;
  selected: string[];
} {
  if (universe === "sectors") {
    const hasBenchmark = payload.symbols.includes(SECTOR_BENCHMARK);
    const plotted = payload.symbols.filter((symbol) => symbol !== SECTOR_BENCHMARK);
    return {
      benchmarkValue: hasBenchmark ? SECTOR_BENCHMARK : BASKET_VALUE,
      selected: plotted.length ? plotted : payload.symbols,
    };
  }
  return { benchmarkValue: BASKET_VALUE, selected: pickInitialSymbols(payload) };
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const READABLE_LIMIT = 14;

// A crowded universe opens as a hairball, so default to the most-rotated names
// (largest distance from the 100/100 origin). "All" stays one click away.
function pickInitialSymbols(payload: RrgBarsPayload): string[] {
  if (payload.symbols.length <= READABLE_LIMIT) return payload.symbols;
  const w = defaultWindows("weekly");
  const full = computeRrg({
    barsBySymbol: payload.barsBySymbol as Record<string, DailyBar[]>,
    symbols: payload.symbols,
    benchmark: { kind: "basket" },
    timeframe: "weekly",
    ratioWindow: w.ratioWindow,
    momentumWindow: w.momentumWindow,
    tailLength: 1,
  });
  const top = full.series
    .map((s) => ({ symbol: s.symbol, d: Math.hypot(s.head.rsRatio - 100, s.head.rsMomentum - 100) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 12)
    .map((x) => x.symbol);
  return top.length ? top : payload.symbols;
}

export function RrgPanel() {
  const [bars, setBars] = useState<RrgBarsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [universe, setUniverse] = useState<Universe>("sectors");

  const [timeframe, setTimeframe] = useState<Timeframe>("weekly");
  const [benchmarkValue, setBenchmarkValue] = useState<string>(BASKET_VALUE);
  const [ratioWindow, setRatioWindow] = useState(defaultWindows("weekly").ratioWindow);
  const [momentumWindow, setMomentumWindow] = useState(defaultWindows("weekly").momentumWindow);
  const [tailLength, setTailLength] = useState(8);
  const [asOf, setAsOf] = useState<string>(""); // "" = latest
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [quadrant, setQuadrant] = useState<"all" | RrgQuadrant>("all");
  const [playing, setPlaying] = useState(false);
  const idxRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const fetcher = universe === "sectors" ? fetchSectorRrgBars : fetchRrgBars;
    setBars(null);
    setLoadError(null);
    fetcher(controller.signal)
      .then((payload) => {
        const defaults = universeDefaults(payload, universe);
        setBars(payload);
        setBenchmarkValue(defaults.benchmarkValue);
        setSelected(new Set(defaults.selected));
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      });
    return () => controller.abort();
  }, [universe]);

  const selectedList = useMemo(() => [...selected].sort((a, b) => a.localeCompare(b)), [selected]);
  const benchmarkSymbol = benchmarkValue === BASKET_VALUE ? null : benchmarkValue;
  const benchmark: BenchmarkSpec = useMemo(
    () => (benchmarkSymbol ? { kind: "symbol", symbol: benchmarkSymbol } : { kind: "basket" }),
    [benchmarkSymbol],
  );

  const barsBySymbol = (bars?.barsBySymbol ?? {}) as Record<string, DailyBar[]>;

  // Frame the plane from the full rotation history so scrubbing the as-of date
  // (or changing the tail) pans through a stable frame instead of rescaling.
  const bounds = useMemo(() => {
    if (!bars) return undefined;
    const full = computeRrg({
      barsBySymbol,
      symbols: selectedList,
      benchmark,
      timeframe,
      ratioWindow,
      momentumWindow,
      tailLength: 100_000,
    });
    return rrgBounds(full.series);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, selectedList, benchmark, timeframe, ratioWindow, momentumWindow]);

  const result = useMemo(() => {
    if (!bars) return null;
    return computeRrg({
      barsBySymbol,
      symbols: selectedList,
      benchmark,
      timeframe,
      ratioWindow,
      momentumWindow,
      tailLength,
      asOf: asOf || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, selectedList, benchmark, timeframe, ratioWindow, momentumWindow, tailLength, asOf]);

  const dates = result?.dates ?? [];
  const scrubIdx = result ? Math.max(0, dates.indexOf(result.asOf)) : 0;
  useEffect(() => {
    idxRef.current = scrubIdx;
  }, [scrubIdx]);

  const quadrantCounts = useMemo(() => {
    const c: Record<RrgQuadrant, number> = { leading: 0, weakening: 0, lagging: 0, improving: 0 };
    for (const s of result?.series ?? []) c[s.quadrant] += 1;
    return c;
  }, [result]);

  const shownSeries = useMemo(
    () => (quadrant === "all" ? result?.series ?? [] : (result?.series ?? []).filter((s) => s.quadrant === quadrant)),
    [result, quadrant],
  );

  // Autoplay: walk the as-of date forward one period per tick until the end.
  useEffect(() => {
    if (!playing || dates.length === 0) return;
    const id = window.setInterval(() => {
      const next = idxRef.current + 1;
      if (next > dates.length - 1) {
        setPlaying(false);
        return;
      }
      setAsOf(dates[next]);
    }, 380);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, dates.length]);

  function changeTimeframe(next: Timeframe) {
    setPlaying(false);
    setTimeframe(next);
    const w = defaultWindows(next);
    setRatioWindow(w.ratioWindow);
    setMomentumWindow(w.momentumWindow);
    setAsOf("");
  }

  function changeBenchmark(value: string) {
    setPlaying(false);
    setBenchmarkValue(value);
    setAsOf("");
  }

  function changeUniverse(next: Universe) {
    if (next === universe) return;
    setPlaying(false);
    setAsOf("");
    setQuadrant("all");
    setHighlight(null);
    setUniverse(next); // triggers the load effect, which applies universe defaults
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (scrubIdx >= dates.length - 1) {
      // Restart from the first date with enough warm-up to show a tail.
      const start = Math.min(dates.length - 1, ratioWindow + momentumWindow);
      setAsOf(dates[start] ?? "");
    }
    setPlaying(true);
  }

  function stepAsOf(delta: number) {
    setPlaying(false);
    const next = Math.min(dates.length - 1, Math.max(0, scrubIdx + delta));
    setAsOf(dates[next] ?? "");
  }

  // Preselect the most-rotated names (largest distance from the 100/100 origin) so
  // a crowded universe opens on a readable, meaningful set instead of a hairball.
  function selectTopMovers(count = 10) {
    if (!bars) return;
    setPlaying(false);
    const full = computeRrg({
      barsBySymbol,
      symbols: bars.symbols,
      benchmark,
      timeframe,
      ratioWindow,
      momentumWindow,
      tailLength: 1,
      asOf: asOf || undefined,
    });
    const top = full.series
      .map((s) => ({ symbol: s.symbol, d: Math.hypot(s.head.rsRatio - 100, s.head.rsMomentum - 100) }))
      .sort((a, b) => b.d - a.d)
      .slice(0, count)
      .map((x) => x.symbol);
    if (top.length) {
      setSelected(new Set(top));
      setQuadrant("all");
    }
  }

  function toggleSymbol(symbol: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  function resetDefaults() {
    if (!bars) return;
    setPlaying(false);
    setTimeframe("weekly");
    const w = defaultWindows("weekly");
    setRatioWindow(w.ratioWindow);
    setMomentumWindow(w.momentumWindow);
    setTailLength(8);
    setAsOf("");
    const defaults = universeDefaults(bars, universe);
    setBenchmarkValue(defaults.benchmarkValue);
    setSelected(new Set(defaults.selected));
    setHighlight(null);
    setQuadrant("all");
  }

  if (loadError) {
    return <section className="rrg-panel"><div className="rrg-loading">Could not load rotation bars: {loadError}</div></section>;
  }
  if (!bars || !result) {
    return <section className="rrg-panel"><div className="rrg-loading">Loading rotation universe…</div></section>;
  }
  if (bars.symbols.length === 0) {
    return (
      <section className="rrg-panel">
        <div className="rrg-loading">{bars.note ?? "No daily bars are available to build a rotation graph yet."}</div>
      </section>
    );
  }

  const generated = bars.generatedAt ? bars.generatedAt.slice(0, 10) : "—";

  return (
    <section className="rrg-panel">
      <div className="rrg-panel-head">
        <div>
          <span className="eyeless-label">Relative Rotation</span>
          <h2>Sector / symbol rotation vs {result.benchmarkLabel}</h2>
        </div>
        <div className="rrg-panel-meta">
          <span>Benchmark <b>{result.benchmarkLabel}</b></span>
          <span>Plotted <b>{result.series.length}</b></span>
          <span>As of <b>{result.asOf || "—"}</b></span>
          <span>{result.timeframe === "weekly" ? "Weekly" : "Daily"} bars</span>
          <span>Data <b>{generated}</b></span>
        </div>
      </div>

      <div className="rrg-controls">
        <div className="rrg-control">
          <span>Universe</span>
          <div className="micro-segment" role="group" aria-label="Universe">
            <button type="button" className={universe === "sectors" ? "active" : ""} onClick={() => changeUniverse("sectors")}>Sectors</button>
            <button type="button" className={universe === "stocks" ? "active" : ""} onClick={() => changeUniverse("stocks")}>Stocks</button>
          </div>
        </div>

        <label className="rrg-control">
          <span>Benchmark</span>
          <select value={benchmarkValue} onChange={(e) => changeBenchmark(e.target.value)}>
            <option value={BASKET_VALUE}>Equal-weight basket</option>
            {bars.symbols.map((symbol) => (
              <option key={symbol} value={symbol}>{symbol}</option>
            ))}
          </select>
        </label>

        <div className="rrg-control">
          <span>Timeframe</span>
          <div className="micro-segment" role="group" aria-label="Timeframe">
            <button type="button" className={timeframe === "daily" ? "active" : ""} onClick={() => changeTimeframe("daily")}>Daily</button>
            <button type="button" className={timeframe === "weekly" ? "active" : ""} onClick={() => changeTimeframe("weekly")}>Weekly</button>
          </div>
        </div>

        <label className="rrg-control">
          <span>RS-Ratio window</span>
          <input
            type="number"
            min={2}
            max={250}
            value={ratioWindow}
            onChange={(e) => setRatioWindow(clampInt(e.target.value, 2, 250, ratioWindow))}
          />
          <span className="rrg-control-hint">normalisation lookback ({result.timeframe === "weekly" ? "wk" : "d"})</span>
        </label>

        <label className="rrg-control">
          <span>Momentum window</span>
          <input
            type="number"
            min={2}
            max={120}
            value={momentumWindow}
            onChange={(e) => setMomentumWindow(clampInt(e.target.value, 2, 120, momentumWindow))}
          />
          <span className="rrg-control-hint">RS-Ratio change lookback</span>
        </label>

        <label className="rrg-control">
          <span>Tail length</span>
          <input
            type="number"
            min={1}
            max={60}
            value={tailLength}
            onChange={(e) => setTailLength(clampInt(e.target.value, 1, 60, tailLength))}
          />
          <span className="rrg-control-hint">periods shown per trail</span>
        </label>

        <div className="rrg-scrub">
          <span>As of</span>
          <div className="rrg-scrub-controls" role="group" aria-label="Rotation playback">
            <button type="button" onClick={() => stepAsOf(-1)} disabled={scrubIdx <= 0} aria-label="Step back one period" title="Step back">
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              className="rrg-play"
              onClick={togglePlay}
              disabled={dates.length === 0}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play the rotation forward"}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button type="button" onClick={() => stepAsOf(1)} disabled={scrubIdx >= dates.length - 1} aria-label="Step forward one period" title="Step forward">
              <ChevronRight size={15} />
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, dates.length - 1)}
            value={scrubIdx}
            disabled={dates.length === 0}
            onChange={(e) => {
              setPlaying(false);
              setAsOf(dates[Number(e.target.value)] ?? "");
            }}
          />
          <span className="rrg-scrub-date">
            {result.asOf || "—"}
            {dates.length > 0 && <small> · {scrubIdx + 1}/{dates.length}</small>}
          </span>
        </div>
      </div>

      <div className="rrg-symbols">
        <div className="rrg-symbols-head">
          <span className="eyeless-label">Symbols ({selectedList.length}/{bars.symbols.length})</span>
          <div className="rrg-symbols-actions">
            <button type="button" className="primary" onClick={() => selectTopMovers(10)} title="Plot the 10 most-rotated names">Top movers</button>
            <button type="button" onClick={() => { setPlaying(false); setSelected(new Set(bars.symbols)); }}>All</button>
            <button type="button" onClick={() => { setPlaying(false); setSelected(new Set()); }}>None</button>
            <button type="button" onClick={resetDefaults}>Reset</button>
          </div>
        </div>
        <div className="rrg-symbol-grid">
          {bars.symbols.map((symbol) => {
            const isBench = symbol === benchmarkSymbol;
            const on = selected.has(symbol);
            return (
              <button
                key={symbol}
                type="button"
                className={`rrg-symbol-toggle${isBench ? " bench" : on ? " on" : ""}`}
                disabled={isBench}
                title={isBench ? "Current benchmark" : on ? "Click to hide" : "Click to plot"}
                onClick={() => !isBench && toggleSymbol(symbol)}
                onMouseEnter={() => on && setHighlight(symbol)}
                onMouseLeave={() => setHighlight(null)}
              >
                {symbol}{isBench ? " ★" : ""}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rrg-quadrant-filter" role="group" aria-label="Filter by quadrant">
        {QUADRANT_TABS.map((tab) => {
          const count = tab.key === "all" ? result.series.length : quadrantCounts[tab.key];
          const active = quadrant === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              className={`rrg-quad-btn${active ? " active" : ""}`}
              style={active ? { borderColor: tab.color, color: tab.color } : undefined}
              onClick={() => setQuadrant(tab.key)}
            >
              <span className="rrg-quad-dot" style={{ background: tab.color }} />
              {tab.label}
              <b>{count}</b>
            </button>
          );
        })}
      </div>

      <RelativeRotationGraph
        series={shownSeries}
        benchmarkLabel={result.benchmarkLabel}
        asOf={result.asOf}
        timeframe={result.timeframe}
        bounds={bounds}
        highlightSymbol={highlight}
        onHighlightSymbol={setHighlight}
        maxLabels={16}
      />

      <p className="rrg-caption">
        <b>How to read it:</b> each trail is a symbol's path versus the benchmark. <b>Leading</b> (top-right) is strong &amp; rising,
        rotating clockwise through <b>Weakening</b>, <b>Lagging</b>, then <b>Improving</b>. Axes are JdK RS-Ratio (x) and RS-Momentum (y),
        both centred on 100 via a {result.ratioWindow}/{result.momentumWindow}-period rolling z-score on the {result.timeframe} relative-strength line.
        {benchmarkSymbol === null && " The equal-weight basket is rebuilt from whatever symbols you plot, so it shifts as you change the selection — pick a single symbol as the benchmark to hold it fixed."}
        {" "}Use the quadrant tabs to focus a corner, <b>Top movers</b> for the most-rotated names, and <b>Play</b> to roll the as-of date forward.
        {result.skipped.length > 0 && (
          <>
            {" "}
            <span className="rrg-skip">
              Skipped {result.skipped.length}: {result.skipped.slice(0, 6).map((s) => `${s.symbol} (${s.reason})`).join(", ")}
              {result.skipped.length > 6 ? "…" : ""}.
            </span>
          </>
        )}
      </p>
    </section>
  );
}
