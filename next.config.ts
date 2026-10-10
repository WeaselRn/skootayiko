import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Node hosts (Vercel, self-hosted): every route that plans trips reads the GTFS cache from disk, so the
  // file must be bundled with each function. (On Cloudflare it comes from static assets; see gtfs/load.ts.)
  outputFileTracingIncludes: {
    "/api/route": ["./.cache/gtfs/**/*"],
    "/api/itinerary": ["./.cache/gtfs/**/*"],
    "/api/metro": ["./.cache/gtfs/**/*"],
  },
};

export default nextConfig;
