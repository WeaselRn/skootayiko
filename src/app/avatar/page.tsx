"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Logo from "@/components/brand/Logo";
import { loadAvatar, saveAvatar, type Avatar } from "@/lib/avatar";

const AvatarStage = dynamic(() => import("@/components/avatar/AvatarStage"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-[var(--brand-ink)]/50">Warming up…</div>,
});

const OPTIONS: { key: Avatar; label: string; accent: string }[] = [
  { key: "man", label: "Man", accent: "#0d9488" },
  { key: "woman", label: "Woman", accent: "#f97357" },
];

export default function AvatarPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<Avatar | null>(null);
  const [hover, setHover] = useState<Avatar | null>(null);

  useEffect(() => setSelected(loadAvatar()), []);

  const go = () => {
    if (!selected) return;
    saveAvatar(selected);
    router.push(`/plan?avatar=${selected}`);
  };

  return (
    <main className="flex min-h-dvh flex-col bg-[var(--brand-cream)] text-[var(--brand-ink)]">
      <header className="flex items-center justify-between px-5 pt-5 sm:px-10">
        <Link href="/" aria-label="Skootayiko home" className="text-2xl">
          <Logo />
        </Link>
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-ink)]/50">Step 1 of 2</span>
      </header>

      <div className="px-6 pt-6 text-center">
        <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.9rem,5vw,2.8rem)] font-extrabold leading-tight">
          Who&apos;s riding today?
        </h1>
        <p className="mt-1 text-sm text-[var(--brand-ink)]/65">Tap a traveller to pick them. Drag to spin the stage.</p>
      </div>

      <div className="relative mx-auto h-[min(54dvh,520px)] w-full max-w-4xl">
        <AvatarStage selected={selected} onSelect={setSelected} onHover={setHover} />
      </div>

      <fieldset className="mx-auto grid w-full max-w-xl grid-cols-2 gap-3 px-6">
        <legend className="sr-only">Choose your traveller</legend>
        {OPTIONS.map((o) => {
          const on = selected === o.key;
          return (
            <label
              key={o.key}
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 bg-white/70 px-4 py-3 font-[family-name:var(--font-display)] text-lg font-bold transition ${
                on ? "shadow-[0_4px_0_0_currentColor]" : hover === o.key ? "border-[var(--brand-ink)]/30" : "border-transparent"
              }`}
              style={on ? { borderColor: o.accent, color: o.accent } : undefined}
            >
              <input
                type="radio"
                name="avatar"
                value={o.key}
                checked={on}
                onChange={() => setSelected(o.key)}
                className="sr-only"
              />
              <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: o.accent, opacity: on ? 1 : 0.35 }} />
              {o.label}
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-1 items-end justify-center px-6 pb-8 pt-6">
        <button
          type="button"
          onClick={go}
          disabled={!selected}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-ink)] px-8 py-3.5 font-[family-name:var(--font-display)] text-lg font-bold text-[var(--brand-cream)] shadow-[0_6px_0_0_#0d9488] transition-transform hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_0_#0d9488] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
        >
          {selected ? `Ride as ${selected === "man" ? "him" : "her"} →` : "Pick a traveller"}
        </button>
      </div>
    </main>
  );
}
