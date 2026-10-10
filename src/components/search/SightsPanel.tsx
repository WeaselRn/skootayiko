"use client";

import { DETOUR_CHOICES, INTERESTS } from "@/lib/interests";
import type { Suggestion } from "@/schema/suggest";
import type { SuggestState } from "./useSuggestions";

interface Props {
  enabled: boolean;
  onEnabled(v: boolean): void;
  interests: string[];
  onInterests(v: string[]): void;
  maxOffRouteM: number;
  onMaxOffRoute(m: number): void;
  state: SuggestState;
  /** True once there are at least two stops to look between. */
  ready: boolean;
  canAdd: boolean;
  onAdd(s: Suggestion): void;
  onLook(s: Suggestion): void;
}

const fmtOff = (m: number) => (m < 100 ? "on the route" : m < 1000 ? `${Math.round(m / 50) * 50} m off route` : `${(m / 1000).toFixed(1)} km off route`);

/** Opt-in "sights on the way": pick interests, then add suggested places near the route as stops. */
export default function SightsPanel({ enabled, onEnabled, interests, onInterests, maxOffRouteM, onMaxOffRoute, state, ready, canAdd, onAdd, onLook }: Props) {
  const toggle = (id: string) => onInterests(interests.includes(id) ? interests.filter((x) => x !== id) : [...interests, id]);
  const labelOf = (id: string) => INTERESTS.find((i) => i.id === id)?.label ?? id;
  const items = state.kind === "off" ? [] : state.items;

  return (
    <section aria-label="Sights on the way" className="rounded-xl border border-[var(--color-line)] p-2.5 text-xs">
      <label className="flex cursor-pointer items-center gap-2 font-semibold">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} className="accent-teal-600" />
        Visit sights on the way
      </label>
      {enabled && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="What are you interested in?">
            {INTERESTS.map((i) => {
              const on = interests.includes(i.id);
              return (
                <button
                  key={i.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(i.id)}
                  className={`rounded-full border px-2.5 py-1 ${on ? "border-teal-600 bg-teal-600/10 text-teal-800 dark:text-teal-300" : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-slate-400"}`}
                >
                  {i.label}
                </button>
              );
            })}
          </div>
          <select
            aria-label="How far off the route"
            value={maxOffRouteM}
            onChange={(e) => onMaxOffRoute(Number(e.target.value))}
            className="rounded-md border border-[var(--color-line)] bg-transparent px-2 py-1"
          >
            {DETOUR_CHOICES.map((d) => (
              <option key={d.m} value={d.m}>
                {d.label}
              </option>
            ))}
          </select>

          {!ready && <p className="text-[var(--color-muted)]">Set your start and destination to see places along the way.</p>}
          {ready && interests.length === 0 && <p className="text-[var(--color-muted)]">Pick at least one interest.</p>}
          {state.kind === "loading" && <p className="text-[var(--color-muted)]">Looking for places near your route…</p>}
          {state.kind === "error" && (
            <p role="alert" className="text-amber-700 dark:text-amber-400">
              {state.message}
            </p>
          )}
          {state.kind === "ready" && items.length === 0 && (
            <p className="text-[var(--color-muted)]">Nothing found near this route. Try a wider distance or more interests.</p>
          )}
          {state.kind === "ready" && state.partial && items.length > 0 && (
            <p className="text-[var(--color-muted)]">Some stretches of the route could not be searched, so this list may be incomplete.</p>
          )}

          {items.length > 0 && (
            <ul className="max-h-44 divide-y divide-[var(--color-line)] overflow-y-auto rounded-lg border border-[var(--color-line)]" aria-label="Suggested places">
              {items.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-2 py-1.5">
                  <button type="button" onClick={() => onLook(s)} className="min-w-0 flex-1 text-left" title="Show on map">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="truncate text-[11px] text-[var(--color-muted)]">
                      {labelOf(s.interest)}
                      {s.kind && ` · ${s.kind}`} · {fmtOff(s.offRouteM)}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={!canAdd}
                    onClick={() => onAdd(s)}
                    title={canAdd ? "Add as a stop" : "Maximum number of stops reached"}
                    className="shrink-0 rounded-md border border-teal-600/40 px-2 py-1 font-semibold text-teal-700 hover:bg-teal-600/10 disabled:opacity-40 dark:text-teal-400"
                  >
                    + Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
