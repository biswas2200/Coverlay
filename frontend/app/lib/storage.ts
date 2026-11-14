import { useEffect, useState } from 'react';

// Small per-browser memories for the clickable preview (the wallet balance, the board, a draft). Losing one costs
// nothing, so every read and write tolerates a browser that blocks storage instead of breaking the page.

export function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the page works without it.
  }
}

/**
 * State that survives a reload, with the way it is read in the caller's hands: `load` gets what is stored (or null)
 * and returns the state to start from, so it can validate, convert an older shape, or fall back to a sample. The
 * state is written back whenever it changes.
 */
export function useStoredValue<T>(key: string, load: (stored: unknown) => T) {
  const [value, setValue] = useState<T>(() => load(readJson(key)));
  useEffect(() => {
    writeJson(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}

/** `useStoredValue` for the common case: keep what is stored when `isValid` accepts it, else start from `fallback()`. */
export function useStoredState<T>(key: string, fallback: () => T, isValid: (value: unknown) => boolean = () => true) {
  return useStoredValue<T>(key, (saved) => (saved !== null && isValid(saved) ? (saved as T) : fallback()));
}
