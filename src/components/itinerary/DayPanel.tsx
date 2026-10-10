"use client";

import { INTERESTS } from "@/lib/interests";
import { fmtDuration } from "@/lib/format";

export type Pace = "relaxed" | "normal" | "packed";
export type Prefer = "fastest" | "scenic";

interface Props {
  budgetMin: number;
  onBudget(m: number): void;
  startAt: string;
  onStartAt(v: string): void;
  interests: string[];
  onInterests(v: string[]): void;
  pace: Pace;
  onPace(p: Pace): void;
  lunch: boolean;
  onLunch(v: boolean): void;
  prefer: Prefer;
  onPrefer(p: Prefer): void;
  /** True when no destination is set, so the day ends back at the start. */
  roundTrip: boolean;
}

const chip = (on: boolean) =>
  `rounded-full border px-2.5 py-1 ${on ? "border-teal-600 bg-teal-600/10 text-teal-800 dark:text-teal-300" : "border-[var(--color-line)] text-[var(--color-muted)] hover:border-slate-400"}`;

/** Inputs for "Plan my day": time budget, start time, interests, pace and extras. */
export default function DayPanel(p: Props) {
  const toggle = (id: string) => p.onInterests(p.interests.includes(id) ? p.interests.filter((x) => x !== id) : [...p.interests, id]);
  return (
    <section aria-label="Plan my day" className="space-y-2.5 rounded-xl border border-[var(--color-line)] p-2.5 text-xs">
      <div>
        <label htmlFor="day-budget" className="flex items-baseline justify-between font-semibold">
          Time available <span className="tabular-nums text-sm text-teal-700 dark:text-teal-400">{fmtDuration(p.budgetMin * 60)}</span>
        </label>
        <input
          id="day-budget"
          type="range"
          min={60}
          max={480}
          step={30}
          value={p.budgetMin}
          onChange={(e) => p.onBudget(Number(e.target.value))}
          className="mt-1 w-full accent-teal-600"
        />
        <div className="flex justify-between text-[10px] text-[var(--color-muted)]">
          <span>1 h</span>
          <span>8 h</span>
        </div>
      </div>
      <label className="flex items-center gap-2">
        <span className="font-semibold">Start</span>
        <input
          type="datetime-local"
          aria-label="Start time (IST)"
          value={p.startAt}
          onChange={(e) => p.onStartAt(e.target.value)}
          className="rounded-md border border-[var(--color-line)] bg-transparent px-2 py-1"
        />
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What do you enjoy?">
        {INTERESTS.map((i) => (
          <button key={i.id} type="button" aria-pressed={p.interests.includes(i.id)} onClick={() => toggle(i.id)} className={chip(p.interests.includes(i.id))}>
            {i.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-[var(--color-line)]" role="group" aria-label="Pace">
          {(["relaxed", "normal", "packed"] as const).map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={p.pace === x}
              onClick={() => p.onPace(x)}
              className={`px-2 py-1 capitalize ${p.pace === x ? "bg-teal-600 text-white" : "hover:bg-slate-500/10"}`}
            >
              {x}
            </button>
          ))}
        </div>
        <select
          aria-label="Route preference"
          value={p.prefer}
          onChange={(e) => p.onPrefer(e.target.value as Prefer)}
          className="rounded-md border border-[var(--color-line)] bg-transparent px-2 py-1"
        >
          <option value="fastest">Fastest travel</option>
          <option value="scenic">Scenic (boats, walks)</option>
        </select>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={p.lunch} onChange={(e) => p.onLunch(e.target.checked)} className="accent-teal-600" />
          Lunch break
        </label>
      </div>
      <p className="text-[11px] text-[var(--color-muted)]">
        {p.roundTrip ? "No destination set: the day ends back at the start. " : ""}
        Stops you add in between are always included.
      </p>
    </section>
  );
}
