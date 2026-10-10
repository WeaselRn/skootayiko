"use client";

import type { RouteOption } from "@/schema/route";
import { fmtClock, fmtCost, fmtDuration, SOURCE_LABEL } from "@/lib/format";
import { MODE_STYLE } from "@/lib/modes";

const BADGE: Record<string, string> = {
  fastest: "bg-teal-600 text-white",
  cheapest: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
  balanced: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
};

export function ModeStrip({ option }: { option: RouteOption }) {
  const total = option.totalDurationSeconds || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-500/10" aria-hidden>
      {option.segments.map((s) => (
        <div
          key={s.id}
          style={{
            width: `${((s.durationSeconds + s.waitSeconds) / total) * 100}%`,
            background:
              s.waitSeconds > 0
                ? `linear-gradient(90deg, #cbd5e1 ${(s.waitSeconds / (s.durationSeconds + s.waitSeconds)) * 100}%, ${MODE_STYLE[s.mode].color} 0)`
                : MODE_STYLE[s.mode].color,
          }}
        />
      ))}
    </div>
  );
}

export default function RouteCard({
  option,
  selected,
  onSelect,
}: {
  option: RouteOption;
  selected: boolean;
  onSelect(): void;
}) {
  const first = option.segments[0];
  const last = option.segments[option.segments.length - 1];
  const vehicleModes = option.segments.filter((s) => s.mode !== "walking");
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border p-3 text-left transition ${
        selected
          ? "border-teal-600 bg-teal-600/5 ring-1 ring-teal-600"
          : "border-[var(--color-line)] bg-[var(--color-panel)] hover:border-slate-400"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {option.rankings
              .filter((r) => r !== "alternative")
              .map((r) => (
                <span key={r} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${BADGE[r]}`}>
                  {r}
                </span>
              ))}
            <span className="text-sm font-semibold">{option.label}</span>
          </div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            {fmtClock(first.origin.departureTime)}–{fmtClock(last.destination.arrivalTime)} ·{" "}
            {option.transfers === 0 ? "No transfers" : `${option.transfers} transfer${option.transfers > 1 ? "s" : ""}`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums leading-tight">{fmtDuration(option.totalDurationSeconds)}</div>
          <div className="text-sm tabular-nums">
            {fmtCost(option.totalCostEstimate)}
            {option.totalCostEstimate && option.totalCostEstimate.max > 0 && (
              <span className="ml-1 text-[11px] text-[var(--color-muted)]">{SOURCE_LABEL[option.totalCostEstimate.source].toLowerCase()}</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2.5">
        <ModeStrip option={option} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {vehicleModes.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: MODE_STYLE[s.mode].color }} />
            {MODE_STYLE[s.mode].label}
            {s.lineName && s.mode !== "metro" ? <span className="max-w-40 truncate text-[var(--color-muted)]">{s.lineName}</span> : null}
          </span>
        ))}
        {option.totalWaitSeconds > 0 && (
          <span className="text-[var(--color-muted)]">incl. ~{fmtDuration(option.totalWaitSeconds)} waiting</span>
        )}
      </div>
    </button>
  );
}
