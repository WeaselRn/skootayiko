import type { CostEstimate, EstimateSource } from "@/schema/route";

export function fmtDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtDistance(m?: number): string {
  if (m === undefined) return "";
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function fmtCost(c?: CostEstimate): string {
  if (!c) return "Fare unknown";
  if (c.max === 0) return "Free";
  return c.min === c.max ? `₹${c.min}` : `₹${c.min}–${c.max}`;
}

/** HH:MM in IST from an ISO string that carries its own offset. */
export function fmtClock(iso?: string): string {
  if (!iso) return "";
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : "";
}

export const SOURCE_LABEL: Record<EstimateSource, string> = {
  live: "Live",
  published_schedule: "Timetable",
  provider_estimate: "Provider estimate",
  model_estimate: "Estimate",
  fallback: "Rough guess",
};

/** Current time in IST as a value for <input type="datetime-local">. */
export function nowIstLocalInput(): string {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

/** Converts a datetime-local value (interpreted as IST) to ISO with offset. */
export function istLocalToIso(v: string): string {
  return `${v}:00+05:30`;
}
