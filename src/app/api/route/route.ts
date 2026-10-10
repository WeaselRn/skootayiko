import { NextResponse } from "next/server";
import { RoutePlanRequest, RoutePlanResponse } from "@/schema/route";
import { env } from "@/server/env";
import { planJourney } from "@/server/routing/multi";
import { attachRoadGeometry } from "@/server/routing/geometry";
import { pickFixture } from "@/fixtures";

export const runtime = "nodejs";
/** Seconds; route planning plus provider calls can exceed serverless defaults on a cold start (Vercel). */
export const maxDuration = 60;

const cache = new Map<string, { at: number; body: RoutePlanResponse }>();
const hits = new Map<string, number[]>();
const RATE_PER_MIN = 20;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_PER_MIN;
}

const cacheKey = (r: RoutePlanRequest) => {
  const c = (p: { lat: number; lon: number }) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  // Departure rounded to 5 minutes so nearby requests share a cache entry.
  const t = Math.floor((r.departAt ? Date.parse(r.departAt) : Date.now()) / 300_000);
  const via = (r.via ?? []).map((v) => `${c(v.location)}+${v.dwellMin ?? 0}`).join(";");
  return `${c(r.origin.location)}|${via}|${c(r.destination.location)}|${t}|${(r.accessModes ?? []).join(",")}|${r.partySize ?? 1}`;
};

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many route requests, wait a minute." }, { status: 429 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = RoutePlanRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  if (env.USE_MOCK_ROUTES && !parsed.data.via?.length && (parsed.data.partySize ?? 1) === 1) {
    const sample = pickFixture(parsed.data);
    if (sample) return NextResponse.json(sample);
  }

  const key = cacheKey(parsed.data);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < env.ROUTE_CACHE_TTL_SECONDS * 1000) return NextResponse.json(hit.body);

  try {
    const raw = await planJourney(parsed.data);
    // Legs whose ORS refinement was skipped or hit the quota get street geometry (ORS, else OSRM).
    await attachRoadGeometry(raw, 0);
    const plan = RoutePlanResponse.parse(raw);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), body: plan });
    return NextResponse.json(plan);
  } catch (e) {
    console.error("route planning failed", e);
    return NextResponse.json({ error: "Route planning failed. Try again or adjust the locations." }, { status: 500 });
  }
}
