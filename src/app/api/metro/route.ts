import { NextResponse } from "next/server";
import { getNetwork } from "@/server/gtfs/load";
import type { MetroNetwork } from "@/lib/metro";

export const runtime = "nodejs";

let cached: MetroNetwork | null = null;

/** Static KMRL line + stations from the GTFS feed, for drawing the whole network. */
export async function GET() {
  if (!cached) {
    const net = getNetwork();
    const metroPatterns = net.patterns.filter((p) => net.routes[p.route].mode === "metro" && p.shape >= 0);
    // The pattern with the most stops covers the full line.
    const full = metroPatterns.sort((a, b) => b.stops.length - a.stops.length)[0];
    const flat = full ? net.shapes[full.shape] : [];
    const line: MetroNetwork["line"] = [];
    for (let i = 0; i < flat.length; i += 2) line.push({ lat: flat[i], lon: flat[i + 1] });
    const stations = (full?.stops ?? []).map((s) => {
      const st = net.stops[s];
      return { id: st.gtfsId, name: st.name, lat: st.lat, lon: st.lon };
    });
    cached = { line, stations };
  }
  return NextResponse.json(cached, { headers: { "Cache-Control": "public, max-age=86400" } });
}
