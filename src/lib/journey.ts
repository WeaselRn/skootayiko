import type { Coordinate, RouteOption, RouteSegment } from "@/schema/route";

/** Pure helpers that turn a RouteOption into a playable timeline. No routing logic here. */

export interface Phase {
  segment: number;
  kind: "wait" | "move";
  start: number;
  end: number;
}

export interface Timeline {
  phases: Phase[];
  total: number;
}

export function buildTimeline(option: RouteOption): Timeline {
  const phases: Phase[] = [];
  let t = 0;
  option.segments.forEach((s, i) => {
    if (s.waitSeconds > 0) {
      phases.push({ segment: i, kind: "wait", start: t, end: t + s.waitSeconds });
      t += s.waitSeconds;
    }
    // Give zero-length legs a sliver of time so they still appear in playback.
    const d = Math.max(1, s.durationSeconds);
    phases.push({ segment: i, kind: "move", start: t, end: t + d });
    t += d;
  });
  return { phases, total: t };
}

export interface PlayState {
  segment: number;
  kind: "wait" | "move";
  /** 0..1 within the current segment's movement (0 while waiting). */
  progress: number;
  /** Seconds left in the current phase. */
  remaining: number;
}

export function stateAt(tl: Timeline, t: number): PlayState {
  const time = Math.max(0, Math.min(tl.total, t));
  const ph = tl.phases.find((p) => time < p.end) ?? tl.phases[tl.phases.length - 1];
  const progress = ph.kind === "move" ? (time - ph.start) / (ph.end - ph.start) : 0;
  return { segment: ph.segment, kind: ph.kind, progress: Math.min(1, progress), remaining: ph.end - time };
}

/** Journey time at which a given segment's wait (or move, if no wait) starts. */
export function segmentStart(tl: Timeline, segment: number): number {
  return tl.phases.find((p) => p.segment === segment)?.start ?? 0;
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

function dist(a: Coordinate, b: Coordinate): number {
  const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * R;
}

/** Bearing in degrees clockwise from north. */
function bearing(a: Coordinate, b: Coordinate): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface PathSampler {
  length: number;
  at(fraction: number): { point: Coordinate; bearing: number };
}

/** Arc-length parameterised sampler. Falls back to origin→destination when geometry is missing. */
export function pathSampler(seg: Pick<RouteSegment, "geometry" | "origin" | "destination">): PathSampler {
  const pts = seg.geometry.length >= 2 ? seg.geometry : [seg.origin.location, seg.destination.location];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const length = cum[cum.length - 1];
  return {
    length,
    at(f) {
      if (length === 0) return { point: pts[0], bearing: 0 };
      const target = Math.max(0, Math.min(1, f)) * length;
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid;
        else hi = mid;
      }
      const a = pts[lo];
      const b = pts[hi];
      const span = cum[hi] - cum[lo] || 1;
      const k = (target - cum[lo]) / span;
      // Look slightly ahead for a stable heading on dense, jittery polylines.
      let j = hi;
      while (j < pts.length - 1 && cum[j] - target < 15) j++;
      return {
        point: { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k },
        bearing: bearing(a, pts[j] ?? b),
      };
    },
  };
}
