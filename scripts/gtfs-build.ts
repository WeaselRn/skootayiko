import path from "node:path";
import { buildNetwork, DEFAULT_FEEDS } from "@/server/gtfs/build";
import { writeNetworkCache } from "@/server/gtfs/load";
import { env } from "@/server/env";

const t0 = Date.now();
const net = buildNetwork(DEFAULT_FEEDS(path.resolve(env.GTFS_METRO_DIR), path.resolve(env.GTFS_BUS_DIR)));
const out = writeNetworkCache(net);
const shapePts = net.shapes.reduce((n, s) => n + s.length / 2, 0);
console.log(
  `GTFS network built in ${Date.now() - t0} ms -> ${out}\n` +
    `  stops=${net.stops.length} routes=${net.routes.length} patterns=${net.patterns.length} ` +
    `shapes=${net.shapes.length} (${shapePts} pts) metroFares=${Object.keys(net.metroFares).length}`,
);
for (const p of net.provenance) console.log(`  ${p.id}: valid until ${p.validUntil ?? "?"}${p.expired ? " (EXPIRED)" : ""}`);
