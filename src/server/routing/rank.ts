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
 * Output order: fastest, cheapest, balanced, then alternatives by balancedScore.
 */
export function rankOptions(input: RouteOption[], limit = 5): RouteOption[] {
  // Multi-leg options that are slower AND dearer than another option add nothing.
  // Direct rides are kept so users can still compare taxi/auto/bike taxi.
  const options = input.filter((o) => isDirect(o) || !input.some((x) => x !== o && dominates(x, o)));
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
  return [...head, ...rest].slice(0, limit).map((o) => ({ ...o, rankings: labels.get(o) ?? ["alternative"] }));
}
