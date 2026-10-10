"use client";

import type { ItineraryResponse } from "@/schema/itinerary";
import type { Suggestion } from "@/schema/suggest";
import { fmtClock, fmtDuration } from "@/lib/format";
import { MODE_STYLE } from "@/lib/modes";
import { stopLetter } from "@/lib/stops";

interface Props {
  itinerary: ItineraryResponse;
  mustSee: string[];
  busy: boolean;
  /** Replace a chosen sight: exclude it and re-plan. */
  onSwap(id: string): void;
  onTogglePin(id: string): void;
  /** Force a dropped sight in (as a must-see). */
  onAdd(id: string): void;
  onRestore(id: string): void;
  onLook(s: Suggestion): void;
}

const REASON: Record<string, string> = {
  closed: "Closed",
  too_far: "Too far",
  over_budget: "No time",
  removed: "Removed",
};

const smallBtn =
  "rounded-md border border-[var(--color-line)] px-1.5 py-0.5 text-[11px] font-medium hover:border-slate-400 disabled:opacity-40";

/** The planned day as visit blocks and travel between them, with budget use and what was left out. */
export default function Timeline({ itinerary: it, mustSee, busy, onSwap, onTogglePin, onAdd, onRestore, onLook }: Props) {
  const byId = new Map(it.stops.map((s) => [s.id, s]));
  const pct = Math.min(100, Math.round((it.usedMin / it.budgetMin) * 100));
  let visitNo = 0;

  return (
    <section aria-label="Your day" className="space-y-3">
      <div className="rounded-xl border border-[var(--color-line)] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${it.fits ? "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300"}`}
          >
            {it.fits ? `Fits in ${fmtDuration(it.usedMin * 60)}` : `${fmtDuration(-it.slackMin * 60)} over`}
          </span>
          <span className="text-xs tabular-nums text-[var(--color-muted)]">
            {fmtClock(it.startAt)} → {fmtClock(it.finishAt)} · budget until {fmtClock(it.endBy)}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-500/15" aria-hidden>
          <div className={`h-full rounded-full ${it.fits ? "bg-teal-600" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-[var(--color-muted)]">
          {it.stops.length} {it.stops.length === 1 ? "stop" : "stops"}
          {it.fits && it.slackMin > 0 && ` · ${fmtDuration(it.slackMin * 60)} spare`}
        </div>
      </div>

      {it.timeline.length > 0 && (
        <ol className="relative space-y-1" aria-label="Timeline">
          {it.timeline.map((t, i) => {
            if (t.kind === "travel") {
              const modes = t.modes.filter((m) => m !== "walking");
              const label = t.modes.length ? (modes.length ? modes : t.modes).map((m) => MODE_STYLE[m].label).join(" + ") : "Travel (estimate)";
              const color = MODE_STYLE[(modes[0] ?? t.modes[0]) || "unknown"].color;
              return (
                <li key={i} className="relative flex items-center gap-2 pl-7 text-xs text-[var(--color-muted)]">
                  <span aria-hidden className="absolute bottom-0 left-[9px] top-0 w-1 rounded-full opacity-70" style={{ background: color }} />
                  <span className="tabular-nums">{fmtClock(t.departAt)}</span>
                  <span>
                    {label} · {fmtDuration(t.minutes * 60)}
                  </span>
                </li>
              );
            }
            if (t.kind === "lunch") {
              return (
                <li key={i} className="relative pl-7 text-xs">
                  <span aria-hidden className="absolute left-0 top-0.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-amber-500/20 text-[12px]">
                    🍽
                  </span>
                  <div className="py-1">
                    <span className="font-semibold">Lunch near {t.near}</span>
                    <span className="ml-2 tabular-nums text-[var(--color-muted)]">
                      {fmtClock(t.startAt)}–{fmtClock(t.endAt)}
                    </span>
                  </div>
                </li>
              );
            }
            visitNo += 1;
            const s = byId.get(t.sightId);
            const pinned = mustSee.includes(t.sightId);
            const custom = t.sightId.startsWith("extra:");
            return (
              <li key={i} className="relative pl-7">
                <span aria-hidden className="absolute left-0 top-2 grid h-[22px] w-[22px] place-items-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
                  {stopLetter(visitNo)}
                </span>
                <div className="rounded-xl border border-[var(--color-line)] p-2">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" className="min-w-0 text-left" onClick={() => s && onLook(s)} title="Show on map">
                      <div className="text-sm font-semibold">{t.name}</div>
                      <div className="text-xs tabular-nums text-[var(--color-muted)]">
                        {fmtClock(t.startAt)}–{fmtClock(t.leaveAt)} · {fmtDuration(t.minutes * 60)}
                        {s && s.interest !== "custom" && ` · worth ${Math.round(s.score * 100)}`}
                      </div>
                    </button>
                    {!custom && (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" disabled={busy} onClick={() => onTogglePin(t.sightId)} aria-pressed={pinned} className={`${smallBtn} ${pinned ? "border-teal-600 text-teal-700 dark:text-teal-400" : ""}`} title={pinned ? "Unpin" : "Keep this stop when re-planning"}>
                          {pinned ? "★ Pinned" : "☆ Pin"}
                        </button>
                        <button type="button" disabled={busy} onClick={() => onSwap(t.sightId)} className={smallBtn} title="Remove and let the planner pick something else">
                          ⇄ Swap
                        </button>
                      </div>
                    )}
                  </div>
                  {s?.blurb && <p className="mt-1 text-xs">{s.blurb}</p>}
                  {t.warnings.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                      {t.warnings.map((w) => (
                        <li key={w}>⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
          <li className="relative pl-7 pt-1">
            <span aria-hidden className="absolute left-0 top-1.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-rose-700 text-[10px] font-bold text-white">
              {stopLetter(visitNo + 1)}
            </span>
            <div className="text-sm font-semibold">Done {fmtClock(it.finishAt)}</div>
          </li>
        </ol>
      )}

      {it.dropped.length > 0 && (
        <details className="rounded-xl border border-[var(--color-line)] p-2.5 text-xs">
          <summary className="cursor-pointer font-semibold">Left out ({it.dropped.length})</summary>
          <ul className="mt-1.5 divide-y divide-[var(--color-line)]">
            {it.dropped.map((d) => (
              <li key={d.sight.id} className="flex items-center gap-2 py-1.5">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onLook(d.sight)} title="Show on map">
                  <div className="truncate font-medium">{d.sight.name}</div>
                  <div className="text-[11px] text-[var(--color-muted)]">
                    <span className="font-semibold">{REASON[d.reason]}</span> · {d.detail}
                  </div>
                </button>
                {d.reason === "removed" ? (
                  <button type="button" disabled={busy} onClick={() => onRestore(d.sight.id)} className={smallBtn}>
                    Restore
                  </button>
                ) : (
                  d.reason !== "closed" && (
                    <button type="button" disabled={busy} onClick={() => onAdd(d.sight.id)} className={smallBtn} title="Make this a must-see and re-plan">
                      + Must see
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
