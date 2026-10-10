"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  Map as MlMap,
  Marker,
  LngLatBounds,
  NavigationControl,
  AttributionControl,
  type GeoJSONSource,
  setWorkerUrl,
  type StyleSpecification,
  type ExpressionSpecification,
} from "maplibre-gl";
import type { Coordinate, RouteOption, RoutePlanResponse } from "@/schema/route";
import { MODE_STYLE } from "@/lib/modes";
import { pathSampler } from "@/lib/journey";
import type { Suggestion } from "@/schema/suggest";
import type { Avatar } from "@/lib/avatar";
import type { MetroNetwork } from "@/lib/metro";
import { JourneyLayer } from "@/components/scene/JourneyLayer";
import { closeZoom, type DriveFrame } from "@/components/player/useDrive";

export interface JourneyMapHandle {
  /** Called every animation frame by the drive loop. */
  frame(f: DriveFrame): void;
  /** Current zoom (drive speed scales with it). */
  zoom(): number;
  /** Fly back to a close-up of the rider. */
  recenter(): void;
  fitOption(): void;
  focusSegment(i: number): void;
  /** Fly to a point of interest. */
  focusPoint(c: Coordinate): void;
}

export interface StopMarker {
  location: Coordinate;
  label: string;
  color: string;
}

interface Props {
  ref?: Ref<JourneyMapHandle>;
  plan: RoutePlanResponse | null;
  selected: number;
  activeSegment: number | null;
  follow: boolean;
  reducedMotion: boolean;
  lowPower: boolean;
  /** Lettered pins for each filled-in stop (A, B, C …). */
  stopMarkers: StopMarker[];
  /** Sights offered along the route, shown as small amber pins. */
  suggestions: Suggestion[];
  /** True while the next map click should set a stop. */
  pickMode: boolean;
  onPick(c: Coordinate): void;
  avatar: Avatar;
}

setWorkerUrl("/vendor/maplibre-gl-worker.mjs");

const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || "streets-v2";
const CENTER: [number, number] = [
  Number(process.env.NEXT_PUBLIC_MAP_CENTER_LON || 76.2999),
  Number(process.env.NEXT_PUBLIC_MAP_CENTER_LAT || 9.9816),
];
const ZOOM = Number(process.env.NEXT_PUBLIC_MAP_ZOOM || 11);

/** Used only when no MapTiler key is configured (development). */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/** After a manual orbit, wait this long before the chase camera swings back behind the rider. */
const CHASE_DELAY_MS = 2500;
const ORBIT_DEG_PER_S = 110;

function optionFeatures(option: RouteOption, idxOffset = 0) {
  return option.segments.map((s, i) => ({
    type: "Feature" as const,
    properties: { idx: i + idxOffset, color: MODE_STYLE[s.mode].color, dashed: s.mode === "walking" },
    geometry: {
      type: "LineString" as const,
      coordinates: (s.geometry.length >= 2 ? s.geometry : [s.origin.location, s.destination.location]).map((c) => [c.lon, c.lat]),
    },
  }));
}

function stopFeatures(option: RouteOption) {
  const feats: GeoJSON.Feature[] = [];
  option.segments.forEach((s, i) => {
    if (i === 0) return;
    feats.push({
      type: "Feature",
      properties: { name: s.origin.name, color: MODE_STYLE[s.mode].color },
      geometry: { type: "Point", coordinates: [s.origin.location.lon, s.origin.location.lat] },
    });
  });
  return feats;
}

function bboxOf(option: RouteOption): LngLatBounds {
  const b = new LngLatBounds();
  for (const s of option.segments) {
    for (const c of s.geometry.length ? s.geometry : [s.origin.location, s.destination.location]) b.extend([c.lon, c.lat]);
  }
  return b;
}

/** Kerala-pastel wall colours for painted facades; the last is a glassy tower facade. */
const WALLS = ["#f8c8a8", "#f6a5a0", "#ffd98a", "#a9dfc8", "#a9cbee", "#cdb9e8", "#f3e3c3", "#bfe3a4"];
const GLASS_WALL = "#b9d4e3";

/** Buildings arrive merged per tile, so variety comes from id + height buckets. */
const pick = (n: number) => ["%", ["+", ["to-number", ["coalesce", ["id"], 0]], ["round", ["*", ["coalesce", ["get", "render_height"], 6], 1.7]]], n];
const FACADE_PATTERN = [
  "case",
  [">", ["coalesce", ["get", "render_height"], 0], 28],
  "facade-glass",
  ["match", pick(WALLS.length), ...WALLS.flatMap((_, i) => [i, `facade-${i}`]).slice(0, -2), `facade-${WALLS.length - 1}`],
] as unknown as ExpressionSpecification;
const ROOF_COLOR = [
  "match",
  pick(6),
  0, "#c2552d",
  1, "#b5482a",
  2, "#d0683c",
  3, "#f8fafc",
  4, "#5eb3a8",
  "#a8432a",
] as unknown as ExpressionSpecification;

/** Draws a 64×64 facade tile: painted wall, two storeys of windows with sills and a floor band. */
function facadeImage(wall: string, glass: boolean): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = wall;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "rgba(0,0,0,0.06)";
  g.fillRect(0, 30, 64, 3); // floor band
  for (const y of [6, 38]) {
    for (const x of glass ? [4, 20, 36, 52] : [9, 37]) {
      const w = glass ? 10 : 18;
      const h = glass ? 20 : 16;
      g.fillStyle = glass ? "#6aa6c4" : "#4f7f96";
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(x, y, w, h * 0.35); // sky reflection
      if (!glass) {
        g.fillStyle = "rgba(255,255,255,0.85)";
        g.fillRect(x - 2, y + h, w + 4, 2); // sill
      }
    }
  }
  return g.getImageData(0, 0, 64, 64);
}

function registerFacades(map: MlMap) {
  WALLS.forEach((w, i) => {
    if (!map.hasImage(`facade-${i}`)) map.addImage(`facade-${i}`, facadeImage(w, false), { pixelRatio: 2 });
  });
  if (!map.hasImage("facade-glass")) map.addImage("facade-glass", facadeImage(GLASS_WALL, true), { pixelRatio: 2 });
}

const METRO_TEAL = "#0d9488";

/**
 * Kochi Metro Line 1 is always on the map: a teal line with white casing and named stations
 * in 2D, and (via the 3D layer) the elevated viaduct and station blocks. It sits beneath the
 * route layers so it never covers the journey being ridden.
 */
async function addMetroNetwork(map: MlMap, layer: JourneyLayer) {
  let data: MetroNetwork;
  try {
    const res = await fetch("/api/metro");
    if (!res.ok) return;
    data = (await res.json()) as MetroNetwork;
  } catch {
    return;
  }
  if (!map.getStyle()) return;
  layer.setMetro(data);
  map.addSource("metro", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: data.line.map((c) => [c.lon, c.lat]) } },
        ...data.stations.map((st) => ({
          type: "Feature" as const,
          properties: { name: st.name },
          geometry: { type: "Point" as const, coordinates: [st.lon, st.lat] },
        })),
      ],
    },
  });
  const before = map.getLayer("alt-line") ? "alt-line" : undefined;
  const lineOpacity = ["interpolate", ["linear"], ["zoom"], 14, 0.9, 16.5, 0.35] as unknown as ExpressionSpecification;
  map.addLayer(
    {
      id: "metro-casing",
      type: "line",
      source: "metro",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 9], "line-opacity": lineOpacity },
    },
    before,
  );
  map.addLayer(
    {
      id: "metro-line",
      type: "line",
      source: "metro",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": METRO_TEAL, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 15, 5], "line-opacity": lineOpacity },
    },
    before,
  );
  map.addLayer(
    {
      id: "metro-stations",
      type: "circle",
      source: "metro",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 15, 6],
        "circle-color": "#ffffff",
        "circle-stroke-color": METRO_TEAL,
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 15, 3],
      },
    },
    before,
  );
  if (KEY) {
    map.addLayer(
      {
        id: "metro-labels",
        type: "symbol",
        source: "metro",
        filter: ["==", ["geometry-type"], "Point"],
        minzoom: 11.5,
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Roboto Medium", "Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 11.5, 10, 16, 13],
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: { "text-color": "#0f766e", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
      },
      before,
    );
  }
}

/** Warmer, greener, bluer basemap plus a tropical sky and golden light. */
function paintBasemap(map: MlMap) {
  const set = (id: string, prop: string, value: unknown) => {
    try {
      map.setPaintProperty(id, prop as "fill-color", value as string);
    } catch {
      /* layer may not support the property */
    }
  };
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id.toLowerCase();
    // The style ships its own grey 3D buildings; ours (colourful) replace them.
    if (layer.type === "fill-extrusion") map.setLayoutProperty(layer.id, "visibility", "none");
    else if (layer.type === "background") set(layer.id, "background-color", "#f6efdf");
    else if (layer.type === "fill" && /water|ocean|river|lake|sea/.test(id)) set(layer.id, "fill-color", "#7fcfe0");
    else if (layer.type === "line" && /water|river|stream|canal/.test(id)) set(layer.id, "line-color", "#6cc3d8");
    else if (layer.type === "fill" && /park|grass|wood|forest|meadow|scrub|farmland|garden|landcover|green|cemetery/.test(id))
      set(layer.id, "fill-color", "#b8e2a0");
    else if (layer.type === "fill" && /residential|landuse/.test(id)) set(layer.id, "fill-color", "#f3e9d4");
    else if (layer.type === "fill" && /^building/.test(id)) set(layer.id, "fill-color", "#ead9c2");
  }
  try {
    map.setSky({
      "sky-color": "#8fd3ef",
      "horizon-color": "#ffe6c4",
      "fog-color": "#f6efdf",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.35,
      "atmosphere-blend": 0.6,
    });
  } catch {
    /* sky unsupported */
  }
  map.setLight({ anchor: "viewport", color: "#fff1d6", intensity: 0.42, position: [1.4, 205, 35] });
}

/* ---------------------------------------------------------------- Streets */

/** Zoom where our real-width streets take over from the basemap's thin road lines. */
const STREET_ZOOM = 15;
/** Screen pixels per metre at Kochi's latitude (~10° N) for a given zoom: 512·2^z / (C·cos φ). */
const PX_PER_M_Z15 = 0.4251;
const PX_PER_M_Z24 = 217.65;
/** Typical carriageway width (m) by OpenMapTiles road class. */
const ROAD_WIDTH_M: unknown = [
  "match",
  ["get", "class"],
  "motorway", 16,
  "trunk", 14,
  "primary", 12,
  "secondary", 10,
  "tertiary", 8.5,
  "minor", 6.5,
  "service", 4.5,
  "track", 3.5,
  6,
];
/** Metres → pixels, exact at every zoom from STREET_ZOOM up (exponential base 2). */
const metres = (m: unknown) => ["interpolate", ["exponential", 2], ["zoom"], STREET_ZOOM, ["*", m, PX_PER_M_Z15], 24, ["*", m, PX_PER_M_Z24]];
const VEHICLE_ROADS = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"];
const MARKED_ROADS = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const notTunnel = ["!=", ["get", "brunnel"], "tunnel"];
const isLine = ["==", ["geometry-type"], "LineString"];
const fadeIn = ["interpolate", ["linear"], ["zoom"], STREET_ZOOM, 0, STREET_ZOOM + 0.6, 1];

/**
 * Real-width streets from the vector tiles: kerb/footpath strip, asphalt, white edge lines and a dashed
 * centre line on marked roads, and sandy footpaths. Drawn under labels and 3D buildings (so buildings
 * hide them), and only from STREET_ZOOM up; the basemap's own thin road lines are kept for zoomed-out views.
 */
function addStreets(map: MlMap, src: string, before?: string) {
  for (const layer of map.getStyle().layers ?? []) {
    const l = layer as { id: string; type: string; "source-layer"?: string; minzoom?: number };
    if (l.type !== "line" || l["source-layer"] !== "transportation") continue;
    if (/rail|ferry|cable|tunnel|construction|pier/i.test(l.id)) continue;
    map.setLayerZoomRange(l.id, l.minzoom ?? 0, STREET_ZOOM + 0.6);
  }
  const base = { type: "line" as const, source: src, "source-layer": "transportation", minzoom: STREET_ZOOM };
  const roads = ["all", isLine, notTunnel, ["in", ["get", "class"], ["literal", VEHICLE_ROADS]]];
  const marked = ["all", isLine, notTunnel, ["in", ["get", "class"], ["literal", MARKED_ROADS]]];
  const paths = ["all", isLine, notTunnel, ["in", ["get", "class"], ["literal", ["path", "pedestrian"]]]];
  const add = (spec: object) => map.addLayer(spec as never, before);
  add({
    ...base,
    id: "street-path",
    filter: paths,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#e2cfa3", "line-width": metres(2.4), "line-opacity": fadeIn },
  });
  // Footpath / kerb strip either side of the carriageway.
  add({
    ...base,
    id: "street-kerb",
    filter: roads,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#d4cdbd", "line-width": metres(["+", ROAD_WIDTH_M, 3]), "line-opacity": fadeIn },
  });
  add({
    ...base,
    id: "street-asphalt",
    filter: roads,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["match", ["get", "class"], ["service", "track"], "#6f7379", "#565b63"], "line-width": metres(ROAD_WIDTH_M), "line-opacity": fadeIn },
  });
  // Edge lines: a thin line drawn either side of a gap the width of the carriageway.
  add({
    ...base,
    id: "street-edge",
    minzoom: 16.5,
    filter: marked,
    layout: { "line-join": "round" },
    paint: {
      "line-color": "#eeeee6",
      "line-width": metres(0.15),
      "line-gap-width": metres(["-", ROAD_WIDTH_M, 1]),
      "line-opacity": 0.75,
    },
  });
  add({
    ...base,
    id: "street-centre",
    minzoom: 16,
    filter: marked,
    layout: { "line-join": "round" },
    paint: {
      "line-color": "#f5f2e6",
      "line-width": ["interpolate", ["exponential", 2], ["zoom"], 16, 1, 24, 0.15 * PX_PER_M_Z24],
      "line-dasharray": [4, 4],
      "line-opacity": 0.9,
    },
  });
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export default function JourneyMap(props: Props) {
  const { ref, plan, selected, activeSegment, follow, reducedMotion, lowPower, stopMarkers, suggestions, pickMode, onPick, avatar } =
    props;
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const layerRef = useRef<JourneyLayer | null>(null);
  const [ready, setReady] = useState(false);
  const markers = useRef<Marker[]>([]);
  const pins = useRef<Marker[]>([]);
  const cam = useRef({ segment: -1, easeUntil: 0, lastManual: 0, lon: 0, lat: 0 });
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const followRef = useRef(follow);
  followRef.current = follow;
  const pickRef = useRef({ pickMode, onPick });
  pickRef.current = { pickMode, onPick };
  const option = plan?.options[selected] ?? null;
  const samplers = useMemo(() => option?.segments.map((s) => pathSampler(s)) ?? [], [option]);

  // Create map once.
  useEffect(() => {
    if (!el.current) return;
    const map = new MlMap({
      container: el.current,
      style: KEY ? `https://api.maptiler.com/maps/${STYLE}/style.json?key=${KEY}` : FALLBACK_STYLE,
      center: CENTER,
      zoom: ZOOM,
      maxPitch: 85,
      maxZoom: 23.5,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2),
      canvasContextAttributes: { antialias: !lowPower },
    });
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => {
      paintBasemap(map);
      // 3D buildings from the MapTiler vector source, if the style has one.
      const src = ["maptiler_planet", "openmaptiles"].find((s) => map.getSource(s));
      if (src) {
        registerFacades(map);
        const height = ["coalesce", ["get", "render_height"], 6];
        const opacity = ["interpolate", ["linear"], ["zoom"], 15, 0.95, 18.5, 0.62, 21, 0.4];
        map.addLayer({
          id: "buildings-3d",
          type: "fill-extrusion",
          source: src,
          "source-layer": "building",
          minzoom: 14,
          paint: {
            "fill-extrusion-pattern": FACADE_PATTERN,
            "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 14, 0, 15, height],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-vertical-gradient": true,
            "fill-extrusion-opacity": opacity,
          } as never,
        });
        // Roof caps: Kerala clay-tile terracotta with some white and teal terraces.
        map.addLayer({
          id: "buildings-roof",
          type: "fill-extrusion",
          source: src,
          "source-layer": "building",
          minzoom: 15,
          paint: {
            "fill-extrusion-color": ROOF_COLOR,
            "fill-extrusion-base": height,
            "fill-extrusion-height": ["+", height, 0.5],
            "fill-extrusion-opacity": opacity,
          } as never,
        });
        // Below the basemap's labels so street names stay readable.
        addStreets(map, src, map.getStyle().layers?.find((l) => l.type === "symbol")?.id);
      }
      // Route lines sit on the ground under the 3D buildings, so a building in front hides the line
      // instead of the line being painted across it.
      const under = map.getLayer("buildings-3d") ? "buildings-3d" : undefined;
      map.addSource("alt", { type: "geojson", data: EMPTY });
      map.addSource("route", { type: "geojson", data: EMPTY });
      map.addSource("stops", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "alt-line",
        type: "line",
        source: "alt",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#94a3b8", "line-width": 3, "line-opacity": 0.5 },
      }, under);
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["boolean", ["feature-state", "active"], false], 26, 16],
          "line-blur": 10,
          "line-opacity": ["case", ["boolean", ["feature-state", "dim"], false], 0.12, 0.38],
        },
      }, under);
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        filter: ["!", ["get", "dashed"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": ["case", ["boolean", ["feature-state", "active"], false], 11, 8] },
      }, under);
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        filter: ["!", ["get", "dashed"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["boolean", ["feature-state", "active"], false], 7, 5],
          "line-opacity": ["case", ["boolean", ["feature-state", "dim"], false], 0.45, 1],
        },
      }, under);
      map.addLayer({
        id: "route-walk",
        type: "line",
        source: "route",
        filter: ["get", "dashed"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["boolean", ["feature-state", "active"], false], 5, 3.5],
          "line-dasharray": [0.1, 2],
        },
      }, under);
      map.addLayer({
        id: "stops",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8],
          "circle-color": "#ffffff",
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 4],
          "circle-stroke-color": ["get", "color"],
        },
      });
      const layer = new JourneyLayer(lowPower, avatarRef.current);
      map.addLayer(layer);
      layerRef.current = layer;
      addMetroNetwork(map, layer);
      setReady(true);
    });
    map.on("click", (e) => {
      const { pickMode: pm, onPick: cb } = pickRef.current;
      if (pm) cb({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    // Free look while following: one-finger / left-button drag orbits around the rider.
    // (Map panning is disabled in follow mode, so the rider stays centred.)
    const container = map.getCanvasContainer();
    const pointers = new Map<number, { x: number; y: number }>();
    const down = (e: PointerEvent) => {
      if (!followRef.current || (e.pointerType === "mouse" && e.button !== 0)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p || !followRef.current || pointers.size > 1) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      map.setBearing(map.getBearing() - dx * 0.35);
      map.setPitch(Math.max(0, Math.min(85, map.getPitch() - dy * 0.3)));
      cam.current.lastManual = performance.now();
    };
    const up = (e: PointerEvent) => pointers.delete(e.pointerId);
    container.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    map.on("rotatestart", () => (cam.current.lastManual = performance.now()));
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __map?: MlMap }).__map = map;
    return () => {
      setReady(false);
      container.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = pickMode ? "crosshair" : follow ? "grab" : "";
  }, [pickMode, follow]);

  // Follow mode: the rider stays centred; zoom and rotate happen around it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (follow) {
      map.dragPan.disable();
      map.keyboard.disable();
      map.scrollZoom.enable({ around: "center" });
      map.touchZoomRotate.enable({ around: "center" });
      map.doubleClickZoom.disable();
      cam.current.segment = -1; // fly in on next frame
    } else {
      map.dragPan.enable();
      map.keyboard.enable();
      map.scrollZoom.enable();
      map.touchZoomRotate.enable();
      map.doubleClickZoom.enable();
    }
  }, [follow, ready]);

  useEffect(() => layerRef.current?.setAvatar(avatar), [avatar, ready]);

  // Lettered stop markers (A, B, C …).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markers.current.forEach((m) => m.remove());
    markers.current = stopMarkers.map((s) => {
      const node = document.createElement("div");
      node.className = "grid place-items-center rounded-full text-[11px] font-bold text-white shadow-md ring-2 ring-white";
      node.style.cssText = `width:24px;height:24px;background:${s.color}`;
      node.textContent = s.label;
      return new Marker({ element: node }).setLngLat([s.location.lon, s.location.lat]).addTo(map);
    });
  }, [stopMarkers]);

  // Suggested sights along the route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pins.current.forEach((m) => m.remove());
    pins.current = suggestions.map((s) => {
      const node = document.createElement("div");
      node.className = "grid place-items-center rounded-full text-[11px] text-white shadow ring-2 ring-white";
      node.style.cssText = "width:20px;height:20px;background:#d97706";
      node.textContent = "★";
      node.title = s.name;
      return new Marker({ element: node }).setLngLat([s.location.lon, s.location.lat]).addTo(map);
    });
  }, [suggestions]);

  // Route lines for the selected option and faint alternatives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const alts = (plan?.options ?? []).filter((_, i) => i !== selected).flatMap((o) => optionFeatures(o));
    (map.getSource("alt") as GeoJSONSource).setData({ type: "FeatureCollection", features: alts });
    (map.getSource("route") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: option ? optionFeatures(option).map((f, i) => ({ ...f, id: i })) : [],
    });
    (map.getSource("stops") as GeoJSONSource).setData({ type: "FeatureCollection", features: option ? stopFeatures(option) : [] });
    layerRef.current?.setJourney(option);
    cam.current.segment = -1;
    if (option) map.fitBounds(bboxOf(option), { padding: 60, duration: reducedMotion ? 0 : 800, pitch: 0, bearing: 0 });
  }, [plan, selected, option, ready, reducedMotion]);

  // Highlight the active segment.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !option) return;
    option.segments.forEach((_, i) =>
      map.setFeatureState(
        { source: "route", id: i },
        { active: activeSegment === i, dim: activeSegment !== null && activeSegment !== i },
      ),
    );
  }, [activeSegment, option, ready]);

  useImperativeHandle(
    ref,
    () => ({
      frame(f) {
        const map = mapRef.current;
        if (!map || !option) return;
        layerRef.current?.setState(f.state, { moving: f.moving, pace: f.pace });
        if (!followRef.current) return;
        const seg = option.segments[f.state.segment];
        const sampler = samplers[f.state.segment];
        // A frame from the previous route can arrive right after switching routes.
        if (!seg || !sampler) return;
        const at = sampler.at(f.state.kind === "wait" ? 0 : f.state.progress);
        const now = performance.now();
        if (f.scrub) {
          // Dragging the progress bar: track the rider immediately, keep the user's zoom and view angle.
          cam.current.segment = f.state.segment;
          cam.current.easeUntil = 0;
          cam.current.lon = at.point.lon;
          cam.current.lat = at.point.lat;
          map.stop();
          map.jumpTo({ center: [at.point.lon, at.point.lat] });
          return;
        }
        if (cam.current.segment !== f.state.segment) {
          // New leg: swoop into a close-up behind the rider.
          cam.current.segment = f.state.segment;
          const dur = reducedMotion ? 0 : 1400;
          cam.current.easeUntil = now + dur;
          cam.current.lon = at.point.lon;
          cam.current.lat = at.point.lat;
          map.easeTo({ center: [at.point.lon, at.point.lat], zoom: closeZoom(seg.mode), pitch: 68, bearing: at.bearing, duration: dur });
          return;
        }
        if (now < cam.current.easeUntil) return;
        let bearing = map.getBearing();
        if (f.orbit) {
          bearing += f.orbit * ORBIT_DEG_PER_S * f.dt;
          cam.current.lastManual = now;
        } else if (f.moving && !reducedMotion && now - cam.current.lastManual > CHASE_DELAY_MS) {
          // Chase camera: drift back behind the direction of travel.
          let d = at.bearing - bearing;
          d = ((d + 540) % 360) - 180;
          bearing += d * Math.min(1, f.dt * 1.8);
        }
        const moved = Math.abs(at.point.lon - cam.current.lon) + Math.abs(at.point.lat - cam.current.lat) > 1e-9;
        if (moved || Math.abs(bearing - map.getBearing()) > 0.01) {
          cam.current.lon = at.point.lon;
          cam.current.lat = at.point.lat;
          map.jumpTo({ center: [at.point.lon, at.point.lat], bearing });
        }
      },
      zoom() {
        return mapRef.current?.getZoom() ?? 16;
      },
      recenter() {
        cam.current.segment = -1;
      },
      fitOption() {
        const map = mapRef.current;
        if (map && option) map.fitBounds(bboxOf(option), { padding: 60, duration: reducedMotion ? 0 : 800, pitch: 0, bearing: 0 });
      },
      focusPoint(c) {
        mapRef.current?.flyTo({ center: [c.lon, c.lat], zoom: Math.max(mapRef.current.getZoom(), 15), duration: reducedMotion ? 0 : 700 });
      },
      focusSegment(i) {
        const map = mapRef.current;
        const seg = option?.segments[i];
        if (!map || !seg) return;
        const b = new LngLatBounds();
        for (const c of seg.geometry.length ? seg.geometry : [seg.origin.location, seg.destination.location]) b.extend([c.lon, c.lat]);
        map.fitBounds(b, { padding: 80, maxZoom: 17, duration: reducedMotion ? 0 : 600 });
      },
    }),
    [option, samplers, reducedMotion],
  );

  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full" aria-label="Route map" role="region" />
      {!KEY && (
        <div className="absolute left-2 top-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 shadow">
          NEXT_PUBLIC_MAPTILER_KEY not set — using basic OpenStreetMap tiles.
        </div>
      )}
    </div>
  );
}
