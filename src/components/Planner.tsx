"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoutePlanResponse, type Coordinate } from "@/schema/route";
import { istLocalToIso, nowIstLocalInput } from "@/lib/format";
import { loadAvatar, parseAvatar, saveAvatar, type Avatar } from "@/lib/avatar";
import PlaceInput, { type PlaceValue } from "./search/PlaceInput";
import RouteCard from "./routes/RouteCard";
import SegmentList from "./routes/SegmentList";
import RideHud from "./player/RideHud";
import { useDrive, type DriveFrame } from "./player/useDrive";
import Logo from "./brand/Logo";
import type { JourneyMapHandle } from "./map/JourneyMap";

const JourneyMap = dynamic(() => import("./map/JourneyMap"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-[var(--color-muted)]">Loading map…</div>,
});

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

function usePrefersReducedMotion() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setV(m.matches);
    const on = () => setV(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return v;
}

function detectLowPower(): boolean {
  if (typeof navigator === "undefined") return false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return (navigator.hardwareConcurrency ?? 8) <= 4 || (mem !== undefined && mem <= 4);
}

const coordName = (c: Coordinate) => `Pinned ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`;

export default function Planner() {
  const [origin, setOrigin] = useState<PlaceValue | null>(null);
  const [destination, setDestination] = useState<PlaceValue | null>(null);
  const [departMode, setDepartMode] = useState<"now" | "at">("now");
  const [departAt, setDepartAt] = useState("");
  const [bikeTaxi, setBikeTaxi] = useState(true);
  const [plan, setPlan] = useState<RoutePlanResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [selected, setSelected] = useState(0);
  const [pickMode, setPickMode] = useState<"origin" | "destination" | null>(null);
  const [follow, setFollow] = useState(true);
  const [focusSeg, setFocusSeg] = useState<number | null>(null);
  const [lowPower] = useState(detectLowPower);
  const reducedMotion = usePrefersReducedMotion();
  const [avatar, setAvatar] = useState<Avatar>("man");
  const [riding, setRiding] = useState(false);
  const mapRef = useRef<JourneyMapHandle>(null);

  useEffect(() => {
    setDepartAt(nowIstLocalInput());
    // Avatar from the picker (URL) or a previous visit.
    const fromUrl = parseAvatar(new URLSearchParams(window.location.search).get("avatar"));
    const a = fromUrl ?? loadAvatar();
    if (a) {
      setAvatar(a);
      if (fromUrl) saveAvatar(fromUrl);
    }
  }, []);

  const option = plan?.options[selected] ?? null;
  const onFrame = useCallback((f: DriveFrame) => mapRef.current?.frame(f), []);
  const getZoom = useCallback(() => mapRef.current?.zoom() ?? 16, []);
  const drive = useDrive({ option, active: riding, getZoom, onFrame, reducedMotion });
  const activeSegment = riding ? (drive.state?.segment ?? null) : focusSeg;

  // Leaving a ride or switching route returns to the planning view.
  useEffect(() => setRiding(false), [option]);

  // C toggles the follow camera while riding.
  useEffect(() => {
    if (!riding) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== "KeyC" || e.repeat || (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      setFollow((f) => !f);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [riding]);

  const canSearch = !!origin && !!destination && status.kind !== "loading";

  async function search() {
    if (!origin || !destination) return;
    setStatus({ kind: "loading" });
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination,
          departAt: departMode === "at" && departAt ? istLocalToIso(departAt) : undefined,
          accessModes: bikeTaxi ? ["walking", "bike_taxi"] : ["walking"],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      const parsed = RoutePlanResponse.safeParse(json);
      if (!parsed.success) throw new Error("The route service returned data in an unexpected format.");
      setPlan(parsed.data);
      setSelected(0);
      setFocusSeg(null);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }

  const onPick = (c: Coordinate) => {
    const v = { name: coordName(c), location: c };
    if (pickMode === "origin") setOrigin(v);
    else if (pickMode === "destination") setDestination(v);
    setPickMode(null);
  };

  const startRide = () => {
    setFollow(true);
    setRiding(true);
    drive.restart();
    mapRef.current?.recenter();
    // Keyboard controls work from anywhere; drop focus from the button so Space doesn't re-click it.
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const exitRide = () => {
    setRiding(false);
    mapRef.current?.fitOption();
  };

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* Map + player */}
      <section className={`relative shrink-0 transition-[height] md:order-2 md:h-full md:flex-1 ${riding ? "h-[74dvh]" : "h-[48dvh]"}`}>
        <JourneyMap
          ref={mapRef}
          plan={plan}
          selected={selected}
          activeSegment={activeSegment}
          follow={follow && riding}
          reducedMotion={reducedMotion}
          lowPower={lowPower}
          origin={origin?.location}
          destination={destination?.location}
          pickMode={pickMode}
          onPick={onPick}
          avatar={avatar}
        />
        {pickMode && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="rounded-full bg-slate-900/90 px-3 py-1.5 text-xs text-white shadow">
              Click the map to set {pickMode === "origin" ? "the start (A)" : "the destination (B)"}
            </div>
          </div>
        )}
        {option && drive.timeline && drive.state && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 md:inset-x-auto md:bottom-4 md:left-4 md:w-[min(620px,calc(100%-2rem))]">
            {riding ? (
              <div className="relative">
                <RideHud
                  option={option}
                  timeline={drive.timeline}
                  state={drive.state}
                  time={drive.time}
                  gate={drive.gate}
                  auto={drive.auto}
                  moving={drive.moving}
                  rate={drive.rate}
                  follow={follow}
                  onPress={drive.press}
                  onToggleAuto={drive.toggleAuto}
                  onContinue={drive.continueGate}
                  onRestart={() => {
                    drive.restart();
                    mapRef.current?.recenter();
                  }}
                  onJump={(i) => {
                    drive.jumpToSegment(i);
                    mapRef.current?.recenter();
                  }}
                  onFollow={(f) => {
                    setFollow(f);
                    if (f) mapRef.current?.recenter();
                  }}
                  onRecenter={() => mapRef.current?.recenter()}
                  onExit={exitRide}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={startRide}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[var(--brand-ink)] px-5 py-2.5 font-[family-name:var(--font-display)] text-base font-bold text-white shadow-[0_5px_0_0_#0d9488] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_0_#0d9488]"
              >
                ▶ Ride this route
                <span className="hidden text-xs font-medium opacity-70 [@media(pointer:fine)]:inline">· drive with W A S D</span>
              </button>
            )}
          </div>
        )}
      </section>

      {/* Planner panel */}
      <aside className="flex min-h-0 flex-1 flex-col border-[var(--color-line)] bg-[var(--color-panel)] md:order-1 md:w-[400px] md:flex-none md:border-r">
        <header className="px-4 pb-2 pt-4">
          <h1 className="flex items-center justify-between gap-2 text-2xl">
            <Link href="/" aria-label="Skootayiko home" className="[--brand-ink:var(--color-ink)]">
              <Logo />
            </Link>
            <Link
              href="/avatar"
              className="rounded-full border border-[var(--color-line)] px-2.5 py-1 font-sans text-xs font-medium text-[var(--color-muted)] hover:border-slate-400"
              title="Change traveller"
            >
              Riding as {avatar === "man" ? "Man" : "Woman"} · change
            </Link>
          </h1>
        </header>

        <form
          className="space-y-2 px-4 pb-3"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <PlaceInput
            label="From"
            marker="A"
            value={origin}
            onChange={setOrigin}
            picking={pickMode === "origin"}
            onPickOnMap={() => setPickMode(pickMode === "origin" ? null : "origin")}
          />
          <PlaceInput
            label="To"
            marker="B"
            value={destination}
            onChange={setDestination}
            picking={pickMode === "destination"}
            onPickOnMap={() => setPickMode(pickMode === "destination" ? null : "destination")}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setOrigin(destination);
                setDestination(origin);
              }}
              className="rounded-md px-2 py-1 hover:bg-slate-500/10"
            >
              ⇅ Swap
            </button>
            <select
              aria-label="Departure"
              value={departMode}
              onChange={(e) => setDepartMode(e.target.value as "now" | "at")}
              className="rounded-md border border-[var(--color-line)] bg-transparent px-2 py-1"
            >
              <option value="now">Leave now</option>
              <option value="at">Leave at…</option>
            </select>
            {departMode === "at" && (
              <input
                type="datetime-local"
                aria-label="Departure time (IST)"
                value={departAt}
                onChange={(e) => setDepartAt(e.target.value)}
                className="rounded-md border border-[var(--color-line)] bg-transparent px-2 py-1"
              />
            )}
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={bikeTaxi} onChange={(e) => setBikeTaxi(e.target.checked)} className="accent-teal-600" />
              Bike taxi to/from metro
            </label>
          </div>
          <button
            type="submit"
            disabled={!canSearch}
            className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status.kind === "loading" ? "Finding routes…" : "Find routes"}
          </button>
        </form>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-6">
          {status.kind === "error" && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {status.message}
            </div>
          )}

          {status.kind === "loading" && (
            <div className="space-y-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-500/10" />
              ))}
            </div>
          )}

          {!plan && status.kind === "idle" && (
            <p className="text-sm text-[var(--color-muted)]">
              Search two places in Kochi (or pick them on the map) to compare metro, bus, boat, bike-taxi, auto and taxi options by
              estimated time and cost.
            </p>
          )}

          {plan && status.kind !== "loading" && (
            <>
              {(plan.mock || (plan.dataWarnings?.length ?? 0) > 0) && (
                <details className="rounded-xl border border-amber-300/60 bg-[var(--color-warn-bg)] p-3 text-xs text-[var(--color-warn)]">
                  <summary className="cursor-pointer font-semibold">
                    {plan.mock ? "Sample data" : "Data limitations"} ({plan.dataWarnings?.length ?? 0})
                  </summary>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4">
                    {plan.dataWarnings?.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}

              {plan.options.length === 0 ? (
                <p className="rounded-xl border border-[var(--color-line)] p-3 text-sm">No routes found for this trip.</p>
              ) : (
                <div className="space-y-2" role="list" aria-label="Route options">
                  {plan.options.map((o, i) => (
                    <div role="listitem" key={o.id}>
                      <RouteCard
                        option={o}
                        selected={i === selected}
                        onSelect={() => {
                          setSelected(i);
                          setFocusSeg(null);
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {option && (
                <section aria-label="Journey steps" className="pt-1">
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Steps</h2>
                  <SegmentList
                    option={option}
                    active={activeSegment}
                    onFocus={(i) => {
                      setFocusSeg(i);
                      if (riding) {
                        drive.jumpToSegment(i);
                        mapRef.current?.recenter();
                      }
                      else mapRef.current?.focusSegment(i);
                    }}
                  />
                  {(option.assumptions?.length ?? 0) + (option.warnings?.length ?? 0) > 0 && (
                    <details className="mt-2 text-xs text-[var(--color-muted)]">
                      <summary className="cursor-pointer">How this was estimated</summary>
                      <ul className="mt-1 list-disc space-y-1 pl-4">
                        {[...(option.warnings ?? []), ...(option.assumptions ?? [])].map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              )}

              <footer className="border-t border-[var(--color-line)] pt-2 text-[11px] text-[var(--color-muted)]">
                Sources: {plan.provenance.map((p) => p.name + (p.expired ? " (expired)" : "")).join(" · ")}. Times and fares are
                estimates, not live data. <a className="underline" href="/about">About &amp; attribution</a>
              </footer>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
