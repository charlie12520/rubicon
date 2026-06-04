import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { SpxHeatmapLiveStatus, SpxHeatmapPayload, SpxHeatmapTile } from "../../shared/types";
import { fetchSpxHeatmap, fetchSpxHeatmapLiveStatus, startSpxHeatmapLive, stopSpxHeatmapLive } from "../api";
import { heatmapColor, squarifyTreemap, type Rect } from "../spxTreemap";
import "./SpxHeatmap.css";

const VIEW_W = 1000;
const VIEW_H = 620;
const SECTOR_HEADER_H = 17; // viewBox units reserved for a sector's name band
const INDUSTRY_HEADER_H = 12; // smaller band for an industry caption nested inside a sector
const PLAYBACK_MS = 320;

type PlacedTile = { tile: SpxHeatmapTile; rect: Rect };
type SectorBlock = { name: string; rect: Rect; showHeader: boolean };
type IndustryBlock = { sector: string; name: string; rect: Rect; showHeader: boolean };

function tilePctAt(tile: SpxHeatmapTile, index: number, lastIndex: number): number | null {
  if (lastIndex < 0) return tile.pct;
  const value = tile.pctByTime[index];
  if (value === undefined) return index >= lastIndex ? tile.pct : null;
  return value;
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

export function SpxHeatmapPanel() {
  const [payload, setPayload] = useState<SpxHeatmapPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timeIndex, setTimeIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [focusedSector, setFocusedSector] = useState<string | null>(null);
  const [hover, setHover] = useState<{ tile: SpxHeatmapTile; x: number; y: number } | null>(null);
  const [liveStatus, setLiveStatus] = useState<SpxHeatmapLiveStatus | null>(null);
  const [followLive, setFollowLive] = useState(true);
  const [liveBusy, setLiveBusy] = useState(false);
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
    const load = (initial: boolean) => {
      fetchSpxHeatmap()
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
  }, []);

  // Poll the live-feed process status for the control strip.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetchSpxHeatmapLiveStatus()
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
  }, []);

  const reloadHeatmap = useCallback(() => {
    fetchSpxHeatmap().then(setPayload).catch(() => undefined);
  }, []);

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
      const pct = tilePctAt(tile, clampedIndex, lastIndex);
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
  }, [payload, clampedIndex, lastIndex]);

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
    return <section className="heatmap-panel"><div className="heatmap-loading">Could not load the S&P 500 heatmap: {loadError}</div></section>;
  }
  if (!payload) {
    return <section className="heatmap-panel"><div className="heatmap-loading">Loading S&P 500 heatmap…</div></section>;
  }
  if (payload.tiles.length === 0) {
    return (
      <section className="heatmap-panel">
        <div className="heatmap-loading">{payload.note ?? "No S&P 500 heatmap data is available yet."}</div>
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
          <span className="eyeless-label">S&amp;P 500 Market Map</span>
          <h2>
            Intraday heatmap
            {focusedSector ? <span className="heatmap-focus-name"> · {focusedSector}</span> : null}
          </h2>
        </div>
        <div className="heatmap-meta">
          <span className={`heatmap-index ${(frame.indexPct ?? 0) >= 0 ? "up" : "down"}`}>
            {payload.index?.label ?? "S&P 500"} <b>{formatPct(frame.indexPct)}</b>
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
              <span className="heatmap-chip-dot" style={{ background: heatmapColor(pct) }} />
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
          <button type="button" className="heatmap-live-btn" disabled={liveBusy} onClick={() => runLiveAction(stopSpxHeatmapLive)}>
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
              onClick={() => runLiveAction(startSpxHeatmapLive)}
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
            const pct = tilePctAt(tile, clampedIndex, lastIndex);
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
                  fill={heatmapColor(pct)}
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
                    {formatPct(pct)}
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
        </svg>

        {hover && (
          <div className="heatmap-tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
            <div className="heatmap-tooltip-head">
              <b>{hover.tile.symbol}</b>
              <span className={(tilePctAt(hover.tile, clampedIndex, lastIndex) ?? 0) >= 0 ? "up" : "down"}>
                {formatPct(tilePctAt(hover.tile, clampedIndex, lastIndex))}
              </span>
            </div>
            <div className="heatmap-tooltip-name">{hover.tile.name}</div>
            <div className="heatmap-tooltip-row">
              <span>{hover.tile.sector} · {hover.tile.industry}</span>
              <span>{hover.tile.weight.toFixed(2)}% wt</span>
            </div>
            {hover.tile.last !== null && (
              <div className="heatmap-tooltip-row">
                <span>Last {hover.tile.last.toFixed(2)}</span>
                {hover.tile.prevClose !== null && <span>Prev {hover.tile.prevClose.toFixed(2)}</span>}
              </div>
            )}
          </div>
        )}
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
        <div className="heatmap-legend" aria-hidden="true">
          <span>-3%</span>
          <span className="heatmap-legend-bar" />
          <span>+3%</span>
        </div>
      </div>

    </section>
  );
}
