// Squarified treemap layout (Bruls, Huizing & van Wijk 2000). Pure geometry so
// it can be unit-tested and reused for both the sector blocks and the stocks
// laid out inside each sector. No dependencies, works in a unitless coordinate
// space (we drive it with an SVG viewBox).

export type Rect = { x: number; y: number; w: number; h: number };

export type TreeInput<T> = { key: string; value: number; data: T };

export type TreeOutput<T> = { key: string; data: T; rect: Rect };

type Node<T> = { key: string; data: T; area: number };

function shorterSide(rect: Rect): number {
  return Math.min(rect.w, rect.h);
}

// Aspect-ratio cost of a candidate row (lower is squarer). `length` is the side
// the row is laid out along (the shorter side of the remaining rectangle).
function worstRatio<T>(row: Node<T>[], extra: Node<T> | null, length: number): number {
  const nodes = extra ? [...row, extra] : row;
  if (nodes.length === 0) return Infinity;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const node of nodes) {
    sum += node.area;
    if (node.area > max) max = node.area;
    if (node.area < min) min = node.area;
  }
  if (sum <= 0) return Infinity;
  const s2 = sum * sum;
  const l2 = length * length;
  return Math.max((l2 * max) / s2, s2 / (l2 * min));
}

export function squarifyTreemap<T>(items: TreeInput<T>[], bounds: Rect): TreeOutput<T>[] {
  const area = bounds.w * bounds.h;
  const valid = items.filter((item) => Number.isFinite(item.value) && item.value > 0);
  const totalValue = valid.reduce((sum, item) => sum + item.value, 0);
  if (valid.length === 0 || totalValue <= 0 || area <= 0) return [];

  const scale = area / totalValue;
  const queue: Node<T>[] = valid
    .map((item) => ({ key: item.key, data: item.data, area: item.value * scale }))
    .sort((a, b) => b.area - a.area);

  const out: TreeOutput<T>[] = [];
  let rect: Rect = { ...bounds };
  let row: Node<T>[] = [];

  const layoutRow = () => {
    const sum = row.reduce((acc, node) => acc + node.area, 0);
    if (sum <= 0) {
      row = [];
      return;
    }
    const length = shorterSide(rect);
    const thickness = sum / length;
    if (rect.w >= rect.h) {
      // Remaining rect is wide: consume a vertical strip on the left, stacking
      // the row's tiles top-to-bottom across the (shorter) height.
      let y = rect.y;
      for (const node of row) {
        const h = (node.area / sum) * length;
        out.push({ key: node.key, data: node.data, rect: { x: rect.x, y, w: thickness, h } });
        y += h;
      }
      rect = { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h };
    } else {
      // Remaining rect is tall: consume a horizontal strip on top, laying the
      // row's tiles left-to-right across the (shorter) width.
      let x = rect.x;
      for (const node of row) {
        const w = (node.area / sum) * length;
        out.push({ key: node.key, data: node.data, rect: { x, y: rect.y, w, h: thickness } });
        x += w;
      }
      rect = { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness };
    }
    row = [];
  };

  for (const node of queue) {
    const length = shorterSide(rect);
    if (row.length === 0 || worstRatio(row, null, length) >= worstRatio(row, node, length)) {
      row.push(node);
    } else {
      layoutRow();
      row.push(node);
    }
  }
  if (row.length) layoutRow();

  return out;
}

// Diverging red→neutral→green scale used to colour tiles by % change. Clamped at
// ±`cap` percent (Finviz-style), tuned for the dark terminal background.
export function heatmapColor(pct: number | null | undefined, cap = 3): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "#2b2f38";
  const t = Math.max(-1, Math.min(1, pct / cap));
  // Finviz-like: a fairly neutral gray at flat, ramping to vivid green / red.
  const neutral = [62, 66, 76]; // #3e424c
  const positive = [40, 174, 84]; // #28ae54
  const negative = [230, 58, 54]; // #e63a36
  const target = t >= 0 ? positive : negative;
  const mix = Math.abs(t);
  const channel = (index: number) => Math.round(neutral[index] + (target[index] - neutral[index]) * mix);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}
