# Routing and estimation logic

Code: `src/server/routing/*`, `src/server/gtfs/*`, `config/fares.json`. This layer is server-only. Provider keys never reach the client.

## Data pipeline
`npm run gtfs:build` runs `scripts/gtfs-build.ts`, which writes `.cache/gtfs/network.json` (about 4 MB). If the cache is missing, the server builds it on first request.
- Both feeds are merged, and stop, route and service ids get a feed prefix (`metro:`, `bus:`).
- Trips are grouped into **patterns**, meaning the same route and the same stop sequence.
  - Metro patterns keep real timetabled trips.
  - Bus and boat patterns keep template offsets plus `frequencies.txt` windows.
- Stops are snapped to the raw shape first. The shape is then simplified with Douglas–Peucker at 5 m, always keeping the snapped vertices. Metro stations end up less than 75 m from the line.
- Calendar date ranges are ignored because both feeds are expired. Day-of-week service is kept: metro `WK` runs Monday–Saturday and `WE` runs Sunday.

## Search (`raptor.ts`)
RAPTOR is a round-based search with one round per ride. It returns a Pareto set over arrival time and number of rides.
- **Timetable patterns:** board the next trip that leaves at or after the ready time.
- **Frequency patterns:** board at the window start if the rider arrives early. Otherwise the expected wait is headway/2. Bus headway is fixed at 1200 s because the feed value is a placeholder. Boats use the feed headway.
- **Boarding buffer:** metro 180 s (station entry and ticketing), bus 60 s, boat 300 s.
- **Transfers:** walking between stops within 400 m. Distance is straight-line × 1.3 at 1.3 m/s.
- **Access and egress:**
  - Walking reaches every stop within `MAX_WALK_METERS`.
  - A bike taxi reaches the nearest 4 metro stations or jetties and the nearest 3 bus hubs (stops on 6 or more patterns) within 7 km that are more than 600 m away.

## Candidates (`plan.ts`)
1. Run RAPTOR several times:
   - walk/walk with all modes,
   - walk/walk with bus and boat only,
   - bike taxi used for access only, for egress only, and for both.
2. Add direct options:
   - walk, if the trip is at most 3 km,
   - bike taxi, auto and taxi, if the trip is at least 800 m.
3. Keep the fastest candidate per signature, where the signature is the mode and route sequence.
4. Pre-rank and keep a shortlist of 7.
5. Refine access, egress and direct legs with ORS (`foot-walking` or `driving-car`).
   - Road time is the larger of ORS duration × 1.35 and distance ÷ typical speed. Typical speeds: bike taxi 22 km/h, taxi 20 km/h, auto 19 km/h.
   - If ORS fails, the leg keeps its straight-line estimate, gets `confidence: low`, and a warning is added.
6. Re-time the whole journey leg by leg with the same boarding functions. A later arrival can therefore miss a train.
7. Compute totals with `computeTotals`, then rank.

## Multi-stop trips (`multi.ts`)
- Each stop-to-stop leg is planned on its own with `planRoutes`; leg n+1 departs when the chosen leg n option arrives.
- One combined journey is built per picker: fastest, cheapest, balanced, and the fastest option using metro, bus or boat on every leg. Identical journeys collapse, then `rankOptions` labels them.
- A via stop may carry `dwellMin`: the next leg departs at arrival + dwell. Without it the next leg starts on arrival. Merged (duplicate) stops add their dwell together.
- If any leg has no option for a picker, that picker produces no journey. If none do, the response has no options and a warning.

## Sights on the way (`suggest/nearby.ts`, `POST /api/suggest`)
- Opt-in. The user picks interests (`src/lib/interests.ts`) and a maximum distance off the route (0.5, 1 or 2 km).
- The route (the real geometry once a plan exists, else straight lines between stops) is sampled about every 2 km. Each sample queries LocationIQ Nearby with the tags of the chosen interests, at most 14 calls spaced 550 ms apart (free-tier 2 req/s); results are cached for 24 h.
- Places are kept when within the chosen distance of the route, then sorted by `score` = interest match × popularity × detour penalty (1.0 on the route, 0.4 at the distance limit), de-duplicated, and capped at 18. Popularity comes from `config/sights.json` when the place matches a curated sight, else a per-interest base (`src/lib/dwell.ts`).
- Each suggestion also carries `dwellMin` (curated, else per-kind/interest default) and, for curated sights, opening `hours`, `closedDays` and a `blurb`. Neighbourhood parks with names like "Residential Park" are dropped.
- `afterStop` is the stop whose leg the place is nearest to; "+ Add" inserts it right after that stop.
- If the provider rate-limits some samples, the response is marked `partial`.

## Plan my day (`routing/itinerary.ts`, `routing/dayplan.ts`, `POST /api/itinerary`)
- Input: start, optional end (default: back to start), start time, time budget (30–720 min), interests, pace (relaxed ×1.3 / normal / packed ×0.75 dwell), must-see ids, own extra stops (always must-see), removed ids, lunch, route preference (fastest / scenic).
- **Candidates:** curated sights (`config/sights.json`) matching the interests, plus LocationIQ places along the start→end line when the key is set (up to 3 km off). Duplicates within 60 m or with the same name within 250 m collapse; places at the start/end are skipped. Top 24 by must-see, then score.
- **Solver** (deterministic, no AI): an orienteering heuristic on a quick travel model (walk ≤ 1.5 km, else auto-rickshaw speed + pickup wait, +10%). Repeatedly inserts the sight/position with the best worth per added second, then 2-opt. Worth = score × 100, ×1.3 for sunset spots visited around sunset, +1000 for must-sees. Opening windows and closed days are hard limits; arriving early waits for opening (waiting counts against the budget). Lunch (45 min) goes after the first visit ending 12:00–15:00, else on arrival at the end. At most 8 stops.
- **Monotonic budget:** the solver runs greedy at every 5-minute budget up to the real one and keeps the best, so more time never gives a lower total score.
- **Left out:** every unchosen sight gets a reason: `closed` (closed that day or not open long enough), `too_far` (alone it would not fit), `over_budget` (did not fit alongside better stops), `removed` (by the user).
- **Re-timing:** the chosen order goes to `planJourney` as via stops with `dwellMin` = wait + visit (+ lunch). The fastest option (or the lowest scenic score) is followed. If the real day runs over, the stop with the least worth per minute (visit + detour) is dropped and the day re-routed, at most twice. If real routes leave 20+ min over, the travel model is scaled to the real travel times and the day re-solved once; the bigger day is kept only if it still fits.
- **Timeline:** travel, visit (with real wait for opening and "closes soon / may be closed" warnings) and lunch blocks, contiguous from start to finish. `fits`, `usedMin` and `slackMin` compare the routed finish with the budget.
- **Scenic:** `scenicScore` = balanced score − 1.5 × ferry seconds − 0.3 × walking seconds (`config/fares.json` → `ranking`).

## Street geometry (`geometry.ts`, `osrm.ts`)
- Road and walking segments that are still straight lines (ORS skipped, failed or out of quota) get street/footpath geometry after planning: ORS first, then OSRM (`OSRM_BASE_URL`, default FOSSGIS `routing.openstreetmap.de`, `off` disables) with all pairs batched into one request per profile, spaced ≥ 1 s apart. Geometry only; times and distances stay as planned.
- `/api/route` fills the returned journeys; the day planner explores orders without ORS and fills only the final day (≈ one request per leg instead of hundreds), which keeps the ORS daily quota for real use.
- When ORS answers "Quota exceeded", it is not called again until the next UTC day.

## Map streets (`JourneyMap.tsx`)
- From zoom 15 the basemap's thin road lines give way to real-width streets from the vector tiles: kerb strip, asphalt (width by road class), white edge lines and a dashed centre line on marked roads, sandy footpaths. Drawn under labels and 3D buildings.
- Route lines are drawn under the 3D buildings, so a building in front hides the line instead of the line being painted across it.

## Ranking (`rank.ts`)
- **fastest:** the lowest door-to-door duration.
- A route is **practical** if its duration is at most max(2 × fastest, fastest + 30 min).
- **cheapest:** the lowest cost midpoint among practical routes. On a tie, the faster route wins.
- **balanced:** the lowest value of duration + cost ÷ (₹2/min) + 300 s × transfers. It gets the label only if it is a different option from fastest and cheapest.
- A multi-leg option is dropped if another option is no slower, no dearer, has no more transfers, and is strictly better on time or cost. Direct rides are always kept.
- A multi-leg option is pruned only when another multi-leg (transit) option beats it; direct rides never prune transit.
- Options slower than 2.5 × fastest are dropped. The planner returns at most 5 options.
- The best bus, metro and boat journeys are always kept, even if pruned, as long as they are within 2.5 × fastest.

## Fares (`fares.ts`, `config/fares.json`)
| Mode | Method | Source tag |
|---|---|---|
| Metro | KMRL `fare_rules` (₹10–60, token price) | `published_schedule` |
| Bus | ₹10 up to 1 km, then ₹8 per started km along the shape (interim product rule) | `model_estimate` |
| Boat | ₹6–20 flat | `model_estimate` |
| Bike taxi, auto, taxi | base + per-km range, with a minimum fare | `model_estimate` |
| Walk | ₹0 | — |

The `verify` notes in `config/fares.json` list what to check before treating a value as sourced.

## Known limitations
- Both feeds are expired. Bus routes come from 2022–23 OpenStreetMap data.
- Bus waits are assumed. Bus ride times are interpolated (`timepoint=0`).
- Walk transfers between stops use straight lines.
- ORS has no traffic data and no motorcycle profile.
- ORS walking and driving can use ferry links, such as the Fort Kochi Ro-Ro, without charging a fare.
- Water Metro is not in the feeds.
- Departures after midnight do not use the previous day's service.

## Tests
`npm test` runs these cases:
- schema validity,
- connected and monotonic segments,
- totals consistency,
- the metro fare oracle,
- fastest and cheapest labelling,
- ORS-down fallback,
- outside the service area,
- origin equal to destination,
- dominance pruning,
- fixtures.
