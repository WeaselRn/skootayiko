import fs from "node:fs";
import path from "node:path";
import { GridIndex } from "@/server/geo";
import { env } from "@/server/env";
import { buildNetwork, DEFAULT_FEEDS } from "./build";
import type { Network } from "./types";

/** Walk transfers are allowed up to this straight-line distance between stops. */
export const TRANSFER_RADIUS_M = 400;

export interface LoadedNetwork extends Network {
  grid: GridIndex;
  /** stop -> list of [patternIdx, positionInPattern] */
  patternsAtStop: [number, number][][];
  /** stop -> list of [neighbourStop, straightLineMetres] (excludes self) */
  transfers: [number, number][][];
}

export function networkCachePath(): string {
  return path.resolve(env.GTFS_CACHE_DIR, "network.json");
}

export function writeNetworkCache(net: Network): string {
  const p = networkCachePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(net));
  return p;
}

export function hydrate(net: Network): LoadedNetwork {
  const grid = new GridIndex(net.stops, 0.005);
  const patternsAtStop: [number, number][][] = net.stops.map(() => []);
  net.patterns.forEach((p, pi) => p.stops.forEach((s, pos) => patternsAtStop[s].push([pi, pos])));
  const transfers = net.stops.map((s, i) =>
    grid.within(s, TRANSFER_RADIUS_M).filter(([j]) => j !== i) as [number, number][],
  );
  return { ...net, grid, patternsAtStop, transfers };
}

let cached: LoadedNetwork | null = null;

/** Loads the prebuilt network (npm run gtfs:build), building it from raw GTFS if the cache is missing. */
export function getNetwork(): LoadedNetwork {
  if (cached) return cached;
  const p = networkCachePath();
  let net: Network;
  if (fs.existsSync(p)) {
    net = JSON.parse(fs.readFileSync(p, "utf8")) as Network;
  } else {
    net = buildNetwork(DEFAULT_FEEDS(path.resolve(env.GTFS_METRO_DIR), path.resolve(env.GTFS_BUS_DIR)));
    try {
      writeNetworkCache(net);
    } catch {
      // read-only filesystem in production: keep in memory only
    }
  }
  cached = hydrate(net);
  return cached;
}
