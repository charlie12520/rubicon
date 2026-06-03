import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, Radio } from "lucide-react";
import type { SpxHeatmapLiveStatus, SpxHeatmapPayload, SpxHeatmapTile } from "../../shared/types";
import { fetchSpxHeatmap, fetchSpxHeatmapLiveStatus, startSpxHeatmapLive, stopSpxHeatmapLive } from "../api";
import { heatmapColor, squarifyTreemap, type Rect } from "../spxTreemap";
import "./SpxHeatmap.css";

const VIEW_W = 1000;
const VIEW_H = 620;
const SECTOR_HEADER_H = 17; // viewBox units reserved for a sector's name band
const PLAYBACK_MS = 320;

type PlacedTile = { tile: SpxHeatmapTile; rect: Rect };
type SectorBlock = { name: string; rect: Rect; showHeader: boolean };

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

// Approx glyph advance / font-size for the bold uppercase tickers, used to fit
// the ticker to the tile width.
const CHAR_WIDTH = 0.62;

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
  const fitWidth = (rect.w * 0.9) / Math.max(2.2, symbol.length * CHAR_WIDTH);
  const fitHeight = rect.h * 0.46;
  const tf = Math.max(4.5, Math.min(62, Math.min(fitWidth, fitHeight)));
  const showSymbol = tf >= 6 && rect.w > 18 && rect.h > 10;
  const showPct = showSymbol && rect.h >= tf * 2.0 && rect.w >= 34;
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
  const idxRef = useRef(0);

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
          window.setTimeout(reloadHeatmap, 1500);
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
    if (!payload) return { tiles: [] as PlacedTile[], sectors: [] as SectorBlock[] };
    const bounds: Rect = { x: 2, y: 2, w: VIEW_W - 4, h: VIEW_H - 4 };

    if (focusedSector) {
      const sectorTiles = payload.tiles.filter((tile) => tile.sector === focusedSector);
      const placed = squarifyTreemap(
        sectorTiles.map((tile) => ({ key: tile.symbol, value: tile.weight, data: tile })),
        bounds,
      );
      return {
        tiles: placed.map((node) => ({ tile: node.data, rect: node.rect })),
        sectors: [] as SectorBlock[],
      };
    }

    const sectorBlocks = squarifyTreemap(
      payload.sectors.map((sector) => ({ key: sector.name, value: sector.weight, data: sector })),
      bounds,
    );
    const tiles: PlacedTile[] = [];
    const sectors: SectorBlock[] = [];
    for (const block of sectorBlocks) {
      const showHeader = block.rect.h > 46 && block.rect.w > 78;
      sectors.push({ name: block.key, rect: block.rect, showHeader });
      const inner: Rect = showHeader
        ? { x: block.rect.x + 1, y: block.rect.y + SECTOR_HEADER_H, w: block.rect.w - 2, h: block.rect.h - SECTOR_HEADER_H - 1 }
        : { x: block.rect.x + 1, y: block.rect.y + 1, w: block.rect.w - 2, h: block.rect.h - 2 };
      const sectorTiles = payload.tiles.filter((tile) => tile.sector === block.key);
      const placed = squarifyTreemap(
        sectorTiles.map((tile) => ({ key: tile.symbol, value: tile.weight, data: tile })),
        inner,
      );
      for (const node of placed) tiles.push({ tile: node.data, rect: node.rect });
    }
    return { tiles, sectors };
  }, [payload, focusedSector]);

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
          IBKR live feed <b>{liveStatus?.running ? "running" : "off"}</b>
        </span>
        {liveStatus?.running ? (
          <button type="button" className="heatmap-live-btn" disabled={liveBusy} onClick={() => runLiveAction(stopSpxHeatmapLive)}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="heatmap-live-btn primary"
            disabled={liveBusy || liveStatus?.available === false}
            title={liveStatus?.available === false ? "refresh-spx-heatmap.py not found" : "Start the per-minute IBKR snapshot feed"}
            onClick={() => runLiveAction(startSpxHeatmapLive)}
          >
            {liveBusy ? "Starting…" : "Start live"}
          </button>
        )}
        {!followLive ? (
          <button type="button" className="heatmap-live-btn" onClick={() => setFollowLive(true)} title="Jump to the latest minute and follow the feed">
            <Radio size={12} /> Go live
          </button>
        ) : payload.live ? (
          <span className="heatmap-live-follow"><Radio size={12} /> following</span>
        ) : null}
        <span className="heatmap-live-meta">
          {payload.source === "ibkr-live" ? `live · updated ${payload.asOf ?? "—"} ET` : `feed: ${payload.source}`}
          {liveStatus?.autoStartEt ? ` · auto-start ${liveStatus.autoStartEt} ET wkdays` : ""}
        </span>
      </div>

      <div className="heatmap-stage">
        {focusedSector && (
          <button type="button" className="heatmap-back" onClick={() => setFocusedSector(null)}>
            <ArrowLeft size={14} /> All sectors
          </button>
        )}
        <svg
          className="heatmap-svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
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
              <span>{hover.tile.sector}</span>
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

      <p className="heatmap-caption">
        <b>How to read it:</b> every tile is an S&amp;P 500 constituent, sized by its index weight and coloured by intraday % change
        (deep red −3% → grey flat → deep green +3%). Tiles are grouped into GICS sectors. Hover for detail, click a tile or sector to
        zoom in, and use the scrubber / <b>Play</b> to roll the map through the trading day.
        {payload.note ? <span className="heatmap-skip"> {payload.note}</span> : null}
      </p>
    </section>
  );
}
