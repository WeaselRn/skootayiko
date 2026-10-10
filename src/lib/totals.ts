import type { CostEstimate, RouteSegment } from "@/schema/route";
import { weakestSource } from "@/server/routing/fares";

/**
 * Single source of truth for journey totals. Duration = sum of each segment's
 * wait + travel time. Cost is omitted when any segment lacks an estimate.
 */
export function computeTotals(segments: RouteSegment[]): {
  totalDurationSeconds: number;
  totalWaitSeconds: number;
  totalDistanceMeters: number;
  totalCostEstimate?: CostEstimate;
  transfers: number;
} {
  let dur = 0;
  let wait = 0;
  let dist = 0;
  for (const s of segments) {
    dur += s.durationSeconds + (s.waitSeconds ?? 0);
    wait += s.waitSeconds ?? 0;
    dist += s.distanceMeters ?? 0;
  }
  const costs = segments.map((s) => s.costEstimate);
  const totalCostEstimate = costs.every((c): c is CostEstimate => !!c)
    ? {
        min: costs.reduce((a, c) => a + c.min, 0),
        max: costs.reduce((a, c) => a + c.max, 0),
        currency: "INR" as const,
        // Free legs (walking) carry no pricing uncertainty, so they do not downgrade the source.
        source: weakestSource(costs.filter((c) => c.max > 0).map((c) => c.source).concat(costs.every((c) => c.max === 0) ? ["model_estimate"] : [])),
      }
    : undefined;
  // A transfer = boarding a vehicle after already having used one.
  const vehicleLegs = segments.filter((s) => s.mode !== "walking").length;
  return {
    totalDurationSeconds: Math.round(dur),
    totalWaitSeconds: Math.round(wait),
    totalDistanceMeters: Math.round(dist),
    totalCostEstimate,
    transfers: Math.max(0, vehicleLegs - 1),
  };
}
