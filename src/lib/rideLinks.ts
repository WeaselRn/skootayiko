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

/**
 * Rapido publishes no booking deep link, so this only opens the app listing (Play Store on Android) or
 * Rapido's website; the trip has to be entered again there.
 */
export const rapido: Provider = {
  id: "rapido",
  label: "Rapido",
  modes: ["bike_taxi", "auto_rickshaw", "taxi"],
  link(_from, to, platform) {
    return {
      providerId: "rapido",
      label: "Rapido",
      href: platform === "android" ? "https://play.google.com/store/apps/details?id=com.rapido.passenger" : "https://www.rapido.bike/",
      prefilled: false,
      note: `Opens Rapido${platform === "android" ? " in the Play Store" : "'s website"}; enter ${to.name} as the drop there (trip details are not passed on).`,
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
