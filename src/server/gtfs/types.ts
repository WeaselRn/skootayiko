import type { DataProvenance, TransportMode } from "@/schema/route";

export type FeedId = "metro" | "bus";

export interface NetStop {
  /** Feed-prefixed id, e.g. "metro:ALVA", "bus:n622522403". */
  id: string;
  /** Raw GTFS stop_id, used for fare lookups. */
  gtfsId: string;
  feed: FeedId;
  name: string;
  lat: number;
  lon: number;
}

export interface NetRoute {
  id: string;
  feed: FeedId;
  mode: TransportMode;
  shortName: string;
  longName: string;
  color?: string;
}

/** A scheduled run of a timetable pattern (metro). Times are seconds after service-day midnight. */
export interface TimetableTrip {
  service: string;
  arr: number[];
  dep: number[];
}

/** Frequency window for a frequency-based pattern (bus/ferry); times are of the first stop. */
export interface FrequencyWindow {
  start: number;
  end: number;
  headway: number;
}

export interface Pattern {
  id: string;
  route: number;
  headsign: string;
  /** Stop indices into Network.stops, in travel order. */
  stops: number[];
  /** Index into Network.shapes, or -1. */
  shape: number;
  /** For each stop, index of the nearest shape point (monotonic). */
  shapeIdx: number[];
  /** Cumulative along-shape distance (metres) at each stop. */
  distM: number[];
  /** Timetable trips sorted by departure at the first stop. */
  trips?: TimetableTrip[];
  /** Frequency-based: template offsets from trip start + service windows. */
  freq?: { service: string; arrOff: number[]; depOff: number[]; windows: FrequencyWindow[] };
}

export interface Network {
  builtAt: string;
  provenance: DataProvenance[];
  stops: NetStop[];
  routes: NetRoute[];
  patterns: Pattern[];
  /** Simplified shapes as flat [lat, lon, lat, lon, ...]. */
  shapes: number[][];
  /** Metro fares: "ORIG>DEST" -> INR. */
  metroFares: Record<string, number>;
  /** Active service ids per day of week, index 0 = Sunday (calendar date ranges ignored: feeds are expired). */
  servicesByDow: string[][];
}
