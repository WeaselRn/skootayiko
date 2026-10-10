import type { Coordinate } from "@/schema/route";

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function polylineLength(pts: Coordinate[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}

/** Local equirectangular projection in metres around a reference latitude. */
function project(p: Coordinate, lat0: number): [number, number] {
  return [toRad(p.lon) * R * Math.cos(toRad(lat0)), toRad(p.lat) * R];
}

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker simplification with tolerance in metres (iterative, safe for long shapes). */
export function simplify(pts: Coordinate[], tolerance: number): Coordinate[] {
  if (pts.length <= 2) return pts.slice();
  const lat0 = pts[0].lat;
  const xy = pts.map((p) => project(p, lat0));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(xy[i], xy[s], xy[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Simplifies while always keeping the given vertex indices (e.g. stop snap points).
 * Returns the simplified points and a map from old to new index for the kept vertices.
 */
export function simplifyKeeping(
  pts: Coordinate[],
  tolerance: number,
  keep: Iterable<number>,
): { points: Coordinate[]; indexMap: Map<number, number> } {
  const cuts = [...new Set([0, pts.length - 1, ...keep])].filter((i) => i >= 0 && i < pts.length).sort((a, b) => a - b);
  const points: Coordinate[] = [];
  const indexMap = new Map<number, number>();
  for (let c = 0; c < cuts.length; c++) {
    if (c === 0) {
      indexMap.set(cuts[0], 0);
      points.push(pts[cuts[0]]);
      continue;
    }
    const piece = simplify(pts.slice(cuts[c - 1], cuts[c] + 1), tolerance);
    points.push(...piece.slice(1));
    indexMap.set(cuts[c], points.length - 1);
  }
  return { points, indexMap };
}

/** Straight-line distance inflated by a detour factor, as a cheap network-distance guess. */
export function detourDistance(a: Coordinate, b: Coordinate, factor = 1.3): number {
  return haversine(a, b) * factor;
}

/** Simple uniform grid spatial index for point lookups within a radius. */
export class GridIndex {
  private cells = new Map<string, number[]>();
  constructor(
    private points: Coordinate[],
    private cellDeg = 0.01,
  ) {
    points.forEach((p, i) => {
      const k = this.key(p.lat, p.lon);
      const arr = this.cells.get(k);
      if (arr) arr.push(i);
      else this.cells.set(k, [i]);
    });
  }
  private key(lat: number, lon: number) {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lon / this.cellDeg)}`;
  }
  /** Returns [index, metres] pairs within radius, nearest first. */
  within(c: Coordinate, radiusM: number): [number, number][] {
    const dDeg = radiusM / 111_000 / Math.max(0.2, Math.cos(toRad(c.lat))) + this.cellDeg;
    const out: [number, number][] = [];
    const la0 = Math.floor((c.lat - dDeg) / this.cellDeg);
    const la1 = Math.floor((c.lat + dDeg) / this.cellDeg);
    const lo0 = Math.floor((c.lon - dDeg) / this.cellDeg);
    const lo1 = Math.floor((c.lon + dDeg) / this.cellDeg);
    for (let a = la0; a <= la1; a++)
      for (let o = lo0; o <= lo1; o++) {
        const arr = this.cells.get(`${a}:${o}`);
        if (!arr) continue;
        for (const i of arr) {
          const d = haversine(c, this.points[i]);
          if (d <= radiusM) out.push([i, d]);
        }
      }
    return out.sort((x, y) => x[1] - y[1]);
  }
}
