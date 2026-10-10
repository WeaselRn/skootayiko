import { NextResponse } from "next/server";
import { geocode, GeocodeError } from "@/server/geocode/locationiq";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return NextResponse.json({ places: [] });
  if (q.length > 120) return NextResponse.json({ error: "Query too long" }, { status: 400 });
  try {
    return NextResponse.json({ places: await geocode(q) });
  } catch (e) {
    const status = e instanceof GeocodeError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
