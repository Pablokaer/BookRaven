import { fractionLocator } from "@bookraven/locator";
import { keptForAccount } from "./accountData";
import { apiFetch, apiJson, type Progress } from "./api";
import { deviceId, deviceName } from "./device";
import { onServerEvent } from "./events";
import { createOutbox, localStorageStore } from "./outbox";

/**
 * Reading positions on this device: saving them, and which position wins when the server and
 * this device disagree.
 *  - A position is stored on the device first and sent a moment later (lib/outbox), so turning
 *    pages quickly sends one request and nothing is lost offline or when the app closes. Waiting
 *    positions go at once when the page is hidden (and with every other change when back online
 *    or signing out, lib/accountData).
 *  - Each position carries the time it was reached; the newest wins, on the server (a device
 *    syncing late never overwrites newer progress) and here: a book opens at this device's
 *    unsent position when it is newer than the server's, and a position reached on another
 *    device is offered only when it is newer than what was read here.
 */

export type Position = { locator: string; percentage: number; label: string | null };
/** A position as the server keeps it: when it was reached, and on which device. */
export type SavedPosition = Pick<Progress, "locator" | "updatedAt"> & { deviceId?: string | null };
type Pending = Position & { bookId: string; clientUpdatedAt: number };

/** Positions reached in quick succession (turning pages) go as one request. */
const DEBOUNCE_MS = 1500;

/** Set while the page is being hidden: the request must outlive it. */
let leaving = false;

const outbox = createOutbox<Pending>({
  // The first version kept one position per book in an object; it is brought over once.
  store: localStorageStore<Pending>("readsync.progressQueue", {
    key: "readsync.progressOutbox",
    convert: (old) => Object.values(old as Record<string, Pending>).sort((a, b) => a.clientUpdatedAt - b.clientUpdatedAt),
  }),
  key: (p) => p.bookId,
  delay: DEBOUNCE_MS,
  send: ([p]) =>
    apiFetch(`/api/books/${p!.bookId}/progress`, {
      method: "PUT",
      keepalive: leaving,
      body: JSON.stringify({
        locator: p!.locator,
        percentage: Math.min(1, Math.max(0, p!.percentage)),
        label: p!.label,
        deviceId,
        deviceName,
        clientUpdatedAt: p!.clientUpdatedAt,
      }),
    }),
});

/** Time (ms) of the last position this device reached in each book, sent or not. */
const reachedHere = new Map<string, number>();
/** The server position each book last opened at (its `updatedAt`): nothing new to offer. */
const openedFrom = new Map<string, string>();

const time = (p: SavedPosition) => new Date(p.updatedAt).getTime();

/** This device's newest position in the book not yet accepted by the server. */
function unsent(bookId: string) {
  let newest: Pending | null = null;
  for (const p of outbox.pending()) if (p.bookId === bookId && (!newest || p.clientUpdatedAt > newest.clientUpdatedAt)) newest = p;
  return newest;
}

const lastReachedHere = (bookId: string) => reachedHere.get(bookId) ?? unsent(bookId)?.clientUpdatedAt ?? 0;

/** Saves the reader's position in a book: stored at once, sent shortly (or when back online). */
export function savePosition(bookId: string, pos: Position) {
  const pending: Pending = { ...pos, bookId, clientUpdatedAt: Date.now() };
  reachedHere.set(bookId, pending.clientUpdatedAt);
  outbox.push(pending);
}

/**
 * Where the book opens, given the server's position (null: never opened anywhere): this device's
 * unsent position when it is newer, else the server's.
 */
export function openingLocator(bookId: string, server: SavedPosition | null | undefined): string | null {
  if (server) openedFrom.set(bookId, server.updatedAt);
  else openedFrom.delete(bookId);
  const local = unsent(bookId);
  if (local && (!server || local.clientUpdatedAt > time(server))) return local.locator;
  return server?.locator ?? null;
}

/**
 * Whether a position the server has (from the live events, or asked for) is worth offering to
 * the reader at `current` ("continue where you left off on another device"): reached on another
 * device, after anything read here, somewhere else, and not the one the book opened at.
 */
export function worthOffering(bookId: string, remote: SavedPosition, current: Position | null): boolean {
  if (remote.deviceId === deviceId) return false;
  if (time(remote) <= lastReachedHere(bookId)) return false;
  if (openedFrom.get(bookId) === remote.updatedAt) return false;
  return current?.locator !== remote.locator;
}

/** A book's position changed on the server (live): `elsewhere` when it was reached on another device. */
export function onPositionChange(listener: (p: Progress & { bookId: string }, elsewhere: boolean) => void) {
  return onServerEvent((event, data) => {
    if (event === "progress.updated") listener(data, !!data.deviceId && data.deviceId !== deviceId);
  });
}

/** Sends the waiting positions now (closing a book); resolves once answered. */
export function flushPositions() {
  return outbox.flush();
}

/** The page is being hidden (closed, switched away from, app sent to the background): positions go now. */
function flushOnLeave() {
  leaving = true;
  void outbox.flush().finally(() => (leaving = false));
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushOnLeave);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushOnLeave());
}

keptForAccount({
  flush: flushPositions,
  // Signing out: the next account must not send (or open at) these positions.
  async forget() {
    reachedHere.clear();
    openedFrom.clear();
    await outbox.clear();
  },
});

export function fetchProgress(bookId: string) {
  return apiJson<Progress | null>(`/api/books/${bookId}/progress`);
}

/**
 * Marks a book as finished at `at` (an import from another app): at 100%, which every reader
 * opens on the last page. The server keeps the newest position, so a book read since then keeps
 * its real place.
 */
export function markFinished(bookId: string, at: Date) {
  return apiJson<{ applied: boolean }>(`/api/books/${bookId}/progress`, {
    method: "PUT",
    body: JSON.stringify({ locator: fractionLocator(1), percentage: 1, label: null, deviceId, deviceName: "Import", clientUpdatedAt: Math.min(at.getTime(), Date.now()) }),
  });
}
