import { z } from "zod";
import { Coordinate, MAX_PARTY, MAX_VIA, RoutePlanResponse, TransportMode } from "./route";
import { Suggestion } from "./suggest";

const Place = z.object({ name: z.string().default("Place"), location: Coordinate });

export const ItineraryRequest = z.object({
  start: Place,
  /** Where the day ends; defaults to the start (a round trip). */
  end: Place.optional(),
  /** ISO 8601 with offset; defaults to now. */
  startAt: z.string().optional(),
  /** Total time for the day, travel and visits included. */
  budgetMin: z.number().int().min(30).max(720),
  interests: z.array(z.string()).min(1).max(8),
  pace: z.enum(["relaxed", "normal", "packed"]).default("normal"),
  /** Sight ids that must be included when they fit. */
  mustSee: z.array(z.string()).max(MAX_VIA).default([]),
  /** Own places the traveller insists on (always treated as must-see). */
  extraStops: z
    .array(Place.extend({ dwellMin: z.number().min(5).max(240).default(30) }))
    .max(MAX_VIA)
    .default([]),
  /** Sight ids the traveller removed; never chosen. */
  exclude: z.array(z.string()).max(60).default([]),
  /** Reserve a lunch break around midday when the day spans it. */
  lunch: z.boolean().default(false),
  /** How the real route between stops is picked. */
  prefer: z.enum(["fastest", "scenic"]).default("fastest"),
  accessModes: z.array(z.enum(["walking", "bike_taxi", "taxi", "auto_rickshaw"])).optional(),
  /** Travellers in the group; fares and modes follow planRoutes' group rules. */
  partySize: z.number().int().min(1).max(MAX_PARTY).default(1),
});
export type ItineraryRequest = z.input<typeof ItineraryRequest>;
export type ItineraryInput = z.output<typeof ItineraryRequest>;

export const DropReason = z.enum(["closed", "too_far", "over_budget", "removed"]);
export type DropReason = z.infer<typeof DropReason>;

export const TimelineItem = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("travel"),
    leg: z.number().int().nonnegative(),
    from: z.string(),
    to: z.string(),
    departAt: z.string(),
    arriveAt: z.string(),
    minutes: z.number(),
    modes: z.array(TransportMode),
  }),
  z.object({
    kind: z.literal("visit"),
    sightId: z.string(),
    name: z.string(),
    arriveAt: z.string(),
    /** When the visit can start (later than arriveAt if waiting for opening). */
    startAt: z.string(),
    leaveAt: z.string(),
    minutes: z.number(),
    waitMin: z.number(),
    warnings: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("lunch"),
    near: z.string(),
    startAt: z.string(),
    endAt: z.string(),
    minutes: z.number(),
  }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;

export const DroppedSight = z.object({
  sight: Suggestion,
  reason: DropReason,
  detail: z.string(),
});
export type DroppedSight = z.infer<typeof DroppedSight>;

export const ItineraryResponse = z.object({
  startAt: z.string(),
  /** Latest allowed finish (startAt + budget). */
  endBy: z.string(),
  /** Real (routed) finish time; equals the estimate when routing fell back. */
  finishAt: z.string(),
  budgetMin: z.number(),
  usedMin: z.number(),
  slackMin: z.number(),
  fits: z.boolean(),
  /** Sum of chosen sights' scores. */
  totalScore: z.number(),
  /** Chosen sights in visiting order. */
  stops: z.array(Suggestion),
  dropped: z.array(DroppedSight),
  timeline: z.array(TimelineItem),
  /** Routed journey through the chosen stops; null when nothing fits or routing failed. */
  plan: RoutePlanResponse.nullable(),
  /** Index into plan.options of the journey the timeline follows. */
  selected: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});
export type ItineraryResponse = z.infer<typeof ItineraryResponse>;
