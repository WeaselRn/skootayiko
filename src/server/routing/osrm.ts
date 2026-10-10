import type { Coordinate } from "@/schema/route";
import { env } from "@/server/env";

export type OsrmProfile = "foot" | "car" | "bike";

/**
 * Street geometry from an OSRM server (default: the FOSSGIS community instance, OpenStreetMap data).
 * Used only as a fallback when ORS is unavailable. The public instance asks for light use, so pairs are
 * batched into one multi-waypoint request per profile and requests are spaced at least 1 s apart.
 */
const GAP_MS = 1100;
let nextAt = 0;
/**
 * Spaces calls GAP_MS apart. Uses a shared timestamp, not a shared promise chain: on Cloudflare Workers a
 * timer created by one request is cancelled when that request ends, so chaining across requests would hang.
 */
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const at = Math.max(now, nextAt);
  nextAt = at + GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  return fn();
}

const cache = new Map<string, Coordinate[]>();
const k = (c: Coordinate) => `${c.lon.toFixed(5)},${c.lat.toFixed(5)}`;

interface OsrmResponse {
  code: string;
  routes?: { legs: { steps: { geometry: { coordinates: [number, number][] } }[] }[] }[];
}

/**
 * Paths for each [from, to] pair, in order (null where no path came back). Pairs are chained into a
 * single route A→B→C→D…; only the legs that correspond to the pairs are kept.
 */
export async function osrmPaths(profile: OsrmProfile, pairs: [Coordinate, Coordinate][]): Promise<(Coordinate[] | null)[]> {
  const out: (Coordinate[] | null)[] = pairs.map(([a, b]) => cache.get(`${profile}|${k(a)}|${k(b)}`) ?? null);
  const todo = pairs.map((p, i) => ({ p, i })).filter(({ i }) => !out[i]);
  if (!todo.length || !env.OSRM_BASE_URL) return out;

  const pts = todo.flatMap(({ p }) => p);
  const url = `${env.OSRM_BASE_URL}/routed-${profile}/route/v1/driving/${pts.map(k).join(";")}?overview=false&steps=true&geometries=geojson&continue_straight=false`;
  const res = await throttled(() =>
    fetch(url, { headers: { "User-Agent": "Skootayiko/0.1 (Kochi trip planner)" }, signal: AbortSignal.timeout(10000) }),
  );
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const json = (await res.json()) as OsrmResponse;
  const legs = json.routes?.[0]?.legs;
  if (json.code !== "Ok" || !legs) throw new Error(`OSRM ${json.code}`);
  todo.forEach(({ p, i }, n) => {
    // Leg 2n runs from this pair's origin to its destination; odd legs join consecutive pairs.
    const leg = legs[2 * n];
    if (!leg) return;
    const path: Coordinate[] = [];
    for (const st of leg.steps) {
      for (const [lon, lat] of st.geometry.coordinates) {
        const last = path[path.length - 1];
        if (!last || last.lat !== lat || last.lon !== lon) path.push({ lat, lon });
      }
    }
    if (path.length < 2) return;
    out[i] = path;
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    cache.set(`${profile}|${k(p[0])}|${k(p[1])}`, path);
  });
  return out;
}
