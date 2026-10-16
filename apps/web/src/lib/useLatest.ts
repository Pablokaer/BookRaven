import { useEffect, useRef } from "react";

/** A ref holding the latest `value`, for listeners that should not subscribe again when it changes. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Listens to `type` events on the document (while `enabled`), always with the latest `handler`. */
export function useDocumentEvent<K extends keyof DocumentEventMap>(type: K, handler: (e: DocumentEventMap[K]) => void, enabled = true) {
  const latest = useLatest(handler);
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: DocumentEventMap[K]) => latest.current(e);
    document.addEventListener(type, listener);
    return () => document.removeEventListener(type, listener);
  }, [type, enabled, latest]);
}
