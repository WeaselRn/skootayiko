import { describe, expect, it } from "vitest";
import { RoutePlanResponse, type RouteOption, type RouteSegment } from "@/schema/route";
import { computeTotals } from "@/lib/totals";
import { haversine } from "@/server/geo";
import { getNetwork } from "@/server/gtfs/load";
import { planRoutes } from "@/server/routing/plan";
import { rankOptions } from "@/server/routing/rank";
import { busFare, metroFare, roadFare } from "@/server/routing/fares";
import { FIXTURES } from "@/fixtures";

const net = getNetwork();
const MONDAY_0830 = "2026-10-12T08:30:00+05:30";
const loc = (lat: number, lon: number, name = "P") => ({ name, location: { lat, lon } });

function assertConnected(segs: RouteSegment[]) {
  for (let i = 1; i < segs.length; i++) {
    expect(haversine(segs[i - 1].destination.location, segs[i].origin.location)).toBeLessThan(1);
    const arr = Date.parse(segs[i - 1].destination.arrivalTime!);
    const dep = Date.parse(segs[i].origin.departureTime!);
    expect(dep).toBeGreaterThanOrEqual(arr);
  }
}

function assertTotals(o: RouteOption) {
  const t = computeTotals(o.segments);
  expect(o.totalDurationSeconds).toBe(t.totalDurationSeconds);
  expect(o.totalWaitSeconds).toBe(t.totalWaitSeconds);
  expect(o.totalCostEstimate?.min).toBe(t.totalCostEstimate?.min);
  expect(o.totalCostEstimate?.max).toBe(t.totalCostEstimate?.max);
  // Door-to-door duration matches first departure minus waits → last arrival.
  const first = o.segments[0];
  const last = o.segments[o.segments.length - 1];
  const span = (Date.parse(last.destination.arrivalTime!) - Date.parse(first.origin.departureTime!)) / 1000;
  expect(Math.abs(span + first.waitSeconds - o.totalDurationSeconds)).toBeLessThanOrEqual(o.segments.length);
}

describe("GTFS network", () => {
  it("loads both feeds and marks them expired", () => {
    expect(net.stops.length).toBeGreaterThan(3000);
    expect(net.provenance.map((p) => p.id)).toEqual(["gtfs:metro", "gtfs:bus"]);
    expect(net.provenance.every((p) => p.expired)).toBe(true);
  });

  it("snaps metro stations onto the line shape (<75 m)", () => {
    const metro = net.patterns.filter((p) => net.routes[p.route].mode === "metro");
    expect(metro.length).toBeGreaterThan(0);
    for (const p of metro) {
      const flat = net.shapes[p.shape];
      p.stops.forEach((s, i) => {
        const j = p.shapeIdx[i];
        const d = haversine(net.stops[s], { lat: flat[2 * j], lon: flat[2 * j + 1] });
        expect(d).toBeLessThan(75);
      });
    }
  });
});

describe("fares", () => {
  it("uses the KMRL fare table", () => {
    expect(metroFare(net.metroFares, "ALVA", "VYTA")).toMatchObject({ min: 60, max: 60, source: "published_schedule" });
    expect(metroFare(net.metroFares, "NOPE", "VYTA")).toBeUndefined();
  });
  it("applies the bus rule: ₹10 up to 1 km, +₹8 per started km after", () => {
    expect(busFare(800).min).toBe(10);
    expect(busFare(1000).min).toBe(10);
    expect(busFare(1001).min).toBe(18);
    expect(busFare(3500)).toMatchObject({ min: 34, max: 34 });
  });
  it("marks modelled fares as estimates with a range", () => {
    const b = busFare(10_000);
    expect(b.source).toBe("model_estimate");
    expect(b.min).toBeGreaterThanOrEqual(10);
    expect(b.max).toBeGreaterThanOrEqual(b.min);
    const t = roadFare("taxi", 1000);
    expect(t.min).toBeGreaterThanOrEqual(100);
  });
});

describe("planRoutes (offline, no ORS)", () => {
  it("Aluva → Vyttila returns schema-valid, connected, consistent options incl. metro", async () => {
    const plan = RoutePlanResponse.parse(
      await planRoutes({ origin: loc(10.1076, 76.3516), destination: loc(9.9673, 76.3215), departAt: MONDAY_0830 }, { useOrs: false }),
    );
    expect(plan.liveData).toBe(false);
    expect(plan.options.length).toBeGreaterThanOrEqual(2);
    for (const o of plan.options) {
      assertConnected(o.segments);
      assertTotals(o);
    }
    const metro = plan.options.find((o) => o.segments.some((s) => s.mode === "metro"));
    expect(metro).toBeDefined();
    const ride = metro!.segments.find((s) => s.mode === "metro")!;
    expect(ride.origin.name).toBe("Aluva");
    expect(ride.destination.name).toBe("Vyttila");
    expect(ride.costEstimate).toMatchObject({ min: 60, max: 60 });
    expect(ride.durationSource).toBe("published_schedule");
    expect(plan.dataWarnings!.some((w) => w.includes("expired"))).toBe(true);
  });

  it("labels exactly one fastest and one cheapest option", async () => {
    const plan = await planRoutes(
      { origin: loc(9.97, 76.28), destination: loc(10.0159, 76.3419), departAt: MONDAY_0830 },
      { useOrs: false },
    );
    const fastest = plan.options.filter((o) => o.rankings.includes("fastest"));
    const cheapest = plan.options.filter((o) => o.rankings.includes("cheapest"));
    expect(fastest).toHaveLength(1);
    expect(cheapest).toHaveLength(1);
    const minDur = Math.min(...plan.options.map((o) => o.totalDurationSeconds));
    expect(fastest[0].totalDurationSeconds).toBe(minDur);
  });

  it("falls back to straight-line legs with a warning when ORS is unavailable", async () => {
    // No ORS_API_KEY is loaded in the test environment, so ORS calls fail.
    const plan = await planRoutes(
      { origin: loc(10.053, 76.327), destination: loc(10.0152, 76.3636), departAt: MONDAY_0830 },
      { useOrs: true },
    );
    expect(plan.options.length).toBeGreaterThan(0);
    expect(plan.dataWarnings!.some((w) => /directions/i.test(w))).toBe(true);
    const road = plan.options.flatMap((o) => o.segments).filter((s) => s.mode !== "metro" && s.mode !== "bus");
    expect(road.every((s) => s.dataSource === "model:straight-line" || s.dataSource?.startsWith("ors:"))).toBe(true);
  });

  it("returns no options with a warning outside the service area", async () => {
    const plan = await planRoutes({ origin: loc(13.08, 80.27), destination: loc(9.97, 76.28) }, { useOrs: false });
    expect(plan.options).toHaveLength(0);
    expect(plan.dataWarnings!.join(" ")).toMatch(/outside/);
  });

  it("returns no options when origin equals destination", async () => {
    const plan = await planRoutes({ origin: loc(9.97, 76.28), destination: loc(9.97, 76.28) }, { useOrs: false });
    expect(plan.options).toHaveLength(0);
  });
});

describe("ranking rules", () => {
  const opt = (id: string, min: number, inr: number, transfers = 0, legs = 2): RouteOption => ({
    id,
    label: id,
    rankings: ["alternative"],
    totalDurationSeconds: min * 60,
    totalWaitSeconds: 0,
    totalCostEstimate: { min: inr, max: inr, currency: "INR", source: "model_estimate" },
    transfers,
    segments: Array.from({ length: legs }, () => ({}) as RouteSegment),
  });

  it("picks fastest by time and cheapest among practical routes", () => {
    const r = rankOptions([opt("fast", 20, 200, 0, 1), opt("cheap", 35, 20), opt("tooSlowButFree", 200, 0)]);
    expect(r.find((o) => o.id === "fast")!.rankings).toContain("fastest");
    expect(r.find((o) => o.id === "cheap")!.rankings).toContain("cheapest");
    expect(r.find((o) => o.id === "tooSlowButFree")).toBeUndefined();
  });

  it("drops multi-leg options dominated on time, cost and transfers", () => {
    const r = rankOptions([opt("good", 30, 50), opt("worse", 40, 60, 1)]);
    expect(r.map((o) => o.id)).toEqual(["good"]);
  });
});

describe("fixtures", () => {
  it("conform to the schema and have consistent totals", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(3);
    for (const f of FIXTURES) {
      expect(f.mock).toBe(true);
      for (const o of f.options) {
        assertConnected(o.segments);
        assertTotals(o);
      }
    }
  });
});
