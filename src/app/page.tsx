import Link from "next/link";
import Logo from "@/components/brand/Logo";

// One river-like route the little vehicles ride along (viewBox 1200×400).
const ROUTE = "M -40 300 C 180 300, 220 120, 420 140 S 700 330, 860 250 S 1060 70, 1240 110";

const LOOP_S = 18;
// Spread along the route; the same offsets seed the animation so riders never bunch up.
const RIDERS = [
  { label: "Metro", color: "#0d9488", w: 46, at: 0.1 },
  { label: "Bus", color: "#2563eb", w: 40, at: 0.36 },
  { label: "Auto", color: "#f5b301", w: 26, at: 0.6 },
  { label: "Boat", color: "#0284c7", w: 36, at: 0.84 },
];

const MODES = ["Metro", "Bus", "Boat", "Auto", "Bike taxi", "Taxi", "Walk"];

export default function Welcome() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[var(--brand-cream)] text-[var(--brand-ink)]">
      {/* Route ribbon with riders */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[76%] h-[30vh] -translate-y-1/2 sm:top-1/2 sm:h-[40vh]">
        <svg viewBox="0 0 1200 400" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <path d={ROUTE} fill="none" stroke="#0d9488" strokeOpacity="0.12" strokeWidth="46" strokeLinecap="round" />
          <path d={ROUTE} fill="none" stroke="#0d9488" strokeOpacity="0.55" strokeWidth="3" strokeDasharray="2 12" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0" style={{ width: "100%", height: "100%" }}>
          <svg viewBox="0 0 1200 400" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {RIDERS.map((r) => (
              <g
                key={r.label}
                className="motion-safe:animate-[ride_18s_linear_infinite]"
                style={{
                  offsetPath: `path("${ROUTE}")`,
                  offsetRotate: "auto",
                  offsetDistance: `${r.at * 100}%`,
                  animationDelay: `${-r.at * LOOP_S}s`,
                }}
              >
                <rect x={-r.w / 2} y={-9} width={r.w} height={18} rx={7} fill={r.color} />
                <rect x={r.w / 2 - 10} y={-5} width={6} height={6} rx={1.5} fill="#ffffff" opacity="0.85" />
                <circle cx={-r.w / 2 + 7} cy={10} r={3.5} fill="#10233a" />
                <circle cx={r.w / 2 - 7} cy={10} r={3.5} fill="#10233a" />
              </g>
            ))}
          </svg>
        </div>
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 pt-5 sm:px-10 sm:pt-8">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-ink)]/60">Kochi · Ernakulam</span>
        <Link href="/plan" className="text-sm font-medium text-[var(--brand-ink)]/70 underline-offset-4 hover:underline">
          Skip to planner
        </Link>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <h1 className="text-[clamp(3.2rem,11vw,7rem)] leading-[0.95]">
          <Logo />
        </h1>
        <p className="mt-5 max-w-xl text-balance font-[family-name:var(--font-display)] text-[clamp(1.15rem,3.2vw,1.5rem)] font-medium leading-snug">
          Find the smartest way across Kochi — then ride it.
        </p>
        <p className="mt-3 max-w-sm text-balance text-sm leading-relaxed text-[var(--brand-ink)]/70">
          Mix metro, bus, boat and autos, compare time and cost, and drive the trip yourself in 3D.
        </p>

        <Link
          href="/avatar"
          className="group mt-9 inline-flex items-center gap-2 rounded-full bg-[var(--brand-ink)] px-7 py-3.5 font-[family-name:var(--font-display)] text-lg font-bold text-[var(--brand-cream)] shadow-[0_6px_0_0_#0d9488] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_0_#0d9488]"
        >
          Let&apos;s go
          <span aria-hidden className="transition-transform group-hover:translate-x-1">
            →
          </span>
        </Link>

        <ul className="mt-10 flex max-w-md flex-wrap justify-center gap-1.5" aria-label="Supported ways to travel">
          {MODES.map((m) => (
            <li key={m} className="rounded-full border border-[var(--brand-ink)]/15 bg-white/60 px-2.5 py-0.5 text-xs font-medium">
              {m}
            </li>
          ))}
        </ul>
      </section>

      <footer className="relative z-10 px-6 pb-5 text-center text-[11px] text-[var(--brand-ink)]/55">
        Times and fares are estimates. The 3D ride is a preview, not live tracking.
      </footer>
    </main>
  );
}
