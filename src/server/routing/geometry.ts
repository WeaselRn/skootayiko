import type { Coordinate, RoutePlanResponse, RouteSegment } from "@/schema/route";
import { haversine } from "@/server/geo";
import { orsDirections, type OrsProfile } from "./ors";
import { osrmPaths, type OsrmProfile } from "./osrm";

/** Road-going modes whose geometry should follow streets or footpaths. */
const ROAD_MODES = new Set<RouteSegment["mode"]>(["walking", "bike_taxi", "auto_rickshaw", "taxi", "cycling"]);
/** Segments shorter than this keep their straight line (not worth a request). */
const MIN_M = 40;

/** True when a segment has no real path, only its two end points. */
export const isStraight = (s: RouteSegment) => s.geometry.length <= 2 && haversine(s.origin.location, s.destination.location) >= MIN_M;

const OSRM_PROFILE: Record<OrsProfile, OsrmProfile> = { "foot-walking": "foot", "driving-car": "car", "cycling-regular": "bike" };
const profileFor = (s: RouteSegment): OrsProfile => (s.mode === "walking" ? "foot-walking" : s.mode === "cycling" ? "cycling-regular" : "driving-car");

/** ORS snaps to the nearest road; join the exact stop locations on so the path stays continuous. */
function withEnds(path: Coordinate[], from: Coordinate, to: Coordinate): Coordinate[] {
  const out = path.slice();
  if (!out.length || haversine(out[0], from) > 1) out.unshift(from);
  if (haversine(out[out.length - 1], to) > 1) out.push(to);
  return out;
}

/**
 * Replaces straight-line road and walking segments with real street/footpath geometry from ORS,
 * falling back to OSRM (OpenStreetMap) when ORS is out of quota or down.
 * Geometry only: times and distances are left as planned so timetables stay consistent.
 * The followed option (`first`) goes first; at most `maxCalls` distinct requests are made
 * (repeats hit the ORS cache). Returns the number of segments still straight.
 */
export async function attachRoadGeometry(plan: RoutePlanResponse, first = 0, maxCalls = 24): Promise<number> {
  const order = [first, ...plan.options.map((_, i) => i).filter((i) => i !== first)];
  const wanted = new Map<string, RouteSegment[]>();
  for (const i of order) {
    for (const s of plan.options[i]?.segments ?? []) {
      if (!ROAD_MODES.has(s.mode) || !isStraight(s)) continue;
      const key = `${profileFor(s)}|${s.origin.location.lat},${s.origin.location.lon}|${s.destination.location.lat},${s.destination.location.lon}`;
      const list = wanted.get(key);
      if (list) list.push(s);
      else if (wanted.size < maxCalls) wanted.set(key, [s]);
    }
  }
  const failed: RouteSegment[][] = [];
  await Promise.all(
    [...wanted.values()].map(async (segs) => {
      const s = segs[0];
      try {
        const r = await orsDirections(profileFor(s), s.origin.location, s.destination.location);
        if (r.geometry.length < 2) throw new Error("empty");
        const path = withEnds(r.geometry, s.origin.location, s.destination.location);
        for (const x of segs) x.geometry = path;
      } catch {
        failed.push(segs);
      }
    }),
  );
  // Fallback: OSRM, one batched request per profile.
  const byProfile = new Map<OsrmProfile, RouteSegment[][]>();
  for (const segs of failed) {
    const p = OSRM_PROFILE[profileFor(segs[0])];
    byProfile.set(p, [...(byProfile.get(p) ?? []), segs]);
  }
  await Promise.all(
    [...byProfile].map(async ([profile, groups]) => {
      try {
        const paths = await osrmPaths(
          profile,
          groups.map((g) => [g[0].origin.location, g[0].destination.location]),
        );
        groups.forEach((g, i) => {
          const path = paths[i];
          if (!path) return;
          const full = withEnds(path, g[0].origin.location, g[0].destination.location);
          for (const x of g) x.geometry = full;
        });
      } catch {
        /* keep straight lines */
      }
    }),
  );
  return plan.options[first]?.segments.filter((s) => ROAD_MODES.has(s.mode) && isStraight(s)).length ?? 0;
}
