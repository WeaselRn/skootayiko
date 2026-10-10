import type { Coordinate } from "@/schema/route";
import type { Suggestion } from "@/schema/suggest";
import { INTERESTS } from "@/lib/interests";
import { baseScore, defaultDwell, matchCurated, sightScore } from "@/lib/dwell";
import { env } from "@/server/env";
import { distanceToPolyline, haversine, samplePolyline } from "@/server/geo";

interface LiqNearby {
  place_id: string;
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  class?: string;
  display_name?: string;
  distance?: number;
}

const cache = new Map<string, { at: number; items: LiqNearby[] }>();
const TTL_MS = 24 * 3600 * 1000;
const MAX_CALLS = 14;
const MIN_STEP_M = 2000;
const MAX_RADIUS_M = 5000;
/** Park-like names that are neighbourhood greens rather than places worth a detour. */
const NOISE = /\b(residential|colony|school|playground|ground|quarters|apartment|flat|lodge|homestay|hostel)\b/i;

/** Lodging that OSM sometimes tags as an attraction. */
const LODGING = /\b(homestay|home stay|hostel|lodge|resort|hotel|guest ?house|inn|villa|residency|apartments?)\b/i;

export class SuggestError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

/** LocationIQ's free tier allows 2 requests/second; space provider calls so a burst never trips it. */
const GAP_MS = 550;
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

async function nearby(c: Coordinate, radiusM: number, tags: string[]): Promise<LiqNearby[]> {
  const key = `${c.lat.toFixed(3)},${c.lon.toFixed(3)}|${Math.round(radiusM / 100)}|${tags.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  const params = new URLSearchParams({
    key: env.LOCATIONIQ_API_KEY,
    lat: String(c.lat),
    lon: String(c.lon),
    tag: tags.join(","),
    radius: String(Math.round(radiusM)),
    limit: "50",
    format: "json",
  });
  const res = await throttled(() => fetch(`${env.LOCATIONIQ_BASE_URL}/nearby?${params}`, { signal: AbortSignal.timeout(8000) }));
  // LocationIQ answers 404 when nothing is nearby.
  const items = res.status === 404 ? [] : null;
  if (res.status === 429) throw new SuggestError("Place suggestions rate limit reached, try again shortly", 429);
  if (!res.ok && items === null) throw new SuggestError(`LocationIQ HTTP ${res.status}`);
  const list = items ?? ((await res.json()) as LiqNearby[]);
  if (cache.size > 3000) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), items: list });
  return list;
}

const interestOf = (cls: string, type: string, wanted: typeof INTERESTS) =>
  wanted.find((i) => i.tags.includes(`${cls}:${type}`))?.id;

export interface SuggestInput {
  stops: Coordinate[];
  path?: Coordinate[];
  interests: string[];
  maxOffRouteM: number;
}

/**
 * Tourist places within `maxOffRouteM` of the route. Samples points along the route, asks LocationIQ for
 * places near each sample, then keeps those truly close to the line, nearest and best-known first.
 */
export async function suggestAlongRoute(input: SuggestInput): Promise<{ suggestions: Suggestion[]; partial: boolean }> {
  if (!env.LOCATIONIQ_API_KEY) throw new SuggestError("Place suggestions are not configured (LOCATIONIQ_API_KEY missing)", 503);
  const wanted = INTERESTS.filter((i) => input.interests.includes(i.id));
  if (!wanted.length) return { suggestions: [], partial: false };
  const tags = wanted.flatMap((i) => i.tags);

  const line = input.path && input.path.length >= 2 ? input.path : input.stops;
  let length = 0;
  for (let i = 1; i < line.length; i++) length += haversine(line[i - 1], line[i]);
  const step = Math.max(MIN_STEP_M, length / (MAX_CALLS - 1));
  const samples = samplePolyline(line, step);
  const radius = Math.min(MAX_RADIUS_M, Math.hypot(step / 2, input.maxOffRouteM) + 100);

  const found = new Map<string, LiqNearby>();
  let partial = false;
  const batch = await Promise.allSettled(samples.map((s) => nearby(s, radius, tags)));
  for (const r of batch) {
    if (r.status === "fulfilled") for (const it of r.value) found.set(it.place_id, it);
    else {
      partial = true;
      console.warn("place suggestions: provider call failed:", (r.reason as Error).message);
    }
  }
  if (!found.size && partial) throw new SuggestError("Place suggestions are temporarily unavailable, try again shortly");

  const stopLine = input.stops;
  const out: Suggestion[] = [];
  for (const it of found.values()) {
    const name = it.name?.trim();
    const interest = interestOf(it.class ?? "", it.type ?? "", wanted);
    if (!name || !interest) continue;
    if (interest === "nature" && NOISE.test(name)) continue;
    if (LODGING.test(name)) continue;
    const location = { lat: Number(it.lat), lon: Number(it.lon) };
    const off = distanceToPolyline(location, line).meters;
    if (off > input.maxOffRouteM) continue;
    // Leave places that are basically at a stop already on the trip out.
    if (stopLine.some((s) => haversine(s, location) < 120)) continue;
    const [head, ...tail] = (it.display_name ?? name).split(", ");
    const kind = (it.type ?? "").replace(/_/g, " ");
    const cur = matchCurated(name, location);
    out.push({
      id: it.place_id,
      name: cur?.name ?? name,
      interest,
      kind,
      address: tail.slice(0, 3).join(", ") || head,
      location,
      offRouteM: Math.round(off),
      afterStop: distanceToPolyline(location, stopLine).segment,
      dwellMin: cur?.dwellMin ?? defaultDwell(interest, kind),
      score: sightScore(cur?.popularity ?? baseScore(interest), off, input.maxOffRouteM),
      hours: cur?.hours,
      closedDays: cur?.closedDays,
      sunset: cur?.sunset ?? interest === "beaches",
      blurb: cur?.blurb,
      curated: !!cur,
    });
  }

  // Drop duplicates of the same landmark (e.g. "Dutch Palace" and "Dutch Palace Complex").
  const lower = (s: string) => s.toLowerCase();
  const deduped: Suggestion[] = [];
  for (const s of out.sort((a, b) => b.score - a.score || a.offRouteM - b.offRouteM)) {
    const dup = deduped.some(
      (d) => haversine(d.location, s.location) < 250 && (lower(d.name).includes(lower(s.name)) || lower(s.name).includes(lower(d.name))),
    );
    if (!dup) deduped.push(s);
  }
  return { suggestions: deduped.slice(0, 18), partial };
}
