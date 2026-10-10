import { describe, expect, it } from "vitest";
import { detectPlatform, METRO_WHATSAPP, rideLinks, uber } from "@/lib/rideLinks";

const seg = (mode: "bike_taxi" | "metro" | "walking" | "taxi", lat = 9.9658) => ({
  mode,
  origin: { name: "Fort Kochi", location: { lat, lon: 76.2421 } },
  destination: { name: "Ernakulam South", location: { lat: 9.9686, lon: 76.2896 } },
});

describe("rideLinks", () => {
  it("builds an Uber universal link from the segment's own stops", () => {
    const [u] = rideLinks(seg("taxi"), "desktop");
    const url = new URL(u.href);
    expect(url.origin + url.pathname).toBe("https://m.uber.com/ul/");
    expect(url.searchParams.get("action")).toBe("setPickup");
    expect(url.searchParams.get("pickup[latitude]")).toBe("9.9658");
    expect(url.searchParams.get("pickup[nickname]")).toBe("Fort Kochi");
    expect(url.searchParams.get("dropoff[longitude]")).toBe("76.2896");
    expect(url.searchParams.get("dropoff[nickname]")).toBe("Ernakulam South");
    expect(u.prefilled).toBe(true);
  });

  it("falls back to current location without a usable pickup, and skips Uber without a drop", () => {
    const u = uber.link({ name: "?", location: { lat: NaN, lon: 0 } }, seg("taxi").destination, "ios")!;
    expect(new URL(u.href).searchParams.get("pickup")).toBe("my_location");
    expect(uber.link(seg("taxi").origin, { name: "?" }, "ios")).toBeNull();
  });

  it("Rapido is never claimed as pre-filled; on Android it targets the app with a Play Store fallback", () => {
    const r = (p: "android" | "desktop") => rideLinks(seg("bike_taxi"), p).find((l) => l.providerId === "rapido")!;
    const a = r("android").href;
    expect(a.startsWith("intent://rapido.bike/#Intent;scheme=https;package=com.rapido.passenger;")).toBe(true);
    expect(decodeURIComponent(a.match(/S\.browser_fallback_url=([^;]+)/)![1])).toBe("https://play.google.com/store/apps/details?id=com.rapido.passenger");
    expect(a.endsWith(";end")).toBe(true);
    expect(r("desktop").href).toBe("https://www.rapido.bike/");
    expect(r("android").prefilled).toBe(false);
  });

  it("offers nothing for walking or transit legs", () => {
    expect(rideLinks(seg("walking"), "desktop")).toEqual([]);
    expect(rideLinks(seg("metro"), "desktop")).toEqual([]);
  });

  it("detects platforms and builds the metro WhatsApp link", () => {
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14)")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0)")).toBe("desktop");
    expect(METRO_WHATSAPP.href).toBe("https://wa.me/919188957488?text=Hi");
  });
});
