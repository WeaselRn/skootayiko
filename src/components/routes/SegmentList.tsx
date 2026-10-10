"use client";

import type { RouteOption } from "@/schema/route";
import { fmtClock, fmtCost, fmtDistance, fmtDuration, SOURCE_LABEL } from "@/lib/format";
import { MODE_STYLE } from "@/lib/modes";
import { stopLetter } from "@/lib/stops";

const CONF: Record<string, string> = {
  high: "text-emerald-700 dark:text-emerald-400",
  medium: "text-slate-600 dark:text-slate-300",
  low: "text-amber-700 dark:text-amber-400",
};

export default function SegmentList({
  option,
  active,
  onFocus,
}: {
  option: RouteOption;
  active: number | null;
  onFocus(i: number): void;
}) {
  const last = option.segments[option.segments.length - 1];
  // Multi-stop trips: the final marker is the last letter, and each leg change shows the stop reached.
  const endLetter = stopLetter((last.leg ?? 0) + 1);
  return (
    <ol className="relative">
      {option.segments.map((s, i) => {
        const st = MODE_STYLE[s.mode];
        const isActive = active === i;
        const prev = option.segments[i - 1];
        const newLeg = prev && (s.leg ?? 0) !== (prev.leg ?? 0);
        return (
          <li key={s.id} className="relative pl-7">
            {newLeg && (
              <div className="relative -ml-7 flex items-center gap-2 py-1.5">
                <span aria-hidden className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
                  {stopLetter(s.leg ?? 0)}
                </span>
                <div className="text-sm font-semibold">
                  {prev.destination.name}
                  <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">arrive {fmtClock(prev.destination.arrivalTime)}</span>
                </div>
              </div>
            )}
            <span
              aria-hidden
              className="absolute bottom-0 left-[9px] top-0 w-1 rounded-full"
              style={{
                background: st.dashed ? `repeating-linear-gradient(${st.color} 0 4px, transparent 4px 8px)` : st.color,
                opacity: active === null || isActive ? 1 : 0.4,
              }}
            />
            <span
              aria-hidden
              className="absolute left-0 top-2.5 h-[22px] w-[22px] rounded-full border-[3px] bg-[var(--color-panel)]"
              style={{ borderColor: st.color }}
            />
            {s.waitSeconds > 0 && (
              <div className="pt-2 text-xs text-[var(--color-muted)]">
                Wait ~{fmtDuration(s.waitSeconds)}
                {s.mode === "bike_taxi" || s.mode === "taxi" || s.mode === "auto_rickshaw" ? " for pickup" : " at the stop"}
              </div>
            )}
            <button
              type="button"
              onClick={() => onFocus(i)}
              className={`mb-1 mt-1 w-full rounded-xl p-2 text-left ${isActive ? "bg-slate-500/10" : "hover:bg-slate-500/5"}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="text-sm font-semibold">
                  {st.label}
                  {s.lineName && <span className="font-normal text-[var(--color-muted)]"> · {s.lineName}</span>}
                </div>
                <div className="shrink-0 text-xs tabular-nums text-[var(--color-muted)]">{fmtClock(s.origin.departureTime)}</div>
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                {s.origin.name} → {s.destination.name}
              </div>
              <ul className="mt-1 space-y-0.5 text-xs">
                {s.instructions?.map((t, k) => (
                  <li key={k}>{t}</li>
                ))}
              </ul>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--color-muted)]">
                <span className="tabular-nums">{fmtDuration(s.durationSeconds)}</span>
                {s.distanceMeters !== undefined && <span>{fmtDistance(s.distanceMeters)}</span>}
                <span>
                  {fmtCost(s.costEstimate)}
                  {s.costEstimate && s.costEstimate.max > 0 && ` (${SOURCE_LABEL[s.costEstimate.source].toLowerCase()})`}
                </span>
                <span>time: {SOURCE_LABEL[s.durationSource].toLowerCase()}</span>
                <span className={CONF[s.confidence]}>{s.confidence} confidence</span>
              </div>
            </button>
          </li>
        );
      })}
      <li className="relative pl-7 pt-1">
        <span aria-hidden className="absolute left-0 top-1.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-rose-700 text-[10px] font-bold text-white">
          {endLetter}
        </span>
        <div className="text-sm font-semibold">
          Arrive {fmtClock(option.segments[option.segments.length - 1].destination.arrivalTime)}
        </div>
      </li>
    </ol>
  );
}
