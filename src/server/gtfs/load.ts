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

let cached: Promise<LoadedNetwork> | null = null;

/** Published path of the prebuilt network in static assets (copied there by scripts/prepare-network.ts). */
export const NETWORK_ASSET_PATH = "/data/network.json";

/**
 * Loads the prebuilt network once per process/isolate.
 * Node (dev, tests, self-hosted): reads GTFS_CACHE_DIR/network.json, building it from raw GTFS if missing.
 * Cloudflare Workers (no filesystem): fetches the copy shipped with the static assets via the ASSETS binding.
 */
export function getNetwork(): Promise<LoadedNetwork> {
  if (!cached) {
    cached = loadNetwork().catch((e) => {
      cached = null; // let the next request retry
      throw e;
    });
  }
  return cached;
}

async function loadNetwork(): Promise<LoadedNetwork> {
  const p = networkCachePath();
  let exists = false;
  try {
    exists = fs.existsSync(p);
  } catch {
    /* no filesystem */
  }
  if (exists) return hydrate(JSON.parse(fs.readFileSync(p, "utf8")) as Network);

  const fromAssets = await fetchFromAssets();
  if (fromAssets) return hydrate(fromAssets);

  const net = buildNetwork(DEFAULT_FEEDS(path.resolve(env.GTFS_METRO_DIR), path.resolve(env.GTFS_BUS_DIR)));
  try {
    writeNetworkCache(net);
  } catch {
    // read-only filesystem in production: keep in memory only
  }
  return hydrate(net);
}

/** The network from the Workers static-assets binding; null when not running on Cloudflare. */
async function fetchFromAssets(): Promise<Network | null> {
  let assets: { fetch(input: string): Promise<Response> } | undefined;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env: cfEnv } = await getCloudflareContext({ async: true });
    assets = (cfEnv as { ASSETS?: typeof assets }).ASSETS;
  } catch {
    return null;
  }
  if (!assets) return null;
  const res = await assets.fetch(`https://assets.local${NETWORK_ASSET_PATH}`);
  if (!res.ok) throw new Error(`GTFS network asset missing (HTTP ${res.status}); was scripts/prepare-network.ts run before the build?`);
  return (await res.json()) as Network;
}
