"use client";

import { useEffect, useState } from "react";
import type { RouteSegment } from "@/schema/route";
import { detectPlatform, METRO_WHATSAPP, rideLinks, type Platform } from "@/lib/rideLinks";

const link =
  "inline-flex items-center rounded-md px-1.5 py-1 [@media(pointer:coarse)]:py-2 font-medium text-teal-700 underline-offset-2 hover:bg-teal-600/10 hover:underline dark:text-teal-400";

/**
 * Quiet hand-off links under a segment: ride apps for bike-taxi/auto/taxi legs, WhatsApp tickets for metro.
 * They open outside apps in a new tab; nothing is booked here, so the wording says so.
 */
export default function ExternalLinks({ segment }: { segment: Pick<RouteSegment, "mode" | "origin" | "destination"> }) {
  // Platform is only known in the browser; render the desktop variant until then (no hydration mismatch).
  const [platform, setPlatform] = useState<Platform>("desktop");
  useEffect(() => setPlatform(detectPlatform()), []);

  if (segment.mode === "metro") {
    return (
      <div className="-mt-0.5 mb-1 flex flex-wrap items-center gap-x-1 px-2 text-[11px] text-[var(--color-muted)]">
        <span>Metro ticket:</span>
        <a href={METRO_WHATSAPP.href} target="_blank" rel="noopener noreferrer" className={link} title={`Opens WhatsApp chat with ${METRO_WHATSAPP.number}`}>
          WhatsApp {METRO_WHATSAPP.number}
        </a>
      </div>
    );
  }

  const links = rideLinks(segment, platform);
  if (!links.length) return null;
  return (
    <div className="-mt-0.5 mb-1 flex flex-wrap items-center gap-x-1 px-2 text-[11px] text-[var(--color-muted)]">
      <span title="Booked and paid in the provider's app, not through Skootayiko. Fares there may differ from our estimate.">Book outside Skootayiko:</span>
      {links.map((l) => (
        <span key={l.providerId} className="inline-flex items-center">
          <a href={l.href} target="_blank" rel="noopener noreferrer" className={link} title={l.note}>
            Continue with {l.label}
            {!l.prefilled && <span className="ml-1 font-normal text-[var(--color-muted)]">(enter trip there)</span>}
            <span aria-hidden className="ml-0.5">↗</span>
          </a>
        </span>
      ))}
    </div>
  );
}
