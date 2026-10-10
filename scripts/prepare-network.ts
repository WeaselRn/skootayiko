// Ships the prebuilt GTFS network as a static asset (public/data/network.json) so the Cloudflare
// Worker, which has no filesystem, can load it via the ASSETS binding. Builds the network from the
// raw GTFS folders first when the local cache is missing (e.g. on a fresh CI checkout).
import fs from "node:fs";
import path from "node:path";
import { buildNetwork, DEFAULT_FEEDS } from "@/server/gtfs/build";
import { NETWORK_ASSET_PATH, networkCachePath, writeNetworkCache } from "@/server/gtfs/load";
import { env } from "@/server/env";

let src = networkCachePath();
if (!fs.existsSync(src)) {
  const t0 = Date.now();
  src = writeNetworkCache(buildNetwork(DEFAULT_FEEDS(path.resolve(env.GTFS_METRO_DIR), path.resolve(env.GTFS_BUS_DIR))));
  console.log(`GTFS network built in ${Date.now() - t0} ms`);
}
const dest = path.join("public", NETWORK_ASSET_PATH);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`GTFS network -> ${dest} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
