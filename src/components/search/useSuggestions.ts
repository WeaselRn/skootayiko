"use client";

import { useEffect, useState } from "react";
import type { Coordinate } from "@/schema/route";
import { SuggestResponse, type Suggestion } from "@/schema/suggest";

export type SuggestState =
  | { kind: "off" }
  | { kind: "loading"; items: Suggestion[] }
  | { kind: "ready"; items: Suggestion[]; partial: boolean }
  | { kind: "error"; message: string; items: Suggestion[] };

interface Params {
  enabled: boolean;
  /** Filled-in stops in order. */
  stops: Coordinate[];
  /** Real route geometry when a matching plan exists. */
  path?: Coordinate[];
  interests: string[];
  maxOffRouteM: number;
}

/** Fetches sights near the route whenever the stops, route or preferences change (debounced). */
export function useSuggestions({ enabled, stops, path, interests, maxOffRouteM }: Params): SuggestState {
  const [state, setState] = useState<SuggestState>({ kind: "off" });
  const body = JSON.stringify({ stops, path, interests, maxOffRouteM });
  const active = enabled && stops.length >= 2 && interests.length > 0;

  useEffect(() => {
    if (!active) {
      setState({ kind: "off" });
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setState((s) => ({ kind: "loading", items: s.kind === "off" ? [] : s.items }));
      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: ctl.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        const parsed = SuggestResponse.parse(json);
        setState({ kind: "ready", items: parsed.suggestions, partial: parsed.partial });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setState((s) => ({ kind: "error", message: (e as Error).message, items: s.kind === "off" ? [] : s.items }));
      }
    }, 700);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [active, body]);

  return state;
}
