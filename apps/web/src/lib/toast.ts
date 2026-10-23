/**
 * Short messages at the bottom of the screen ("Sent to your e-readers"), drawn by
 * components/ui/Toaster.tsx. One at a time: a new one replaces the one showing.
 */

export type Toast = { id: number; message: string; tone: "info" | "error" };

type Listener = (toast: Toast | null) => void;

const listeners = new Set<Listener>();
let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;

function emit() {
  for (const l of listeners) l(current);
}

/** Shows `message` for a few seconds (longer for errors). */
export function showToast(message: string, tone: Toast["tone"] = "info") {
  current = { id: nextId++, message, tone };
  clearTimeout(timer);
  timer = setTimeout(dismissToast, tone === "error" ? 6000 : 3500);
  emit();
}

export function dismissToast() {
  clearTimeout(timer);
  current = null;
  emit();
}

/** Calls `listener` with the toast showing now and every change; returns the unsubscribe. */
export function onToast(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
