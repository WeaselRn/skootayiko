import type { Coordinate } from "@/schema/route";
import { env } from "@/server/env";

export type OrsProfile = "driving-car" | "foot-walking" | "cycling-regular";

export interface OrsRoute {
  geometry: Coordinate[];
  distanceM: number;
  durationS: number;
}

export class OrsUnavailable extends Error {}

const cache = new Map<string, OrsRoute>();
const CACHE_MAX = 1000;
let day = new Date().toISOString().slice(0, 10);
let dayCount = 0;
let minuteStart = Date.now();
let minuteCount = 0;

function takeQuota(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
  }
  if (Date.now() - minuteStart > 60_000) {
    minuteStart = Date.now();
    minuteCount = 0;
  }
  if (dayCount >= env.ORS_DAILY_BUDGET || minuteCount >= env.ORS_RATE_PER_MIN) return false;
  dayCount++;
  minuteCount++;
  return true;
}

const k = (c: Coordinate) => `${c.lon.toFixed(5)},${c.lat.toFixed(5)}`;

/** openrouteservice directions (HeiGIT). Throws OrsUnavailable on missing key, quota, timeout or API error. */
export async function orsDirections(profile: OrsProfile, from: Coordinate, to: Coordinate): Promise<OrsRoute> {
  const key = `${profile}|${k(from)}|${k(to)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!env.ORS_API_KEY) throw new OrsUnavailable("ORS_API_KEY not set");
  if (!takeQuota()) throw new OrsUnavailable("ORS request budget exhausted");

  let res: Response;
  try {
    res = await fetch(`${env.ORS_BASE_URL}/v2/directions/${profile}/geojson`, {
      method: "POST",
      headers: { Authorization: env.ORS_API_KEY, "Content-Type": "application/json", Accept: "application/geo+json" },
      body: JSON.stringify({ coordinates: [[from.lon, from.lat], [to.lon, to.lat]], radiuses: [500, 500] }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    throw new OrsUnavailable(`ORS request failed: ${(e as Error).message}`);
  }
  if (!res.ok) throw new OrsUnavailable(`ORS HTTP ${res.status}`);
  const json = (await res.json()) as {
    features?: { geometry: { coordinates: [number, number][] }; properties: { summary: { distance?: number; duration?: number } } }[];
  };
  const f = json.features?.[0];
  if (!f) throw new OrsUnavailable("ORS returned no route");
  const route: OrsRoute = {
    geometry: f.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    distanceM: f.properties.summary.distance ?? 0,
    durationS: f.properties.summary.duration ?? 0,
  };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, route);
  return route;
}
