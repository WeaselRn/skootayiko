import {
  SCHEMA_VERSION,
  type Confidence,
  type Coordinate,
  type DataProvenance,
  type EstimateSource,
  type RouteOption,
  type RoutePlanRequest,
  type RoutePlanResponse,
  type RouteSegment,
  type TransportMode,
} from "@/schema/route";
import { computeTotals } from "@/lib/totals";
import { haversine } from "@/server/geo";
import { env } from "@/server/env";
import { getNetwork, type LoadedNetwork } from "@/server/gtfs/load";
import { FARES, fareFor, metroFare, busFare, ferryFare } from "./fares";
import { orsDirections, type OrsProfile } from "./ors";
import {
  raptor,
  boardAt,
  arrivalAt,
  boardingBuffer,
  patternMode,
  walkSeconds,
  type AccessLink,
  type AccessMode,
  type RaptorJourney,
} from "./raptor";
import { rankOptions } from "./rank";
import { serviceClock, toIstIso, type ServiceClock } from "./time";

type RoadMode = "walking" | "bike_taxi" | "auto_rickshaw" | "taxi";

interface Place {
  name: string;
  location: Coordinate;
  stopIdx?: number;
}

interface RoadLeg {
  kind: "road";
  mode: RoadMode;
  from: Place;
  to: Place;
  seconds: number;
  waitSeconds: number;
  distanceM: number;
  geometry?: Coordinate[];
  durationSource: EstimateSource;
  confidence: Confidence;
  dataSource: string;
  /** Access/egress/direct legs are refined with ORS; short transfers are not. */
  refine: boolean;
}

interface TransitLeg {
  kind: "ride";
  pattern: number;
  boardPos: number;
  alightPos: number;
}

type Leg = RoadLeg | TransitLeg;

interface Candidate {
  legs: Leg[];
}

export interface PlanDeps {
  network?: LoadedNetwork;
  /** Set false to skip ORS (tests, offline fixtures). */
  useOrs?: boolean;
  now?: Date;
}

const S = FARES.speeds;
const ROAD_SPEED: Record<RoadMode, number> = {
  walking: S.walkingMps,
  bike_taxi: S.bikeTaxiMps,
  auto_rickshaw: S.autoRickshawMps,
  taxi: S.taxiMps,
};
const PICKUP_WAIT: Record<RoadMode, number> = {
  walking: 0,
  bike_taxi: FARES.bike_taxi.pickupWaitSeconds,
  auto_rickshaw: FARES.auto_rickshaw.pickupWaitSeconds,
  taxi: FARES.taxi.pickupWaitSeconds,
};
const MOTOR_ACCESS_RADIUS_M = 7000;
const DIRECT_WALK_MAX_M = 3000;
const DIRECT_RIDE_MIN_M = 800;
const SERVICE_AREA_MARGIN_M = 15000;
const BUS_HUB_MIN_PATTERNS = 6;

function estimateRoad(mode: RoadMode, from: Place, to: Place, refine: boolean): RoadLeg {
  const straight = haversine(from.location, to.location);
  const dist = straight * 1.3;
  return {
    kind: "road",
    mode,
    from,
    to,
    distanceM: dist,
    seconds: dist / ROAD_SPEED[mode],
    waitSeconds: PICKUP_WAIT[mode],
    durationSource: "model_estimate",
    confidence: "low",
    dataSource: "model:straight-line",
    refine,
  };
}

function stopPlace(net: LoadedNetwork, idx: number): Place {
  const s = net.stops[idx];
  return { name: s.name, location: { lat: s.lat, lon: s.lon }, stopIdx: idx };
}

function accessLinks(net: LoadedNetwork, at: Coordinate, modes: AccessMode[]): AccessLink[] {
  const links: AccessLink[] = [];
  if (modes.includes("walking")) {
    for (const [stop, m] of net.grid.within(at, env.MAX_WALK_METERS)) {
      links.push({ stop, mode: "walking", seconds: walkSeconds(m), waitSeconds: 0, distanceM: m * 1.3 });
    }
  }
  for (const mode of modes) {
    if (mode === "walking") continue;
    // Motorised first/last mile to the nearest metro stations / jetties and the nearest
    // bus hubs (stops served by many routes), so places far from a bus stop still get buses.
    const candidates = net.grid.within(at, MOTOR_ACCESS_RADIUS_M).filter(([, m]) => m > 600);
    const near = [
      ...candidates.filter(([s]) => net.stops[s].feed === "metro" || isJetty(net, s)).slice(0, 4),
      ...candidates.filter(([s]) => net.stops[s].feed === "bus" && !isJetty(net, s) && net.patternsAtStop[s].length >= BUS_HUB_MIN_PATTERNS).slice(0, 3),
    ];
    for (const [stop, m] of near) {
      const dist = m * 1.3;
      links.push({
        stop,
        mode,
        seconds: dist / ROAD_SPEED[mode],
        waitSeconds: PICKUP_WAIT[mode],
        distanceM: dist,
      });
    }
  }
  return links;
}

let jettyCache: Set<number> | null = null;
function isJetty(net: LoadedNetwork, s: number): boolean {
  if (!jettyCache) {
    jettyCache = new Set();
    net.patterns.forEach((p) => {
      if (patternMode(net, p) === "ferry") p.stops.forEach((x) => jettyCache!.add(x));
    });
  }
  return jettyCache.has(s);
}

function fromRaptor(net: LoadedNetwork, j: RaptorJourney, origin: Place, dest: Place): Candidate {
  const legs: Leg[] = [];
  const firstStop = stopPlace(net, j.access.stop);
  legs.push(estimateRoad(j.access.mode, origin, firstStop, true));
  for (const l of j.legs) {
    if (l.kind === "ride") legs.push({ kind: "ride", pattern: l.pattern, boardPos: l.boardPos, alightPos: l.alightPos });
    else {
      const w = estimateRoad("walking", stopPlace(net, l.from), stopPlace(net, l.to), false);
      w.confidence = "medium";
      legs.push(w);
    }
  }
  legs.push(estimateRoad(j.egress.mode, stopPlace(net, j.egress.stop), dest, true));
  return { legs: mergeWalks(legs.filter((l) => l.kind === "ride" || l.distanceM >= 25)) };
}

function mergeWalks(legs: Leg[]): Leg[] {
  const out: Leg[] = [];
  for (const l of legs) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === "road" && l.kind === "road" && prev.mode === "walking" && l.mode === "walking") {
      out[out.length - 1] = {
        ...prev,
        to: l.to,
        seconds: prev.seconds + l.seconds,
        distanceM: prev.distanceM + l.distanceM,
        geometry: undefined,
        refine: prev.refine || l.refine,
      };
    } else out.push(l);
  }
  return out;
}

function signature(net: LoadedNetwork, c: Candidate): string {
  return c.legs
    .map((l) => (l.kind === "road" ? l.mode : net.routes[net.patterns[l.pattern].route].id))
    .join(">");
}

async function refineWithOrs(c: Candidate, warnings: Set<string>): Promise<void> {
  await Promise.all(
    c.legs.map(async (l) => {
      if (l.kind !== "road" || !l.refine) return;
      const profile: OrsProfile = l.mode === "walking" ? "foot-walking" : "driving-car";
      try {
        const r = await orsDirections(profile, l.from.location, l.to.location);
        l.geometry = r.geometry;
        l.distanceM = r.distanceM;
        if (l.mode === "walking") l.seconds = r.durationS;
        else {
          // ORS durations are free-flow. Use the slower of (ORS × traffic factor) and
          // (road distance ÷ typical urban speed for the mode).
          const modeFactor = l.mode === "bike_taxi" ? S.bikeTaxiVsCarFactor : l.mode === "auto_rickshaw" ? 1.1 : 1;
          l.seconds = Math.max(r.durationS * S.roadTrafficFactor * modeFactor, r.distanceM / ROAD_SPEED[l.mode]);
        }
        l.durationSource = "provider_estimate";
        l.confidence = "medium";
        l.dataSource = `ors:${profile}`;
      } catch (e) {
        warnings.add(`Road directions unavailable (${(e as Error).message}); some legs use straight-line estimates.`);
      }
    }),
  );
}

export const MODE_LABEL: Record<TransportMode, string> = {
  walking: "Walk",
  bike_taxi: "Bike taxi",
  taxi: "Taxi",
  auto_rickshaw: "Auto",
  bus: "Bus",
  metro: "Metro",
  train: "Train",
  ferry: "Boat",
  cycling: "Cycle",
  unknown: "Other",
};

const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/** Turns a candidate into timed schema segments. Returns null if a transit leg cannot be boarded. */
function timeline(net: LoadedNetwork, c: Candidate, clock: ServiceClock, services: Set<string>): RouteSegment[] | null {
  let t = clock.departSec;
  const segs: RouteSegment[] = [];
  c.legs.forEach((l, i) => {
    if (!segs || t === Infinity) return;
    if (l.kind === "road") {
      const start = t + l.waitSeconds;
      const end = start + l.seconds;
      const geometry = l.geometry ?? [l.from.location, l.to.location];
      const next = c.legs[i + 1];
      segs.push({
        id: `s${i}`,
        mode: l.mode,
        origin: { id: stopId(net, l.from), name: l.from.name, location: l.from.location, departureTime: toIstIso(clock, start) },
        destination: { id: stopId(net, l.to), name: l.to.name, location: l.to.location, arrivalTime: toIstIso(clock, end) },
        geometry,
        durationSeconds: Math.round(l.seconds),
        waitSeconds: Math.round(l.waitSeconds),
        durationSource: l.durationSource,
        costEstimate: fareFor(l.mode, l.distanceM),
        distanceMeters: Math.round(l.distanceM),
        instructions: [roadInstruction(l, next?.kind === "ride")],
        dataSource: l.dataSource,
        confidence: l.confidence,
      });
      t = end;
      return;
    }
    const pat = net.patterns[l.pattern];
    const mode = patternMode(net, pat);
    const route = net.routes[pat.route];
    const b = boardAt(net, pat, l.boardPos, t + boardingBuffer(mode), services);
    if (!b) {
      t = Infinity;
      return;
    }
    const arrive = arrivalAt(pat, b, l.alightPos);
    const from = stopPlace(net, pat.stops[l.boardPos]);
    const to = stopPlace(net, pat.stops[l.alightPos]);
    const distanceM = pat.distM[l.alightPos] - pat.distM[l.boardPos];
    const cost =
      mode === "metro"
        ? metroFare(net.metroFares, net.stops[from.stopIdx!].gtfsId, net.stops[to.stopIdx!].gtfsId)
        : mode === "ferry"
          ? ferryFare()
          : busFare(distanceM);
    const isFreq = !pat.trips;
    const line = mode === "metro" ? "Kochi Metro Line 1" : route.shortName ? `${route.shortName} ${route.longName}` : route.longName;
    const stopsCount = l.alightPos - l.boardPos;
    segs.push({
      id: `s${i}`,
      mode,
      origin: { id: net.stops[from.stopIdx!].id, name: from.name, location: from.location, departureTime: toIstIso(clock, b.departAt) },
      destination: { id: net.stops[to.stopIdx!].id, name: to.name, location: to.location, arrivalTime: toIstIso(clock, arrive) },
      geometry: shapeSlice(net, pat, l.boardPos, l.alightPos),
      durationSeconds: Math.round(arrive - b.departAt),
      waitSeconds: Math.round(b.departAt - t),
      durationSource: isFreq ? "model_estimate" : "published_schedule",
      costEstimate: cost,
      distanceMeters: Math.round(distanceM),
      lineName: line,
      headsign: pat.headsign,
      instructions: [
        `${MODE_LABEL[mode] === "Boat" ? "Board the boat" : `Board the ${MODE_LABEL[mode].toLowerCase()}`} towards ${pat.headsign} at ${from.name}.`,
        `Ride ${stopsCount} stop${stopsCount === 1 ? "" : "s"} and get off at ${to.name}.`,
        ...(isFreq ? [`Departure time is an estimate (assumed ${Math.round(effectiveWaitNote(mode) / 60)}-min average wait).`] : []),
      ],
      dataSource: `gtfs:${route.feed}`,
      confidence: mode === "metro" ? "medium" : "low",
    });
    t = arrive;
  });
  return t === Infinity ? null : segs;
}

function effectiveWaitNote(mode: TransportMode): number {
  return mode === "bus" ? FARES.transitDefaults.assumedBusHeadwaySeconds / 2 : 900;
}

function stopId(net: LoadedNetwork, p: Place): string | undefined {
  return p.stopIdx !== undefined ? net.stops[p.stopIdx].id : undefined;
}

function roadInstruction(l: RoadLeg, toTransit: boolean): string {
  const d = fmtDist(l.distanceM);
  const where = toTransit ? `${l.to.name} stop` : l.to.name;
  switch (l.mode) {
    case "walking":
      return `Walk ${d} to ${where}.`;
    case "bike_taxi":
      return `Take a bike taxi (${d}) to ${where}. Book in a ride-hailing app; pickup wait is assumed.`;
    case "auto_rickshaw":
      return `Take an auto-rickshaw (${d}) to ${where}.`;
    case "taxi":
      return `Take a taxi (${d}) to ${where}. Book in a ride-hailing app; pickup wait is assumed.`;
  }
}

function shapeSlice(net: LoadedNetwork, pat: LoadedNetwork["patterns"][number], a: number, b: number): Coordinate[] {
  const s0 = net.stops[pat.stops[a]];
  const s1 = net.stops[pat.stops[b]];
  const ends = [
    { lat: s0.lat, lon: s0.lon },
    { lat: s1.lat, lon: s1.lon },
  ];
  if (pat.shape < 0) return pat.stops.slice(a, b + 1).map((s) => ({ lat: net.stops[s].lat, lon: net.stops[s].lon }));
  const flat = net.shapes[pat.shape];
  const i0 = pat.shapeIdx[a];
  const i1 = pat.shapeIdx[b];
  if (i1 <= i0) return ends;
  const pts: Coordinate[] = [ends[0]];
  for (let i = i0; i <= i1; i++) pts.push({ lat: flat[2 * i], lon: flat[2 * i + 1] });
  pts.push(ends[1]);
  return pts;
}

function toOption(net: LoadedNetwork, segs: RouteSegment[], idx: number, warnings: string[]): RouteOption {
  const totals = computeTotals(segs);
  const vehicleModes = [...new Set(segs.filter((s) => s.mode !== "walking").map((s) => s.mode))];
  const label = vehicleModes.length ? vehicleModes.map((m) => MODE_LABEL[m]).join(" + ") : "Walk";
  const assumptions = new Set<string>();
  const optWarnings = new Set<string>(warnings);
  for (const s of segs) {
    if (["bike_taxi", "taxi", "auto_rickshaw"].includes(s.mode))
      assumptions.add(`Road times assume typical city speeds (bike taxi ~22 km/h, taxi ~20 km/h); no live traffic data.`);
    if (s.mode === "bus") {
      assumptions.add(FARES.transitDefaults.basis);
      optWarnings.add("Bus routes come from 2022–23 community data and may have changed.");
    }
    if (s.mode === "metro") assumptions.add("Metro times follow the KMRL timetable (feed expired 2025-12-31; assumed unchanged).");
    if (s.costEstimate?.source === "model_estimate" && s.mode !== "walking")
      assumptions.add(`${MODE_LABEL[s.mode]} fare is an approximate range, not a quote.`);
    if (s.durationSource === "model_estimate" && s.dataSource === "model:straight-line" && s.mode !== "walking")
      optWarnings.add("Some road legs use straight-line estimates.");
  }
  return {
    id: `opt-${idx}`,
    label,
    rankings: ["alternative"],
    ...totals,
    segments: segs,
    assumptions: [...assumptions],
    warnings: [...optWarnings],
  };
}

function directCandidates(origin: Place, dest: Place): Candidate[] {
  const d = haversine(origin.location, dest.location);
  const out: Candidate[] = [];
  if (d <= DIRECT_WALK_MAX_M) out.push({ legs: [estimateRoad("walking", origin, dest, true)] });
  if (d >= DIRECT_RIDE_MIN_M) {
    for (const m of ["bike_taxi", "auto_rickshaw", "taxi"] as const) out.push({ legs: [estimateRoad(m, origin, dest, true)] });
  }
  return out;
}

function inServiceArea(net: LoadedNetwork, c: Coordinate): boolean {
  return net.grid.within(c, SERVICE_AREA_MARGIN_M).length > 0;
}

export function staticProvenance(net: LoadedNetwork): DataProvenance[] {
  return [
    ...net.provenance,
    { id: "fares:kmrl", name: "KMRL fare table (from GTFS)", kind: "fare_table", expired: false },
    {
      id: "fares:model",
      name: "Approximate fare model (config/fares.json)",
      kind: "fare_model",
      expired: false,
      note: "Bus, boat, bike-taxi, auto and taxi fares are estimated ranges.",
    },
    { id: "ors", name: "openrouteservice directions (HeiGIT), © OpenStreetMap contributors", kind: "directions_api", expired: false },
  ];
}

export async function planRoutes(req: RoutePlanRequest, deps: PlanDeps = {}): Promise<RoutePlanResponse> {
  const net = deps.network ?? getNetwork();
  const useOrs = deps.useOrs ?? true;
  const clock = serviceClock(req.departAt ?? (deps.now ?? new Date()).toISOString());
  const services = new Set(net.servicesByDow[clock.dow]);
  const origin: Place = { name: req.origin.name, location: req.origin.location };
  const dest: Place = { name: req.destination.name, location: req.destination.location };
  const accessModes = (req.accessModes?.filter((m) => m !== "taxi") ?? ["walking", "bike_taxi"]) as AccessMode[];
  const dataWarnings = new Set<string>();
  for (const p of net.provenance)
    if (p.expired) dataWarnings.add(`${p.name} expired on ${p.validUntil}; schedules are assumed to be typical, not current.`);

  const base: Omit<RoutePlanResponse, "options"> = {
    schemaVersion: SCHEMA_VERSION,
    origin: { name: origin.name, location: origin.location },
    destination: { name: dest.name, location: dest.location },
    generatedAt: new Date().toISOString(),
    departAt: toIstIso(clock, clock.departSec),
    liveData: false,
    mock: false,
    provenance: staticProvenance(net),
  };

  if (!inServiceArea(net, origin.location) || !inServiceArea(net, dest.location)) {
    return { ...base, options: [], dataWarnings: [...dataWarnings, "Origin or destination is outside the Kochi service area."] };
  }
  if (haversine(origin.location, dest.location) < 50) {
    return { ...base, options: [], dataWarnings: [...dataWarnings, "Origin and destination are the same place."] };
  }

  // 1. Candidate generation: several RAPTOR runs with different first/last-mile modes.
  const walkOnly: AccessMode[] = ["walking"];
  const variants: { a: AccessMode[]; e: AccessMode[]; modes?: TransportMode[] }[] = [
    { a: walkOnly, e: walkOnly },
    { a: walkOnly, e: walkOnly, modes: ["bus", "ferry"] },
  ];
  for (const m of accessModes.filter((x) => x !== "walking")) {
    variants.push({ a: [m], e: walkOnly }, { a: walkOnly, e: [m] }, { a: [m], e: [m] });
  }
  const pool = new Map<string, { c: Candidate; est: number }>();
  const consider = (c: Candidate) => {
    const segs = timeline(net, c, clock, services);
    if (!segs) return;
    const est = computeTotals(segs).totalDurationSeconds;
    const sig = signature(net, c);
    const cur = pool.get(sig);
    if (!cur || est < cur.est) pool.set(sig, { c, est });
  };
  for (const v of variants) {
    const access = accessLinks(net, origin.location, v.a);
    const egress = accessLinks(net, dest.location, v.e);
    if (!access.length || !egress.length) continue;
    const journeys = raptor(net, {
      departSec: clock.departSec,
      services,
      access,
      egress,
      maxRides: env.MAX_TRANSFERS + 1,
      allowedModes: v.modes ? new Set(v.modes) : undefined,
    });
    for (const j of journeys) consider(fromRaptor(net, j, origin, dest));
  }
  const transitFound = pool.size > 0;
  for (const c of directCandidates(origin, dest)) consider(c);
  if (!transitFound) dataWarnings.add("No public transport connection found for this trip and time; showing direct options only.");

  // 2. Pre-rank on estimates, keep a shortlist, refine road legs with ORS, then re-time and re-rank.
  const prelim = [...pool.values()].map(({ c }, i) => ({ c, opt: toOption(net, timeline(net, c, clock, services)!, i, []) }));
  const shortlist = rankOptions(
    prelim.map((p) => p.opt),
    7,
  ).map((o) => prelim.find((p) => p.opt.id === o.id)!);

  const orsWarnings = new Set<string>();
  if (useOrs) await Promise.all(shortlist.map((p) => refineWithOrs(p.c, orsWarnings)));
  else orsWarnings.add("Road directions disabled; road legs use straight-line estimates.");

  const finals: RouteOption[] = [];
  shortlist.forEach((p, i) => {
    const segs = timeline(net, p.c, clock, services);
    if (segs) finals.push(toOption(net, segs, i, []));
  });
  orsWarnings.forEach((w) => dataWarnings.add(w));

  // Walking-only routes over 3 km are not useful alternatives.
  const options = rankOptions(finals.filter((o) => !(o.segments.length === 1 && o.segments[0].mode === "walking" && o.totalDistanceMeters! > DIRECT_WALK_MAX_M * 1.3)));
  return { ...base, options, dataWarnings: [...dataWarnings] };
}

