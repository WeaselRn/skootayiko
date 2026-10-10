# Route schema (v1.0)

The single source of truth is `src/schema/route.ts` (zod). The API validates its output with this schema, and the UI validates every response with it. Tests and fixtures use it too.

## Shape
```
RoutePlanResponse
  schemaVersion "1.0"
  origin, destination: RouteStop
  generatedAt, departAt: ISO 8601 (+05:30)
  liveData: false            // always false until a verified realtime feed exists
  mock: boolean              // true for saved fixtures
  options: RouteOption[]     // ordered: fastest, cheapest, balanced, alternatives
  provenance: DataProvenance[]
  dataWarnings?: string[]

RouteOption
  id, label
  rankings: ("fastest"|"cheapest"|"balanced"|"alternative")[]   // one option can be both fastest and cheapest
  totalDurationSeconds       // = Σ (segment.durationSeconds + segment.waitSeconds)
  totalWaitSeconds
  totalDistanceMeters?
  totalCostEstimate?         // absent if any segment has no fare
  segments: RouteSegment[]   // ordered and connected
  transfers                  // vehicle legs − 1
  assumptions?, warnings?

RouteSegment
  id, mode, origin, destination (RouteStop with departure/arrival times)
  geometry: Coordinate[]     // may be empty; the UI then draws a straight line
  durationSeconds            // travel only
  waitSeconds                // boarding wait / pickup wait before this leg
  durationSource: EstimateSource
  costEstimate?: { min, max, currency "INR", source, basis }
  distanceMeters?, instructions?, lineName?, headsign?, dataSource?
  confidence: "high"|"medium"|"low"
```

`TransportMode` adds `auto_rickshaw` to the brief's list. `EstimateSource` is one of `live | published_schedule | provider_estimate | model_estimate | fallback`.

## Changes from the brief's draft
| Change | Reason |
|---|---|
| `ranking` became `rankings[]` | One option is often both fastest and cheapest. |
| Added `durationSource` and a required `confidence` on segments | Shows whether each time comes from the timetable or a model. |
| Added `waitSeconds` (default 0) and `totalWaitSeconds` | Totals can be checked against the segments. |
| Added `costEstimate.basis` | Gives a human-readable fare source. |
| Added `liveData`, `mock`, `departAt`, `provenance[]` | Makes data honesty machine-readable. |
| Added `auto_rickshaw` | A common first/last-mile mode in Kochi. |

## Invariants (tested in `tests/routing.test.ts`)
- Segment *i* destination equals segment *i+1* origin, within 1 m.
- Each departure time is at or after the previous arrival time.
- The option totals equal `computeTotals(segments)` (`src/lib/totals.ts`).
- The metro fare equals the KMRL `fare_rules` value.

## Change process
For a breaking change, bump `SCHEMA_VERSION`, record it in this file, and regenerate the fixtures (`npm run fixtures:build`).
