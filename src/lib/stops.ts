import { MAX_VIA } from "@/schema/route";
import type { PlaceValue } from "@/components/search/PlaceInput";

/** One row in the trip: the first is the start, the last is the destination, the rest are stops in between. */
export interface Stop {
  /** Stable key so reordering keeps each row's input state. */
  id: string;
  value: PlaceValue | null;
}

export const MAX_STOPS = MAX_VIA + 2;

let counter = 0;
export const newStop = (value: PlaceValue | null = null): Stop => ({ id: `stop-${++counter}`, value });

/** A, B, C … for the map and the step list. */
export const stopLetter = (i: number) => String.fromCharCode(65 + i);

export type StopTone = "start" | "via" | "end";
export const stopTone = (i: number, n: number): StopTone => (i === 0 ? "start" : i === n - 1 ? "end" : "via");

export const TONE_COLOR: Record<StopTone, string> = { start: "#0f172a", via: "#0d9488", end: "#be123c" };

/** Key for the set of filled-in stops, to tell whether a plan still matches the form. */
export const stopsKey = (stops: Stop[]) =>
  stops
    .filter((s) => s.value)
    .map((s) => `${s.value!.location.lat.toFixed(4)},${s.value!.location.lon.toFixed(4)}`)
    .join("|");

export function move<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
