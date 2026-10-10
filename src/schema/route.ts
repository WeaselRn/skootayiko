import { z } from "zod";

/**
 * Shared route contract between the routing service and the UI.
 * Documented in docs/route-schema.md. Any breaking change must bump
 * SCHEMA_VERSION and be noted there first.
 */
export const SCHEMA_VERSION = "1.0" as const;

/** Max intermediate stops between origin and destination. */
export const MAX_VIA = 8;

export const TransportMode = z.enum([
  "walking",
  "bike_taxi",
  "taxi",
  "auto_rickshaw",
  "bus",
  "metro",
  "train",
  "ferry",
  "cycling",
  "unknown",
]);
export type TransportMode = z.infer<typeof TransportMode>;

export const EstimateSource = z.enum([
  "live",
  "published_schedule",
  "provider_estimate",
  "model_estimate",
  "fallback",
]);
export type EstimateSource = z.infer<typeof EstimateSource>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const Coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type Coordinate = z.infer<typeof Coordinate>;

export const RouteStop = z.object({
  id: z.string().optional(),
  name: z.string(),
  location: Coordinate,
  /** ISO 8601 with offset, e.g. 2026-10-10T08:15:00+05:30 */
  arrivalTime: z.string().optional(),
  departureTime: z.string().optional(),
});
export type RouteStop = z.infer<typeof RouteStop>;

export const CostEstimate = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  currency: z.literal("INR"),
  source: EstimateSource,
  /** Short human note, e.g. "KMRL fare table" or "Per-km model, not a quote". */
  basis: z.string().optional(),
});
export type CostEstimate = z.infer<typeof CostEstimate>;

export const RouteSegment = z.object({
  id: z.string(),
  mode: TransportMode,
  origin: RouteStop,
  destination: RouteStop,
  /** Ordered polyline. May be empty when geometry is unavailable; the UI then draws a straight line. */
  geometry: z.array(Coordinate),
  /** In-vehicle (or walking) time only. Waiting is in waitSeconds. */
  durationSeconds: z.number().nonnegative(),
  /** Expected wait before this segment starts (boarding wait, headway/2, etc.). */
  waitSeconds: z.number().nonnegative().default(0),
  durationSource: EstimateSource,
  costEstimate: CostEstimate.optional(),
  distanceMeters: z.number().nonnegative().optional(),
  instructions: z.array(z.string()).optional(),
  /** Route name/number for transit legs, e.g. "KMRL Line 1" or "Aluva ↔ Fort Kochi". */
  lineName: z.string().optional(),
  headsign: z.string().optional(),
  /** Free-text provider/feed id, e.g. "gtfs:kmrl", "ors:foot-walking". */
  dataSource: z.string().optional(),
  confidence: Confidence,
  /** Multi-stop trips: 0-based index of the stop-to-stop leg this segment belongs to (A→B = 0, B→C = 1, …). */
  leg: z.number().int().nonnegative().optional(),
});
export type RouteSegment = z.infer<typeof RouteSegment>;

export const Ranking = z.enum(["fastest", "cheapest", "balanced", "alternative"]);
export type Ranking = z.infer<typeof Ranking>;

export const RouteOption = z.object({
  id: z.string(),
  label: z.string(),
  /** An option can hold several labels, e.g. both fastest and cheapest. */
  rankings: z.array(Ranking).min(1),
  totalDurationSeconds: z.number().nonnegative(),
  totalWaitSeconds: z.number().nonnegative(),
  totalDistanceMeters: z.number().nonnegative().optional(),
  /** Absent when any segment has no cost estimate. */
  totalCostEstimate: CostEstimate.optional(),
  segments: z.array(RouteSegment).min(1),
  transfers: z.number().int().nonnegative(),
  assumptions: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});
export type RouteOption = z.infer<typeof RouteOption>;

export const DataProvenance = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["gtfs", "directions_api", "geocoding_api", "fare_table", "fare_model", "fixture"]),
  /** YYYY-MM-DD; absent for APIs. */
  validUntil: z.string().optional(),
  expired: z.boolean().default(false),
  note: z.string().optional(),
});
export type DataProvenance = z.infer<typeof DataProvenance>;

export const RoutePlanResponse = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  origin: RouteStop,
  destination: RouteStop,
  /** Intermediate stops in visiting order (multi-stop trips only). */
  via: z.array(RouteStop).optional(),
  /** ISO 8601 */
  generatedAt: z.string(),
  /** Requested departure, ISO 8601. */
  departAt: z.string(),
  /** Always false until a verified realtime feed is integrated. */
  liveData: z.boolean(),
  /** True when the response comes from hand-made fixtures. */
  mock: z.boolean().default(false),
  options: z.array(RouteOption),
  provenance: z.array(DataProvenance),
  dataWarnings: z.array(z.string()).optional(),
});
export type RoutePlanResponse = z.infer<typeof RoutePlanResponse>;

export const RoutePlanRequest = z.object({
  origin: z.object({ name: z.string().default("Origin"), location: Coordinate }),
  destination: z.object({ name: z.string().default("Destination"), location: Coordinate }),
  /** Intermediate stops, visited in order between origin and destination. */
  via: z
    .array(
      z.object({
        name: z.string().default("Stop"),
        location: Coordinate,
        /** Minutes spent at this stop before the next leg departs (default 0). */
        dwellMin: z.number().min(0).max(600).optional(),
      }),
    )
    .max(MAX_VIA)
    .optional(),
  /** ISO 8601; defaults to now. */
  departAt: z.string().optional(),
  /** Restrict first/last mile modes. */
  accessModes: z.array(z.enum(["walking", "bike_taxi", "taxi", "auto_rickshaw"])).optional(),
});
export type RoutePlanRequest = z.infer<typeof RoutePlanRequest>;
