"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RouteOption, TransportMode } from "@/schema/route";
import { buildTimeline, pathSampler, segmentStart, stateAt, type PlayState } from "@/lib/journey";

/**
 * Game-style journey driver. W/↑ moves forward along the planned route, S/↓ backs up,
 * Shift boosts, Space toggles auto-ride. Movement happens in route distance, so the
 * avatar or vehicle always stays on the planned geometry. Journey time is derived from
 * distance travelled, which keeps totals identical to the plan.
 */

/** Ground speed (m/s) at the mode's default camera zoom. Zooming out speeds you up. */
const GAME_SPEED: Partial<Record<TransportMode, number>> = {
  walking: 6,
  cycling: 9,
  bike_taxi: 22,
  auto_rickshaw: 18,
  taxi: 26,
  bus: 22,
  metro: 45,
  train: 45,
  ferry: 18,
};
/** Journey seconds skipped per real second while holding W during a wait. */
const WAIT_SKIP = 120;
const BOOST = 4;

export const CLOSE_ZOOM: Partial<Record<TransportMode, number>> = {
  walking: 22.6,
  cycling: 22,
  bike_taxi: 21.8,
  auto_rickshaw: 21.8,
  taxi: 21.4,
  bus: 20.6,
  metro: 19.6,
  train: 19.6,
  ferry: 19.8,
};
export const closeZoom = (m: TransportMode) => CLOSE_ZOOM[m] ?? 19.5;

export interface DriveFrame {
  state: PlayState;
  moving: boolean;
  pace: number;
  /** -1 = orbit left (A), 1 = orbit right (D). */
  orbit: number;
  dt: number;
}

export type Gate = { kind: "transfer"; next: number } | { kind: "arrived" } | null;

interface Options {
  option: RouteOption | null;
  active: boolean;
  /** Current map zoom; lets speed scale with how far out the player has zoomed. */
  getZoom(): number;
  onFrame(f: DriveFrame): void;
  reducedMotion: boolean;
}

const FWD = new Set(["KeyW", "ArrowUp"]);
const BACK = new Set(["KeyS", "ArrowDown"]);
const LEFT = new Set(["KeyA", "ArrowLeft"]);
const RIGHT = new Set(["KeyD", "ArrowRight"]);

function typingInField(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export function useDrive({ option, active, getZoom, onFrame, reducedMotion }: Options) {
  const timeline = useMemo(() => (option ? buildTimeline(option) : null), [option]);
  const lengths = useMemo(() => option?.segments.map((s) => pathSampler(s).length) ?? [], [option]);
  const [time, setTime] = useState(0);
  const [gate, setGate] = useState<Gate>(null);
  const [auto, setAuto] = useState(false);
  const [moving, setMoving] = useState(false);
  const [rate, setRate] = useState(0);

  const t = useRef(0);
  const v = useRef(0);
  const gateRef = useRef<Gate>(null);
  const autoRef = useRef(false);
  const input = useRef({ fwd: false, back: false, left: false, right: false, boost: false });
  const cbs = useRef({ onFrame, getZoom });
  cbs.current = { onFrame, getZoom };

  const setGateBoth = (g: Gate) => {
    gateRef.current = g;
    setGate(g);
  };

  // Reset when the route changes.
  useEffect(() => {
    t.current = 0;
    v.current = 0;
    setTime(0);
    setGateBoth(null);
    setAuto(false);
    autoRef.current = false;
  }, [timeline]);

  const continueGate = useCallback(() => {
    const g = gateRef.current;
    if (!g || !timeline) return;
    if (g.kind === "arrived") return;
    // Step just past the boundary so the next leg becomes current.
    t.current = segmentStart(timeline, g.next) + 0.01;
    setGateBoth(null);
  }, [timeline]);

  const toggleAuto = useCallback(() => {
    autoRef.current = !autoRef.current;
    setAuto(autoRef.current);
    if (autoRef.current && gateRef.current?.kind === "transfer") continueGate();
  }, [continueGate]);

  const restart = useCallback(() => {
    t.current = 0;
    v.current = 0;
    setTime(0);
    setGateBoth(null);
  }, []);

  const jumpToSegment = useCallback(
    (i: number) => {
      if (!timeline) return;
      t.current = segmentStart(timeline, i) + 0.01;
      v.current = 0;
      setTime(t.current);
      setGateBoth(null);
      cbs.current.onFrame({ state: stateAt(timeline, t.current), moving: false, pace: 0, orbit: 0, dt: 0 });
    },
    [timeline],
  );

  /** Touch controls call this while a button is held. */
  const press = useCallback(
    (key: "fwd" | "back" | "left" | "right" | "boost", down: boolean) => {
      if (down && key === "fwd" && gateRef.current?.kind === "transfer") continueGate();
      input.current[key] = down;
    },
    [continueGate],
  );

  // Keyboard.
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent, down: boolean) => {
      if (typingInField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const c = e.code;
      if (c === "ShiftLeft" || c === "ShiftRight") input.current.boost = down;
      else if (FWD.has(c)) {
        // A fresh press of W also confirms a transfer card.
        if (down && !e.repeat && gateRef.current?.kind === "transfer") continueGate();
        input.current.fwd = down;
      } else if (BACK.has(c)) input.current.back = down;
      else if (LEFT.has(c)) input.current.left = down;
      else if (RIGHT.has(c)) input.current.right = down;
      else if (c === "Space" && down && !e.repeat) toggleAuto();
      else if (c === "Enter" && down && gateRef.current?.kind === "transfer") continueGate();
      else return;
      e.preventDefault();
    };
    const kd = (e: KeyboardEvent) => on(e, true);
    const ku = (e: KeyboardEvent) => on(e, false);
    const blur = () => Object.assign(input.current, { fwd: false, back: false, left: false, right: false, boost: false });
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      blur();
    };
  }, [active, continueGate, toggleAuto]);

  // Game loop.
  useEffect(() => {
    if (!active || !timeline || !option) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let gateTimer = 0;
    cbs.current.onFrame({ state: stateAt(timeline, t.current), moving: false, pace: 0, orbit: 0, dt: 0 });

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const inp = input.current;
      const st = stateAt(timeline, t.current);
      const seg = option.segments[st.segment];
      const phase = timeline.phases.find((p) => p.segment === st.segment && p.kind === st.kind)!;

      // Auto-ride clears transfer cards after a short pause.
      if (autoRef.current && gateRef.current?.kind === "transfer") {
        gateTimer += dt;
        if (gateTimer > (reducedMotion ? 0.3 : 1.4)) {
          gateTimer = 0;
          continueGate();
        }
      }

      const dir = gateRef.current ? 0 : (inp.fwd || autoRef.current ? 1 : 0) - (inp.back ? 1 : 0);
      const boost = inp.boost ? BOOST : 1;
      let target = 0; // journey-seconds per real second
      let pace = 0;
      if (st.kind === "wait") {
        target = dir * WAIT_SKIP * boost;
      } else {
        const base = GAME_SPEED[seg.mode] ?? 20;
        const zoomFactor = Math.min(64, Math.max(0.5, 2 ** (closeZoom(seg.mode) - cbs.current.getZoom())));
        const metres = base * zoomFactor * boost;
        const len = lengths[st.segment] || 1;
        target = dir * metres * ((phase.end - phase.start) / len);
        pace = dir === 0 ? 0 : boost * (inp.boost ? 0.6 : 1);
      }
      // Ease toward the target speed so starts and stops feel physical.
      const k = Math.min(1, dt * (target === 0 ? 10 : 5));
      v.current += (target - v.current) * k;
      if (Math.abs(v.current) < 0.01) v.current = 0;

      const prevSeg = st.segment;
      let next = Math.max(0, Math.min(timeline.total, t.current + v.current * dt));
      // Transfer checkpoint: stop at the end of each leg until the player continues.
      if (v.current > 0 && !gateRef.current) {
        const after = stateAt(timeline, next);
        if (after.segment > prevSeg) {
          next = segmentStart(timeline, prevSeg + 1) - 0.001;
          v.current = 0;
          gateTimer = 0;
          setGateBoth({ kind: "transfer", next: prevSeg + 1 });
        } else if (next >= timeline.total) {
          v.current = 0;
          setGateBoth({ kind: "arrived" });
          if (autoRef.current) {
            autoRef.current = false;
            setAuto(false);
          }
        }
      }
      t.current = next;
      const isMoving = Math.abs(v.current) > 0.05 && st.kind === "move";
      cbs.current.onFrame({
        state: stateAt(timeline, t.current),
        moving: isMoving,
        pace: isMoving ? Math.max(0.5, pace * Math.abs(v.current / (target || v.current))) : 0,
        orbit: (inp.right ? 1 : 0) - (inp.left ? 1 : 0),
        dt,
      });
      if (now - lastUi > 100) {
        lastUi = now;
        setTime(t.current);
        setMoving(Math.abs(v.current) > 0.05);
        setRate(Math.abs(v.current));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, timeline, option, lengths, continueGate, reducedMotion]);

  const state = timeline ? stateAt(timeline, time) : null;
  return { timeline, time, state, gate, auto, moving, rate, press, toggleAuto, continueGate, restart, jumpToSegment };
}
