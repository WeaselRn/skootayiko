"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Coordinate } from "@/schema/route";

export interface PlaceValue {
  name: string;
  location: Coordinate;
}

interface Suggestion {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
}

interface Props {
  label: string;
  marker: "A" | "B";
  value: PlaceValue | null;
  onChange(v: PlaceValue | null): void;
  picking: boolean;
  onPickOnMap(): void;
}

export default function PlaceInput({ label, marker, value, onChange, picking, onPickOnMap }: Props) {
  const [text, setText] = useState(value?.name ?? "");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const [error, setError] = useState("");
  const listId = useId();
  const typed = useRef(false);

  useEffect(() => {
    setText(value?.name ?? "");
    typed.current = false;
  }, [value]);

  useEffect(() => {
    if (!typed.current) return;
    const q = text.trim();
    if (q.length < 3) {
      setItems([]);
      setStatus("idle");
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Search failed");
        setItems(json.places);
        setStatus(json.places.length ? "idle" : "empty");
        setActive(-1);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setStatus("error");
        setOpen(true);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text]);

  const choose = (s: Suggestion) => {
    onChange({ name: s.name, location: { lat: s.lat, lon: s.lon } });
    setOpen(false);
  };

  return (
    <div className="relative">
      <label className="sr-only" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-3 focus-within:ring-2 focus-within:ring-teal-600/40">
        <span
          aria-hidden
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${marker === "A" ? "bg-slate-900" : "bg-rose-700"}`}
        >
          {marker}
        </span>
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-[var(--color-muted)]"
          placeholder={label}
          value={text}
          autoComplete="off"
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            if (!e.target.value) onChange(null);
          }}
          onFocus={() => items.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || !items.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              choose(items[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        <button
          type="button"
          onClick={onPickOnMap}
          aria-pressed={picking}
          title="Pick on map"
          className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${picking ? "bg-teal-600 text-white" : "text-[var(--color-muted)] hover:bg-slate-500/10"}`}
        >
          {picking ? "Click map…" : "Map"}
        </button>
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] py-1 text-sm shadow-lg"
        >
          {status === "error" && <li className="px-3 py-2 text-amber-700">{error}</li>}
          {status === "empty" && <li className="px-3 py-2 text-[var(--color-muted)]">No places found in Kochi.</li>}
          {items.map((s, i) => (
            <li
              key={s.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-teal-600/10" : "hover:bg-slate-500/10"}`}
            >
              <div className="font-medium">{s.name}</div>
              <div className="truncate text-xs text-[var(--color-muted)]">{s.address}</div>
            </li>
          ))}
        </ul>
      )}
      {status === "loading" && <span className="sr-only">Searching…</span>}
    </div>
  );
}
