import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { SpxHeatmapLiveStatus, SpxHeatmapPayload, SpxHeatmapTile } from "../../shared/types";
import { fetchHeatmap, fetchHeatmapLiveStatus, startHeatmapLive, stopHeatmapLive, type HeatmapIndex } from "../api";
import { heatmapColor, squarifyTreemap, type Rect } from "../spxTreemap";
import { industryPeers } from "../heatmapPeers";
import { windowSigma } from "../sigmaMove";
import { HEATMAP_TIMEFRAMES, openingGapPct, timeframeDef, windowPct, type HeatmapTimeframe, type HeatmapTimeframeDef } from "../heatmapWindow";
import { earningsHighlight, type EarningsHighlight } from "../earningsOverlay";
import "./SpxHeatmap.css";

const VIEW_W = 1000;
const VIEW_H = 620;
const SECTOR_HEADER_H = 17; // viewBox units reserved for a sector's name band
const INDUSTRY_HEADER_H = 12; // smaller band for an industry caption nested inside a sector
const PLAYBACK_MS = 320;
const SIGMA_CAP = 2; // colour saturates at ±2σ in the IV-normalized view

type PlacedTile = { tile: SpxHeatmapTile; rect: Rect };
type SectorBlock = { name: string; rect: Rect; showHeader: boolean };
type IndustryBlock = { sector: string; name: string; rect: Rect; showHeader: boolean };

function tilePctAt(tile: SpxHeatmapTile, index: number, lastIndex: number): number | null {
  if (lastIndex < 0) return tile.pct;
  const value = tile.pctByTime[index];
  if (value === undefined) return index >= lastIndex ? tile.pct : null;
  return value;
}

// The tile's % over a trailing window of `windowMinutes` ending at `index`. Both
// endpoints come from tilePctAt (so the sample-mode tile.pct fallback is preserved);
// the start index is clamped forward to the tile's first printed minute, so a name
// that began trading mid-window still measures from its first quote. windowMinutes
// 0 = the whole-day move (unchanged behaviour).
function tileWindowPctAt(tile: SpxHeatmapTile, index: number, lastIndex: number, windowMinutes: number): number | null {
  const now = tilePctAt(tile, index, lastIndex);
  if (windowMinutes <= 0) return now;
  let start = Math.max(0, index - windowMinutes);
  let startPct = tilePctAt(tile, start, lastIndex);
  while (start < index && (startPct === null || !Number.isFinite(startPct))) {
    start += 1;
    startPct = tilePctAt(tile, start, lastIndex);
  }
  return windowPct(now, startPct);
}

// The value to colour by for the active timeframe: the opening gap (fixed for the
// day), the whole-day move (windowMinutes 0), or a trailing-window move ending at
// `index`.
function tileTfPct(tile: SpxHeatmapTile, index: number, lastIndex: number, tf: HeatmapTimeframeDef): number | null {
  if (tf.gap) return openingGapPct(tile.pctByTime);
  return tileWindowPctAt(tile, index, lastIndex, tf.minutes);
}

// The latest minute that actually has data — a live mid-session map only runs
// to here, so we open on it and cap the scrubber there rather than at 16:00.
function frontierOf(payload: SpxHeatmapPayload): number {
  if (payload.asOf) {
    const i = payload.times.indexOf(payload.asOf);
    if (i >= 0) return i;
  }
  for (let i = payload.times.length - 1; i >= 0; i -= 1) {
    if (payload.tiles.some((tile) => tile.pctByTime[i] !== null && tile.pctByTime[i] !== undefined)) return i;
  }
  return Math.max(0, payload.times.length - 1);
}

function formatPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatSigma(sigma: number | null | undefined): string {
  if (sigma === null || sigma === undefined || !Number.isFinite(sigma)) return "—";
  return `${sigma >= 0 ? "+" : ""}${sigma.toFixed(1)}σ`;
}

// Per-character advance (font-size units) for the bold tickers, measured from the
// actual render: most caps ≈0.75, M/W ≈0.95, I/J/'.' narrow. Summing per ticker
// (vs one average) keeps wide names like MMM / WMT from overflowing their tile.
const WIDE_CHARS = new Set(["M", "W"]);
const NARROW_CHARS = new Set(["I", "J", "."]);
function tickerUnits(symbol: string): number {
  let units = 0;
  for (const ch of symbol) units += WIDE_CHARS.has(ch) ? 0.95 : NARROW_CHARS.has(ch) ? 0.42 : 0.75;
  return Math.max(1.6, units);
}

// Group a sector's tiles into its Finviz industries, ordered by summed weight so
// the heaviest industry anchors the top-left of the sector block.
function groupIndustries(tiles: SpxHeatmapTile[]): { name: string; weight: number; tiles: SpxHeatmapTile[] }[] {
  const groups = new Map<string, { name: string; weight: number; tiles: SpxHeatmapTile[] }>();
  for (const tile of tiles) {
    // Fall back to the sector when a tile has no industry (e.g. an older API
    // process still running, or an unclassified name) so the panel degrades to a
    // sector-grouped map instead of crashing the render.
    const key = tile.industry || tile.sector || "Other";
    const group = groups.get(key) ?? { name: key, weight: 0, tiles: [] };
    group.weight += tile.weight;
    group.tiles.push(tile);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.weight - a.weight);
}

// Trim an industry caption to roughly what fits its block width (a per-char
// estimate is plenty for these small labels).
function fitCaption(text: string, widthPx: number, fontSize: number): string {
  if (!text) return "";
  const maxChars = Math.floor((widthPx - 5) / (fontSize * 0.6));
  if (maxChars >= text.length) return text;
  if (maxChars <= 1) return "";
  return `${text.slice(0, maxChars - 1)}…`;
}

type TileLabel = {
  tf: number; // ticker font size (viewBox units)
  pf: number; // % font size
  showSymbol: boolean;
  showPct: boolean;
  symbolY: number;
  pctY: number;
};

// Finviz-style: size the ticker to nearly fill the tile — bounded by width (so a
// 4-char ticker spans most of the box) and by height (leaving room for the % line
// on tiles tall enough). Big tiles get big text; tiny tiles get small text or none.
function tileLabel(rect: Rect, symbol: string): TileLabel {
  const padW = rect.w * 0.88;
  const fitWidth = padW / tickerUnits(symbol);
  const fitHeight = rect.h * 0.46;
  let tf = Math.min(fitWidth, fitHeight);
  const showSymbol = tf >= 6 && rect.w > 18 && rect.h > 10;
  const showPct = showSymbol && rect.h >= tf * 1.95 && rect.w >= 36;
  if (showPct) tf = Math.min(tf, padW / 2.5); // keep the "-XX.XX%" line inside the tile too
  tf = Math.max(4.5, Math.min(150, tf));
  const pf = tf * 0.6;
  const cy = rect.y + rect.h / 2;
  return {
    tf,
    pf,
    showSymbol,
    showPct,
    symbolY: showPct ? cy - pf * 0.62 : cy,
    pctY: cy + tf * 0.55,
  };
}

export function SpxHeatmapPanel({ index = "spx" }: { index?: HeatmapIndex } = {}) {
  const indexLabel = index === "qqq" ? "Nasdaq-100" : "S&P 500";
  const [payload, setPayload] = useState<SpxHeatmapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timeIndex, setTimeIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focusedSector, setFocusedSector] = useState<string | null>(null);
  const [hover, setHover] = useState<{ tile: SpxHeatmapTile; x: number; y: number } | null>(null);
  const [liveStatus, setLiveStatus] = useState<SpxHeatmapLiveStatus | null>(null);
  const [followLive, setFollowLive] = useState(true);
  const [liveBusy, setLiveBusy] = useState(false);
  const [metric, setMetric] = useState<"pct" | "sigma">("pct"); // tile colour: raw % or IV-normalized σ
  const [timeframe, setTimeframe] = useState<HeatmapTimeframe>("day"); // % vs prior close (Day) or a trailing 1h/30m/5m window
  const tf = timeframeDef(timeframe);
  const windowMinutes = tf.minutes;
  const sigmaMinutes = tf.gap ? 0 : windowMinutes; // gap σ uses the daily scale (the gap is an overnight, daily-scale move)
  const [earningsOverlay, setEarningsOverlay] = useState(true); // outline earnings names — ON by default
  const [size, setSize] = useState({ w: VIEW_W, h: VIEW_H });
  const idxRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);

  // Size the map to the actual available area (width AND the height left in the
  // viewport), so it fills the space like Finviz instead of ballooning off-screen
  // on wide windows. Re-measures on resize and when the map first mounts.
  const mapReady = Boolean(payload && payload.tiles.length > 0);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // Fit-to-screen: fill the full container width (capped/centred only on huge
      // ultrawide) and exactly the leftover viewport height, so the whole panel
      // always fits with no scrolling at any size. On small screens tiles get
      // short — the accepted trade-off; never a side-scroller.
      const MAX_W = 2600;
      const w = Math.max(320, Math.min(Math.round(rect.width), MAX_W));
      const h = Math.max(150, Math.round(window.innerHeight - rect.top - 62));
      setSize((prev) => (Math.abs(prev.w - w) < 1 && Math.abs(prev.h - h) < 1 ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mapReady]);

  // Initial load + periodic re-fetch so a running live feed keeps the map current.
  // The follow-live effect below re-pins the scrubber to each new frontier.
  useEffect(() => {
    let cancelled = false;
    // Switching index (SPY↔QQQ) clears the old map so we show a loading state
    // rather than stale tiles while the new payload arrives.
    setPayload(null);
    setLoadError(null);
    setFocusedSector(null);
    setHover(null);
    const load = (initial: boolean) => {
      fetchHeatmap(index)
        .then((next) => {
          if (!cancelled) setPayload(next);
        })
        .catch((error: Error) => {
          if (!cancelled && initial) setLoadError(error.message);
        });
    };
    load(true);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [index]);

  // Poll the live-feed process status for the control strip.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchHeatmapLiveStatus(index)
        .then((status) => !cancelled && setLiveStatus(status))
        .catch(() => undefined);
    };
    poll();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") poll();
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [index]);

  const reloadHeatmap = useCallback(() => {
    fetchHeatmap(index).then(setPayload).catch(() => undefined);
  }, [index]);

  const runLiveAction = useCallback(
    (action: () => Promise<SpxHeatmapLiveStatus>) => {
      setLiveBusy(true);
      action()
        .then((status) => {
          setLiveStatus(status);
          // The Yahoo backfill lands ~15s after Start and the first IBKR sweep
          // ~50s — poll a few times so the map fills promptly instead of waiting
          // for the 30s refresh.
          [1500, 5000, 10000, 16000, 24000, 40000].forEach((ms) => window.setTimeout(reloadHeatmap, ms));
        })
        .catch(() => undefined)
        .finally(() => setLiveBusy(false));
    },
    [reloadHeatmap],
  );

  const times = payload?.times ?? [];
  const frontierIndex = useMemo(() => (payload ? frontierOf(payload) : 0), [payload]);
  const lastIndex = frontierIndex;
  const clampedIndex = Math.min(Math.max(0, timeIndex), Math.max(0, lastIndex));
  useEffect(() => {
    idxRef.current = clampedIndex;
  }, [clampedIndex]);

  // Follow-live: while following (and not replaying), pin the scrubber to the
  // latest minute so new sweeps from the live feed appear automatically.
  useEffect(() => {
    if (followLive && !playing) setTimeIndex(frontierIndex);
  }, [followLive, frontierIndex, playing]);

  // Layout depends only on the universe + which sector is focused — NOT on the
  // scrubbed time — so playback just recolours tiles instead of relaying out.
  const layout = useMemo(() => {
    const result = { tiles: [] as PlacedTile[], sectors: [] as SectorBlock[], industries: [] as IndustryBlock[] };
    if (!payload) return result;
    const bounds: Rect = { x: 1, y: 1, w: size.w - 2, h: size.h - 2 };

    // Lay the industry level inside a sector's area, then the stocks inside each
    // industry — a squarified treemap nested sector → industry → stock.
    const placeIndustries = (sectorName: string, sectorTiles: SpxHeatmapTile[], area: Rect) => {
      const blocks = squarifyTreemap(
        groupIndustries(sectorTiles).map((group) => ({ key: group.name, value: group.weight, data: group })),
        area,
      );
      for (const block of blocks) {
        const showHeader = block.rect.h > 34 && block.rect.w > 64;
        result.industries.push({ sector: sectorName, name: block.key, rect: block.rect, showHeader });
        const inner: Rect = showHeader
          ? { x: block.rect.x + 0.5, y: block.rect.y + INDUSTRY_HEADER_H, w: block.rect.w - 1, h: block.rect.h - INDUSTRY_HEADER_H - 0.5 }
          : { x: block.rect.x + 0.5, y: block.rect.y + 0.5, w: block.rect.w - 1, h: block.rect.h - 1 };
        const placed = squarifyTreemap(
          block.data.tiles.map((tile) => ({ key: tile.symbol, value: tile.weight, data: tile })),
          inner,
        );
        for (const node of placed) result.tiles.push({ tile: node.data, rect: node.rect });
      }
    };

    if (focusedSector) {
      placeIndustries(focusedSector, payload.tiles.filter((tile) => tile.sector === focusedSector), bounds);
      return result;
    }

    const sectorBlocks = squarifyTreemap(
      payload.sectors.map((sector) => ({ key: sector.name, value: sector.weight, data: sector })),
      bounds,
    );
    for (const block of sectorBlocks) {
      const showHeader = block.rect.h > 46 && block.rect.w > 78;
      result.sectors.push({ name: block.key, rect: block.rect, showHeader });
      const inner: Rect = showHeader
        ? { x: block.rect.x + 1, y: block.rect.y + SECTOR_HEADER_H, w: block.rect.w - 2, h: block.rect.h - SECTOR_HEADER_H - 1 }
        : { x: block.rect.x + 1, y: block.rect.y + 1, w: block.rect.w - 2, h: block.rect.h - 2 };
      placeIndustries(block.key, payload.tiles.filter((tile) => tile.sector === block.key), inner);
    }
    return result;
  }, [payload, focusedSector, size]);

  // Per-frame aggregates (index move, breadth, sector tints) at the scrubbed minute.
  const frame = useMemo(() => {
    const sectorPct = new Map<string, number>();
    let advancers = 0;
    let decliners = 0;
    let unchanged = 0;
    let indexNum = 0;
    let indexDen = 0;
    const sectorAcc = new Map<string, { num: number; den: number }>();
    for (const tile of payload?.tiles ?? []) {
      const pct = tileTfPct(tile, clampedIndex, lastIndex, tf);
      if (pct === null || !Number.isFinite(pct)) continue;
      if (pct > 0.02) advancers += 1;
      else if (pct < -0.02) decliners += 1;
      else unchanged += 1;
      indexNum += pct * tile.weight;
      indexDen += tile.weight;
      const acc = sectorAcc.get(tile.sector) ?? { num: 0, den: 0 };
      acc.num += pct * tile.weight;
      acc.den += tile.weight;
      sectorAcc.set(tile.sector, acc);
    }
    for (const [name, acc] of sectorAcc) sectorPct.set(name, acc.den > 0 ? acc.num / acc.den : 0);
    return {
      sectorPct,
      advancers,
      decliners,
      unchanged,
      indexPct: indexDen > 0 ? indexNum / indexDen : null,
    };
  }, [payload, clampedIndex, lastIndex, tf]);

  // The hovered tile's sub-industry peers (Finviz-style hover detail), heaviest
  // first; recomputed only when the hovered industry changes, not on cursor move.
  const hoverPeers = useMemo(
    () => (payload && hover ? industryPeers(payload.tiles, hover.tile.sector, hover.tile.industry) : []),
    [payload, hover?.tile.sector, hover?.tile.industry],
  );

  // Whether the live IBKR sweep has populated any implied vols; gates the σ view.
  const hasIv = useMemo(
    () => (payload?.tiles ?? []).some((tile) => tile.iv !== null && Number.isFinite(tile.iv)),
    [payload],
  );

  // Earnings-this-week highlight per symbol (before-open counts as the prior day);
  // recomputed when the payload refetches (~30s), which also refreshes "now".
  const earningsBySymbol = useMemo(() => {
    const map = new Map<string, EarningsHighlight>();
    const now = new Date();
    for (const tile of payload?.tiles ?? []) {
      const hl = earningsHighlight(tile.earningsDate, tile.earningsTime, now);
      if (hl) map.set(tile.symbol, hl);
    }
    return map;
  }, [payload]);
  const hasEarnings = earningsBySymbol.size > 0;
  // If IV goes away (feed stopped / backfill-only), drop back to % so the map never
  // silently greys out while stuck in σ mode.
  useEffect(() => {
    // σ needs live IV; if it disappears (feed stopped / backfill-only) drop back to %
    // so the map never silently greys out while stuck in σ. σ now works on every
    // timeframe — windowSigma scales the IV denominator to the selected window.
    if (!hasIv && metric === "sigma") setMetric("pct");
  }, [hasIv, metric]);

  // Playback: walk the minute forward one tick at a time until the close.
  useEffect(() => {
    if (!playing || lastIndex <= 0) return;
    const id = window.setInterval(() => {
      const next = idxRef.current + 1;
      if (next > lastIndex) {
        setPlaying(false);
        return;
      }
      setTimeIndex(next);
    }, PLAYBACK_MS);
    return () => window.clearInterval(id);
  }, [playing, lastIndex]);

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    setFollowLive(false);
    if (clampedIndex >= lastIndex) setTimeIndex(0);
    setPlaying(true);
  }

  function step(delta: number) {
    setPlaying(false);
    setFollowLive(false);
    setTimeIndex((current) => Math.min(lastIndex, Math.max(0, current + delta)));
  }

  if (loadError) {
    return <section className="heatmap-panel"><div className="heatmap-loading">Could not load the {indexLabel} heatmap: {loadError}</div></section>;
  }
  if (!payload) {
    return <section className="heatmap-panel"><div className="heatmap-loading">Loading {indexLabel} heatmap…</div></section>;
  }
  if (payload.tiles.length === 0) {
    return (
      <section className="heatmap-panel">
        <div className="heatmap-loading">{payload.note ?? `No ${indexLabel} heatmap data is available yet.`}</div>
      </section>
    );
  }

  const currentTime = times[clampedIndex] ?? payload.asOf ?? "—";
  const generated = payload.generatedAt ? payload.generatedAt.slice(0, 10) : "—";
  const feedLabel = payload.live
    ? "LIVE"
    : payload.delayMinutes
      ? `${payload.delayMinutes}m delayed`
      : "snapshot";

  return (
    <section className="heatmap-panel">
      <div className="heatmap-head">
        <div>
          <span className="eyeless-label">{indexLabel} Market Map</span>
          <h2>
            Intraday heatmap
            {focusedSector ? <span className="heatmap-focus-name"> · {focusedSector}</span> : null}
          </h2>
        </div>
        <div className="heatmap-meta">
          <span className={`heatmap-index ${(frame.indexPct ?? 0) >= 0 ? "up" : "down"}`}>
            {payload.index?.label ?? indexLabel} <b>{formatPct(frame.indexPct)}</b>
          </span>
          <span className="heatmap-breadth">
            <b className="up">{frame.advancers}</b> adv · <b className="down">{frame.decliners}</b> dec
          </span>
          <span>As of <b>{currentTime}</b> ET</span>
          <span className={`heatmap-feed ${payload.live ? "live" : ""}`}>{feedLabel}</span>
          <span>{payload.source}</span>
          <span>{payload.session || generated}</span>
        </div>
      </div>

      <div className="heatmap-sector-chips" role="group" aria-label="Filter by sector">
        <button type="button" className={`heatmap-chip${focusedSector === null ? " active" : ""}`} onClick={() => setFocusedSector(null)}>
          All sectors
        </button>
        {payload.sectors.map((sector) => {
          const pct = frame.sectorPct.get(sector.name) ?? sector.pct ?? 0;
          const active = focusedSector === sector.name;
          return (
            <button
              key={sector.name}
              type="button"
              className={`heatmap-chip${active ? " active" : ""}`}
              onClick={() => setFocusedSector(active ? null : sector.name)}
              title={`${sector.name} · ${sector.count} names · ${sector.weight.toFixed(1)}% of index`}
            >
              <span className="heatmap-chip-dot" style={{ background: heatmapColor(pct, tf.cap) }} />
              {sector.name}
              <b className={pct >= 0 ? "up" : "down"}>{formatPct(pct)}</b>
            </button>
          );
        })}
      </div>

      <div className="heatmap-livebar">
        <span className={`heatmap-live-dot${liveStatus?.running ? " on" : ""}`} aria-hidden="true" />
        <span className="heatmap-live-label">
          IBKR feed: <b>{liveStatus?.running ? "running" : "off"}</b>
        </span>
        {liveStatus?.running ? (
          <button type="button" className="heatmap-live-btn" disabled={liveBusy} onClick={() => runLiveAction(() => stopHeatmapLive(index))}>
            Stop feed
          </button>
        ) : (
          <>
            <button
              type="button"
              className="heatmap-live-btn primary"
              disabled={liveBusy || liveStatus?.available === false || liveStatus?.marketOpen === false}
              title={
                liveStatus?.marketOpen === false
                  ? "Market closed — the feed only pulls 09:25–16:00 ET, Mon–Fri"
                  : liveStatus?.available === false
                    ? "refresh-spx-heatmap.py not found"
                    : "Start the per-minute IBKR snapshot feed (backfills today from Yahoo immediately)"
              }
              onClick={() => runLiveAction(() => startHeatmapLive(index))}
            >
              {liveBusy ? "Starting…" : "Start feed"}
            </button>
            {liveStatus?.marketOpen === false && <span className="heatmap-live-now">market closed</span>}
          </>
        )}
        {!followLive ? (
          <button type="button" className="heatmap-live-btn" onClick={() => setFollowLive(true)} title="Jump to the latest minute and track it">
            Jump to now
          </button>
        ) : (
          <span className="heatmap-live-now" title="Showing the latest minute">● now</span>
        )}
        <span className="heatmap-live-meta">
          updated {payload.asOf ?? "—"} ET · {payload.source}
          {liveStatus?.autoStartEt ? ` · auto-start ${liveStatus.autoStartEt} ET wkdays` : ""}
        </span>
      </div>

      <div className="heatmap-stage-wrap" ref={stageRef}>
        <div className="heatmap-stage" style={{ width: size.w, height: size.h }}>
        {focusedSector && (
          <button type="button" className="heatmap-back" onClick={() => setFocusedSector(null)}>
            <ArrowLeft size={14} /> All sectors
          </button>
        )}
        <svg
          className="heatmap-svg"
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="S&P 500 constituents sized by index weight and coloured by intraday percentage change"
          onMouseLeave={() => setHover(null)}
        >
          {layout.tiles.map(({ tile, rect }) => {
            const pct = tileTfPct(tile, clampedIndex, lastIndex, tf);
            const shade = metric === "sigma" ? windowSigma(pct, tile.iv, sigmaMinutes) : pct;
            const label = tileLabel(rect, tile.symbol);
            const cx = rect.x + rect.w / 2;
            return (
              <g
                key={tile.symbol}
                className="heatmap-tile"
                onMouseMove={(event) => setHover({ tile, x: event.clientX, y: event.clientY })}
                onMouseEnter={(event) => setHover({ tile, x: event.clientX, y: event.clientY })}
                onClick={() => setFocusedSector((current) => (current === tile.sector ? null : tile.sector))}
              >
                <rect
                  x={rect.x}
                  y={rect.y}
                  width={Math.max(0, rect.w)}
                  height={Math.max(0, rect.h)}
                  fill={heatmapColor(shade, metric === "sigma" ? SIGMA_CAP : tf.cap)}
                  stroke="#0b0e14"
                  strokeWidth={0.6}
                />
                {label.showSymbol && (
                  <text x={cx} y={label.symbolY} fontSize={label.tf} className="heatmap-tile-symbol">
                    {tile.symbol}
                  </text>
                )}
                {label.showPct && (
                  <text x={cx} y={label.pctY} fontSize={label.pf} className="heatmap-tile-pct">
                    {metric === "sigma" ? formatSigma(shade) : formatPct(pct)}
                  </text>
                )}
              </g>
            );
          })}

          {layout.industries.map((block) =>
            block.showHeader ? (
              <text
                key={`ind-${block.sector}-${block.name}`}
                x={block.rect.x + 3}
                y={block.rect.y + 9}
                fontSize={7.5}
                className="heatmap-industry-label"
              >
                {fitCaption(block.name, block.rect.w, 7.5)}
              </text>
            ) : null,
          )}

          {layout.industries.map((block) => (
            <rect
              key={`indb-${block.sector}-${block.name}`}
              x={block.rect.x}
              y={block.rect.y}
              width={Math.max(0, block.rect.w)}
              height={Math.max(0, block.rect.h)}
              fill="none"
              stroke="#0a0d12"
              strokeWidth={0.9}
              pointerEvents="none"
            />
          ))}

          {layout.sectors.map((block) =>
            block.showHeader ? (
              <g key={`hdr-${block.name}`} className="heatmap-sector-label" onClick={() => setFocusedSector(block.name)}>
                <text x={block.rect.x + 6} y={block.rect.y + 12} fontSize={11}>
                  {block.name.toUpperCase()}
                </text>
                <text x={block.rect.x + block.rect.w - 6} y={block.rect.y + 12} fontSize={10} className="heatmap-sector-pct" textAnchor="end">
                  {formatPct(frame.sectorPct.get(block.name) ?? null)}
                </text>
              </g>
            ) : null,
          )}

          {layout.sectors.map((block) => (
            <rect
              key={`brd-${block.name}`}
              x={block.rect.x}
              y={block.rect.y}
              width={Math.max(0, block.rect.w)}
              height={Math.max(0, block.rect.h)}
              fill="none"
              stroke="#070a0f"
              strokeWidth={1.6}
              pointerEvents="none"
            />
          ))}

          {earningsOverlay &&
            layout.tiles.map(({ tile, rect }) => {
              const hl = earningsBySymbol.get(tile.symbol);
              if (!hl?.inWindow) return null;
              const inset = 0.6;
              return (
                <rect
                  key={`earn-${tile.symbol}`}
                  x={rect.x + inset}
                  y={rect.y + inset}
                  width={Math.max(0, rect.w - inset * 2)}
                  height={Math.max(0, rect.h - inset * 2)}
                  fill="#60a5fa"
                  fillOpacity={0.05 + hl.intensity * 0.12}
                  stroke="#60a5fa"
                  strokeWidth={1 + hl.intensity * 2.5}
                  strokeOpacity={0.45 + hl.intensity * 0.55}
                  pointerEvents="none"
                />
              );
            })}
        </svg>

        {hover && (() => {
          // Keep the panel on-screen without measuring it: flip left near the
          // right edge, and anchor it ABOVE the cursor in the lower half of the
          // screen (growing upward) so a long industry list never runs off the
          // bottom. Height is capped to the space available in the chosen direction.
          const TIP_W = 256;
          const MARGIN = 8;
          const left = hover.x + 14 + TIP_W > window.innerWidth ? Math.max(MARGIN, hover.x - TIP_W - 14) : hover.x + 14;
          const flipUp = hover.y > window.innerHeight * 0.5;
          const vStyle = flipUp
            ? { bottom: Math.round(window.innerHeight - hover.y + 14) }
            : { top: Math.round(hover.y + 14) };
          const maxHeight = Math.max(140, Math.round((flipUp ? hover.y - 14 : window.innerHeight - hover.y - 14) - MARGIN));
          const headPct = tileTfPct(hover.tile, clampedIndex, lastIndex, tf);
          return (
            <div className="heatmap-tooltip" style={{ left, ...vStyle, maxHeight }}>
              <div className="heatmap-tooltip-head">
                <b>{hover.tile.symbol}</b>
                <span className={(headPct ?? 0) >= 0 ? "up" : "down"}>{formatPct(headPct)}</span>
              </div>
              <div className="heatmap-tooltip-name">{hover.tile.name}</div>
              <div className="heatmap-tooltip-row">
                <span>{hover.tile.sector}</span>
                {hover.tile.last !== null && <span>Last {hover.tile.last.toFixed(2)}</span>}
              </div>
              {hover.tile.iv !== null && (
                <div className="heatmap-tooltip-row">
                  <span>IV {Math.round(hover.tile.iv * 100)}%</span>
                  <span>σ {formatSigma(windowSigma(headPct, hover.tile.iv, sigmaMinutes))}</span>
                </div>
              )}
              {hover.tile.earningsDate && (
                <div className="heatmap-tooltip-row">
                  <span>
                    Earnings {hover.tile.earningsDate}
                    {hover.tile.earningsTime === "before-open" ? " BMO" : hover.tile.earningsTime === "after-close" ? " AMC" : ""}
                  </span>
                  {(() => {
                    const earn = earningsBySymbol.get(hover.tile.symbol);
                    return earn?.inWindow ? (
                      <span className="heatmap-earn-flag">{earn.daysUntil === 0 ? "today" : `in ${earn.daysUntil}d`}</span>
                    ) : null;
                  })()}
                </div>
              )}
              <div className="heatmap-tooltip-industry">
                {hover.tile.industry} · {hoverPeers.length}
              </div>
              <div className="heatmap-tooltip-peers">
                {hoverPeers.map((peer) => {
                  const pct = tileTfPct(peer, clampedIndex, lastIndex, tf);
                  const shade = metric === "sigma" ? windowSigma(pct, peer.iv, sigmaMinutes) : pct;
                  return (
                    <div key={peer.symbol} className={`heatmap-peer${peer.symbol === hover.tile.symbol ? " current" : ""}`}>
                      <span className="heatmap-peer-dot" style={{ background: heatmapColor(shade, metric === "sigma" ? SIGMA_CAP : tf.cap) }} />
                      <span className="heatmap-peer-sym">{peer.symbol}</span>
                      {peer.last !== null && <span className="heatmap-peer-last">{peer.last.toFixed(2)}</span>}
                      <span className={`heatmap-peer-pct ${(shade ?? 0) >= 0 ? "up" : "down"}`}>
                        {metric === "sigma" ? formatSigma(shade) : formatPct(pct)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
        </div>
      </div>

      <div className="heatmap-controls">
        <div className="heatmap-scrub-controls" role="group" aria-label="Intraday playback">
          <button type="button" onClick={() => step(-1)} disabled={clampedIndex <= 0} aria-label="Step back one minute" title="Step back">
            <ChevronLeft size={15} />
          </button>
          <button type="button" className="heatmap-play" onClick={togglePlay} disabled={times.length === 0} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play the session forward"}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button type="button" onClick={() => step(1)} disabled={clampedIndex >= lastIndex} aria-label="Step forward one minute" title="Step forward">
            <ChevronRight size={15} />
          </button>
        </div>
        <input
          type="range"
          className="heatmap-scrub"
          min={0}
          max={Math.max(0, lastIndex)}
          value={clampedIndex}
          disabled={times.length === 0}
          onChange={(event) => {
            setPlaying(false);
            setFollowLive(false);
            setTimeIndex(Number(event.target.value));
          }}
        />
        <span className="heatmap-scrub-time">
          {currentTime}
          {times.length > 0 && <small> · {clampedIndex + 1}/{lastIndex + 1}</small>}
        </span>
        <div className="heatmap-timeframe-toggle" role="group" aria-label="Timeframe">
          {HEATMAP_TIMEFRAMES.map((t) => (
            <button
              key={t.key}
              type="button"
              className={timeframe === t.key ? "active" : ""}
              onClick={() => setTimeframe(t.key)}
              title={t.gap ? "opening gap — % from the prior close to the open (fixed for the day)" : t.key === "day" ? "% change vs prior close (full day)" : `% change over the last ${t.label}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="heatmap-metric-toggle" role="group" aria-label="Tile colour metric">
          <button type="button" className={metric === "pct" ? "active" : ""} onClick={() => setMetric("pct")} title="Colour by raw daily % change">
            %
          </button>
          <button
            type="button"
            className={metric === "sigma" ? "active" : ""}
            onClick={() => setMetric("sigma")}
            disabled={!hasIv}
            title={hasIv ? "Colour by IV-normalized move — standard deviations over the selected timeframe" : "σ needs live IV — start the IBKR feed and wait for the first sweep"}
          >
            σ
          </button>
        </div>
        <button
          type="button"
          className={`heatmap-overlay-toggle${earningsOverlay ? " active" : ""}`}
          onClick={() => setEarningsOverlay((value) => !value)}
          disabled={!hasEarnings}
          aria-pressed={earningsOverlay}
          title={
            hasEarnings
              ? "Outline names with earnings in the next ~2 weeks (brighter = sooner; before-open counts as the prior day)"
              : "No earnings data yet — it loads with the live feed"
          }
        >
          <span className="heatmap-overlay-dot" aria-hidden="true" /> Earnings
        </button>
        <div className="heatmap-legend" aria-hidden="true">
          <span>{metric === "sigma" ? "−2σ" : `-${tf.cap}%`}</span>
          <span className="heatmap-legend-bar" />
          <span>{metric === "sigma" ? "+2σ" : `+${tf.cap}%`}</span>
        </div>
      </div>

    </section>
  );
}
