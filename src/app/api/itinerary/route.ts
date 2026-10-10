import { NextResponse } from "next/server";
import { ItineraryRequest, ItineraryResponse } from "@/schema/itinerary";
import { planDay } from "@/server/routing/dayplan";

export const runtime = "nodejs";
/** Seconds; route planning plus provider calls can exceed serverless defaults on a cold start (Vercel). */
export const maxDuration = 60;

const hits = new Map<string, number[]>();
const RATE_PER_MIN = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_PER_MIN;
}

/** "Plan my day": picks and orders sights to fit a time budget, then routes them. */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many requests, wait a minute." }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = ItineraryRequest.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  try {
    return NextResponse.json(ItineraryResponse.parse(await planDay(parsed.data)));
  } catch (e) {
    console.error("itinerary failed", e);
    return NextResponse.json({ error: "Could not plan the day. Try again or adjust the inputs." }, { status: 500 });
  }
}
