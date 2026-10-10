import type { RouteOption, RoutePlanRequest, RoutePlanResponse, RouteSegment, RouteStop } from "@/schema/route";
import { computeTotals } from "@/lib/totals";
import { haversine } from "@/server/geo";
import { MODE_LABEL, planRoutes, type PlanDeps } from "./plan";
import { rankOptions } from "./rank";
import { serviceClock, toIstIso } from "./time";

/** How each leg's option is picked. Every picker yields one combined journey; duplicates collapse. */
type Picker = (opts: RouteOption[]) => RouteOption | undefined;
const byRank =
  (r: "fastest" | "cheapest" | "balanced"): Picker =>
  (opts) =>
    opts.find((o) => o.rankings.includes(r));
/** Fastest option that rides the given mode, so metro / bus / boat journeys stay visible. */
const withMode =
  (m: "metro" | "bus" | "ferry"): Picker =>
  (opts) =>
    opts.find((o) => o.segments.some((s) => s.mode === m));
const PICKERS: Picker[] = [byRank("fastest"), byRank("cheapest"), byRank("balanced"), withMode("metro"), withMode("bus"), withMode("ferry")];
/** Stops closer than this are treated as the same place and merged. */
const SAME_PLACE_M = 50;

interface Built {
  segs: RouteSegment[];
  assumptions: Set<string>;
  warnings: Set<string>;
  /** Transfers inside each leg; a ride that starts a new stop-to-stop leg is not a transfer. */
  transfers: number;
}

/**
 * Plans A → B → C … by routing each stop-to-stop leg on its own and chaining departure times
 * (leg n+1 leaves when leg n arrives, plus the stop's `dwellMin` if set). Combined journeys are built per ranking style:
 * "fastest of every leg", "cheapest of every leg", "balanced of every leg".
 * Without `via` this is exactly planRoutes.
 */
export async function planJourney(req: RoutePlanRequest, deps: PlanDeps = {}): Promise<RoutePlanResponse> {
  type Stop = RoutePlanRequest["origin"] & { dwellMin?: number };
  const stops: Stop[] = [req.origin];
  for (const v of [...(req.via ?? []), req.destination] as Stop[]) {
    const prev = stops[stops.length - 1];
    if (haversine(prev.location, v.location) >= SAME_PLACE_M) stops.push(v);
    // A merged stop still keeps its visit time.
    else if (v.dwellMin) stops[stops.length - 1] = { ...prev, dwellMin: (prev.dwellMin ?? 0) + v.dwellMin };
  }
  if (stops.length < 3) return planRoutes({ ...req, via: undefined }, deps);

  const legs = stops.length - 1;
  const cache = new Map<string, Promise<RoutePlanResponse>>();
  const planLeg = (i: number, departAt: string | undefined) => {
    const key = `${i}|${departAt ?? "now"}`;
    let p = cache.get(key);
    if (!p) {
      p = planRoutes({ origin: stops[i], destination: stops[i + 1], departAt, accessModes: req.accessModes }, deps);
      cache.set(key, p);
    }
    return p;
  };

  const first = await planLeg(0, req.departAt);
  const warnings = new Set<string>(first.dataWarnings ?? []);
  const built = new Map<string, Built>();
  let failedLeg = -1;

  for (const pick of PICKERS) {
    let at: string | undefined = first.departAt;
    const b: Built = { segs: [], assumptions: new Set(), warnings: new Set(), transfers: 0 };
    let ok = true;
    for (let i = 0; i < legs; i++) {
      const plan = await planLeg(i, at);
      plan.dataWarnings?.forEach((w) => warnings.add(w));
      const opt = pick(plan.options) ?? plan.options[0];
      if (!opt) {
        failedLeg = i;
        ok = false;
        break;
      }
      for (const s of opt.segments) b.segs.push({ ...s, id: `l${i}-${s.id}`, leg: i });
      opt.assumptions?.forEach((a) => b.assumptions.add(a));
      opt.warnings?.forEach((w) => b.warnings.add(w));
      b.transfers += opt.transfers;
      at = addMinutes(opt.segments[opt.segments.length - 1].destination.arrivalTime, stops[i + 1].dwellMin);
    }
    if (ok) built.set(b.segs.map((s) => `${s.mode}:${s.lineName ?? ""}:${s.origin.name}>${s.destination.name}`).join("|"), b);
  }

  const { options: _legOptions, ...rest } = first;
  const base: Omit<RoutePlanResponse, "options"> = {
    ...rest,
    origin: { name: stops[0].name, location: stops[0].location },
    destination: { name: stops[legs].name, location: stops[legs].location },
    via: stops.slice(1, legs).map((s): RouteStop => ({ name: s.name, location: s.location })),
    generatedAt: new Date().toISOString(),
  };

  if (!built.size) {
    const bad = failedLeg >= 0 ? `${stops[failedLeg].name} → ${stops[failedLeg + 1].name}` : "one leg";
    return { ...base, options: [], dataWarnings: [...warnings, `No route found for ${bad}.`] };
  }

  const options = [...built.values()].map((b, i): RouteOption => {
    const modes = [...new Set(b.segs.filter((s) => s.mode !== "walking").map((s) => s.mode))];
    return {
      id: `opt-${i}`,
      label: modes.length ? modes.map((m) => MODE_LABEL[m]).join(" + ") : "Walk",
      rankings: ["alternative"],
      ...computeTotals(b.segs),
      transfers: b.transfers,
      segments: b.segs,
      assumptions: [...b.assumptions],
      warnings: [...b.warnings],
    };
  });

  return { ...base, options: rankOptions(options, 5), dataWarnings: [...warnings] };
}

/** ISO time shifted by `min` minutes (IST offset kept); unchanged when there is nothing to add. */
function addMinutes(iso: string | undefined, min: number | undefined): string | undefined {
  if (!iso || !min) return iso;
  const c = serviceClock(iso);
  return toIstIso(c, c.departSec + min * 60);
}
