# Skootayiko

A journey planner for Kochi, India. Enter a start and a destination (plus optional stops) and compare door-to-door options across metro, bus, ferry, bike taxi, auto-rickshaw, taxi and walking, ranked by time and cost. Then watch the chosen route as a 3D preview, or let the day planner build a sightseeing itinerary that fits a time budget.

The name is Malayalam-flavoured wordplay on "scoot". The logo's two "o" letters are scooter wheels.

All times and fares are **estimates**. The 3D view is a preview that moves a model along the planned route. It is not live vehicle tracking, and nothing is booked or paid through the app.

## Features

- **Multimodal route comparison.** Up to five options per trip, labelled fastest, cheapest and balanced, with total duration (waits included), a fare range, transfers and a leg-by-leg step list.
- **Multi-stop trips.** Up to 8 intermediate stops, reorderable. Each stop-to-stop leg is routed separately and the times are chained.
- **Group size.** Transit is charged per person, road rides per vehicle (for example a 4-person group needs two autos). Bike taxis are left out for groups of three or more.
- **Day planner.** Give a time budget, a start time and interests (landmarks, museums, heritage, beaches, nature, family fun, temples and churches). A deterministic solver picks and orders sights using visit length, popularity and opening hours, then the real router re-times the day. If the real plan overruns, the weakest stop is dropped and the day is re-routed.
- **Sights along a route.** Opt in to see tourist places near your route and add them as stops.
- **2D map and 3D ride preview.** MapLibre map with route lines and stops. A three.js preview with play, pause, scrub, speed, leg stepping and camera follow. Walking avatar (man or woman) and vehicle models per mode.
- **Hand-off links.** Open Uber, Rapido or similar apps for a ride segment. The app only opens the provider; it never books, quotes or checks availability.
- **Honest data.** Every time and fare carries a source and confidence level. Expired feeds are disclosed in the UI.

## How it works (short)

1. **Static transit network.** GTFS feeds (Kochi Metro and a community bus and boat feed) are compiled into one compact network by `npm run gtfs:build` (also run by `prebuild`).
2. **Routing.** RAPTOR runs several times with different first and last-mile modes. Candidates are de-duplicated, pre-ranked, then road legs are refined with openrouteservice (OSRM as fallback) and re-timed.
3. **Ranking.** Fastest is the minimum duration. Cheapest is the lowest cost among practical options. Balanced minimises duration plus a cost and transfer penalty. All weights are in `config/fares.json`.
4. **Fares.** Metro fares come from the KMRL fare table. Bus, ferry, bike taxi, auto and taxi use an approximate model in `config/fares.json`. These are not quotes.
5. **Day planner.** Candidate sights come from `config/sights.json` (hand-curated) plus LocationIQ nearby search. See `src/server/routing/itinerary.ts` and `dayplan.ts`.

More detail is in [`docs/`](docs): [`prd.md`](docs/prd.md) (product), [`logic.md`](docs/logic.md) (routing and ranking), [`route-schema.md`](docs/route-schema.md) (API contract), [`ui.md`](docs/ui.md), [`build.md`](docs/build.md) and [`deploy.md`](docs/deploy.md).

## Tech stack

Next.js 16 (App Router) and React 19, TypeScript, Tailwind CSS 4, MapLibre GL JS, three.js, Zod 4 for validation, Vitest for tests. Deployable to Vercel or Cloudflare Workers (OpenNext adapter).

## Getting started

Requirements: **Node.js 22 or newer** (build scripts use `--env-file-if-exists`) and npm.

```bash
git clone https://github.com/WeaselRn/skootayiko.git
cd skootayiko
npm install
cp .env.example .env
```

Fill in `.env` (see below), then:

```bash
npm run dev
```

Open <http://localhost:3000>. The planner is at `/plan`.

`npm run dev` and `npm run build` build the transit network from the GTFS folders in the repo if `.cache/gtfs/network.json` is missing.

### Environment variables

Copy `.env.example` to `.env`. Do not keep an empty `.env.local` next to it: Next.js gives `.env.local` priority and an empty value would shadow the real one.

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_MAPTILER_KEY` | client | MapTiler tiles. Without it the map falls back to basic OpenStreetMap tiles. Restrict the key by allowed HTTP origins in the MapTiler dashboard. |
| `NEXT_PUBLIC_MAP_STYLE`, `NEXT_PUBLIC_MAP_CENTER_LAT/LON`, `NEXT_PUBLIC_MAP_ZOOM` | client | Map style and default view. |
| `NEXT_PUBLIC_SITE_URL` | build | Absolute site URL for link previews (`og:image`). Optional on Vercel, where `VERCEL_PROJECT_PRODUCTION_URL` is used as a fallback. |
| `LOCATIONIQ_API_KEY` | server | Place search and nearby sights. |
| `LOCATIONIQ_BASE_URL` | server | Use `https://eu1.locationiq.com/v1` if your key is in the EU region. |
| `GEOCODE_VIEWBOX`, `GEOCODE_COUNTRY` | server | Restrict place search to the Kochi area. |
| `ORS_API_KEY` | server | openrouteservice road and walking directions. |
| `ORS_DAILY_BUDGET`, `ORS_RATE_PER_MIN` | server | Self-imposed guards below the free-tier limits. |
| `OSRM_BASE_URL` | server | Fallback street geometry. Set to `off` to disable. |
| `GTFS_METRO_DIR`, `GTFS_BUS_DIR`, `GTFS_CACHE_DIR` | server | GTFS input folders and the compiled network cache. |
| `MAX_WALK_METERS`, `MAX_TRANSFERS` | server | Routing limits. |
| `USE_MOCK_ROUTES` | server | `true` serves fixtures from `src/fixtures` instead of the router. |
| `ROUTE_CACHE_TTL_SECONDS` | server | In-memory route cache lifetime. |

Keys named `NEXT_PUBLIC_*` are inlined into the browser bundle at build time. Never put a secret under that prefix. Redeploy after changing one.

You can run without API keys: set `USE_MOCK_ROUTES=true` to browse the fixtures, though place search and sights need LocationIQ.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server. |
| `npm run build` / `npm start` | Production build and server. |
| `npm test` | Run the Vitest suite (routing, multi-stop, itinerary, group fares, ride links). |
| `npm run typecheck` | TypeScript check. |
| `npm run gtfs:build` | Rebuild the compiled transit network from GTFS. |
| `npm run fixtures:build` | Regenerate mock route fixtures. |
| `npm run models:build` | Optimise the 3D models in `public/models`. |
| `npm run deploy` | Build and deploy to Cloudflare Workers. |

`npx tsx scripts/smoke.ts` prints a one-line summary for a set of hard-coded Kochi trips, offline.

## Project layout

```
config/            fares.json (fare and ranking model), sights.json (curated sights)
docs/              product, logic, schema, UI, build and deploy notes
public/models/     optimised glTF models used by the 3D preview
scripts/           GTFS build, fixtures, model optimisation, smoke test
src/app/           pages (landing, /plan, /about, /credits, /avatar) and API routes
src/components/    planner UI, map, 3D scene, ride HUD, itinerary timeline
src/lib/           shared helpers (formatting, modes, dwell times, ride links)
src/schema/        Zod contracts shared by the server and the UI
src/server/        env, geo maths, geocoding, GTFS loading, routing, suggestions
tests/             Vitest tests
```

API routes (all `POST` unless noted): `/api/route`, `/api/itinerary`, `/api/suggest`, `/api/geocode`, and `GET /api/metro`. Each validates input with Zod and applies a per-IP rate limit.

## Deployment

See [`docs/deploy.md`](docs/deploy.md). In short:

- **Vercel (Hobby)** is the simplest option. Add `NEXT_PUBLIC_MAPTILER_KEY`, `NEXT_PUBLIC_MAP_STYLE`, `LOCATIONIQ_API_KEY` and `ORS_API_KEY`. Use Node 22 or newer. Hobby is for personal, non-commercial use.
- **Cloudflare Workers** works through OpenNext but needs the Workers Paid plan, because route planning exceeds the 10 ms CPU limit on the Free plan.
- Next.js is pinned to 16.3.8 because the OpenNext adapter does not yet support 16.4.

In-memory caches and rate limits are per instance and reset on cold starts.

## Known limitations

- Both GTFS feeds are expired (KMRL ends 2025-12-31, the bus feed 2023-03-25). Schedules are treated as typical, not current.
- The bus feed has placeholder headways, so waits use an assumed 20-minute headway.
- No real-time data. Fares outside the metro are approximate ranges, not quotes.
- Curated sight coordinates, hours and visit lengths in `config/sights.json` are approximate. Verify before relying on them.
- The planner only works inside the Kochi service area. Other cities need their own transit data and configuration.
- Free-tier API limits (LocationIQ, openrouteservice) apply.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run `npm run typecheck` and `npm test`. Any breaking change to the route contract must bump `SCHEMA_VERSION` in `src/schema/route.ts` and be noted in `docs/route-schema.md` first.

## License

The source code is released under the [MIT License](LICENSE).

Third-party material keeps its own licenses and is not covered by the MIT License: 3D models (see `/credits`), GTFS feeds, map data (OpenStreetMap, ODbL) and fonts. Full attributions are on the in-app Credits page ([`src/app/credits/page.tsx`](src/app/credits/page.tsx)) and the About page.
