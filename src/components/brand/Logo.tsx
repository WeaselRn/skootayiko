/**
 * Skootayiko wordmark: the "oo" are two scooter wheels (teal + auto-rickshaw yellow)
 * joined by a little route line. Wheels spin on hover of the parent `.group`.
 */
function Wheel({ color, delay }: { color: string; delay: string }) {
  return (
    <svg viewBox="0 0 40 40" className="inline-block h-[0.78em] w-[0.78em] translate-y-[0.06em]" aria-hidden>
      <g className="origin-center motion-safe:group-hover:animate-[spin_0.9s_linear_infinite]" style={{ animationDelay: delay }}>
        <circle cx="20" cy="20" r="16" fill="none" stroke={color} strokeWidth="7" />
        <circle cx="20" cy="20" r="4.5" fill={color} />
        <path d="M20 8v6M20 26v6M8 20h6M26 20h6" stroke={color} strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`group inline-flex select-none items-baseline font-[family-name:var(--font-display)] font-extrabold tracking-tight ${className}`}>
      <span className="sr-only">Skootayiko</span>
      <span aria-hidden className="text-[var(--brand-ink)]">Sk</span>
      <Wheel color="#0d9488" delay="0s" />
      <Wheel color="#f5b301" delay="0.15s" />
      <span aria-hidden className="text-[var(--brand-ink)]">tayiko</span>
      <span aria-hidden className="ml-0.5 h-[0.22em] w-[0.22em] translate-y-[-0.05em] self-end rounded-full bg-[#f97357]" />
    </span>
  );
}

/** Square app mark for small spaces. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="18" fill="#0d9488" />
      <path d="M14 42c8 0 10-20 18-20s10 20 18 20" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 8" />
      <circle cx="18" cy="44" r="7" fill="none" stroke="#f5b301" strokeWidth="4" />
      <circle cx="46" cy="44" r="7" fill="none" stroke="#fff" strokeWidth="4" />
      <circle cx="32" cy="20" r="4" fill="#f97357" />
    </svg>
  );
}
