import type { Coordinate } from "@/schema/route";
import { haversine } from "@/server/geo";
import sightsConfig from "../../config/sights.json";

/** Default visit length (minutes) and base worth (0–1) per interest, for places without curated data. */
export const INTEREST_DEFAULTS: Record<string, { dwellMin: number; base: number }> = {
  sights: { dwellMin: 30, base: 0.6 },
  museums: { dwellMin: 60, base: 0.6 },
  heritage: { dwellMin: 45, base: 0.65 },
  beaches: { dwellMin: 40, base: 0.55 },
  nature: { dwellMin: 40, base: 0.45 },
  fun: { dwellMin: 90, base: 0.5 },
  worship: { dwellMin: 20, base: 0.4 },
  food: { dwellMin: 45, base: 0.45 },
};

/** Finer-grained dwell for some OSM kinds (spaces replace underscores, as in Suggestion.kind). */
const KIND_DWELL: Record<string, number> = {
  viewpoint: 15,
  gallery: 45,
  monument: 15,
  fort: 45,
  castle: 60,
  "archaeological site": 30,
  marina: 25,
  garden: 30,
  "nature reserve": 60,
  "theme park": 180,
  zoo: 120,
  aquarium: 60,
  cafe: 30,
};

export const PACE_FACTOR = { relaxed: 1.3, normal: 1, packed: 0.75 } as const;
export type Pace = keyof typeof PACE_FACTOR;

export interface CuratedSight {
  id: string;
  name: string;
  interest: string;
  kind: string;
  location: Coordinate;
  address: string;
  dwellMin: number;
  popularity: number;
  hours?: [string, string][];
  closedDays?: number[];
  sunset?: boolean;
  blurb?: string;
}

export const CURATED: CuratedSight[] = sightsConfig.sights as CuratedSight[];
export const SUNSET_AROUND: string = sightsConfig.sunsetAround;
export const CURATED_VERIFY: string = sightsConfig.verify;

export function defaultDwell(interest: string, kind: string): number {
  return KIND_DWELL[kind] ?? INTEREST_DEFAULTS[interest]?.dwellMin ?? 30;
}

export function baseScore(interest: string): number {
  return INTEREST_DEFAULTS[interest]?.base ?? 0.4;
}

/**
 * 0–1 worth of a place for this trip: interest match (always 1 here, places are fetched by interest)
 * × popularity (curated, else a per-interest base) × detour penalty (down to 0.4 at the distance limit).
 */
export function sightScore(popularity: number, offRouteM: number, maxOffRouteM: number, interestMatch = 1): number {
  const detour = 1 - 0.6 * Math.min(1, Math.max(0, offRouteM) / maxOffRouteM);
  return Math.round(interestMatch * popularity * detour * 1000) / 1000;
}

/** "HH:MM" → seconds after midnight. */
export function hhmm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 3600 + m * 60;
}

/** Words too common to identify a landmark on their own. */
const GENERIC = new Set(["beach", "church", "temple", "museum", "park", "road", "market", "kochi", "fort", "cathedral", "basilica", "walkway"]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** The curated entry for a provider place: close by and sharing a name word of 4+ letters, or very close. */
export function matchCurated(name: string, location: Coordinate): CuratedSight | undefined {
  const words = new Set(norm(name).split(" ").filter((w) => w.length >= 4 && !GENERIC.has(w)));
  return CURATED.find((c) => {
    const d = haversine(c.location, location);
    if (d < 60) return true;
    return d < 400 && norm(c.name).split(" ").some((w) => w.length >= 4 && words.has(w));
  });
}
