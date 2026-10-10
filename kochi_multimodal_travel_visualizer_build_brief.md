# Kochi Multimodal Travel Visualizer

## Product Context, Agent Responsibilities, Architecture, and Build Plan

## 1. Product vision

Build a Kochi-focused multimodal travel-planning web app that helps
users travel from location A to location B using practical combinations
of transport modes.

The app should estimate the **total journey time and cost**, compare
route alternatives, and let the user watch the selected journey unfold
through a clean, animated 3D visualization.

Think of it as a multimodal route planner with a lightweight 3D journey
player---not a traditional gamification app.

### Core example

A route might be:

1.  Bike taxi to a metro station.
2.  Metro to an interchange station.
3.  Bus to a stop near the destination.
4.  Walk the final stretch.

The user should be able to understand the entire journey, including
transfer points, estimated duration, and estimated cost, without needing
to interpret a complicated map.

### Product principles

-   **Utility first:** route correctness, understandable transfers,
    useful cost/time estimates.
-   **Minimal interface:** show only information and 3D objects relevant
    to the current journey segment.
-   **Visualize, don't simulate everything:** the 3D layer should
    explain the route, not become a complex open-world game.
-   **Reuse assets:** use a small library of reusable 3D models rather
    than generating models for every trip.
-   **Be honest about data:** distinguish live data from schedules,
    estimates, and simulated animation.
-   **Build incrementally:** prove the routing and data contract before
    integrating every feature.
-   **Mobile-first performance:** keep models, scene complexity, and
    animation costs under control.

## 2. Scope

### In scope

-   Origin and destination search.
-   Multimodal route alternatives using available transport data.
-   Estimated total travel time, including transfers and waiting where
    data permits.
-   Estimated total cost, with assumptions and uncertainty made clear.
-   Route comparison, at minimum:
    -   Fastest practical route.
    -   Cheapest practical route.
-   A basic 2D map for validating route geometry and stops.
-   An animated 3D journey view.
-   Relevant 3D assets for road travel, metro, buses, and walking.
-   Segment-by-segment journey progression.
-   Clear loading, unavailable-data, and error states.
-   A modular architecture that allows routing and visualization to
    evolve independently.

### Explicitly out of scope for the initial version

-   XP, badges, leaderboards, streaks, rewards, or other traditional
    gamification.
-   A full open-world 3D city simulation.
-   Generating new 3D models for every route.
-   Guaranteed live vehicle tracking for operators that do not provide
    accessible live data.
-   Booking or paying for transport unless a supported provider
    integration is available.
-   Claiming exact fares or arrival times when only estimates are
    available.

## 3. Agent assignment: main agent + dedicated logic subagent

Use two parallel workstreams with a shared contract.

### Main agent: interface and 3D journey experience

The main agent owns the user-facing application and should focus on:

-   Product layout and responsive interface.
-   Origin/destination entry and route selection.
-   Route summary cards showing total estimated cost and duration.
-   Map rendering and camera behavior.
-   3D scene composition and reusable vehicle/environment assets.
-   Segment-specific animations and transitions.
-   Journey progress UI and transfer instructions.
-   Loading, empty, error, and degraded-data states.
-   Mobile performance and visual polish.
-   Integration with the route schema and the logic subagent's output.

The main agent should **not independently invent routing rules,
transport fares, or route rankings**. It should consume route results
through the shared schema. Until the logic service is ready, it should
use clearly labelled mock route data that conforms to the same schema.

### Logic subagent: routing, data sources, and estimation

Spawn a dedicated subagent whose responsibility is solely the routing
and estimation layer. It should investigate and implement:

-   Feasible transport data sources for Kochi.
-   Public transit schedule and route availability.
-   Road routing and walking geometry.
-   Multimodal connections and transfer feasibility.
-   Route alternatives and ranking.
-   Total duration estimation, including waiting and transfer time where
    possible.
-   Cost estimation by transport leg.
-   Data provenance, freshness, limitations, and confidence/uncertainty.
-   Backend endpoints and tests for route planning.
-   Sample response payloads that conform to the shared route schema.

The logic subagent should not spend time building the 3D interface or
visual design. Its deliverables should be a documented, testable routing
service and reliable structured route output.

### Coordination rules

1.  The main agent creates or agrees on the shared route schema before
    building tightly coupled integration.
2.  The logic subagent must use that schema and document any proposed
    changes before making breaking changes.
3.  Both workstreams can proceed in parallel using mock data and sample
    API responses.
4.  The main agent owns the final integration and user experience.
5.  The logic subagent owns the correctness of route calculation,
    ranking, cost/time estimates, and their tests.
6.  Keep transport data limitations visible. Neither agent should assume
    an API/feed exists until verified.
7.  If repository tooling supports subagents, delegate the logic
    workstream explicitly. If not, keep the logic task isolated as a
    separate implementation brief or worktree/branch.

## 4. Suggested architecture

Keep routing, data normalization, and rendering as separate layers.

``` text
User enters A and B
        |
        v
Frontend requests route alternatives
        |
        v
Routing API / backend
  - fetches transport and map data
  - creates candidate route legs
  - validates transfers
  - estimates duration and cost
  - ranks route alternatives
        |
        v
Shared route response schema
        |
        +------------------------------+
        |                              |
        v                              v
Route summary UI                 3D journey visualizer
cost, time, transfers             segment geometry, assets,
                                  camera, animation, progress
```

### Potential technology choices

Treat these as options to validate against the repository and data
requirements, not mandatory choices.

-   **Frontend:** React / Next.js with TypeScript.
-   **Styling:** the project's existing styling system; Tailwind CSS if
    already used or appropriate.
-   **Map rendering:** MapLibre GL JS or another suitable map SDK.
-   **3D rendering:** Three.js, potentially integrated with MapLibre for
    geographic alignment.
-   **Animation:** Three.js animation/update loop and/or GSAP for
    coordinated transitions.
-   **Backend:** Python with FastAPI, or the project's existing backend
    framework.
-   **Geospatial database:** PostgreSQL with PostGIS if persistent
    geographic querying is needed.
-   **Road routing:** OSRM or a suitable directions provider.
-   **Multimodal transit routing:** OpenTripPlanner where compatible, or
    a custom integration/routing layer.
-   **Geographic context:** OpenStreetMap data, subject to licensing and
    attribution requirements.
-   **Transit data:** GTFS schedules and GTFS-Realtime where published
    and usable.
-   **Realtime delivery:** polling, server-sent events, or WebSockets
    only where the product genuinely needs updates.

Do not introduce every technology at once. Inspect the current
repository and reuse existing choices when sensible.

## 5. Shared route schema

The route schema is the interface between the logic subagent and the
main agent. Agree on it early and version it if needed.

A route response should represent a journey as ordered segments. Each
segment should contain enough information for the UI to show the
relevant mode, geometry, estimated duration, estimated cost, and
transfer instructions.

Illustrative TypeScript shape:

``` ts
type TransportMode =
  | "walking"
  | "bike_taxi"
  | "taxi"
  | "bus"
  | "metro"
  | "train"
  | "ferry"
  | "cycling"
  | "unknown";

type EstimateSource =
  | "live"
  | "published_schedule"
  | "provider_estimate"
  | "model_estimate"
  | "fallback";

interface Coordinate {
  lat: number;
  lon: number;
}

interface RouteStop {
  id?: string;
  name: string;
  location: Coordinate;
  arrivalTime?: string;
  departureTime?: string;
}

interface RouteSegment {
  id: string;
  mode: TransportMode;
  origin: RouteStop;
  destination: RouteStop;
  geometry: Coordinate[];
  durationSeconds: number;
  costEstimate?: {
    min: number;
    max: number;
    currency: "INR";
    source: EstimateSource;
  };
  distanceMeters?: number;
  waitSeconds?: number;
  instructions?: string[];
  dataSource?: string;
  confidence?: "high" | "medium" | "low";
}

interface RouteOption {
  id: string;
  label: string;
  ranking: "fastest" | "cheapest" | "balanced" | "alternative";
  totalDurationSeconds: number;
  totalCostEstimate: {
    min: number;
    max: number;
    currency: "INR";
    source: EstimateSource;
  };
  segments: RouteSegment[];
  transfers: number;
  assumptions?: string[];
  warnings?: string[];
}

interface RoutePlanResponse {
  schemaVersion: "1.0";
  origin: RouteStop;
  destination: RouteStop;
  generatedAt: string;
  options: RouteOption[];
  dataWarnings?: string[];
}
```

This is an initial contract, not a final specification. Adjust it to the
routing engine and actual data sources, but preserve these principles:

-   Geometry must be available for drawing the segment where possible.
-   Duration and cost must be explicit estimates, not silently treated
    as exact values.
-   Each estimate should indicate its source or confidence where
    feasible.
-   Segments must be ordered and transfers must be represented clearly.
-   The UI must handle missing geometry, unknown costs, and incomplete
    transit data gracefully.
-   Avoid exposing provider credentials or secret API keys to the
    client.

## 6. Routing and estimation requirements

The logic subagent should investigate and document the following before
claiming routing is reliable.

### Route generation

-   Find plausible candidate paths for each supported mode.
-   Combine modes into valid multimodal journeys.
-   Respect transit schedules when available.
-   Account for walking between stops and stations.
-   Include interchange/waiting time when data supports it.
-   Avoid impossible or impractical transfers.
-   Return more than one useful route when possible.

### Ranking

At minimum, support:

-   **Fastest:** lowest estimated total door-to-door duration.
-   **Cheapest:** lowest estimated total cost among practical routes.
-   **Balanced (optional):** a documented trade-off between cost,
    duration, and number of transfers.

Do not simply add independently calculated mode routes if that produces
invalid connections. Transfers and schedules must be checked as part of
the whole journey.

### Cost estimation

-   Prefer official fares and supported provider estimates.
-   Record whether a fare is fixed, schedule-derived,
    provider-estimated, or approximate.
-   For services without a usable fare API, provide a range or clearly
    marked estimate.
-   Include known booking charges where applicable.
-   Never invent exact fares or imply a ride is bookable when it is not.

### Time estimation

-   Include ride duration, scheduled waiting, transfer walking, and
    expected waiting when data is available.
-   State assumptions for unknown traffic, delays, or headways.
-   Distinguish planned/scheduled duration from live arrival
    predictions.
-   Make sure the total is calculated consistently from its segment
    durations and transfer waits.

### Kochi data audit

Before implementation depends on a source, verify:

-   Which bus and metro route/schedule data is accessible.
-   Whether it is downloadable, licensed for the intended use, and
    current.
-   Whether real-time vehicle positions or service alerts are available.
-   Whether road directions and walking routes cover the intended area.
-   Whether ride-hailing providers permit estimates or booking through
    an approved integration.
-   Rate limits, pricing, attribution, and API key requirements.

The app can still be useful without complete live data, but it must
disclose estimates and gaps.

## 7. 3D UI and animation requirements

The main agent should make the 3D layer a visual representation of the
selected route.

### Scene behavior by mode

-   **Bike taxi / cab:** show a relevant vehicle moving along road
    geometry.
-   **Metro:** show a train moving along a simplified rail path, with
    relevant stations or track context.
-   **Bus:** show a bus moving along its route with restrained
    surrounding traffic.
-   **Walking:** show a simple street scene with buildings, sidewalks,
    and occasional vehicles.
-   **Transfers:** show arrival, a clear transition to the next leg, and
    the next boarding/walking instruction.

Use only the contextually relevant scene objects. Avoid loading a busy
3D city for every segment.

### Asset strategy

-   Create or source a small reusable asset library.
-   Load assets on demand and cache them.
-   Prefer optimized GLB/glTF models with sensible polygon counts and
    texture sizes.
-   Use simple proxy assets while detailed models load.
-   Reuse the same model for many journeys.
-   Respect licenses and attribution requirements for third-party
    assets.

### Animation behavior

-   Use the route geometry to guide vehicle movement.
-   Orient vehicles along the path.
-   Use estimated segment duration to control timing, but allow
    accelerated playback if needed.
-   Clearly distinguish visual playback from actual elapsed travel time.
-   Animate camera transitions and mode changes without disorienting the
    user.
-   Preload the next segment's assets where practical.
-   Ensure reduced-motion preferences and low-powered devices are
    supported.

### Avoid misleading users

A moving model along a planned route is not proof of live vehicle
tracking. If live GPS/operator data is unavailable, describe it as a
route animation or journey preview---not a live vehicle position.

## 8. Phased implementation plan

### Phase 0 --- Inspect and define

**Main agent** - Inspect the repository, current framework,
dependencies, and existing UI. - Create the product/architecture
documents. - Define the route schema with the logic subagent. - Set up
mock route fixtures for frontend development.

**Logic subagent** - Audit data providers and Kochi transit data. -
Identify feasible routing options, limitations, and costs. - Propose the
route calculation and estimation design.

**Checkpoint:** documented architecture, agreed schema, known data
limitations, and a mock response.

### Phase 1 --- Routing foundation

**Logic subagent** - Implement the route service and provider
adapters. - Generate candidate route options. - Estimate total duration
and cost. - Implement fastest and cheapest ranking. - Add
unit/integration tests and representative route fixtures.

**Main agent** - Build the origin/destination flow and route comparison
UI against mock data. - Display totals, segment lists, transfers, and
uncertainty labels.

**Checkpoint:** route options can be tested independently, and the
frontend renders the shared schema correctly.

### Phase 2 --- Functional 2D map

**Main agent** - Render route geometries and stop locations on a map. -
Highlight the selected route and current segment. - Validate map fit,
route visibility, and transfer presentation.

**Logic subagent** - Improve geometry, stop matching, transfer validity,
and estimate consistency.

**Checkpoint:** selected route geometry and its segment list agree.

### Phase 3 --- 3D journey player

**Main agent** - Add optimized reusable 3D assets. - Animate vehicles
along route geometry. - Add camera transitions and segment-specific
scene context. - Implement arrival/transfer transitions and fallback
behavior.

**Logic subagent** - Continue improving route feasibility, costs, data
provenance, and test coverage.

**Checkpoint:** a route response can drive the full visual journey
without hardcoded route-specific UI logic.

### Phase 4 --- Integration and resilience

-   Connect the real route service to the frontend.
-   Handle timeouts, unavailable providers, incomplete geometry, and
    missing fares.
-   Add caching and rate-limit protection.
-   Test on mobile and low-powered devices.
-   Validate totals, transfers, and route ranking with representative
    Kochi journeys.

**Checkpoint:** end-to-end route planning works with transparent
estimates and graceful failure states.

### Phase 5 --- Real-time features, only where supported

-   Add live transit data and service alerts where feeds exist.
-   Add user GPS tracking with clear permission handling.
-   Recalculate journeys when meaningful changes occur.
-   Integrate ride-hailing links or approved APIs where permitted.

**Checkpoint:** the UI clearly distinguishes live, scheduled, estimated,
and simulated information.

## 9. Testing and acceptance criteria

Do not consider a phase complete until its checkpoint has been verified.

### Routing acceptance

-   The API returns a schema-valid response.
-   Route legs are ordered and connected.
-   Total duration accounts for included segment and transfer times.
-   Cheapest and fastest options are ranked according to documented
    rules.
-   Missing fares or feeds produce explicit warnings rather than
    fabricated values.
-   Tests cover no-route, partial-data, and provider-failure scenarios.

### UI acceptance

-   The user can enter an origin and destination and select a route.
-   Cost, duration, modes, and transfers are easy to understand.
-   The 2D map can display route geometry and stops.
-   The 3D scene changes based on the current segment's transport mode.
-   Vehicles follow the supplied geometry rather than arbitrary screen
    coordinates.
-   Missing 3D assets or geometry do not crash the app.
-   Mobile layout, loading states, and reduced-motion behavior are
    handled.

### Integration acceptance

-   The UI consumes the same route schema used by tests and mock
    fixtures.
-   No route or fare logic is duplicated inside presentation components.
-   Route totals shown in the UI match the API response.
-   The UI never labels simulated movement as live tracking.

## 10. Instructions to the coding agent

1.  Create or update `prd.md`, `logic.md`, `ui.md`, `route-schema.md`,
    and `build.md`.
2.  Spawn a dedicated logic subagent solely for routing, transport data,
    fare/time estimation, ranking, backend APIs, and logic tests.
3.  Keep the main agent focused on the interface, map, 3D models,
    animations, responsive behavior, and integration.
4.  Agree on the route schema before tightly coupling the workstreams.
5.  Let the main agent use mock route fixtures while the logic subagent
    develops the real service.
6.  Implement one phase at a time and verify each checkpoint before
    proceeding.
7.  Do not claim a transport feed, API, live tracking capability, or
    booking integration exists until it has been verified.
8.  Prefer existing repository conventions and dependencies over
    unnecessary rewrites.
9. Report completed work, tests run, assumptions, known limitations,
    and the next phase at each checkpoint.

**Primary success criterion:** a user can enter A and B, compare
plausible multimodal options by estimated time and cost, select a route,
and watch a clear, lightweight 3D visualization of its ordered journey
segments.
