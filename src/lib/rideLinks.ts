import type { Coordinate, RouteSegment, TransportMode } from "@/schema/route";

/**
 * Hand-off links to outside apps for a journey segment. These only open the provider's own app or site;
 * nothing is booked, quoted or checked for availability by Skootayiko. Add a provider by appending to
 * PROVIDERS.
 */

export type Platform = "android" | "ios" | "desktop";

export interface Place {
  name: string;
  location?: Coordinate;
}

export interface ExternalLink {
  providerId: string;
  /** Short link text, e.g. "Uber". */
  label: string;
  href: string;
  /** True when pickup and drop are filled in for the user. */
  prefilled: boolean;
  /** Shown as a tooltip / small print. */
  note: string;
}

export interface Provider {
  id: string;
  label: string;
  /** Segment modes this provider is offered for. */
  modes: TransportMode[];
  link(from: Place, to: Place, platform: Platform): ExternalLink | null;
}

const valid = (c?: Coordinate): c is Coordinate =>
  !!c && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180;

/**
 * Uber universal deep link (developer.uber.com, "Ride Request Deep Links"): opens the Uber app on phones
 * that have it, otherwise m.uber.com, with pickup and drop-off set. Without a usable pickup it falls back
 * to the rider's current location.
 */
export const uber: Provider = {
  id: "uber",
  label: "Uber",
  modes: ["taxi", "auto_rickshaw", "bike_taxi"],
  link(from, to) {
    if (!valid(to.location)) return null;
    const q = new URLSearchParams({ action: "setPickup" });
    if (valid(from.location)) {
      q.set("pickup[latitude]", String(from.location.lat));
      q.set("pickup[longitude]", String(from.location.lon));
      q.set("pickup[nickname]", from.name);
    } else q.set("pickup", "my_location");
    q.set("dropoff[latitude]", String(to.location.lat));
    q.set("dropoff[longitude]", String(to.location.lon));
    q.set("dropoff[nickname]", to.name);
    return {
      providerId: "uber",
      label: "Uber",
      href: `https://m.uber.com/ul/?${q}`,
      prefilled: true,
      note: valid(from.location) ? "Opens Uber with pickup and drop-off filled in." : "Opens Uber with your current location as pickup.",
    };
  },
};

const RAPIDO_PACKAGE = "com.rapido.passenger";
const RAPIDO_PLAY = `https://play.google.com/store/apps/details?id=${RAPIDO_PACKAGE}`;

/**
 * Rapido publishes no booking deep link, so trip details cannot be passed on.
 * Android: rapido.bike serves an assetlinks.json that verifies the Rapido app for the domain, so an
 * intent URL for https://rapido.bike/ restricted to the Rapido package opens the installed app where the
 * app accepts that link, and falls back to the Play Store otherwise (Chrome and most Android browsers).
 * Elsewhere: Rapido's website.
 */
export const rapido: Provider = {
  id: "rapido",
  label: "Rapido",
  modes: ["bike_taxi", "auto_rickshaw", "taxi"],
  link(_from, to, platform) {
    const android = platform === "android";
    return {
      providerId: "rapido",
      label: "Rapido",
      href: android
        ? `intent://rapido.bike/#Intent;scheme=https;package=${RAPIDO_PACKAGE};S.browser_fallback_url=${encodeURIComponent(RAPIDO_PLAY)};end`
        : "https://www.rapido.bike/",
      prefilled: false,
      note: android
        ? `Opens the Rapido app (or the Play Store if it is not installed); enter ${to.name} as the drop there, trip details are not passed on.`
        : `Opens Rapido's website; enter ${to.name} as the drop there (trip details are not passed on).`,
    };
  },
};

export const PROVIDERS: Provider[] = [uber, rapido];

export function detectPlatform(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): Platform {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && /mobile/i.test(ua))) return "ios";
  return "desktop";
}

/** Outside-app links for one segment, in PROVIDERS order. */
export function rideLinks(seg: Pick<RouteSegment, "mode" | "origin" | "destination">, platform: Platform, providers = PROVIDERS): ExternalLink[] {
  const from: Place = { name: seg.origin.name, location: seg.origin.location };
  const to: Place = { name: seg.destination.name, location: seg.destination.location };
  return providers.filter((p) => p.modes.includes(seg.mode)).flatMap((p) => p.link(from, to, platform) ?? []);
}

/** Kochi Metro tickets over WhatsApp: opens a chat with the number and "Hi" typed in. */
export const METRO_WHATSAPP = {
  number: "+91 91889 57488",
  href: `https://wa.me/919188957488?text=${encodeURIComponent("Hi")}`,
};

export interface OptionLinks {
  /** Ride-app links for the option's first bike-taxi/auto/taxi leg (the one you would book first). */
  rides: ExternalLink[];
  /** "Origin → Destination" of that leg, for labelling. */
  rideLeg?: string;
  /** True when the option rides the metro, so the WhatsApp ticket link applies. */
  metro: boolean;
}

/** Hand-off links for a whole journey option, for showing up front (map overlay, ride HUD). */
export function optionLinks(segments: Pick<RouteSegment, "mode" | "origin" | "destination">[], platform: Platform, providers = PROVIDERS): OptionLinks {
  const ride = segments.find((s) => rideLinks(s, platform, providers).length > 0);
  return {
    rides: ride ? rideLinks(ride, platform, providers) : [],
    rideLeg: ride ? `${ride.origin.name} → ${ride.destination.name}` : undefined,
    metro: segments.some((s) => s.mode === "metro"),
  };
}
