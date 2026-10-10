"use client";

import { useRef, useState } from "react";
import { MAX_STOPS, move, newStop, stopLetter, stopTone, type Stop } from "@/lib/stops";
import PlaceInput from "./PlaceInput";

interface Props {
  stops: Stop[];
  onChange(stops: Stop[]): void;
  pickId: string | null;
  onPick(id: string | null): void;
}

const iconBtn =
  "grid h-5 w-6 place-items-center rounded text-[11px] leading-none text-[var(--color-muted)] hover:bg-slate-500/10 disabled:opacity-30 disabled:hover:bg-transparent";

/** Google-Maps-style stop list: type, drag (or use the arrows) to reorder, remove, add more. */
export default function StopsEditor({ stops, onChange, pickId, onPick }: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);

  const set = (i: number, value: Stop["value"]) => onChange(stops.map((s, k) => (k === i ? { ...s, value } : s)));
  const label = (i: number) => (i === 0 ? "From" : i === stops.length - 1 ? "To" : `Stop ${stopLetter(i)}`);

  return (
    <div className="space-y-2">
      <ol className="space-y-2" aria-label="Trip stops">
        {stops.map((s, i) => (
          <li
            key={s.id}
            ref={(el) => {
              rows.current[i] = el;
            }}
            onDragOver={(e) => {
              if (dragIdx === null) return;
              e.preventDefault();
              setOverIdx(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx !== null) onChange(move(stops, dragIdx, i));
              setDragIdx(null);
              setOverIdx(null);
            }}
            className={`flex items-center gap-1 rounded-xl ${dragIdx === i ? "opacity-40" : ""} ${
              overIdx === i && dragIdx !== null && dragIdx !== i ? "ring-2 ring-teal-600/60" : ""
            }`}
          >
            <span
              draggable
              role="img"
              aria-label={`Drag to reorder ${label(i)}`}
              title="Drag to reorder"
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", s.id);
                const row = rows.current[i];
                if (row) e.dataTransfer.setDragImage(row, 16, 16);
              }}
              onDragEnd={() => {
                setDragIdx(null);
                setOverIdx(null);
              }}
              className="cursor-grab select-none px-0.5 text-sm text-[var(--color-muted)] active:cursor-grabbing"
            >
              ⋮⋮
            </span>
            <div className="min-w-0 flex-1">
              <PlaceInput
                label={label(i)}
                marker={stopLetter(i)}
                tone={stopTone(i, stops.length)}
                value={s.value}
                onChange={(v) => set(i, v)}
                picking={pickId === s.id}
                onPickOnMap={() => onPick(pickId === s.id ? null : s.id)}
              />
            </div>
            <div className="flex shrink-0 flex-col">
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => onChange(move(stops, i, i - 1))} aria-label={`Move ${label(i)} up`}>
                ▲
              </button>
              <button
                type="button"
                className={iconBtn}
                disabled={i === stops.length - 1}
                onClick={() => onChange(move(stops, i, i + 1))}
                aria-label={`Move ${label(i)} down`}
              >
                ▼
              </button>
            </div>
            {stops.length > 2 ? (
              <button type="button" className={`${iconBtn} h-6 w-6 text-sm`} onClick={() => onChange(stops.filter((_, k) => k !== i))} aria-label={`Remove ${label(i)}`}>
                ✕
              </button>
            ) : (
              <span className="w-6 shrink-0" aria-hidden />
            )}
          </li>
        ))}
      </ol>
      {stops.length < MAX_STOPS && (
        <button
          type="button"
          onClick={() => onChange([...stops.slice(0, -1), newStop(), stops[stops.length - 1]])}
          className="rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-600/10 dark:text-teal-400"
        >
          + Add stop
        </button>
      )}
    </div>
  );
}
