import { useCallback, useState } from 'react';

/**
 * State that survives a reload. Guarded because localStorage throws in a
 * sandboxed iframe and in private-mode Safari — a preference is never worth
 * taking the page down for.
 *
 * Values are JSON-encoded, so objects and arrays (favourites, filters) persist
 * as readily as the plain strings this originally held.
 */
export function usePersistentState<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Preference simply won't persist; the UI still works.
        }
        return next;
      });
    },
    [key],
  );

  return [value, set];
}

function read<T>(key: string, fallback: T): T {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    // Values written before this hook stored JSON are bare strings (`feed`, not
    // `"feed"`), and JSON.parse rejects them. Treat the raw text as the value
    // rather than silently resetting a preference someone deliberately set; the
    // next write re-encodes it properly.
    return raw as unknown as T;
  }
}
