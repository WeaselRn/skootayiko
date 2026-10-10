import { env } from "@/server/env";

export interface Place {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
}

interface LiqResult {
  place_id: string;
  lat: string;
  lon: string;
  display_name: string;
  display_place?: string;
  display_address?: string;
}

const cache = new Map<string, { at: number; places: Place[] }>();
const TTL_MS = 24 * 3600 * 1000;

export class GeocodeError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

function toPlace(r: LiqResult): Place {
  const [head, ...tail] = r.display_name.split(", ");
  return {
    id: String(r.place_id),
    name: r.display_place ?? head,
    address: r.display_address ?? tail.slice(0, 3).join(", "),
    lat: Number(r.lat),
    lon: Number(r.lon),
  };
}

/** LocationIQ autocomplete restricted to the Kochi viewbox. Falls back to /search if autocomplete fails. */
export async function geocode(q: string): Promise<Place[]> {
  const query = q.trim().toLowerCase();
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.places;
  if (!env.LOCATIONIQ_API_KEY) throw new GeocodeError("Geocoding is not configured (LOCATIONIQ_API_KEY missing)", 503);

  const params = new URLSearchParams({
    key: env.LOCATIONIQ_API_KEY,
    q: query,
    limit: "6",
    countrycodes: env.GEOCODE_COUNTRY,
    viewbox: env.GEOCODE_VIEWBOX,
    bounded: "1",
    format: "json",
    dedupe: "1",
  });
  const urls = [`https://api.locationiq.com/v1/autocomplete?${params}`, `${env.LOCATIONIQ_BASE_URL}/search?${params}`];
  let lastErr = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.status === 404) {
        cache.set(query, { at: Date.now(), places: [] }); // LocationIQ returns 404 for "no results"
        return [];
      }
      if (res.status === 429) throw new GeocodeError("Geocoding rate limit reached, try again shortly", 429);
      if (!res.ok) {
        lastErr = `LocationIQ HTTP ${res.status}`;
        continue;
      }
      const places = ((await res.json()) as LiqResult[]).map(toPlace);
      if (cache.size > 2000) cache.delete(cache.keys().next().value!);
      cache.set(query, { at: Date.now(), places });
      return places;
    } catch (e) {
      if (e instanceof GeocodeError) throw e;
      lastErr = (e as Error).message;
    }
  }
  throw new GeocodeError(`Geocoding failed: ${lastErr}`);
}
