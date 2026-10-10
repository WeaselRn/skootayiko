# Build and run

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in `NEXT_PUBLIC_MAPTILER_KEY`, `LOCATIONIQ_API_KEY` and `ORS_API_KEY`.
   - Do not also create a `.env.local` that has empty keys. It takes priority and would shadow `.env`.
   - Restrict the MapTiler key to your HTTP origins. It is visible in the browser.
3. Build the GTFS cache. This is optional: the server builds it automatically if it is missing.
   ```bash
   npm run gtfs:build
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
   The app runs at http://localhost:3000. `predev` copies the MapLibre worker to `public/vendor/`.

## Scripts
| Script | Purpose |
|---|---|
| `npm test` | Vitest routing, schema and fixture tests. Runs offline. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run build` / `start` | Production build and server. |
| `npm run gtfs:build` | Raw GTFS to `.cache/gtfs/network.json`. |
| `npm run fixtures:build` | Regenerates `src/fixtures/*.json` with the real engine. Uses about 40 ORS calls, unless you pass `-- --no-ors`. |
| `npm run models:build` | Turns `3d assets/` into `public/models/*.glb`: bus OBJ to GLB, clip pruning, WebP, meshopt. |

## Environment
| Variable | Notes |
|---|---|
| `USE_MOCK_ROUTES=true` | Serves the nearest saved fixture with a "sample data" banner. Set it to `false` to use the real engine. |
| `ORS_DAILY_BUDGET`, `ORS_RATE_PER_MIN` | In-process guards below the ORS free tier. When the budget runs out, legs fall back to straight-line estimates. |
| `MAX_WALK_METERS`, `MAX_TRANSFERS` | Search limits. |

## Phase checkpoints
| Phase | Status | Evidence |
|---|---|---|
| 0: Scaffold and contract | Done | Next 16 and TypeScript; zod schema; 3 fixtures; docs. |
| 1: Routing foundation and comparison UI | Done | RAPTOR over metro, bus and boat; ORS refinement; fares; ranking; `/api/route`; `/api/geocode`; 12 tests pass. |
| 2: 2D map | Done | MapLibre route, stops and active leg. Leg endpoints match stops (tested). |
| 3: 3D player | Done, needs tuning | Custom Three.js layer, 6 GLB models plus procedural props, player controls. Model facing (`yaw` in `models.ts`) is not yet confirmed visually for every asset. |
| 4: Integration and resilience | Partly done | Real engine verified through the API. Timeouts, caching, rate limits and ORS fallback are in. The mobile device pass and a 10-journey validation are still to do. |
| 5: Realtime | Not started | No verified GTFS-RT feed for Kochi. |

## Next steps
- Turn on the real engine (`USE_MOCK_ROUTES=false`) and walk through 10 reference journeys:
  - Aluva ↔ Fort Kochi
  - Infopark ↔ Edappally
  - Vyttila ↔ Kakkanad
  - Airport ↔ Ernakulam
  - Vypin ↔ MG Road
  - …
- Tune `yaw` per model, then check on a mid-range phone.
- Refresh the GTFS sources and verify the fares in `config/fares.json`.
- Add Kochi Water Metro if a feed becomes available.
