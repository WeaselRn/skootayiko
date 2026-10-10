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
  - A bike taxi reaches only the nearest 4 metro stations or jetties within 7 km that are more than 600 m away.

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

## Ranking (`rank.ts`)
- **fastest:** the lowest door-to-door duration.
- A route is **practical** if its duration is at most max(2 × fastest, fastest + 30 min).
- **cheapest:** the lowest cost midpoint among practical routes. On a tie, the faster route wins.
- **balanced:** the lowest value of duration + cost ÷ (₹2/min) + 300 s × transfers. It gets the label only if it is a different option from fastest and cheapest.
- A multi-leg option is dropped if another option is no slower, no dearer, has no more transfers, and is strictly better on time or cost. Direct rides are always kept.
- Options slower than 2.5 × fastest are dropped. The planner returns at most 5 options.

## Fares (`fares.ts`, `config/fares.json`)
| Mode | Method | Source tag |
|---|---|---|
| Metro | KMRL `fare_rules` (₹10–60, token price) | `published_schedule` |
| Bus | ₹10 minimum for the first 2.5 km, then ₹1.0–1.1/km along the shape | `model_estimate` |
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
