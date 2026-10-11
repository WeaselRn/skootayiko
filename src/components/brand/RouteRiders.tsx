"use client";

import { useEffect, useState } from "react";

interface Rider {
  label: string;
  color: string;
  w: number;
  /** Starting position along the route, 0–1. */
  at: number;
}

/**
 * Little vehicles riding the landing-page route. Uses SVG <animateMotion> (supported in every current
 * browser) rather than CSS offset-path, which Firefox does not apply to SVG shapes. With "reduce motion"
 * set in the OS, riders stay parked at their spots instead of moving.
 */
export default function RouteRiders({ path, riders, loopS }: { path: string; riders: Rider[]; loopS: number }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  return (
    <svg viewBox="0 0 1200 400" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
      <path id="rider-route" d={path} fill="none" stroke="none" />
      {riders.map((r) => (
        <g key={`${r.label}-${reduced}`}>
          {reduced ? (
            // Parked: hold the rider at its own point on the route.
            <animateMotion dur="1s" fill="freeze" rotate="auto" keyPoints={`${r.at};${r.at}`} keyTimes="0;1" calcMode="linear">
              <mpath href="#rider-route" />
            </animateMotion>
          ) : (
            <animateMotion dur={`${loopS}s`} begin={`${-r.at * loopS}s`} repeatCount="indefinite" rotate="auto">
              <mpath href="#rider-route" />
            </animateMotion>
          )}
          <rect x={-r.w / 2} y={-9} width={r.w} height={18} rx={7} fill={r.color} />
          <rect x={r.w / 2 - 10} y={-5} width={6} height={6} rx={1.5} fill="#ffffff" opacity="0.85" />
          <circle cx={-r.w / 2 + 7} cy={10} r={3.5} fill="#10233a" />
          <circle cx={r.w / 2 - 7} cy={10} r={3.5} fill="#10233a" />
        </g>
      ))}
    </svg>
  );
}
