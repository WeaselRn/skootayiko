import { NextResponse } from "next/server";
import { SuggestRequest } from "@/schema/suggest";
import { suggestAlongRoute, SuggestError } from "@/server/suggest/nearby";

export const runtime = "nodejs";

const hits = new Map<string, number[]>();
const RATE_PER_MIN = 20;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_PER_MIN;
}

/** Tourist places near a route, for the "sights on the way" opt-in. */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many requests, wait a minute." }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = SuggestRequest.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  try {
    const r = await suggestAlongRoute(parsed.data);
    return NextResponse.json(r);
  } catch (e) {
    const status = e instanceof SuggestError ? e.status : 500;
    if (!(e instanceof SuggestError)) console.error("suggest failed", e);
    return NextResponse.json({ error: e instanceof SuggestError ? e.message : "Could not load suggestions." }, { status });
  }
}
