import type { Coordinate } from "@/schema/route";
import type { Suggestion } from "@/schema/suggest";
import type { DropReason } from "@/schema/itinerary";
import { hhmm, SUNSET_AROUND } from "@/lib/dwell";
import { haversine } from "@/server/geo";
import { FARES } from "./fares";

/**
 * Day-planner solver (an orienteering problem): choose and order sights so their total worth is as high
 * as possible while the whole day — travel, waiting for opening, visits, lunch — fits the time budget.
 *
 * Travel uses a quick straight-line model, not the real router; the caller re-times the result with
 * planJourney and trims it if the real times run over. Deterministic: same input, same output.
 */

const DAY = 86400;
/** Value of a must-see, so it is always inserted first when it fits at all. */
const MUST_BONUS = 1000;
/** Beach/waterfront worth multiplier when the visit overlaps the sunset window. */
const SUNSET_BONUS = 1.3;
const SUNSET = hhmm(SUNSET_AROUND);
const SUNSET_WINDOW: [number, number] = [SUNSET - 45 * 60, SUNSET + 15 * 60];
export const LUNCH_MIN = 45;
/** Lunch is taken after the first visit ending in this window, else on arrival at the end. */
const LUNCH_FROM = hhmm("12:00");
const LUNCH_UNTIL = hhmm("15:00");
/** A restaurant visit starting in this window is the lunch break itself. */
const MEAL_FROM = hhmm("11:30");
/** At most this many restaurant/café stops in a day. */
const MAX_FOOD_STOPS = 2;
/** Straight-line model is optimistic; pad it so the real router rarely overruns. */
const APPROX_MARGIN = 1.1;
const WALK_MAX_M = 1500;
/** Ladder step for the budget sweep that makes the solver monotonic in budget. */
const LADDER_SEC = 5 * 60;

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Rough door-to-door seconds: walk when close, otherwise an auto-rickshaw with pickup wait. */
export function approxTravelSec(a: Coordinate, b: Coordinate): number {
  const d = haversine(a, b) * 1.3;
  if (d < 30) return 0;
  const sec = d <= WALK_MAX_M ? d / FARES.speeds.walkingMps : d / FARES.speeds.autoRickshawMps + FARES.auto_rickshaw.pickupWaitSeconds;
  return Math.round(sec * APPROX_MARGIN);
}

export interface SolveInput {
  start: Coordinate;
  end: Coordinate;
  /** Seconds after IST midnight. */
  startSec: number;
  /** 0 = Sunday. */
  dow: number;
  budgetMin: number;
  /** Candidate sights; dwellMin already scaled for pace. */
  candidates: Suggestion[];
  mustSee?: string[];
  lunch?: boolean;
  maxStops?: number;
  /** Override the travel model (tests). */
  travel?: (a: Coordinate, b: Coordinate) => number;
}

export interface Visit {
  id: string;
  arriveSec: number;
  startSec: number;
  leaveSec: number;
  waitSec: number;
  /** Lunch break taken right after this visit. */
  lunchAfter: boolean;
  /** This restaurant visit is the lunch break (no separate break added). */
  meal?: boolean;
}

export interface Schedule {
  ok: boolean;
  /** Why it failed: opening hours, budget, or too many stops. */
  why?: "hours" | "budget" | "stops";
  visits: Visit[];
  endSec: number;
  /** Arrival at the end point (before any lunch taken there). */
  arriveEndSec: number;
  lunchAtEnd: boolean;
  /** Objective: scores ×100, sunset bonus, must-see bonus. */
  value: number;
}

export interface Solution extends Schedule {
  order: string[];
  /** Plain sum of chosen sights' scores. */
  score: number;
}

export interface Dropped {
  id: string;
  reason: DropReason;
  detail: string;
}

const fmt = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;

/** Opening windows in seconds after midnight for the trip's weekday; empty when closed that day. */
export function openWindows(c: Suggestion, dow: number): [number, number][] {
  if (c.closedDays?.includes(dow)) return [];
  if (!c.hours?.length) return [[0, 2 * DAY]];
  return c.hours.map(([o, cl]) => [hhmm(o), hhmm(cl)]);
}

function prepare(input: SolveInput) {
  const { candidates, startSec } = input;
  const n = candidates.length;
  const travel = input.travel ?? approxTravelSec;
  const must = new Set(input.mustSee ?? []);
  const maxStops = input.maxStops ?? 8;

  // Node 0 = start, 1..n = candidates, n+1 = end.
  const pts = [input.start, ...candidates.map((c) => c.location), input.end];
  const T = pts.map((a) => pts.map((b) => travel(a, b)));
  const dwell = candidates.map((c) => Math.round(c.dwellMin * 60));
  const windows = candidates.map((c) => openWindows(c, input.dow));
  const worth = candidates.map((c) => c.score * 100 + (must.has(c.id) ? MUST_BONUS : 0));

  /** Times a visiting order (candidate indices) against hours and `limitSec`. */
  function simulate(order: number[], limitSec: number): Schedule {
    let t = startSec;
    let prev = 0;
    let lunchDone = !input.lunch;
    let value = 0;
    const visits: Visit[] = [];
    const fail = (why: Schedule["why"]): Schedule => ({ ok: false, why, visits, endSec: t, arriveEndSec: t, lunchAtEnd: false, value });
    if (order.length > maxStops) return fail("stops");
    const isFood = (c: number | undefined) => c !== undefined && candidates[c].interest === "food";
    if (order.filter(isFood).length > MAX_FOOD_STOPS) return fail("stops");
    // Two restaurant/café stops in a row is not a sightseeing day.
    if (order.some((c, i) => i > 0 && isFood(c) && isFood(order[i - 1]))) return fail("stops");
    for (const [i, c] of order.entries()) {
      t += T[prev][c + 1];
      const arrive = t;
      const w = windows[c].find(([o, cl]) => Math.max(arrive, o) + dwell[c] <= cl);
      if (!w) return fail("hours");
      const start = Math.max(arrive, w[0]);
      t = start + dwell[c];
      const sunsetHit = candidates[c].sunset && start < SUNSET_WINDOW[1] && t > SUNSET_WINDOW[0];
      value += worth[c] * (sunsetHit ? SUNSET_BONUS : 1);
      const meal = !lunchDone && candidates[c].interest === "food" && start >= MEAL_FROM && start <= LUNCH_UNTIL;
      if (meal) lunchDone = true;
      // If a restaurant comes next, that visit is lunch; no separate break here.
      const lunchAfter = !lunchDone && t >= LUNCH_FROM && t <= LUNCH_UNTIL && !isFood(order[i + 1]);
      visits.push({ id: candidates[c].id, arriveSec: arrive, startSec: start, leaveSec: t, waitSec: start - arrive, lunchAfter, ...(meal ? { meal } : {}) });
      if (lunchAfter) {
        t += LUNCH_MIN * 60;
        lunchDone = true;
      }
      prev = c + 1;
    }
    t += T[prev][n + 1];
    const arriveEnd = t;
    const lunchAtEnd = !lunchDone && t >= LUNCH_FROM && startSec <= LUNCH_UNTIL - LUNCH_MIN * 60;
    if (lunchAtEnd) t += LUNCH_MIN * 60;
    const s: Schedule = { ok: true, visits, endSec: t, arriveEndSec: arriveEnd, lunchAtEnd, value };
    if (t - startSec > limitSec) return { ...s, ok: false, why: "budget" };
    return s;
  }
  return { simulate, windows, must, T };
}

/** Times a fixed visiting order (sight ids) with the same model the solver uses, ignoring the budget. */
export function scheduleOrder(input: SolveInput, ids: string[]): Schedule {
  const { simulate } = prepare(input);
  return simulate(
    ids.map((id) => input.candidates.findIndex((c) => c.id === id)),
    Infinity,
  );
}

export function solveItinerary(input: SolveInput): { solution: Solution; dropped: Dropped[] } {
  const { candidates, startSec } = input;
  const n = candidates.length;
  const budgetSec = input.budgetMin * 60;
  const { simulate, windows, must } = prepare(input);

  const better = (a: { order: number[]; s: Schedule }, b: { order: number[]; s: Schedule }) =>
    a.s.value - b.s.value > 1e-9 || (Math.abs(a.s.value - b.s.value) <= 1e-9 && (a.s.endSec < b.s.endSec || (a.s.endSec === b.s.endSec && key(a.order) < key(b.order))));
  const key = (o: number[]) => o.map((i) => candidates[i].id).join("|");

  /** Reverse sub-sequences while that shortens the day without losing worth. */
  function twoOpt(order: number[], cur: Schedule, limitSec: number): [number[], Schedule] {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < order.length - 1 && !improved; i++) {
        for (let j = i + 1; j < order.length && !improved; j++) {
          const next = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
          const s = simulate(next, limitSec);
          if (s.ok && s.endSec < cur.endSec && s.value >= cur.value - 1e-9) {
            order = next;
            cur = s;
            improved = true;
          }
        }
      }
    }
    return [order, cur];
  }

  /** Best value-per-added-second insertion, repeated until nothing more fits in `limitSec`. */
  function greedy(limitSec: number): { order: number[]; s: Schedule } {
    let order: number[] = [];
    let cur = simulate(order, limitSec);
    if (!cur.ok) return { order, s: cur };
    for (;;) {
      let best: { order: number[]; s: Schedule; ratio: number; id: string } | null = null;
      for (let c = 0; c < n; c++) {
        if (order.includes(c)) continue;
        for (let p = 0; p <= order.length; p++) {
          const next = [...order.slice(0, p), c, ...order.slice(p)];
          const s = simulate(next, limitSec);
          if (!s.ok) continue;
          const ratio = (s.value - cur.value) / Math.max(60, s.endSec - cur.endSec);
          const id = key(next);
          if (!best || ratio > best.ratio + 1e-12 || (Math.abs(ratio - best.ratio) <= 1e-12 && id < best.id)) best = { order: next, s, ratio, id };
        }
      }
      if (!best) break;
      [order, cur] = twoOpt(best.order, best.s, limitSec);
    }
    return { order, s: cur };
  }

  // Sweep budgets on a 5-minute ladder up to the real one and keep the best plan: any plan that fits a
  // smaller budget also fits a larger one, so more time never yields a worse day.
  let best = greedy(budgetSec);
  for (let k = LADDER_SEC; k < budgetSec; k += LADDER_SEC) {
    const g = greedy(k);
    if (better(g, best)) best = g;
  }
  // Re-time the winner against the full budget (same order, same schedule) for reporting.
  const final = simulate(best.order, budgetSec);
  const solution: Solution = {
    ...final,
    order: best.order.map((i) => candidates[i].id),
    score: Math.round(best.order.reduce((a, i) => a + candidates[i].score, 0) * 1000) / 1000,
  };

  const dropped: Dropped[] = [];
  candidates.forEach((c, i) => {
    if (best.order.includes(i)) return;
    if (!windows[i].length) {
      dropped.push({ id: c.id, reason: "closed", detail: `Closed on ${DOW[input.dow]}s` });
      return;
    }
    const alone = simulate([i], Infinity);
    if (!alone.ok) {
      const hrs = windows[i].map(([o, cl]) => `${fmt(o)}–${fmt(cl)}`).join(", ");
      dropped.push({ id: c.id, reason: "closed", detail: `Not open long enough during your day (open ${hrs})` });
      return;
    }
    if (alone.endSec - startSec > budgetSec) {
      const wait = alone.visits[0].waitSec > 0 ? ", waiting for it to open" : "";
      dropped.push({
        id: c.id,
        reason: "too_far",
        detail: `On its own it needs about ${Math.round((alone.endSec - startSec) / 60)} min with travel${wait}`,
      });
      return;
    }
    dropped.push({ id: c.id, reason: "over_budget", detail: must.has(c.id) ? "Could not fit alongside your other must-sees" : "Did not fit alongside better-value stops" });
  });
  return { solution, dropped };
}
