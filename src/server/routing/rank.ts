import type { Ranking, RouteOption } from "@/schema/route";
import { FARES } from "./fares";

const R = FARES.ranking;

const costMid = (o: RouteOption) =>
  o.totalCostEstimate ? (o.totalCostEstimate.min + o.totalCostEstimate.max) / 2 : Infinity;

/** Generalised cost in seconds: time + money (via value of time) + transfer penalty. */
export function balancedScore(o: RouteOption): number {
  const money = Number.isFinite(costMid(o)) ? (costMid(o) / R.valueOfTimeInrPerMinute) * 60 : 3600;
  return o.totalDurationSeconds + money + o.transfers * R.transferPenaltySeconds;
}

/** Balanced score with boat rides and walks discounted, for the day planner's "scenic" preference. */
export function scenicScore(o: RouteOption): number {
  const secs = (m: string) => o.segments.filter((s) => s.mode === m).reduce((a, s) => a + s.durationSeconds, 0);
  return balancedScore(o) - secs("ferry") * R.scenicFerryWeight - secs("walking") * R.scenicWalkWeight;
}

/** A route is practical if not much slower than the fastest one. */
export function isPractical(o: RouteOption, fastestSeconds: number): boolean {
  return (
    o.totalDurationSeconds <=
    Math.max(fastestSeconds * R.practicalDurationFactor, fastestSeconds + R.practicalDurationSlackSeconds)
  );
}

const isDirect = (o: RouteOption) => o.segments.length === 1;

/** True if `a` is no slower and no dearer than `b`, and better in at least one. */
function dominates(a: RouteOption, b: RouteOption): boolean {
  const [ta, tb, ca, cb] = [a.totalDurationSeconds, b.totalDurationSeconds, costMid(a), costMid(b)];
  return ta <= tb && ca <= cb && a.transfers <= b.transfers && (ta < tb || ca < cb);
}

/**
 * Ranking rules (documented in docs/logic.md):
 *  - fastest:  minimum total door-to-door duration.
 *  - cheapest: minimum mid-point cost among practical routes (ties: faster wins).
 *  - balanced: minimum balancedScore, only labelled if it differs from both.
 *  - options slower than maxDurationFactor × fastest are dropped.
 *  - the best bus / metro / boat option is always kept if within that limit.
 * Output order: fastest, cheapest, balanced, then alternatives by balancedScore.
 */
export function rankOptions(input: RouteOption[], limit = 5): RouteOption[] {
  // A transit option is pruned only when another *transit* option is better on every axis;
  // direct rides never knock out public transport, and are always kept for comparison.
  const options = input.filter((o) => isDirect(o) || !input.some((x) => x !== o && !isDirect(x) && dominates(x, o)));
  if (!options.length) return [];
  const byTime = [...options].sort((a, b) => a.totalDurationSeconds - b.totalDurationSeconds);
  const fastest = byTime[0];
  const maxDuration = fastest.totalDurationSeconds * R.maxDurationFactor;
  const practical = options.filter((o) => isPractical(o, fastest.totalDurationSeconds));
  const cheapest = [...practical].sort(
    (a, b) => costMid(a) - costMid(b) || a.totalDurationSeconds - b.totalDurationSeconds,
  )[0];
  const balanced = [...practical].sort((a, b) => balancedScore(a) - balancedScore(b))[0];

  const labels = new Map<RouteOption, Ranking[]>();
  const add = (o: RouteOption, r: Ranking) => labels.set(o, [...(labels.get(o) ?? []), r]);
  add(fastest, "fastest");
  add(cheapest, "cheapest");
  if (balanced !== fastest && balanced !== cheapest) add(balanced, "balanced");

  const head = [fastest, cheapest, balanced].filter((o, i, a) => labels.has(o) && a.indexOf(o) === i);
  // Practical alternatives first, then slower ones so the user still sees some choice.
  const rest = options
    .filter((o) => !labels.has(o) && o.totalDurationSeconds <= maxDuration)
    .sort(
      (a, b) =>
        Number(!practical.includes(a)) - Number(!practical.includes(b)) || balancedScore(a) - balancedScore(b),
    );
  const chosen = [...head, ...rest].slice(0, limit);
  // Diversity: always show the best bus, metro and boat journey when one is reasonable,
  // replacing the weakest unlabelled pick.
  for (const mode of ["bus", "metro", "ferry"] as const) {
    if (chosen.some((o) => o.segments.some((s) => s.mode === mode))) continue;
    // Drawn from all candidates (even ones pruned above) so each mode stays visible.
    const best = input
      .filter((o) => o.segments.some((s) => s.mode === mode) && o.totalDurationSeconds <= maxDuration)
      .sort((a, b) => balancedScore(a) - balancedScore(b))[0];
    if (!best) continue;
    const slot = [...chosen].reverse().findIndex((o) => !labels.has(o));
    if (chosen.length < limit) chosen.push(best);
    else if (slot >= 0) chosen[chosen.length - 1 - slot] = best;
  }
  return chosen.map((o) => ({ ...o, rankings: labels.get(o) ?? ["alternative"] }));
}
