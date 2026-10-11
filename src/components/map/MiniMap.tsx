"use client";

import { useMemo } from "react";
import type { Coordinate, RouteOption } from "@/schema/route";
import { pathSampler, type PlayState } from "@/lib/journey";
import { MODE_STYLE } from "@/lib/modes";

const SIZE = 120;
const PAD = 10;

/**
 * Small overview of the whole journey while riding: the route drawn in mode colours, the current leg
 * highlighted, stops as dots and the rider's position. Plain SVG (no second map), so it costs nothing.
 */
export default function MiniMap({ option, state, className = "" }: { option: RouteOption; state: PlayState; className?: string }) {
  const shape = useMemo(() => {
    const legs = option.segments.map((s) => (s.geometry.length >= 2 ? s.geometry : [s.origin.location, s.destination.location]));
    const all = legs.flat();
    const lat0 = all.reduce((a, c) => a + c.lat, 0) / all.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = all.map((c) => c.lon * kx);
    const ys = all.map((c) => -c.lat);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = (SIZE - 2 * PAD) / Math.max(maxX - minX, maxY - minY, 1e-6);
    // Centre the drawing in the square.
    const ox = PAD + (SIZE - 2 * PAD - (maxX - minX) * scale) / 2;
    const oy = PAD + (SIZE - 2 * PAD - (maxY - minY) * scale) / 2;
    const project = (c: Coordinate): [number, number] => [ox + (c.lon * kx - minX) * scale, oy + (-c.lat - minY) * scale];
    return {
      project,
      paths: legs.map((pts) => pts.map((c) => project(c).map((v) => v.toFixed(1)).join(",")).join(" ")),
      samplers: option.segments.map((s) => pathSampler(s)),
    };
  }, [option]);

  const seg = option.segments[state.segment];
  const here = shape.samplers[state.segment]?.at(state.kind === "wait" ? 0 : state.progress).point;
  const [hx, hy] = here ? shape.project(here) : [0, 0];
  const start = shape.project(option.segments[0].origin.location);
  const end = shape.project(option.segments[option.segments.length - 1].destination.location);

  return (
    <div
      role="img"
      aria-label={`Route overview: leg ${state.segment + 1} of ${option.segments.length}, ${MODE_STYLE[seg.mode].label}`}
      className={`pointer-events-none overflow-hidden rounded-2xl bg-[var(--color-panel)]/90 shadow-lg ring-1 ring-black/10 backdrop-blur ${className}`}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full">
        {shape.paths.map((d, i) => (
          <polyline
            key={i}
            points={d}
            fill="none"
            stroke={MODE_STYLE[option.segments[i].mode].color}
            strokeWidth={i === state.segment ? 4 : 2.5}
            strokeOpacity={i === state.segment ? 1 : 0.45}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={option.segments[i].mode === "walking" ? "1 4" : undefined}
          />
        ))}
        <circle cx={start[0]} cy={start[1]} r={4} fill="#0f172a" stroke="#fff" strokeWidth={1.5} />
        <circle cx={end[0]} cy={end[1]} r={4} fill="#be123c" stroke="#fff" strokeWidth={1.5} />
        {here && (
          <>
            <circle cx={hx} cy={hy} r={8} fill={MODE_STYLE[seg.mode].color} opacity={0.25} />
            <circle cx={hx} cy={hy} r={4.5} fill="#fff" stroke={MODE_STYLE[seg.mode].color} strokeWidth={2.5} />
          </>
        )}
      </svg>
    </div>
  );
}
