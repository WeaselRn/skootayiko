"use client";

import type { RouteSegment } from "@/schema/route";
import { METRO_WHATSAPP, optionLinks } from "@/lib/rideLinks";
import { usePlatform } from "./usePlatform";

const STYLES = {
  /** Floating on the map next to "Ride this route". */
  overlay: {
    wrap: "flex flex-wrap items-center gap-1.5",
    pill: "pointer-events-auto inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-800 shadow ring-1 ring-black/5 backdrop-blur hover:bg-white dark:bg-slate-900/85 dark:text-slate-100 dark:ring-white/10 [@media(pointer:coarse)]:py-1.5",
  },
  /** Inside the ride HUD panel. */
  hud: {
    wrap: "flex flex-wrap items-center gap-1.5 text-[11px]",
    pill: "inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] px-2 py-0.5 font-medium hover:border-slate-400 [@media(pointer:coarse)]:py-1",
  },
} as const;

/**
 * Up-front hand-off links for the selected journey: ride apps for its first bike-taxi/auto/taxi leg and
 * the metro WhatsApp ticket line. External apps only; nothing is booked here.
 */
export default function BookingPills({ segments, variant }: { segments: Pick<RouteSegment, "mode" | "origin" | "destination">[]; variant: keyof typeof STYLES }) {
  const platform = usePlatform();
  const { rides, rideLeg, metro } = optionLinks(segments, platform);
  if (!rides.length && !metro) return null;
  const st = STYLES[variant];
  return (
    <div className={st.wrap} role="group" aria-label="Book outside Skootayiko">
      {rides.map((l) => (
        <a
          key={l.providerId}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className={st.pill}
          title={`${l.note}${rideLeg ? ` Leg: ${rideLeg}.` : ""} Booked and paid in ${l.label}, not through Skootayiko.`}
        >
          {l.label}
          <span aria-hidden className="opacity-60">
            ↗
          </span>
        </a>
      ))}
      {metro && (
        <a href={METRO_WHATSAPP.href} target="_blank" rel="noopener noreferrer" className={st.pill} title={`Metro tickets on WhatsApp: ${METRO_WHATSAPP.number}`}>
          Metro ticket
          <span aria-hidden className="opacity-60">
            ↗
          </span>
        </a>
      )}
    </div>
  );
}
