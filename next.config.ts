import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // GTFS cache is read from disk by server route handlers.
  outputFileTracingIncludes: {
    "/api/route": ["./.cache/gtfs/**/*"],
  },
};

export default nextConfig;
