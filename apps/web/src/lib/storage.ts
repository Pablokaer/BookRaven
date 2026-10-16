/**
 * localStorage that never throws: it can be absent, full or blocked (private mode), and
 * everything kept there is optional. Reads fall back, writes are dropped.
 */

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The stored JSON value, or `fallback` when it is missing, null or unreadable. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* full or blocked */
  }
}

export const writeJson = (key: string, value: unknown) => writeString(key, JSON.stringify(value));

export function removeKey(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* unavailable: nothing stored */
  }
}
