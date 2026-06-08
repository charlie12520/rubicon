import { useEffect, useState } from "react";
import type { SpxMaContextPayload } from "../shared/types";
import { fetchSpxMaContext } from "./api";

// Module-level cache so the trailing warmup window for a date is fetched once and
// shared across the Daily Review and Replay charts (instant cheat-code re-toggle).
const cache = new Map<string, SpxMaContextPayload>();
const inflight = new Map<string, Promise<SpxMaContextPayload>>();

function loadContext(date: string, signal?: AbortSignal): Promise<SpxMaContextPayload> {
  const cached = cache.get(date);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = inflight.get(date);
  if (pending) {
    return pending;
  }
  const promise = fetchSpxMaContext(date, signal)
    .then((payload) => {
      cache.set(date, payload);
      inflight.delete(date);
      return payload;
    })
    .catch((error) => {
      inflight.delete(date);
      throw error;
    });
  inflight.set(date, promise);
  return promise;
}

/**
 * Lazily fetch (and cache) the multi-day MA warmup context for `date`, only once
 * `enabled` (the cheat-code toggle) is true. Returns null until loaded; on failure
 * stays null so the overlay builder degrades to an honest single-session line.
 */
export function useSpxMaContext(date: string | null, enabled: boolean): SpxMaContextPayload | null {
  const [context, setContext] = useState<SpxMaContextPayload | null>(() =>
    date ? cache.get(date) ?? null : null,
  );

  useEffect(() => {
    if (!enabled || !date) {
      return;
    }
    const cached = cache.get(date);
    if (cached) {
      setContext(cached);
      return;
    }
    let active = true;
    const controller = new AbortController();
    loadContext(date, controller.signal)
      .then((payload) => {
        if (active) {
          setContext(payload);
        }
      })
      .catch(() => {
        if (active) {
          setContext(null);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [date, enabled]);

  return date && context?.date === date ? context : date ? cache.get(date) ?? null : null;
}
