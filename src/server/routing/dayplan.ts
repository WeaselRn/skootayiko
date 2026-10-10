import type { RouteOption, RoutePlanResponse } from "@/schema/route";
import type { Suggestion } from "@/schema/suggest";
import type { DroppedSight, ItineraryInput, ItineraryResponse, TimelineItem } from "@/schema/itinerary";
import { CURATED, CURATED_VERIFY, PACE_FACTOR, sightScore } from "@/lib/dwell";
import { env } from "@/server/env";
import { distanceToPolyline, haversine } from "@/server/geo";
import { suggestAlongRoute, type SuggestInput } from "@/server/suggest/nearby";
import { planJourney } from "./multi";
import type { PlanDeps } from "./plan";
import { scenicScore } from "./rank";
import { attachRoadGeometry } from "./geometry";
import { LUNCH_MIN, approxTravelSec, openWindows, scheduleOrder, solveItinerary, type Schedule, type SolveInput } from "./itinerary";
import { serviceClock, toIstIso } from "./time";

export interface DayDeps extends PlanDeps {
  /** Provider sights; null skips them (tests, offline). Defaults to LocationIQ when configured. */
  suggest?: ((input: SuggestInput) => Promise<{ suggestions: Suggestion[]; partial: boolean }>) | null;
}

const MAX_CANDIDATES = 24;
/** Real-router overruns are fixed by dropping a stop and re-routing at most this many times. */
const MAX_TRIMS = 2;
/** Stops this close together (or to the start/end) would be merged by planJourney. */
const MIN_GAP_M = 60;
const CLOSING_SOON_SEC = 30 * 60;
/** Real slack (minutes) that triggers one attempt to fit more in. */
const FILL_MIN_SLACK = 20;

const fmtHm = (sec: number) => `${String(Math.floor(sec / 3600) % 24).padStart(2, "0")}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;

/** How far out a sight can sensibly be for this budget; used for the detour part of the score. */
const reachM = (budgetMin: number) => Math.min(25000, Math.max(3000, budgetMin * 100));

/**
 * "Plan my day": gathers candidate sights (curated + LocationIQ when configured), picks and orders them
 * with the deterministic solver, then re-times the chosen order with the real router (planJourney with
 * per-stop dwell). If the real day runs over budget the weakest stop is dropped and the day re-routed.
 */
export async function planDay(input: ItineraryInput, deps: DayDeps = {}): Promise<ItineraryResponse> {
  const clock = serviceClock(input.startAt ?? deps.now?.toISOString());
  const startIso = toIstIso(clock, clock.departSec);
  const startSec = clock.departSec;
  const end = input.end ?? input.start;
  const line = [input.start.location, end.location];
  const warnings: string[] = [];
  const iso = (sec: number) => toIstIso(clock, sec);
  const secOf = (t: string) => Math.round((Date.parse(t) - clock.midnightMs) / 1000);

  if (startSec < 6 * 3600 || startSec > 20 * 3600) warnings.push(`The day starts at ${fmtHm(startSec)}; most sights are closed at night, so pick a daytime start.`);

  // 1. Candidates.
  const reach = reachM(input.budgetMin);
  const fromCurated: Suggestion[] = CURATED.filter((c) => input.interests.includes(c.interest) || input.mustSee.includes(c.id)).map((c) => {
    const off = distanceToPolyline(c.location, line).meters;
    return {
      id: c.id,
      name: c.name,
      interest: c.interest,
      kind: c.kind,
      address: c.address,
      location: c.location,
      offRouteM: Math.round(off),
      afterStop: 0,
      dwellMin: c.dwellMin,
      score: sightScore(c.popularity, off, reach),
      hours: c.hours,
      closedDays: c.closedDays,
      sunset: c.sunset,
      blurb: c.blurb,
      curated: true,
    };
  });
  let fromProvider: Suggestion[] = [];
  const suggest = deps.suggest === undefined ? (env.LOCATIONIQ_API_KEY ? suggestAlongRoute : null) : deps.suggest;
  if (suggest) {
    try {
      const r = await suggest({ stops: line, interests: input.interests, maxOffRouteM: 3000 });
      fromProvider = r.suggestions;
      if (r.partial) warnings.push("Some nearby places could not be searched, so the choice of sights may be incomplete.");
    } catch (e) {
      warnings.push(`Only curated sights were considered: ${(e as Error).message}.`);
    }
  }
  const extras: Suggestion[] = input.extraStops.map((x, i) => ({
    id: `extra:${i}`,
    name: x.name,
    interest: "custom",
    kind: "your stop",
    address: "",
    location: x.location,
    offRouteM: Math.round(distanceToPolyline(x.location, line).meters),
    afterStop: 0,
    dwellMin: x.dwellMin,
    score: 0.5,
    curated: false,
  }));

  const pool: Suggestion[] = [];
  const near = (a: Suggestion, b: Suggestion) => haversine(a.location, b.location) < MIN_GAP_M;
  const sameLandmark = (a: Suggestion, b: Suggestion) =>
    haversine(a.location, b.location) < 250 && (a.name.toLowerCase().includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(a.name.toLowerCase()));
  const curatedNames = new Set(CURATED.map((c) => c.name));
  for (const s of [...extras, ...fromCurated, ...fromProvider.filter((p) => !(p.curated && curatedNames.has(p.name)))]) {
    if (!pool.some((p) => p.id === s.id || near(p, s) || sameLandmark(p, s))) pool.push(s);
  }

  const dropped: DroppedSight[] = [];
  const excluded = new Set(input.exclude);
  const mustSee = [...input.mustSee, ...extras.map((e) => e.id)];
  const pace = PACE_FACTOR[input.pace];
  const candidates = pool
    .filter((s) => {
      if (excluded.has(s.id)) {
        dropped.push({ sight: s, reason: "removed", detail: "Removed by you" });
        return false;
      }
      // Places at the start or end are visited anyway; planJourney would merge them away.
      return line.every((p) => haversine(p, s.location) >= MIN_GAP_M);
    })
    .map((s) => (s.interest === "custom" ? s : { ...s, dwellMin: Math.max(5, Math.round((s.dwellMin * pace) / 5) * 5) }))
    .sort((a, b) => Number(mustSee.includes(b.id)) - Number(mustSee.includes(a.id)) || b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, MAX_CANDIDATES);

  // 2. Solve on the quick travel model.
  const solveIn: SolveInput = {
    start: input.start.location,
    end: end.location,
    startSec,
    dow: clock.dow,
    budgetMin: input.budgetMin,
    candidates,
    mustSee,
    lunch: input.lunch,
    maxStops: 8,
  };
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const removed = dropped.slice();
  const solved = solveItinerary(solveIn);
  let order = solved.solution.order;
  let solverDropped = solved.dropped;
  const trimmed: DroppedSight[] = [];
  if (candidates.some((c) => c.curated && c.hours)) warnings.push(`Opening hours are approximate. ${CURATED_VERIFY}`);

  const base = {
    startAt: startIso,
    endBy: iso(startSec + input.budgetMin * 60),
    budgetMin: input.budgetMin,
  };
  const respond = (plan: RoutePlanResponse | null, selected: number, timeline: TimelineItem[], finishSec: number): ItineraryResponse => {
    const usedMin = Math.round((finishSec - startSec) / 60);
    const stops = order.map((id) => byId.get(id)!);
    for (const id of mustSee) {
      const d = solverDropped.find((x) => x.id === id);
      if (d) warnings.push(`${byId.get(id)?.name ?? id} could not be included: ${d.detail.toLowerCase()}.`);
    }
    return {
      ...base,
      finishAt: iso(finishSec),
      usedMin,
      slackMin: input.budgetMin - usedMin,
      fits: usedMin <= input.budgetMin,
      totalScore: scoreOf(order),
      stops,
      dropped: [...removed, ...solverDropped.map((d) => ({ sight: byId.get(d.id)!, reason: d.reason, detail: d.detail })), ...trimmed],
      timeline,
      plan,
      selected,
      warnings: [...warnings],
    };
  };

  if (!order.length) {
    warnings.push(candidates.length ? "None of the sights fit in this time. Try more time, a faster pace or other interests." : "No sights found for these interests nearby.");
    return respond(null, 0, [], startSec);
  }

  // 3. Re-time with the real router; trim the weakest stop if the real day runs over.
  const budgetSec = input.budgetMin * 60;
  /** Same rounding as the reported usedMin, so "fits" never disagrees with the badge. */
  const fitsBy = (finishSec: number) => Math.round((finishSec - startSec) / 60) <= input.budgetMin;
  let routed = await route(order);
  if (!routed.ok) {
    warnings.push("Real routes could not be found between these stops, so times below are rough estimates.", ...routed.dataWarnings);
    return respond(null, 0, approxTimeline(routed.sched), routed.sched.endSec);
  }
  for (let trim = 0; routed.ok && !fitsBy(routed.finishSec) && trim < MAX_TRIMS && order.length > 1; trim++) {
    const victim = weakest(order, routed.sched);
    order = order.filter((id) => id !== victim);
    trimmed.push({ sight: byId.get(victim)!, reason: "over_budget", detail: "Dropped because real travel times were longer than estimated" });
    routed = await route(order);
  }
  if (!routed.ok) {
    warnings.push("Real routes could not be found between these stops, so times below are rough estimates.", ...routed.dataWarnings);
    return respond(null, 0, approxTimeline(routed.sched), routed.sched.endSec);
  }
  if (!fitsBy(routed.finishSec)) {
    warnings.push(`Real travel times make this day about ${Math.round((routed.finishSec - startSec - budgetSec) / 60)} min longer than your budget.`);
    await withStreets(routed.plan, routed.selected);
    return respond(routed.plan, routed.selected, routed.timeline, routed.finishSec);
  }

  // 4. The quick model is cautious; when real routes leave time over, scale its travel times to match the
  // real ones and re-solve, keeping the bigger day only if it still fits once routed.
  const slackMin = Math.floor((startSec + budgetSec - routed.finishSec) / 60);
  if (!trimmed.length && slackMin >= FILL_MIN_SLACK && solverDropped.some((d) => d.reason === "over_budget" || d.reason === "too_far")) {
    const realTravel = routed.timeline.reduce((a, t) => a + (t.kind === "travel" ? t.minutes : 0), 0);
    const approxTravel = approxTravelMin(order);
    const k = Math.min(1, Math.max(0.5, realTravel / Math.max(1, approxTravel)));
    const scaled: SolveInput = { ...solveIn, travel: (a, b) => Math.round(approxTravelSec(a, b) * k) };
    const wider = solveItinerary(scaled);
    if (scoreOf(wider.solution.order) > scoreOf(order)) {
      const alt = await route(wider.solution.order, scaled);
      if (alt.ok && fitsBy(alt.finishSec)) {
        order = wider.solution.order;
        solverDropped = wider.dropped;
        routed = alt;
      }
    }
  }
  await withStreets(routed.plan, routed.selected);
  return respond(routed.plan, routed.selected, routed.timeline, routed.finishSec);

  /** Swaps straight road/walk lines for real street paths so the map and the ride follow roads. */
  async function withStreets(plan: RoutePlanResponse, selected: number) {
    if (deps.useOrs === false) return;
    const left = await attachRoadGeometry(plan, selected);
    if (left > 0) warnings.push(`Street paths were unavailable for ${left} leg${left === 1 ? "" : "s"}; those are drawn as straight lines.`);
  }

  function approxTravelMin(ids: string[]): number {
    const pts = [input.start.location, ...ids.map((id) => byId.get(id)!.location), end.location];
    let sec = 0;
    for (let i = 1; i < pts.length; i++) sec += approxTravelSec(pts[i - 1], pts[i]);
    return sec / 60;
  }

  function scoreOf(ids: string[]): number {
    return Math.round(ids.reduce((a, id) => a + byId.get(id)!.score, 0) * 1000) / 1000;
  }

  type Routed =
    | { ok: true; sched: Schedule; plan: RoutePlanResponse; selected: number; timeline: TimelineItem[]; finishSec: number }
    | { ok: false; sched: Schedule; dataWarnings: string[] };

  /** Routes a visiting order for real, each stop held for its planned stay (wait + visit + lunch). */
  async function route(ids: string[], model: SolveInput = solveIn): Promise<Routed> {
    const sched = scheduleOrder(model, ids);
    const plan = await planJourney(
      {
        origin: input.start,
        destination: end,
        via: ids.map((id, i) => {
          const v = sched.visits[i];
          const s = byId.get(id)!;
          return { name: s.name, location: s.location, dwellMin: (v.leaveSec - v.arriveSec) / 60 + (v.lunchAfter ? LUNCH_MIN : 0) };
        }),
        departAt: startIso,
        accessModes: input.accessModes,
      },
      // Exploring orders makes many router calls; street geometry is fetched once for the final day.
      { ...deps, useOrs: false },
    );
    plan.dataWarnings = (plan.dataWarnings ?? []).filter((w) => !w.startsWith("Road directions disabled"));
    const selected = pickOption(plan.options, input.prefer);
    if (selected < 0) return { ok: false, sched, dataWarnings: plan.dataWarnings ?? [] };
    const built = realTimeline(plan.options[selected], sched, ids);
    return { ok: true, sched, plan, selected, timeline: built.timeline, finishSec: built.finishSec };
  }

  /** The stop giving least worth per minute it costs (visit + detour); must-sees go last. */
  function weakest(ids: string[], sched: Schedule): string {
    const pts = [input.start.location, ...ids.map((id) => byId.get(id)!.location), end.location];
    let worst = ids[0];
    let worstRatio = Infinity;
    ids.forEach((id, i) => {
      const detour = approxTravelSec(pts[i], pts[i + 1]) + approxTravelSec(pts[i + 1], pts[i + 2]) - approxTravelSec(pts[i], pts[i + 2]);
      const v = sched.visits[i];
      const cost = (v.leaveSec - v.arriveSec + Math.max(0, detour)) / 60;
      const ratio = (byId.get(id)!.score + (mustSee.includes(id) ? 10 : 0)) / Math.max(1, cost);
      if (ratio < worstRatio) {
        worstRatio = ratio;
        worst = id;
      }
    });
    return worst;
  }

  function visitItem(id: string, arrive: number, leave: number, wait: number): TimelineItem {
    const s = byId.get(id)!;
    const notes: string[] = [];
    const wins = openWindows(s, clock.dow);
    const start = arrive + wait;
    const w = wins.find(([o, cl]) => start >= o && start < cl);
    if (s.hours?.length) {
      if (!w) notes.push(`May be closed when you arrive (open ${s.hours.map(([o, c]) => `${o}–${c}`).join(", ")})`);
      else if (leave > w[1]) notes.push(`Closes at ${fmtHm(w[1])}, before your visit ends`);
      else if (w[1] - leave < CLOSING_SOON_SEC) notes.push(`Closes at ${fmtHm(w[1])} — little time to spare`);
    }
    if (wait > 0) notes.push(`Opens at ${fmtHm(start)}; about ${Math.round(wait / 60)} min wait`);
    return { kind: "visit", sightId: id, name: s.name, arriveAt: iso(arrive), startAt: iso(start), leaveAt: iso(leave), minutes: Math.round((leave - start) / 60), waitMin: Math.round(wait / 60), warnings: notes };
  }

  function realTimeline(option: RouteOption, sched: Schedule, order: string[]): { timeline: TimelineItem[]; finishSec: number } {
    const timeline: TimelineItem[] = [];
    const names = [input.start.name, ...order.map((id) => byId.get(id)!.name), end.name];
    let t = startSec;
    for (let leg = 0; leg <= order.length; leg++) {
      const segs = option.segments.filter((s) => (s.leg ?? 0) === leg);
      const last = segs[segs.length - 1];
      const arrive = last?.destination.arrivalTime ? secOf(last.destination.arrivalTime) : t;
      timeline.push({
        kind: "travel",
        leg,
        from: names[leg],
        to: names[leg + 1],
        departAt: iso(t),
        arriveAt: iso(arrive),
        minutes: Math.round((arrive - t) / 60),
        modes: [...new Set(segs.map((s) => s.mode))],
      });
      t = arrive;
      if (leg === order.length) break;
      const v = sched.visits[leg];
      const id = order[leg];
      // planJourney leaves after the planned stay (wait + visit [+ lunch]); re-derive the wait from the real arrival.
      const stay = v.leaveSec - v.arriveSec;
      const s = byId.get(id)!;
      const opens = openWindows(s, clock.dow).find(([, cl]) => t < cl)?.[0] ?? t;
      const wait = Math.min(stay, Math.max(0, opens - t));
      timeline.push(visitItem(id, t, t + stay, wait));
      t += stay;
      if (v.lunchAfter) {
        timeline.push({ kind: "lunch", near: s.name, startAt: iso(t), endAt: iso(t + LUNCH_MIN * 60), minutes: LUNCH_MIN });
        t += LUNCH_MIN * 60;
      }
    }
    if (sched.lunchAtEnd) {
      timeline.push({ kind: "lunch", near: end.name, startAt: iso(t), endAt: iso(t + LUNCH_MIN * 60), minutes: LUNCH_MIN });
      t += LUNCH_MIN * 60;
    }
    return { timeline, finishSec: t };
  }

  function approxTimeline(sched: Schedule): TimelineItem[] {
    const timeline: TimelineItem[] = [];
    const names = [input.start.name, ...order.map((id) => byId.get(id)!.name), end.name];
    let t = startSec;
    sched.visits.forEach((v, i) => {
      timeline.push({ kind: "travel", leg: i, from: names[i], to: names[i + 1], departAt: iso(t), arriveAt: iso(v.arriveSec), minutes: Math.round((v.arriveSec - t) / 60), modes: [] });
      timeline.push(visitItem(v.id, v.arriveSec, v.leaveSec, v.waitSec));
      t = v.leaveSec;
      if (v.lunchAfter) {
        timeline.push({ kind: "lunch", near: names[i + 1], startAt: iso(t), endAt: iso(t + LUNCH_MIN * 60), minutes: LUNCH_MIN });
        t += LUNCH_MIN * 60;
      }
    });
    const n = sched.visits.length;
    timeline.push({ kind: "travel", leg: n, from: names[n], to: names[n + 1], departAt: iso(t), arriveAt: iso(sched.arriveEndSec), minutes: Math.round((sched.arriveEndSec - t) / 60), modes: [] });
    if (sched.lunchAtEnd) timeline.push({ kind: "lunch", near: end.name, startAt: iso(sched.arriveEndSec), endAt: iso(sched.endSec), minutes: LUNCH_MIN });
    return timeline;
  }
}

/** Index of the journey to follow: fastest by default, lowest scenic score when asked. -1 if none. */
function pickOption(options: RouteOption[], prefer: "fastest" | "scenic"): number {
  if (!options.length) return -1;
  const score = prefer === "scenic" ? scenicScore : (o: RouteOption) => o.totalDurationSeconds;
  let best = 0;
  options.forEach((o, i) => {
    if (score(o) < score(options[best])) best = i;
  });
  return best;
}
