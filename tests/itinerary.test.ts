import { describe, expect, it } from "vitest";
import type { Suggestion } from "@/schema/suggest";
import { ItineraryRequest, ItineraryResponse } from "@/schema/itinerary";
import { CURATED, sightScore } from "@/lib/dwell";
import { solveItinerary, scheduleOrder, approxTravelSec, type SolveInput } from "@/server/routing/itinerary";
import { planDay } from "@/server/routing/dayplan";
import { planJourney } from "@/server/routing/multi";

const MONDAY_0830 = "2026-10-12T08:30:00+05:30";
const FORT_KOCHI_JETTY = { name: "Fort Kochi Jetty", location: { lat: 9.9667, lon: 76.2434 } };
const ERNAKULAM_SOUTH = { name: "Ernakulam South", location: { lat: 9.9686, lon: 76.2896 } };

const curated: Suggestion[] = CURATED.map((c) => ({
  id: c.id,
  name: c.name,
  interest: c.interest,
  kind: c.kind,
  address: c.address,
  location: c.location,
  offRouteM: 0,
  afterStop: 0,
  dwellMin: c.dwellMin,
  score: c.popularity,
  hours: c.hours,
  closedDays: c.closedDays,
  sunset: c.sunset,
  blurb: c.blurb,
  curated: true,
}));

const base = (over: Partial<SolveInput> = {}): SolveInput => ({
  start: FORT_KOCHI_JETTY.location,
  end: ERNAKULAM_SOUTH.location,
  startSec: 8.5 * 3600,
  dow: 1,
  budgetMin: 240,
  candidates: curated,
  ...over,
});

describe("solveItinerary", () => {
  it("never exceeds the budget", () => {
    for (const budgetMin of [60, 120, 180, 240, 300, 480]) {
      const { solution } = solveItinerary(base({ budgetMin }));
      expect(solution.ok).toBe(true);
      expect(solution.endSec - 8.5 * 3600).toBeLessThanOrEqual(budgetMin * 60);
    }
  });

  it("respects opening hours and closed days", () => {
    const { solution, dropped } = solveItinerary(base({ budgetMin: 480 }));
    const byId = new Map(curated.map((c) => [c.id, c]));
    for (const v of solution.visits) {
      const s = byId.get(v.id)!;
      expect(s.closedDays ?? []).not.toContain(1);
      if (s.hours) {
        const ok = s.hours.some(([o, c]) => {
          const [oh, om] = o.split(":").map(Number);
          const [ch, cm] = c.split(":").map(Number);
          return v.startSec >= oh * 3600 + om * 60 && v.leaveSec <= ch * 3600 + cm * 60;
        });
        expect(ok).toBe(true);
      }
    }
    // Hill Palace and the Indo-Portuguese Museum close on Mondays.
    expect(dropped.find((d) => d.id === "curated:hill-palace")?.reason).toBe("closed");
    expect(dropped.find((d) => d.id === "curated:indo-portuguese-museum")?.reason).toBe("closed");
  });

  it("waits for opening instead of visiting a closed place", () => {
    const palace = curated.find((c) => c.id === "curated:mattancherry-palace")!;
    const s = scheduleOrder(base({ startSec: 9 * 3600, candidates: [palace] }), [palace.id]);
    expect(s.ok).toBe(true);
    expect(s.visits[0].startSec).toBe(10 * 3600);
    expect(s.visits[0].waitSec).toBeGreaterThan(0);
  });

  it("longer dwell shifts later arrivals", () => {
    const ids = ["curated:chinese-nets", "curated:st-francis-church"];
    const short = scheduleOrder(base(), ids);
    const longer = scheduleOrder(
      base({ candidates: curated.map((c) => (c.id === ids[0] ? { ...c, dwellMin: c.dwellMin + 30 } : c)) }),
      ids,
    );
    expect(longer.visits[1].arriveSec - short.visits[1].arriveSec).toBe(30 * 60);
  });

  it("explains every left-out sight", () => {
    const { solution, dropped } = solveItinerary(base({ budgetMin: 120 }));
    expect(solution.order.length + dropped.length).toBe(curated.length);
    for (const d of dropped) {
      expect(["closed", "too_far", "over_budget"]).toContain(d.reason);
      expect(d.detail.length).toBeGreaterThan(0);
    }
    expect(dropped.find((d) => d.id === "curated:cherai-beach")?.reason).toBe("too_far");
  });

  it("more budget never lowers the total score", () => {
    let prev = -1;
    for (let budgetMin = 60; budgetMin <= 480; budgetMin += 30) {
      const { solution } = solveItinerary(base({ budgetMin }));
      expect(solution.score).toBeGreaterThanOrEqual(prev);
      prev = solution.score;
    }
  });

  it("is deterministic", () => {
    const a = solveItinerary(base({ budgetMin: 300, lunch: true }));
    const b = solveItinerary(base({ budgetMin: 300, lunch: true, candidates: [...curated].reverse() }));
    expect(a.solution.order).toEqual(solveItinerary(base({ budgetMin: 300, lunch: true })).solution.order);
    expect(b.solution.order).toEqual(a.solution.order);
  });

  it("includes must-sees first and reserves lunch", () => {
    const { solution } = solveItinerary(base({ budgetMin: 300, lunch: true, mustSee: ["curated:folklore-museum"] }));
    expect(solution.order).toContain("curated:folklore-museum");
    const lunchTaken = solution.visits.some((v) => v.lunchAfter) || solution.lunchAtEnd;
    expect(lunchTaken).toBe(true);
  });

  it("caps the number of stops", () => {
    const { solution } = solveItinerary(base({ budgetMin: 720, maxStops: 3 }));
    expect(solution.order.length).toBeLessThanOrEqual(3);
  });

  it("travel model walks short hops and rides longer ones", () => {
    const near = approxTravelSec(FORT_KOCHI_JETTY.location, { lat: 9.9686, lon: 76.2421 });
    const far = approxTravelSec(FORT_KOCHI_JETTY.location, ERNAKULAM_SOUTH.location);
    expect(near).toBeLessThan(10 * 60);
    expect(far).toBeGreaterThan(near);
  });
});

describe("sightScore", () => {
  it("falls with detour and stays within 0–1", () => {
    expect(sightScore(0.9, 0, 1000)).toBeCloseTo(0.9);
    expect(sightScore(0.9, 1000, 1000)).toBeCloseTo(0.36);
    expect(sightScore(0.9, 500, 1000)).toBeLessThan(sightScore(0.9, 100, 1000));
  });
});

describe("planJourney dwell", () => {
  it("next leg departs after arrival plus dwell", async () => {
    const via = { name: "Mattancherry Palace", location: { lat: 9.9582, lon: 76.2593 } };
    const req = { origin: FORT_KOCHI_JETTY, destination: ERNAKULAM_SOUTH, departAt: MONDAY_0830 };
    const plain = await planJourney({ ...req, via: [via] }, { useOrs: false });
    const dwell = await planJourney({ ...req, via: [{ ...via, dwellMin: 45 }] }, { useOrs: false });
    const firstLeg1 = (p: typeof plain) => p.options[0].segments.find((s) => s.leg === 1)!;
    const lastLeg0 = (p: typeof plain) => p.options[0].segments.filter((s) => s.leg === 0).at(-1)!;
    const gap = (p: typeof plain) => Date.parse(firstLeg1(p).origin.departureTime!) - Date.parse(lastLeg0(p).destination.arrivalTime!);
    expect(gap(dwell) - gap(plain)).toBeGreaterThanOrEqual(45 * 60 * 1000 - 1000);
  });
});

describe("planDay (offline)", () => {
  const req = (over: object = {}) =>
    ItineraryRequest.parse({
      start: FORT_KOCHI_JETTY,
      end: ERNAKULAM_SOUTH,
      startAt: MONDAY_0830,
      budgetMin: 240,
      interests: ["sights", "heritage", "museums", "beaches"],
      ...over,
    });

  it("returns a routed day inside the budget with a consistent timeline", async () => {
    const r = ItineraryResponse.parse(await planDay(req({ lunch: true }), { useOrs: false, suggest: null }));
    expect(r.stops.length).toBeGreaterThan(0);
    expect(r.plan).not.toBeNull();
    expect(r.fits).toBe(true);
    expect(r.usedMin).toBeLessThanOrEqual(240);
    // Timeline is contiguous: each item starts where the previous ended.
    let t = Date.parse(r.startAt);
    for (const item of r.timeline) {
      const from = item.kind === "travel" ? item.departAt : item.kind === "visit" ? item.arriveAt : item.startAt;
      const to = item.kind === "travel" ? item.arriveAt : item.kind === "visit" ? item.leaveAt : item.endAt;
      expect(Math.abs(Date.parse(from) - t)).toBeLessThan(1000);
      t = Date.parse(to);
    }
    expect(Math.abs(Date.parse(r.finishAt) - t)).toBeLessThan(1000);
    expect(r.timeline.filter((x) => x.kind === "visit").map((x) => x.kind === "visit" && x.sightId)).toEqual(r.stops.map((s) => s.id));
  });

  it("honours removed sights and own extra stops", async () => {
    const first = await planDay(req(), { useOrs: false, suggest: null });
    const gone = first.stops[0].id;
    const r = await planDay(
      req({ exclude: [gone], extraStops: [{ name: "Friend's place", location: { lat: 9.9612, lon: 76.2506 }, dwellMin: 20 }] }),
      { useOrs: false, suggest: null },
    );
    expect(r.stops.map((s) => s.id)).not.toContain(gone);
    expect(r.dropped.find((d) => d.sight.id === gone)?.reason).toBe("removed");
    expect(r.stops.map((s) => s.id)).toContain("extra:0");
  });

  it("returns an empty day with a note when nothing fits", async () => {
    const r = await planDay(req({ budgetMin: 30, end: undefined, interests: ["fun"] }), { useOrs: false, suggest: null });
    expect(r.stops).toHaveLength(0);
    expect(r.plan).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/fit|found/);
  });
});
