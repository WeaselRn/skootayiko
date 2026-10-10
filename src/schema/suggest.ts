import { z } from "zod";
import { Coordinate } from "./route";

export const SuggestRequest = z.object({
  /** Current stops in order (A, B, C …). */
  stops: z.array(Coordinate).min(2).max(10),
  /** Actual route geometry, when a plan exists; otherwise straight lines between stops are used. */
  path: z.array(Coordinate).max(400).optional(),
  interests: z.array(z.string()).min(1).max(8),
  maxOffRouteM: z.number().min(200).max(3000).default(1000),
});
export type SuggestRequest = z.infer<typeof SuggestRequest>;

export const Suggestion = z.object({
  id: z.string(),
  name: z.string(),
  interest: z.string(),
  /** OSM kind, e.g. "museum", "beach". */
  kind: z.string(),
  address: z.string(),
  location: Coordinate,
  offRouteM: z.number(),
  /** Index of the stop it follows: inserting it at `afterStop + 1` keeps it between those stops. */
  afterStop: z.number().int().nonnegative(),
  /** Typical visit length in minutes (curated, else a per-kind default). */
  dwellMin: z.number().positive().default(30),
  /** How worthwhile the place is for this traveller, 0–1 (interest match × popularity × detour). */
  score: z.number().min(0).max(1).default(0.5),
  /** Opening windows as "HH:MM" pairs in IST; absent = open all day or unknown. */
  hours: z.array(z.tuple([z.string(), z.string()])).optional(),
  /** Days it is closed, 0 = Sunday. */
  closedDays: z.array(z.number().int().min(0).max(6)).optional(),
  /** Worth more around sunset (beaches, waterfronts). */
  sunset: z.boolean().optional(),
  /** One-line description, curated sights only. */
  blurb: z.string().optional(),
  /** True when hours/dwell come from config/sights.json rather than defaults. */
  curated: z.boolean().default(false),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const SuggestResponse = z.object({
  suggestions: z.array(Suggestion),
  /** Set when the provider was rate-limited or failed part-way; results may be incomplete. */
  partial: z.boolean().default(false),
});
export type SuggestResponse = z.infer<typeof SuggestResponse>;
