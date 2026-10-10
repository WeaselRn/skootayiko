import type { TransportMode } from "@/schema/route";
import type { LoadedNetwork } from "@/server/gtfs/load";
import type { Pattern } from "@/server/gtfs/types";
import { FARES } from "./fares";

export type AccessMode = "walking" | "bike_taxi" | "auto_rickshaw";

/** A link between the user's origin/destination and a stop. */
export interface AccessLink {
  stop: number;
  mode: AccessMode;
  /** Travel time (excluding pickup wait). */
  seconds: number;
  /** Pickup wait before travelling (0 for walking). */
  waitSeconds: number;
  distanceM: number;
}

export interface RideLeg {
  kind: "ride";
  pattern: number;
  boardPos: number;
  alightPos: number;
  /** When the rider is at the boarding stop. */
  readyAt: number;
  departAt: number;
  arriveAt: number;
  tripIdx?: number;
}

export interface WalkLeg {
  kind: "walk";
  from: number;
  to: number;
  seconds: number;
  distanceM: number;
}

export interface RaptorJourney {
  access: AccessLink;
  legs: (RideLeg | WalkLeg)[];
  egress: AccessLink;
  arrival: number;
  rides: number;
}

type Parent =
  | { kind: "access"; link: AccessLink }
  | { kind: "ride"; leg: RideLeg }
  | { kind: "walk"; leg: WalkLeg };

export interface RaptorOptions {
  /** Seconds after service-day midnight. */
  departSec: number;
  services: Set<string>;
  access: AccessLink[];
  egress: AccessLink[];
  maxRides: number;
  allowedModes?: Set<TransportMode>;
}

const WALK_DETOUR = 1.3;

export function walkSeconds(straightM: number): number {
  return (straightM * WALK_DETOUR) / FARES.speeds.walkingMps;
}

export function boardingBuffer(mode: TransportMode): number {
  const b = FARES.transitDefaults.boardingBufferSeconds as Record<string, number>;
  return b[mode] ?? 60;
}

export function patternMode(net: LoadedNetwork, pat: Pattern): TransportMode {
  return net.routes[pat.route].mode;
}

/** Headway used for expected-wait estimation on frequency-based patterns. */
export function effectiveHeadway(mode: TransportMode, feedHeadway: number): number {
  return mode === "bus" ? FARES.transitDefaults.assumedBusHeadwaySeconds : feedHeadway;
}

export interface Boarding {
  departAt: number;
  /** Frequency patterns: departure time at the first stop of the virtual trip. */
  base?: number;
  tripIdx?: number;
}

/** Earliest boarding of `pat` at position `pos` for a rider ready at `ready`. */
export function boardAt(
  net: LoadedNetwork,
  pat: Pattern,
  pos: number,
  ready: number,
  services: Set<string>,
): Boarding | null {
  if (pos >= pat.stops.length - 1) return null;
  if (pat.trips) {
    const trips = pat.trips;
    let lo = 0;
    let hi = trips.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (trips[mid].dep[pos] < ready) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < trips.length; i++) {
      if (trips[i].dep[pos] >= ready && services.has(trips[i].service)) return { departAt: trips[i].dep[pos], tripIdx: i };
    }
    return null;
  }
  if (pat.freq && services.has(pat.freq.service)) {
    const off = pat.freq.depOff[pos];
    const mode = patternMode(net, pat);
    for (const w of pat.freq.windows) {
      const needBase = ready - off;
      if (needBase <= w.start) return { departAt: w.start + off, base: w.start };
      if (needBase <= w.end) {
        const base = Math.min(w.end, needBase + effectiveHeadway(mode, w.headway) / 2);
        return { departAt: base + off, base };
      }
    }
  }
  return null;
}

export function arrivalAt(pat: Pattern, b: Boarding, pos: number): number {
  if (pat.trips && b.tripIdx !== undefined) return pat.trips[b.tripIdx].arr[pos];
  return b.base! + pat.freq!.arrOff[pos];
}

export function departureAt(pat: Pattern, b: Boarding, pos: number): number {
  if (pat.trips && b.tripIdx !== undefined) return pat.trips[b.tripIdx].dep[pos];
  return b.base! + pat.freq!.depOff[pos];
}

/**
 * Round-based public transit search (RAPTOR, Delling et al. 2012) adapted for
 * mixed timetable (metro) and frequency-based (bus/ferry) patterns.
 * Returns the Pareto set of journeys over (arrival time, number of rides).
 */
export function raptor(net: LoadedNetwork, opt: RaptorOptions): RaptorJourney[] {
  const n = net.stops.length;
  const K = opt.maxRides;
  const tau: Float64Array[] = [];
  const parents: (Parent | undefined)[][] = [];
  for (let k = 0; k <= K; k++) {
    tau.push(new Float64Array(n).fill(Infinity));
    parents.push(new Array(n));
  }
  const best = new Float64Array(n).fill(Infinity);
  const egressByStop = new Map<number, AccessLink>();
  for (const e of opt.egress) {
    const cur = egressByStop.get(e.stop);
    if (!cur || e.seconds + e.waitSeconds < cur.seconds + cur.waitSeconds) egressByStop.set(e.stop, e);
  }

  let marked = new Set<number>();
  for (const a of opt.access) {
    const t = opt.departSec + a.waitSeconds + a.seconds;
    if (t < tau[0][a.stop]) {
      tau[0][a.stop] = t;
      best[a.stop] = t;
      parents[0][a.stop] = { kind: "access", link: a };
      marked.add(a.stop);
    }
  }

  let target = Infinity;
  const results: { k: number; stop: number; arrival: number }[] = [];

  for (let k = 1; k <= K && marked.size; k++) {
    const queue = new Map<number, number>();
    for (const s of marked) {
      for (const [pi, pos] of net.patternsAtStop[s]) {
        if (opt.allowedModes && !opt.allowedModes.has(patternMode(net, net.patterns[pi]))) continue;
        const q = queue.get(pi);
        if (q === undefined || pos < q) queue.set(pi, pos);
      }
    }
    marked = new Set();
    const rideLabels = new Map<number, number>();

    for (const [pi, pos0] of queue) {
      const pat = net.patterns[pi];
      const mode = patternMode(net, pat);
      let cur: { b: Boarding; boardPos: number; readyAt: number } | null = null;
      for (let pos = pos0; pos < pat.stops.length; pos++) {
        const s = pat.stops[pos];
        if (cur) {
          const arr = arrivalAt(pat, cur.b, pos);
          if (arr < Math.min(best[s], target)) {
            tau[k][s] = arr;
            best[s] = arr;
            parents[k][s] = {
              kind: "ride",
              leg: {
                kind: "ride",
                pattern: pi,
                boardPos: cur.boardPos,
                alightPos: pos,
                readyAt: cur.readyAt,
                departAt: departureAt(pat, cur.b, cur.boardPos),
                arriveAt: arr,
                tripIdx: cur.b.tripIdx,
              },
            };
            marked.add(s);
            rideLabels.set(s, arr);
          }
        }
        const prev = tau[k - 1][s];
        if (prev < Infinity) {
          const cand = boardAt(net, pat, pos, prev + boardingBuffer(mode), opt.services);
          if (cand && (!cur || cand.departAt < departureAt(pat, cur.b, pos))) {
            cur = { b: cand, boardPos: pos, readyAt: prev };
          }
        }
      }
    }

    // Walking transfers, only from stops reached by a ride in this round.
    for (const [s, t] of rideLabels) {
      for (const [nb, m] of net.transfers[s]) {
        const sec = walkSeconds(m);
        const arr = t + sec;
        if (arr < Math.min(best[nb], target)) {
          tau[k][nb] = arr;
          best[nb] = arr;
          parents[k][nb] = { kind: "walk", leg: { kind: "walk", from: s, to: nb, seconds: sec, distanceM: m * WALK_DETOUR } };
          marked.add(nb);
        }
      }
    }

    for (const s of marked) {
      const e = egressByStop.get(s);
      if (!e) continue;
      const arr = tau[k][s] + e.waitSeconds + e.seconds;
      if (arr < target) {
        target = arr;
        const last = results[results.length - 1];
        if (last && last.k === k) results.pop();
        results.push({ k, stop: s, arrival: arr });
      }
    }
  }

  return results.map((r) => reconstruct(net, parents, r.k, r.stop, egressByStop.get(r.stop)!, r.arrival));
}

function reconstruct(
  net: LoadedNetwork,
  parents: (Parent | undefined)[][],
  k: number,
  stop: number,
  egress: AccessLink,
  arrival: number,
): RaptorJourney {
  const legs: (RideLeg | WalkLeg)[] = [];
  let s = stop;
  let r = k;
  for (let guard = 0; guard < 64; guard++) {
    const p = parents[r][s];
    if (!p) throw new Error(`RAPTOR reconstruction failed at round ${r}, stop ${s}`);
    if (p.kind === "access") {
      legs.reverse();
      return { access: p.link, legs, egress, arrival, rides: legs.filter((l) => l.kind === "ride").length };
    }
    legs.push(p.leg);
    if (p.kind === "walk") s = p.leg.from;
    else {
      s = net.patterns[p.leg.pattern].stops[p.leg.boardPos];
      r -= 1;
    }
  }
  throw new Error("RAPTOR reconstruction loop");
}
