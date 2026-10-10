import { describe, expect, it } from "vitest";
import { forParty, vehiclesFor } from "@/server/routing/fares";
import { planRoutes } from "@/server/routing/plan";
import { solveItinerary } from "@/server/routing/itinerary";
import type { CostEstimate } from "@/schema/route";
import type { Suggestion } from "@/schema/suggest";

const cost = (min: number, max: number): CostEstimate => ({ min, max, currency: "INR", source: "model_estimate", basis: "x" });
const MONDAY_1000 = "2026-10-12T10:00:00+05:30";
const EDAPPALLY = { name: "Edappally", location: { lat: 10.0255, lon: 76.308 } };
const VYTTILA = { name: "Vyttila", location: { lat: 9.9673, lon: 76.3215 } };

describe("group fares", () => {
  it("charges transit per person and road rides per vehicle", () => {
    expect(forParty("metro", cost(40, 40), 3)).toMatchObject({ min: 120, max: 120 });
    expect(vehiclesFor("auto_rickshaw", 3)).toBe(1);
    expect(vehiclesFor("auto_rickshaw", 4)).toBe(2);
    expect(vehiclesFor("taxi", 4)).toBe(1);
    expect(vehiclesFor("taxi", 5)).toBe(2);
    expect(forParty("auto_rickshaw", cost(100, 120), 3)).toMatchObject({ min: 100, max: 120 });
    expect(forParty("taxi", cost(200, 250), 6)).toMatchObject({ min: 400, max: 500 });
    expect(forParty("walking", cost(0, 0), 5)).toMatchObject({ min: 0, max: 0 });
    expect(forParty("bus", cost(20, 20), 1)).toMatchObject({ min: 20, max: 20, basis: "x" });
  });

  it("plans for a group: no bike taxis for 3+, fares scaled, flagged in the response", async () => {
    const solo = await planRoutes({ origin: EDAPPALLY, destination: VYTTILA, departAt: MONDAY_1000 }, { useOrs: false });
    const four = await planRoutes({ origin: EDAPPALLY, destination: VYTTILA, departAt: MONDAY_1000, partySize: 4 }, { useOrs: false });
    expect(four.partySize).toBe(4);
    expect(four.options.some((o) => o.segments.some((s) => s.mode === "bike_taxi"))).toBe(false);
    const metro = (p: typeof solo) => p.options.find((o) => o.segments.length === 1 || o.segments.some((s) => s.mode === "metro"));
    const soloMetro = solo.options.flatMap((o) => o.segments).find((s) => s.mode === "metro");
    const fourMetro = four.options.flatMap((o) => o.segments).find((s) => s.mode === "metro");
    if (soloMetro && fourMetro) expect(fourMetro.costEstimate!.min).toBe(soloMetro.costEstimate!.min * 4);
    const taxi = (p: typeof solo) => p.options.find((o) => o.segments.length === 1 && o.segments[0].mode === "taxi")!;
    expect(taxi(four).totalCostEstimate!.min).toBe(taxi(solo).totalCostEstimate!.min);
    expect(metro(four)).toBeDefined();
  });
});

describe("restaurants in the day plan", () => {
  const place = (id: string, interest: string, lon: number, dwellMin: number, score: number): Suggestion => ({
    id, name: id, interest, kind: interest === "food" ? "restaurant" : "museum", address: "", location: { lat: 9.97, lon },
    offRouteM: 0, afterStop: 0, dwellMin, score, curated: false,
  });
  const base = {
    start: { lat: 9.97, lon: 76.28 },
    end: { lat: 9.97, lon: 76.3 },
    dow: 1,
    lunch: true,
    candidates: [
      place("museum", "museums", 76.285, 120, 0.9),
      place("cafe-a", "food", 76.29, 45, 0.5),
      place("cafe-b", "food", 76.292, 45, 0.5),
      place("cafe-c", "food", 76.294, 45, 0.5),
    ],
  };

  it("a midday restaurant visit is the lunch break, and at most two food stops are chosen", () => {
    const { solution } = solveItinerary({ ...base, startSec: 10 * 3600, budgetMin: 360 });
    const food = solution.visits.filter((v) => v.id.startsWith("cafe"));
    expect(food.length).toBeLessThanOrEqual(2);
    // Exactly one lunch: either a restaurant visit or a separate break, never both.
    const meals = solution.visits.filter((v) => v.meal).length + solution.visits.filter((v) => v.lunchAfter).length + Number(solution.lunchAtEnd);
    expect(meals).toBe(1);
    expect(solution.visits.some((v) => v.meal)).toBe(true);
    // No two food stops back to back.
    const ids = solution.order;
    for (let i = 1; i < ids.length; i++) expect(ids[i].startsWith("cafe") && ids[i - 1].startsWith("cafe")).toBe(false);
  });
});
