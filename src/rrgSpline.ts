// Centripetal Catmull-Rom spline → per-segment cubic-bézier SVG paths.
//
// RRG tails curl back on themselves at turning points (the most telling part of
// the rotation). A uniform Catmull-Rom spline overshoots and forms loops there;
// the centripetal parameterisation (alpha = 0.5) provably avoids cusps and
// self-intersections, giving the clean "smooth tails" StockCharts draws.

export type ScreenPoint = { x: number; y: number };

const ALPHA = 0.5;
const EPS = 1e-6;

function knot(a: ScreenPoint, b: ScreenPoint): number {
  return Math.max(EPS, Math.hypot(a.x - b.x, a.y - b.y) ** ALPHA);
}

/** One cubic-bézier (as an SVG path) from p1→p2 using neighbours p0,p3 for the tangents. */
function segmentPath(p0: ScreenPoint, p1: ScreenPoint, p2: ScreenPoint, p3: ScreenPoint): string {
  const t01 = knot(p0, p1);
  const t12 = knot(p1, p2);
  const t23 = knot(p2, p3);

  // Non-uniform Catmull-Rom tangents at p1 and p2 (Hermite form), scaled to [p1,p2].
  const m1x = t12 * ((p1.x - p0.x) / t01 - (p2.x - p0.x) / (t01 + t12) + (p2.x - p1.x) / t12);
  const m1y = t12 * ((p1.y - p0.y) / t01 - (p2.y - p0.y) / (t01 + t12) + (p2.y - p1.y) / t12);
  const m2x = t12 * ((p2.x - p1.x) / t12 - (p3.x - p1.x) / (t12 + t23) + (p3.x - p2.x) / t23);
  const m2y = t12 * ((p2.y - p1.y) / t12 - (p3.y - p1.y) / (t12 + t23) + (p3.y - p2.y) / t23);

  // Hermite → Bézier control points.
  const c1x = p1.x + m1x / 3;
  const c1y = p1.y + m1y / 3;
  const c2x = p2.x - m2x / 3;
  const c2y = p2.y - m2y / 3;

  return (
    `M${p1.x.toFixed(1)},${p1.y.toFixed(1)}` +
    `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  );
}

/**
 * Smooth curve through `pts` as a list of per-segment bézier paths (one per gap),
 * so each segment can carry its own stroke width/opacity for the taper-and-fade.
 * Endpoints are clamped (duplicated) so the curve starts and ends exactly on the data.
 */
export function splineSegments(pts: ScreenPoint[]): string[] {
  if (pts.length < 2) return [];
  const segs: string[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const p0 = pts[i - 2] ?? pts[i - 1];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[i + 1] ?? pts[i];
    segs.push(segmentPath(p0, p1, p2, p3));
  }
  return segs;
}
