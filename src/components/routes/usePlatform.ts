"use client";

import { useEffect, useState } from "react";
import { detectPlatform, type Platform } from "@/lib/rideLinks";

/** Android / iOS / desktop, known only in the browser; "desktop" until mounted (no hydration mismatch). */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("desktop");
  useEffect(() => setPlatform(detectPlatform()), []);
  return platform;
}
