import { describe, expect, it } from "vitest";
import { RoutePlanRequest, RoutePlanResponse } from "@/schema/route";
import { SuggestRequest } from "@/schema/suggest";
import { haversine, distanceToPolyline, samplePolyline } from "@/server/geo";
import { planJourney } from "@/server/routing/multi";
import { computeTotals } from "@/lib/totals";
import { move } from "@/lib/stops";

const MONDAY_0830 = "2026-10-12T08:30:00+05:30";
const loc = (lat: number, lon: number, name: string) => ({ name, location: { lat, lon } });
const ALUVA = loc(10.1076, 76.3516, "Aluva");
const EDAPALLY = loc(10.0261, 76.3086, "Edapally");
const VYTTILA = loc(9.9673, 76.3215, "Vyttila");

describe("planJourney (multi-stop, offline)", () => {
  it("chains legs A > B > C with consecutive times and per-leg indices", async () => {
    const plan = RoutePlanResponse.parse(
      await planJourney({ origin: ALUVA, via: [EDAPALLY], destination: VYTTILA, departAt: MONDAY_0830 }, { useOrs: false }),
    );
    expect(plan.via).toHaveLength(1);
    expect(plan.via![0].name).toBe("Edapally");
    expect(plan.options.length).toBeGreaterThan(0);
    for (const o of plan.options) {
      const legs = new Set(o.segments.map((s) => s.leg));
      expect([...legs].sort()).toEqual([0, 1]);
      expect(new Set(o.segments.map((s) => s.id)).size).toBe(o.segments.length);
      for (let i = 1; i < o.segments.length; i++) {
        const arr = Date.parse(o.segments[i - 1].destination.arrivalTime!);
        const dep = Date.parse(o.segments[i].origin.departureTime!);
        expect(dep).toBeGreaterThanOrEqual(arr);
        expect(haversine(o.segments[i - 1].destination.location, o.segments[i].origin.location)).toBeLessThan(1);
      }
      const t = computeTotals(o.segments);
      expect(o.totalDurationSeconds).toBe(t.totalDurationSeconds);
      // The stop sits where leg 0 ends and leg 1 begins.
      const leg0 = o.segments.filter((s) => s.leg === 0);
      expect(haversine(leg0[leg0.length - 1].destination.location, EDAPALLY.location)).toBeLessThan(1);
    }
  });

  it("matches plain planning when via is empty or duplicates a neighbour", async () => {
    const dup = await planJourney({ origin: ALUVA, via: [{ ...ALUVA }], destination: VYTTILA, departAt: MONDAY_0830 }, { useOrs: false });
    expect(dup.via).toBeUndefined();
    expect(dup.options.length).toBeGreaterThan(0);
    expect(dup.options.every((o) => o.segments.every((s) => s.leg === undefined))).toBe(true);
  });

  it("reports which leg failed when a stop is unreachable", async () => {
    const plan = await planJourney(
      { origin: ALUVA, via: [loc(13.08, 80.27, "Chennai")], destination: VYTTILA, departAt: MONDAY_0830 },
      { useOrs: false },
    );
    expect(plan.options).toHaveLength(0);
    expect(plan.dataWarnings!.join(" ")).toMatch(/No route found|outside/);
  });
});

describe("request limits", () => {
  const base = { origin: ALUVA, destination: VYTTILA };
  it("accepts up to 8 via stops and rejects more", () => {
    expect(RoutePlanRequest.safeParse({ ...base, via: Array(8).fill(EDAPALLY) }).success).toBe(true);
    expect(RoutePlanRequest.safeParse({ ...base, via: Array(9).fill(EDAPALLY) }).success).toBe(false);
  });
  it("suggest request needs interests and two stops", () => {
    const stops = [ALUVA.location, VYTTILA.location];
    expect(SuggestRequest.safeParse({ stops, interests: ["sights"] }).success).toBe(true);
    expect(SuggestRequest.safeParse({ stops, interests: [] }).success).toBe(false);
    expect(SuggestRequest.safeParse({ stops: [ALUVA.location], interests: ["sights"] }).success).toBe(false);
  });
});

describe("geo helpers", () => {
  const line = [ALUVA.location, EDAPALLY.location, VYTTILA.location];
  it("distanceToPolyline finds the nearest segment", () => {
    const nearSecond = { lat: 10.0, lon: 76.3169 }; // between Edapally and Vyttila
    const r = distanceToPolyline(nearSecond, line);
    expect(r.segment).toBe(1);
    expect(r.meters).toBeLessThan(1500);
    expect(distanceToPolyline(EDAPALLY.location, line).meters).toBeLessThan(1);
  });
  it("samplePolyline spaces points and keeps both ends", () => {
    const pts = samplePolyline(line, 2000);
    expect(pts[0]).toEqual(line[0]);
    expect(pts[pts.length - 1]).toEqual(line[2]);
    for (let i = 1; i < pts.length; i++) expect(haversine(pts[i - 1], pts[i])).toBeLessThan(2600);
  });
});

describe("move", () => {
  it("reorders without mutating", () => {
    const a = ["A", "B", "C"];
    expect(move(a, 0, 2)).toEqual(["B", "C", "A"]);
    expect(move(a, 2, 0)).toEqual(["C", "A", "B"]);
    expect(a).toEqual(["A", "B", "C"]);
    expect(move(a, 1, 5)).toBe(a);
  });
});
