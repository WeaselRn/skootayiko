"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoutePlanResponse, type Coordinate } from "@/schema/route";
import type { Suggestion } from "@/schema/suggest";
import { ItineraryResponse } from "@/schema/itinerary";
import { simplify } from "@/server/geo";
import { DEFAULT_INTERESTS } from "@/lib/interests";
import { MAX_STOPS, newStop, stopLetter, stopsKey, stopTone, TONE_COLOR, type Stop } from "@/lib/stops";
import { istLocalToIso, nowIstLocalInput } from "@/lib/format";
import { loadAvatar, parseAvatar, saveAvatar, type Avatar } from "@/lib/avatar";
import StopsEditor from "./search/StopsEditor";
import SightsPanel from "./search/SightsPanel";
import DayPanel, { type Pace, type Prefer } from "./itinerary/DayPanel";
import Timeline from "./itinerary/Timeline";
import { useSuggestions } from "./search/useSuggestions";
import RouteCard from "./routes/RouteCard";
import SegmentList from "./routes/SegmentList";
import RideHud from "./player/RideHud";
import { useDrive, type DriveFrame } from "./player/useDrive";
import Logo from "./brand/Logo";
import type { JourneyMapHandle, StopMarker } from "./map/JourneyMap";

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
  const [mode, setMode] = useState<"route" | "day">("route");
  const [stops, setStops] = useState<Stop[]>(() => [newStop(), newStop()]);
  const [planKey, setPlanKey] = useState("");
  const [sightsOn, setSightsOn] = useState(false);
  const [interests, setInterests] = useState<string[]>(DEFAULT_INTERESTS);
  const [maxOffRouteM, setMaxOffRouteM] = useState(1000);
  const [departMode, setDepartMode] = useState<"now" | "at">("now");
  const [departAt, setDepartAt] = useState("");
  const [bikeTaxi, setBikeTaxi] = useState(true);
  const [plan, setPlan] = useState<RoutePlanResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [selected, setSelected] = useState(0);
  const [pickId, setPickId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [focusSeg, setFocusSeg] = useState<number | null>(null);
  const [lowPower] = useState(detectLowPower);
  const reducedMotion = usePrefersReducedMotion();
  const [avatar, setAvatar] = useState<Avatar>("man");
  const [riding, setRiding] = useState(false);
  // "Plan my day" inputs and result.
  const [budgetMin, setBudgetMin] = useState(240);
  const [pace, setPace] = useState<Pace>("normal");
  const [lunch, setLunch] = useState(true);
  const [prefer, setPrefer] = useState<Prefer>("fastest");
  const [dayInterests, setDayInterests] = useState<string[]>(["sights", "heritage", "museums", "beaches"]);
  const [mustSee, setMustSee] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [itinerary, setItinerary] = useState<ItineraryResponse | null>(null);
  const [dayKey, setDayKey] = useState("");
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

  const origin = stops[0].value;
  const destination = stops[stops.length - 1].value;
  const dayMode = mode === "day";
  const canSearch = !!origin && (dayMode ? dayInterests.length > 0 || stops.slice(1, -1).some((s) => s.value) : !!destination) && status.kind !== "loading";
  const filled = useMemo(() => stops.filter((s) => s.value), [stops]);
  const curKey = stopsKey(stops);
  const dayInputsKey = `${curKey}|${budgetMin}|${departAt}|${dayInterests.join(",")}|${pace}|${lunch}|${prefer}`;
  const planStale = dayMode ? !!itinerary && dayKey !== dayInputsKey : !!plan && planKey !== curKey;

  const stopMarkers = useMemo<StopMarker[]>(() => {
    // A planned day shows its own order: start, chosen sights, end.
    if (dayMode && itinerary && origin) {
      const pts = [origin.location, ...itinerary.stops.map((s) => s.location), (destination ?? origin).location];
      return pts.map((location, i) => ({ location, label: stopLetter(i), color: TONE_COLOR[stopTone(i, pts.length)] }));
    }
    return stops.flatMap((s, i) =>
      s.value ? [{ location: s.value.location, label: stopLetter(i), color: TONE_COLOR[stopTone(i, stops.length)] }] : [],
    );
  }, [stops, dayMode, itinerary, origin, destination]);

  // Sights along the route: follow the real route once a plan matches the form, else straight lines between stops.
  const routePath = useMemo(() => {
    if (!option || planStale) return undefined;
    const pts = option.segments.flatMap((s) => s.geometry);
    let out = simplify(pts, 40);
    if (out.length > 400) out = out.filter((_, i) => i % Math.ceil(out.length / 400) === 0);
    return out;
  }, [option, planStale]);
  const sights = useSuggestions({
    enabled: sightsOn && !dayMode,
    stops: filled.map((s) => s.value!.location),
    path: routePath,
    interests,
    maxOffRouteM,
  });
  const sightItems = useMemo(
    () =>
      dayMode
        ? (itinerary?.dropped.filter((d) => d.reason !== "removed" && d.reason !== "closed").map((d) => d.sight) ?? [])
        : sights.kind === "off"
          ? []
          : sights.items,
    [dayMode, itinerary, sights],
  );

  const addSight = (s: Suggestion) => {
    if (stops.length >= MAX_STOPS) return;
    // `afterStop` counts filled-in stops; find where that sits in the full list.
    const anchor = stops.indexOf(filled[Math.min(s.afterStop, filled.length - 1)]);
    const at = anchor + 1;
    const next = [...stops];
    next.splice(at, 0, newStop({ name: s.name, location: s.location }));
    setStops(next);
  };

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
          via: stops
            .slice(1, -1)
            .flatMap((s) => (s.value ? [s.value] : [])),
          departAt: departMode === "at" && departAt ? istLocalToIso(departAt) : undefined,
          accessModes: bikeTaxi ? ["walking", "bike_taxi"] : ["walking"],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      const parsed = RoutePlanResponse.safeParse(json);
      if (!parsed.success) throw new Error("The route service returned data in an unexpected format.");
      setPlan(parsed.data);
      setPlanKey(curKey);
      setSelected(0);
      setFocusSeg(null);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }

  async function planDay(over: { mustSee?: string[]; exclude?: string[] } = {}) {
    if (!origin) return;
    const ms = over.mustSee ?? mustSee;
    const ex = over.exclude ?? exclude;
    setMustSee(ms);
    setExclude(ex);
    setStatus({ kind: "loading" });
    try {
      const res = await fetch("/api/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: origin,
          end: destination ?? undefined,
          startAt: departAt ? istLocalToIso(departAt) : undefined,
          budgetMin,
          interests: dayInterests.length ? dayInterests : ["sights"],
          pace,
          lunch,
          prefer,
          mustSee: ms,
          exclude: ex,
          extraStops: stops.slice(1, -1).flatMap((s) => (s.value ? [s.value] : [])),
          accessModes: bikeTaxi ? ["walking", "bike_taxi"] : ["walking"],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      const parsed = ItineraryResponse.safeParse(json);
      if (!parsed.success) throw new Error("The planner returned data in an unexpected format.");
      setItinerary(parsed.data);
      setDayKey(dayInputsKey);
      setPlan(parsed.data.plan);
      setPlanKey(curKey);
      setSelected(parsed.data.selected);
      setFocusSeg(null);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }

  const switchMode = (m: "route" | "day") => {
    if (m === mode) return;
    setMode(m);
    setPlan(null);
    setItinerary(null);
    setStatus({ kind: "idle" });
  };

  const onPick = (c: Coordinate) => {
    const v = { name: coordName(c), location: c };
    setStops((all) => all.map((s) => (s.id === pickId ? { ...s, value: v } : s)));
    setPickId(null);
  };
  const pickIdx = stops.findIndex((s) => s.id === pickId);

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

  const hudProps =
    drive.timeline && drive.state && option
      ? {
          option,
          timeline: drive.timeline,
          state: drive.state,
          time: drive.time,
          gate: drive.gate,
          auto: drive.auto,
          moving: drive.moving,
          rate: drive.rate,
          follow,
          onPress: drive.press,
          onToggleAuto: drive.toggleAuto,
          onContinue: drive.continueGate,
          onRestart: () => {
            drive.restart();
            mapRef.current?.recenter();
          },
          onJump: (i: number) => {
            drive.jumpToSegment(i);
            mapRef.current?.recenter();
          },
          onFollow: (f: boolean) => {
            setFollow(f);
            if (f) mapRef.current?.recenter();
          },
          onRecenter: () => mapRef.current?.recenter(),
          onExit: exitRide,
        }
      : null;

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
          stopMarkers={stopMarkers}
          suggestions={sightItems}
          pickMode={pickId !== null}
          onPick={onPick}
          avatar={avatar}
        />
        {pickId !== null && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <div className="rounded-full bg-slate-900/90 px-3 py-1.5 text-xs text-white shadow">
              Click the map to set {pickIdx === 0 ? "the start" : pickIdx === stops.length - 1 ? "the destination" : `stop ${stopLetter(pickIdx)}`} ({stopLetter(pickIdx)})
            </div>
          </div>
        )}
        {option && drive.timeline && drive.state && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 md:inset-x-auto md:bottom-4 md:left-4 md:w-[min(620px,calc(100%-2rem))]">
            {riding ? (
              <div className="relative">
                {hudProps && <RideHud part="panel" {...hudProps} />}
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
        {/* Transfer / arrival cards sit above the control bar, centred on the map. */}
        {riding && hudProps && (
          <div className="pointer-events-none absolute inset-0 z-20">
            <RideHud part="cards" {...hudProps} />
          </div>
        )}
      </section>

      {/* Planner panel */}
      <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto border-[var(--color-line)] bg-[var(--color-panel)] md:order-1 md:w-[400px] md:flex-none md:border-r">
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
            if (dayMode) planDay();
            else search();
          }}
        >
          <div className="grid grid-cols-2 rounded-xl bg-slate-500/10 p-1 text-sm font-semibold" role="tablist" aria-label="Planner mode">
            {(
              [
                ["route", "Find a route"],
                ["day", "Plan my day"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`rounded-lg py-1.5 ${mode === m ? "bg-[var(--color-panel)] shadow-sm" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <StopsEditor stops={stops} onChange={setStops} pickId={pickId} onPick={setPickId} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setStops((all) => [...all].reverse())}
              className="rounded-md px-2 py-1 hover:bg-slate-500/10"
            >
              ⇅ Reverse
            </button>
            {!dayMode && (
            <select
              aria-label="Departure"
              value={departMode}
              onChange={(e) => setDepartMode(e.target.value as "now" | "at")}
              className="rounded-md border border-[var(--color-line)] bg-transparent px-2 py-1"
            >
              <option value="now">Leave now</option>
              <option value="at">Leave at…</option>
            </select>
            )}
            {!dayMode && departMode === "at" && (
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
          {dayMode ? (
            <DayPanel
              budgetMin={budgetMin}
              onBudget={setBudgetMin}
              startAt={departAt}
              onStartAt={setDepartAt}
              interests={dayInterests}
              onInterests={setDayInterests}
              pace={pace}
              onPace={setPace}
              lunch={lunch}
              onLunch={setLunch}
              prefer={prefer}
              onPrefer={setPrefer}
              roundTrip={!destination}
            />
          ) : (
          <SightsPanel
            enabled={sightsOn}
            onEnabled={setSightsOn}
            interests={interests}
            onInterests={setInterests}
            maxOffRouteM={maxOffRouteM}
            onMaxOffRoute={setMaxOffRouteM}
            state={sights}
            ready={filled.length >= 2}
            canAdd={stops.length < MAX_STOPS}
            onAdd={addSight}
            onLook={(s) => mapRef.current?.focusPoint(s.location)}
          />
          )}
          <button
            type="submit"
            disabled={!canSearch}
            className="w-full rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dayMode ? (status.kind === "loading" ? "Planning your day…" : "Plan my day") : status.kind === "loading" ? "Finding routes…" : "Find routes"}
          </button>
        </form>

        <div className="space-y-3 px-4 pb-6">
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

          {dayMode && itinerary && status.kind !== "loading" && (
            <>
              {planStale && (
                <p role="status" className="rounded-xl border border-teal-600/30 bg-teal-600/10 p-2.5 text-xs">
                  Your inputs changed since this day was planned. Press “Plan my day” to update it.
                </p>
              )}
              {itinerary.warnings.length > 0 && (
                <details className="rounded-xl border border-amber-300/60 bg-[var(--color-warn-bg)] p-3 text-xs text-[var(--color-warn)]">
                  <summary className="cursor-pointer font-semibold">Notes ({itinerary.warnings.length})</summary>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4">
                    {itinerary.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              )}
              <Timeline
                itinerary={itinerary}
                mustSee={mustSee}
                busy={false}
                onSwap={(id) => planDay({ exclude: [...exclude, id], mustSee: mustSee.filter((x) => x !== id) })}
                onTogglePin={(id) => planDay({ mustSee: mustSee.includes(id) ? mustSee.filter((x) => x !== id) : [...mustSee, id] })}
                onAdd={(id) => planDay({ mustSee: [...mustSee.filter((x) => x !== id), id].slice(-8) })}
                onRestore={(id) => planDay({ exclude: exclude.filter((x) => x !== id) })}
                onLook={(s) => mapRef.current?.focusPoint(s.location)}
              />
            </>
          )}

          {!itinerary && status.kind === "idle" && dayMode && (
            <p className="text-sm text-[var(--color-muted)]">
              Set where you start (and optionally where you finish), how much time you have and what you enjoy. The planner picks the sights
              that fit best, orders them and routes the day.
            </p>
          )}

          {!plan && status.kind === "idle" && !dayMode && (
            <p className="text-sm text-[var(--color-muted)]">
              Search two or more places in Kochi (or pick them on the map) to compare metro, bus, boat, bike-taxi, auto and taxi options by
              estimated time and cost.
            </p>
          )}

          {plan && status.kind !== "loading" && (
            <>
              {planStale && (
                <p role="status" className="rounded-xl border border-teal-600/30 bg-teal-600/10 p-2.5 text-xs">
                  Stops changed since these routes were found. Press “Find routes” to update them.
                </p>
              )}
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

              {dayMode ? null : plan.options.length === 0 ? (
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
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{dayMode ? "Travel steps" : "Steps"}</h2>
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
