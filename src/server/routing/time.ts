/** Kochi runs on IST (UTC+05:30, no DST). */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

export interface ServiceClock {
  /** UTC epoch ms of IST midnight on the service day. */
  midnightMs: number;
  /** Seconds after IST midnight. */
  departSec: number;
  /** 0 = Sunday. */
  dow: number;
}

export function serviceClock(departAt?: string): ServiceClock {
  const ms = departAt ? Date.parse(departAt) : Date.now();
  if (Number.isNaN(ms)) throw new Error(`Invalid departAt: ${departAt}`);
  const ist = new Date(ms + IST_OFFSET_MS);
  const departSec = ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds();
  return { midnightMs: ms - departSec * 1000 - ist.getUTCMilliseconds(), departSec, dow: ist.getUTCDay() };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 8601 with +05:30 offset. */
export function toIstIso(clock: ServiceClock, sec: number): string {
  const d = new Date(clock.midnightMs + Math.round(sec) * 1000 + IST_OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+05:30`
  );
}
