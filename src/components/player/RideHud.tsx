"use client";

import type { RouteOption } from "@/schema/route";
import { fmtCost, fmtDuration } from "@/lib/format";
import { MODE_STYLE } from "@/lib/modes";
import { segmentStart, type PlayState, type Timeline } from "@/lib/journey";
import type { Gate } from "./useDrive";

type Key = "fwd" | "back" | "left" | "right" | "boost";

interface Props {
  /** "cards" = transfer/arrival dialogs (full-map overlay); "panel" = bottom control bar. */
  part: "cards" | "panel";
  option: RouteOption;
  timeline: Timeline;
  state: PlayState;
  time: number;
  gate: Gate;
  auto: boolean;
  moving: boolean;
  rate: number;
  follow: boolean;
  onPress(k: Key, down: boolean): void;
  onToggleAuto(): void;
  onContinue(): void;
  onRestart(): void;
  onJump(i: number): void;
  onFollow(f: boolean): void;
  onRecenter(): void;
  onExit(): void;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid min-w-[1.6em] place-items-center rounded-md border border-b-2 border-slate-300 bg-white px-1 font-sans text-[10px] font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
      {children}
    </kbd>
  );
}

/** Press-and-hold button for touch screens. */
function HoldButton({ k, label, children, onPress, className = "" }: { k: Key; label: string; children: React.ReactNode; onPress: Props["onPress"]; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress(k, true);
      }}
      onPointerUp={() => onPress(k, false)}
      onPointerCancel={() => onPress(k, false)}
      onContextMenu={(e) => e.preventDefault()}
      className={`pointer-events-auto grid select-none place-items-center rounded-full bg-slate-900/85 text-white shadow-lg backdrop-blur active:scale-95 active:bg-teal-600 ${className}`}
      style={{ touchAction: "none" }}
    >
      {children}
    </button>
  );
}

export default function RideHud(p: Props) {
  const seg = p.option.segments[p.state.segment];
  const st = MODE_STYLE[seg.mode];
  const isRide = ["bike_taxi", "taxi", "auto_rickshaw"].includes(seg.mode);
  const status =
    p.state.kind === "wait"
      ? isRide
        ? `Waiting for your ${st.label.toLowerCase()}`
        : `Waiting for the ${st.label.toLowerCase()} at ${seg.origin.name}`
      : `${st.verb} to ${seg.destination.name}`;
  const hint = p.state.kind === "wait" ? "Hold W to skip the wait" : p.moving ? null : "Hold W to move";
  const next = p.gate?.kind === "transfer" ? p.option.segments[p.gate.next] : null;
  const pct = (p.time / p.timeline.total) * 100;

  if (p.part === "cards") {
    return (
      <>
      {next && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 pb-40">
          <div role="dialog" aria-live="assertive" className="pointer-events-auto w-full max-w-sm rounded-2xl bg-white p-4 text-slate-900 shadow-2xl ring-1 ring-black/5 dark:bg-slate-900 dark:text-slate-100">
            <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">Leg complete · {seg.destination.name}</div>
            <div className="mt-1.5 flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-bold">
              <span className="h-3 w-3 rounded-full" style={{ background: MODE_STYLE[next.mode].color }} />
              Next: {MODE_STYLE[next.mode].label}
              {next.lineName && next.mode !== "metro" ? <span className="truncate text-sm font-medium text-slate-500">{next.lineName}</span> : null}
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{next.instructions?.[0]}</p>
            {next.waitSeconds > 0 && <p className="mt-0.5 text-xs text-slate-500">Expect ~{fmtDuration(next.waitSeconds)} wait.</p>}
            <button
              type="button"
              onClick={p.onContinue}
              autoFocus
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white hover:bg-slate-800 dark:bg-teal-600"
            >
              Continue <Kbd>W</Kbd>
            </button>
          </div>
        </div>
      )}
      {p.gate?.kind === "arrived" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 pb-40">
          <div role="dialog" aria-live="assertive" className="pointer-events-auto w-full max-w-sm rounded-2xl bg-white p-5 text-center text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100">
            <div className="font-[family-name:var(--font-display)] text-2xl font-extrabold">You made it!</div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Arrived at {seg.destination.name}</p>
            <div className="mt-3 flex justify-center gap-6 text-sm">
              <div>
                <div className="text-lg font-bold tabular-nums">{fmtDuration(p.option.totalDurationSeconds)}</div>
                <div className="text-xs text-slate-500">estimated time</div>
              </div>
              <div>
                <div className="text-lg font-bold tabular-nums">{fmtCost(p.option.totalCostEstimate)}</div>
                <div className="text-xs text-slate-500">estimated cost</div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={p.onRestart} className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white dark:bg-teal-600">
                Ride again
              </button>
              <button type="button" onClick={p.onExit} className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold dark:border-slate-600">
                Back to routes
              </button>
            </div>
          </div>
        </div>
      )}

      </>
    );
  }

  return (
    <>
      {/* Touch controls: look left/right under the left thumb, GO/BACK under the right. */}
      <div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1 flex items-end gap-2 [@media(pointer:fine)]:hidden">
        <HoldButton k="left" label="Look left" onPress={p.onPress} className="h-14 w-14 text-xl">
          ⟲
        </HoldButton>
        <HoldButton k="right" label="Look right" onPress={p.onPress} className="h-14 w-14 text-xl">
          ⟳
        </HoldButton>
      </div>
      <div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] right-1 flex flex-col items-end gap-2 [@media(pointer:fine)]:hidden">
        <HoldButton k="fwd" label="Go forward" onPress={p.onPress} className="h-16 w-16 text-sm font-bold">
          GO
        </HoldButton>
        <HoldButton k="back" label="Go back" onPress={p.onPress} className="h-11 w-16 text-xs font-bold">
          BACK
        </HoldButton>
      </div>

      <div className="pointer-events-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)]/95 p-3 shadow-xl backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: st.color }} />
              <span className="truncate">{status}</span>
            </div>
            <div className="mt-0.5 text-xs text-[var(--color-muted)]" aria-live="polite">
              Leg {p.state.segment + 1} of {p.option.segments.length} · {fmtDuration(p.time)} of {fmtDuration(p.timeline.total)}
              {p.moving && p.rate > 1 ? ` · ~${Math.round(p.rate)}× real time` : ""}
              {hint ? <span className="font-semibold text-teal-700 dark:text-teal-400"> · {hint}</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="hidden rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] sm:inline">
              Preview · not live
            </span>
            <button type="button" onClick={p.onExit} aria-label="Exit ride" className="rounded-md px-2 py-1 text-sm text-[var(--color-muted)] hover:bg-slate-500/10">
              ✕
            </button>
          </div>
        </div>

        {/* Leg-segmented progress; click a leg to jump to it. */}
        <div className="relative mt-2.5 flex h-3 w-full gap-0.5">
          {p.option.segments.map((s, i) => {
            const startT = segmentStart(p.timeline, i);
            const endT = i + 1 < p.option.segments.length ? segmentStart(p.timeline, i + 1) : p.timeline.total;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => p.onJump(i)}
                aria-label={`Jump to leg ${i + 1}: ${MODE_STYLE[s.mode].label}`}
                className="h-full rounded-full opacity-90 hover:opacity-100"
                style={{ flex: `${Math.max(1, endT - startT)} 1 0`, background: MODE_STYLE[s.mode].color, opacity: i === p.state.segment ? 1 : 0.35 }}
              />
            );
          })}
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] bg-white shadow"
            style={{ left: `${pct}%`, borderColor: st.color }}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="hidden flex-wrap items-center gap-x-2.5 gap-y-1 text-[var(--color-muted)] [@media(pointer:fine)]:flex">
            <span className="inline-flex items-center gap-1">
              <Kbd>W</Kbd>
              <Kbd>S</Kbd> move
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>A</Kbd>
              <Kbd>D</Kbd> look
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Shift</Kbd> boost
            </span>
            <span>drag to look · scroll to zoom</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={p.onToggleAuto}
              aria-pressed={p.auto}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${p.auto ? "bg-teal-600 text-white" : "hover:bg-slate-500/10"}`}
            >
              Auto-ride <Kbd>Space</Kbd>
            </button>
            <button
              type="button"
              onClick={() => p.onFollow(!p.follow)}
              aria-pressed={p.follow}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${p.follow ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900" : "hover:bg-slate-500/10"}`}
            >
              {p.follow ? "Following" : "Free camera"} <Kbd>C</Kbd>
            </button>
            {p.follow && (
              <button type="button" onClick={p.onRecenter} className="rounded-md px-2 py-1 hover:bg-slate-500/10" title="Zoom back to the rider">
                Recenter
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
