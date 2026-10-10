import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { Coordinate, DataProvenance, TransportMode } from "@/schema/route";
import { haversine, simplifyKeeping } from "@/server/geo";
import type { FeedId, Network, NetRoute, NetStop, Pattern, TimetableTrip } from "./types";

type Row = Record<string, string>;

function readCsv(dir: string, file: string, optional = false): Row[] {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) {
    if (optional) return [];
    throw new Error(`GTFS file missing: ${p}`);
  }
  return parse(fs.readFileSync(p), { columns: true, skip_empty_lines: true, bom: true, trim: true }) as Row[];
}

export function parseTime(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

const ROUTE_TYPE_MODE: Record<string, TransportMode> = {
  "0": "metro", // tram/light rail – none in current feeds
  "1": "metro",
  "2": "train",
  "3": "bus",
  "4": "ferry",
};

const SHAPE_TOLERANCE_M = 5;
const DOW_COLS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Assigns each stop the nearest shape point, moving forward only (handles loops reasonably). */
export function snapStopsToShape(stops: Coordinate[], shape: Coordinate[]): number[] {
  const out: number[] = [];
  let from = 0;
  for (const s of stops) {
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < shape.length; i++) {
      const d = haversine(s, shape[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      // Once a close match is found, stop when the line has clearly moved away.
      if (bestD < 150 && d > bestD + 2000) break;
    }
    out.push(best);
    from = best;
  }
  return out;
}

function cumulative(shape: Coordinate[]): number[] {
  const c = [0];
  for (let i = 1; i < shape.length; i++) c.push(c[i - 1] + haversine(shape[i - 1], shape[i]));
  return c;
}

function gtfsDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

interface FeedSpec {
  id: FeedId;
  dir: string;
  name: string;
  note: string;
}

export function buildNetwork(feeds: FeedSpec[], today = new Date()): Network {
  const stops: NetStop[] = [];
  const stopIndex = new Map<string, number>();
  const routes: NetRoute[] = [];
  const routeIndex = new Map<string, number>();
  const patterns: Pattern[] = [];
  const shapes: number[][] = [];
  const provenance: DataProvenance[] = [];
  const metroFares: Record<string, number> = {};
  const servicesByDow: string[][] = DOW_COLS.map(() => []);

  for (const feed of feeds) {
    const pre = (id: string) => `${feed.id}:${id}`;

    const info = readCsv(feed.dir, "feed_info.txt", true)[0];
    const validUntil = info?.feed_end_date ? gtfsDate(info.feed_end_date) : undefined;
    provenance.push({
      id: `gtfs:${feed.id}`,
      name: feed.name,
      kind: "gtfs",
      validUntil,
      expired: validUntil ? new Date(`${validUntil}T23:59:59+05:30`) < today : false,
      note: feed.note,
    });

    for (const c of readCsv(feed.dir, "calendar.txt")) {
      DOW_COLS.forEach((col, i) => {
        if (c[col] === "1") servicesByDow[i].push(pre(c.service_id));
      });
    }

    for (const s of readCsv(feed.dir, "stops.txt")) {
      if (s.location_type && s.location_type !== "0") continue;
      const lat = Number(s.stop_lat);
      const lon = Number(s.stop_lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      stopIndex.set(pre(s.stop_id), stops.length);
      stops.push({ id: pre(s.stop_id), gtfsId: s.stop_id, feed: feed.id, name: s.stop_name || "Unnamed stop", lat, lon });
    }

    for (const r of readCsv(feed.dir, "routes.txt")) {
      routeIndex.set(pre(r.route_id), routes.length);
      routes.push({
        id: pre(r.route_id),
        feed: feed.id,
        mode: ROUTE_TYPE_MODE[r.route_type] ?? "unknown",
        shortName: r.route_short_name || "",
        longName: r.route_long_name || r.route_short_name || r.route_id,
        color: r.route_color ? `#${r.route_color}` : undefined,
      });
    }

    // Shapes: group, sort, simplify.
    const rawShapes = new Map<string, { seq: number; lat: number; lon: number }[]>();
    for (const p of readCsv(feed.dir, "shapes.txt", true)) {
      const arr = rawShapes.get(p.shape_id) ?? [];
      arr.push({ seq: Number(p.shape_pt_sequence), lat: Number(p.shape_pt_lat), lon: Number(p.shape_pt_lon) });
      rawShapes.set(p.shape_id, arr);
    }
    // Raw (dense) shapes are used for snapping; they are simplified once all stop snaps are known.
    const shapeCoords = new Map<string, Coordinate[]>();
    for (const [id, pts] of rawShapes) {
      pts.sort((a, b) => a.seq - b.seq);
      shapeCoords.set(id, pts.map(({ lat, lon }) => ({ lat, lon })));
    }
    const shapeUsers = new Map<string, Pattern[]>();

    // Stop times grouped by trip.
    const stByTrip = new Map<string, { seq: number; stop: string; arr: number; dep: number }[]>();
    for (const st of readCsv(feed.dir, "stop_times.txt")) {
      const arr = stByTrip.get(st.trip_id) ?? [];
      const a = parseTime(st.arrival_time || st.departure_time);
      const d = parseTime(st.departure_time || st.arrival_time);
      arr.push({ seq: Number(st.stop_sequence), stop: pre(st.stop_id), arr: a, dep: d });
      stByTrip.set(st.trip_id, arr);
    }

    const freqByTrip = new Map<string, { start: number; end: number; headway: number }[]>();
    for (const f of readCsv(feed.dir, "frequencies.txt", true)) {
      const arr = freqByTrip.get(f.trip_id) ?? [];
      arr.push({ start: parseTime(f.start_time), end: parseTime(f.end_time), headway: Number(f.headway_secs) });
      freqByTrip.set(f.trip_id, arr);
    }

    for (const f of readCsv(feed.dir, "fare_rules.txt", true)) {
      if (!f.origin_id || !f.destination_id) continue;
      const fa = readFareCache(feed.dir);
      const price = fa.get(f.fare_id);
      if (price !== undefined) metroFares[`${f.origin_id}>${f.destination_id}`] = price;
    }

    // Group trips into patterns by (route, stop sequence).
    const patternByKey = new Map<string, Pattern>();
    for (const t of readCsv(feed.dir, "trips.txt")) {
      const st = stByTrip.get(t.trip_id);
      const rIdx = routeIndex.get(pre(t.route_id));
      if (!st || st.length < 2 || rIdx === undefined) continue;
      st.sort((a, b) => a.seq - b.seq);
      const stopIdx = st.map((x) => stopIndex.get(x.stop));
      if (stopIdx.some((x) => x === undefined)) continue;
      const service = pre(t.service_id);
      const freq = freqByTrip.get(t.trip_id);
      const key = `${rIdx}|${stopIdx.join(",")}|${freq ? "f" : "t"}`;

      let pat = patternByKey.get(key);
      if (!pat) {
        let shape = -1;
        let shapeIdx: number[] = [];
        let distM: number[] = [];
        const coords = t.shape_id ? shapeCoords.get(t.shape_id) : undefined;
        const stopCoords = stopIdx.map((i) => ({ lat: stops[i!].lat, lon: stops[i!].lon }));
        if (coords && coords.length >= 2) {
          shape = 0; // resolved after simplification below
          shapeIdx = snapStopsToShape(stopCoords, coords);
          const cum = cumulative(coords);
          distM = shapeIdx.map((i) => Math.round(cum[i]));
        } else {
          let acc = 0;
          distM = stopCoords.map((c, i) => (i === 0 ? 0 : Math.round((acc += haversine(stopCoords[i - 1], c)))));
          shapeIdx = stopCoords.map(() => -1);
        }
        pat = {
          id: `${feed.id}:${t.trip_id}`,
          route: rIdx,
          headsign: t.trip_headsign || stops[stopIdx[stopIdx.length - 1]!].name,
          stops: stopIdx as number[],
          shape,
          shapeIdx,
          distM,
        };
        patternByKey.set(key, pat);
        patterns.push(pat);
        if (shape === 0) shapeUsers.set(t.shape_id, [...(shapeUsers.get(t.shape_id) ?? []), pat]);
      }

      if (freq) {
        const base = st[0].dep;
        if (!pat.freq) {
          pat.freq = {
            service,
            arrOff: st.map((x) => x.arr - base),
            depOff: st.map((x) => x.dep - base),
            windows: [],
          };
        }
        pat.freq.windows.push(...freq);
      } else {
        const trip: TimetableTrip = { service, arr: st.map((x) => x.arr), dep: st.map((x) => x.dep) };
        (pat.trips ??= []).push(trip);
      }
    }

    for (const [shapeId, users] of shapeUsers) {
      const keep = users.flatMap((u) => u.shapeIdx);
      const { points, indexMap } = simplifyKeeping(shapeCoords.get(shapeId)!, SHAPE_TOLERANCE_M, keep);
      const slot = shapes.length;
      shapes.push(points.flatMap((c) => [round6(c.lat), round6(c.lon)]));
      for (const u of users) {
        u.shape = slot;
        u.shapeIdx = u.shapeIdx.map((i) => indexMap.get(i)!);
      }
    }
  }

  for (const p of patterns) {
    p.trips?.sort((a, b) => a.dep[0] - b.dep[0]);
    p.freq?.windows.sort((a, b) => a.start - b.start);
  }

  return {
    builtAt: today.toISOString(),
    provenance,
    stops,
    routes,
    patterns,
    shapes,
    metroFares,
    servicesByDow,
  };
}

const fareCache = new Map<string, Map<string, number>>();
function readFareCache(dir: string): Map<string, number> {
  let m = fareCache.get(dir);
  if (!m) {
    m = new Map(readCsv(dir, "fare_attributes.txt", true).map((f) => [f.fare_id, Number(f.price)]));
    fareCache.set(dir, m);
  }
  return m;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const DEFAULT_FEEDS = (metroDir: string, busDir: string): FeedSpec[] => [
  {
    id: "metro",
    dir: metroDir,
    name: "Kochi Metro Rail (KMRL) GTFS",
    note: "Official KMRL timetable and fare table.",
  },
  {
    id: "bus",
    dir: busDir,
    name: "Kochi bus & boat GTFS (Jungle Bus / OpenStreetMap)",
    note: "Community-mapped routes. Headways are mostly a uniform 60 min placeholder, not real frequencies. No fares.",
  },
];
