import type { CostEstimate, EstimateSource, TransportMode } from "@/schema/route";
import fareConfig from "../../../config/fares.json";

export const FARES = fareConfig;

const r = (n: number) => Math.round(n);

function range(min: number, max: number, source: EstimateSource, basis: string): CostEstimate {
  return { min: r(min), max: r(Math.max(min, max)), currency: "INR", source, basis };
}

export function metroFare(
  fares: Record<string, number>,
  fromGtfsId: string,
  toGtfsId: string,
): CostEstimate | undefined {
  const p = fares[`${fromGtfsId}>${toGtfsId}`] ?? fares[`${toGtfsId}>${fromGtfsId}`];
  if (p === undefined) return undefined;
  return range(p, p, "published_schedule", "KMRL fare table (single-journey token; card/QR discounts not applied)");
}

/** ₹10 up to the first km, then ₹8 per started km beyond it (config/fares.json). */
export function busFare(distanceM: number): CostEstimate {
  const c = FARES.bus;
  const extraKm = Math.ceil(Math.max(0, distanceM / 1000 - c.minFareKm) - 1e-9);
  const fare = c.minFare + extraKm * c.perExtraKm;
  return range(fare, fare, "model_estimate", c.basis);
}

export function ferryFare(): CostEstimate {
  return range(FARES.ferry.low, FARES.ferry.high, "model_estimate", FARES.ferry.basis);
}

export function roadFare(mode: "bike_taxi" | "auto_rickshaw" | "taxi", distanceM: number): CostEstimate {
  const km = distanceM / 1000;
  if (mode === "auto_rickshaw") {
    const c = FARES.auto_rickshaw;
    const extra = Math.max(0, km - c.minFareKm);
    return range(c.minFare + extra * c.perKmLow, c.minFare + extra * c.perKmHigh, "model_estimate", c.basis);
  }
  const c = FARES[mode];
  const lo = Math.max(c.minFare, c.base + km * c.perKmLow) + c.bookingFee;
  const hi = Math.max(c.minFare, c.base + km * c.perKmHigh) + c.bookingFee;
  return range(lo, hi, "model_estimate", c.basis);
}

export function freeFare(): CostEstimate {
  return range(0, 0, "model_estimate", "No fare");
}

export function fareFor(mode: TransportMode, distanceM: number): CostEstimate | undefined {
  switch (mode) {
    case "walking":
    case "cycling":
      return freeFare();
    case "bus":
      return busFare(distanceM);
    case "ferry":
      return ferryFare();
    case "bike_taxi":
    case "auto_rickshaw":
    case "taxi":
      return roadFare(mode, distanceM);
    default:
      return undefined;
  }
}

const PER_PERSON = new Set<TransportMode>(["metro", "bus", "ferry", "train"]);
const SEATS = FARES.group.seats as Partial<Record<TransportMode, number>>;

/** Vehicles a group of `party` needs for a road ride (1 for transit and walking). */
export function vehiclesFor(mode: TransportMode, party: number): number {
  const seats = SEATS[mode];
  return seats ? Math.ceil(Math.max(1, party) / seats) : 1;
}

/**
 * Cost for the whole group: public transport per person, road rides per vehicle needed.
 * Walking stays free. Returns the input unchanged for one traveller.
 */
export function forParty(mode: TransportMode, cost: CostEstimate | undefined, party: number): CostEstimate | undefined {
  if (!cost || party <= 1 || cost.max === 0) return cost;
  const n = PER_PERSON.has(mode) ? party : vehiclesFor(mode, party);
  if (n === 1) return { ...cost, basis: `${cost.basis ?? ""} (one vehicle for ${party} people)`.trim() };
  const what = PER_PERSON.has(mode) ? `x ${party} people` : `x ${n} vehicles for ${party} people`;
  return { ...cost, min: cost.min * n, max: cost.max * n, basis: `${cost.basis ?? ""} ${what}`.trim() };
}

const SOURCE_RANK: EstimateSource[] = ["live", "published_schedule", "provider_estimate", "model_estimate", "fallback"];

/** The least reliable source among the inputs. */
export function weakestSource(sources: EstimateSource[]): EstimateSource {
  return sources.reduce((w, s) => (SOURCE_RANK.indexOf(s) > SOURCE_RANK.indexOf(w) ? s : w), "live" as EstimateSource);
}
