// ─── usePersistentState ────────────────────────────────────────────────────
// Drop-in replacement for useState that persists to localStorage.
//
// Usage:
//   const [mode, setMode] = usePersistentState<"daily" | "4h">(
//     "chizzle-cc-tf",      // localStorage key (namespace with "chizzle-")
//     "daily",              // default if nothing stored
//   );
//
// • Values are JSON-serialized so any JSON-safe type works (string, number,
//   boolean, arrays, plain objects).
// • Reads happen once on mount via lazy initializer.
// • Writes are debounced to the next microtask so rapid setState calls coalesce.
// • Failure to read/write (private mode, quota, SSR) silently falls back to
//   in-memory state. The hook never throws.

import { useState, useEffect, useRef } from "react";

// v2 prefix — v1 used raw-string serialization for individual keys.
// Bumping the prefix avoids JSON.parse errors on legacy values; users keep
// sane defaults until they toggle once.
const PREFIX = "chizzle/v2/";

/** Read a persisted value outside React (same key format as the hook). */
export function readPersisted<T>(key: string, fallback: T): T { return readFromStorage(key, fallback); }
const SYNC_EVENT = "chizzle:persist";

function readFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeToStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(value);
    if (window.localStorage.getItem(PREFIX + key) === raw) return;
    window.localStorage.setItem(PREFIX + key, raw);
    // Keep every mounted instance using the same key in sync (e.g. inline card + card dialog).
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { key, raw } }));
  } catch {
    // quota exceeded / disabled — silently drop
  }
}

export function usePersistentState<T>(
  key: string,
  defaultValue: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => readFromStorage(key, defaultValue));
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    writeToStorage(keyRef.current, state);
  }, [state]);

  useEffect(() => {
    const on = (e: Event) => {
      const { key: k, raw } = (e as CustomEvent).detail ?? {};
      if (k !== keyRef.current) return;
      setState((cur) => { try { return JSON.stringify(cur) === raw ? cur : (JSON.parse(raw) as T); } catch { return cur; } });
    };
    window.addEventListener(SYNC_EVENT, on);
    return () => window.removeEventListener(SYNC_EVENT, on);
  }, []);

  return [state, setState];
}
