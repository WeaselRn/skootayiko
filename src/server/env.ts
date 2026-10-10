import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const Env = z.object({
  LOCATIONIQ_API_KEY: z.string().default(""),
  LOCATIONIQ_BASE_URL: z.string().default("https://us1.locationiq.com/v1"),
  GEOCODE_VIEWBOX: z.string().default("75.9,10.3,76.6,9.7"),
  GEOCODE_COUNTRY: z.string().default("in"),
  ORS_API_KEY: z.string().default(""),
  ORS_BASE_URL: z.string().default("https://api.openrouteservice.org"),
  ORS_DAILY_BUDGET: z.coerce.number().default(1500),
  ORS_RATE_PER_MIN: z.coerce.number().default(35),
  /** Fallback street geometry (OSRM, OpenStreetMap data). Set to "off" to disable. */
  OSRM_BASE_URL: z
    .string()
    .default("https://routing.openstreetmap.de")
    .transform((v) => (v === "off" ? "" : v.replace(/\/$/, ""))),
  GTFS_METRO_DIR: z.string().default("./metro details"),
  GTFS_BUS_DIR: z.string().default("./kochi bus details"),
  GTFS_CACHE_DIR: z.string().default("./.cache/gtfs"),
  MAX_WALK_METERS: z.coerce.number().default(800),
  MAX_TRANSFERS: z.coerce.number().int().default(3),
  USE_MOCK_ROUTES: bool,
  ROUTE_CACHE_TTL_SECONDS: z.coerce.number().default(900),
});

// Strip trailing " # comment" (some dotenv loaders keep it) and let empty values fall back to defaults.
const raw = Object.fromEntries(
  Object.entries(process.env)
    .map(([k, v]) => [k, v?.replace(/\s+#.*$/, "").trim()] as const)
    .filter(([, v]) => v !== undefined && v !== ""),
);

/** Server-only configuration. Never import this from client components. */
export const env = Env.parse(raw);
