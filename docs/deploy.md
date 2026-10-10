# Deploying

Two targets are set up. **Vercel (Hobby, free) is the recommended one**: Cloudflare Workers Free allows only
10 ms of CPU per request, which route planning far exceeds.

## Vercel (Hobby)

Vercel runs Next.js natively; no adapter. `vercel.json` pins functions to `bom1` (Mumbai, closest to Kochi).

- **GTFS network:** `npm run build` runs `prebuild`, which builds `.cache/gtfs/network.json` from the GTFS
  folders in the repo. `next.config.ts` (`outputFileTracingIncludes`) bundles that file with `/api/route`,
  `/api/itinerary` and `/api/metro`, which read it from disk.
- **Time limit:** `/api/route` and `/api/itinerary` export `maxDuration = 60` (seconds). The first day plan
  takes about 10 s (LocationIQ and OSRM calls); repeats are fast while the function instance stays warm.
- **In-memory caches and rate limits** are per function instance and reset on cold starts.
- **Hobby is for personal, non-commercial use only.**

### Setup

1. vercel.com → **Add New… → Project** → import `WeaselRn/skootayiko`. Framework is detected as Next.js;
   keep the default build command (`npm run build`) and output settings.
2. **Environment Variables** (Production, and Preview if you use preview deploys):

   | Name | Notes |
   |---|---|
   | `NEXT_PUBLIC_MAPTILER_KEY` | inlined at build time; redeploy after changing |
   | `NEXT_PUBLIC_MAP_STYLE` | `streets-v2` |
   | `LOCATIONIQ_API_KEY` | secret |
   | `ORS_API_KEY` | secret |

   Optional: `LOCATIONIQ_BASE_URL`, `ORS_DAILY_BUDGET`, `ORS_RATE_PER_MIN`, `OSRM_BASE_URL` (`off` disables the
   OSRM fallback), `ROUTE_CACHE_TTL_SECONDS`, `NEXT_PUBLIC_MAP_CENTER_LAT/LON/ZOOM`. Leave `USE_MOCK_ROUTES` unset.
3. **Settings → General → Node.js Version:** 22.x or newer (the build scripts use `--env-file-if-exists`).
4. Deploy. After that, every push to `master` deploys to production.
5. MapTiler dashboard: restrict the key's allowed HTTP origins to your `*.vercel.app` URL and any custom domain.

Local check of the production build: `npm run build && npx next start`.

---

# Cloudflare Workers (needs Workers Paid)

The app runs on Cloudflare Workers via the OpenNext adapter (`@opennextjs/cloudflare`). Config lives in
`wrangler.jsonc` and `open-next.config.ts`.

## How it fits Workers

- **GTFS network:** Workers have no filesystem. `npm run build` runs `scripts/prepare-network.ts` first
  (via `prebuild`). It builds `.cache/gtfs/network.json` from the GTFS folders in the repo if missing and
  copies it to `public/data/network.json`. At runtime `src/server/gtfs/load.ts` reads it through the
  `ASSETS` binding (on Node it still reads the file from disk).
- **Size:** about 1.4 MB gzipped for the Worker plus about 6.5 MB of static assets. That is under the
  free plan's 3 MB Worker limit.
- **CPU:** route planning (RAPTOR) and the day planner use far more than the **10 ms CPU per request**
  that the Workers Free plan allows, so on Free those API calls will fail with "exceeded CPU limit".
  Use **Workers Paid** ($5/month), which allows 30 s of CPU per request by default.
- **In-memory state:** caches (routes, ORS, OSRM, LocationIQ) and the per-IP rate limits live in each
  isolate. They are per-instance and reset when the isolate is recycled. Nothing persistent is required.
- **Next.js is pinned to 16.3.8** (for both targets, so the Cloudflare build keeps working). Next 16.4 writes a new `preview-props.json` that OpenNext 1.20.10
  does not bundle yet, so every route returned HTTP 500. Upgrade only when OpenNext supports 16.4.

## One-time setup (Git deploys, Workers Builds)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick
   `WeaselRn/skootayiko`.
2. **Project name:** `skootayiko`. It must match `name` in `wrangler.jsonc`.
3. **Build command:** `npx opennextjs-cloudflare build`
   **Deploy command:** `npx opennextjs-cloudflare deploy`
   **Root directory:** `/`
4. **Build variables.** These are inlined into the browser bundle at build time, so they must be set here:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_MAPTILER_KEY` | your MapTiler key |
   | `NEXT_PUBLIC_MAP_STYLE` | `streets-v2` |
   | `NODE_VERSION` | `24` (the build scripts use `--env-file-if-exists`) |

   The optional `NEXT_PUBLIC_MAP_CENTER_LAT`, `NEXT_PUBLIC_MAP_CENTER_LON` and `NEXT_PUBLIC_MAP_ZOOM` also go here.
5. After the first deploy: **Settings → Variables and secrets** (runtime). Add these as type **Secret**:
   - `LOCATIONIQ_API_KEY`
   - `ORS_API_KEY`

   Optional plain variables: `LOCATIONIQ_BASE_URL` (for an EU key), `ORS_DAILY_BUDGET`, `ORS_RATE_PER_MIN`,
   `OSRM_BASE_URL` (`off` disables the OSRM fallback), `ROUTE_CACHE_TTL_SECONDS`.
   Do not set `USE_MOCK_ROUTES`. Redeploy after changing these.
6. MapTiler dashboard: restrict the key's allowed HTTP origins to your `*.workers.dev` URL and any custom domain.
7. Switch the account to **Workers Paid** (see CPU above).

After that, every push to `master` builds and deploys.

## Local checks

- `npm run preview` builds the Worker and serves it locally in `workerd` at http://localhost:8787. Secrets
  come from `.env` (or `.dev.vars`).
- `npm run deploy` builds and deploys from your machine with Wrangler (`npx wrangler login` first).
- OpenNext warns that Windows is not fully supported. Builds worked here, but WSL is safer. Stop any running
  `preview` before rebuilding, because Windows keeps `.open-next/` locked.

## Gotcha for code changes

Do not share a promise chain or timer across requests (for example a module-level `queue = queue.then(...)`).
On Workers, a timer created by one request is cancelled when that request ends, and the next request then
hangs. The throttles in `osrm.ts` and `suggest/nearby.ts` space calls with a shared timestamp instead.
