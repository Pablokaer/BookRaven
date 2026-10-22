import { keptForAccount } from "./accountData";
import { apiFetch, apiJson, type Progress } from "./api";
import { deviceId, deviceName } from "./device";
import { retryDelay, settle } from "./outbox";
import { readJson, removeKey, writeJson } from "./storage";

/**
 * Saves reading positions to the server.
 *  - Debounced, so flipping pages quickly sends one request.
 *  - Every position is first written to localStorage ("outbox"), so nothing is lost
 *    when offline or when the tab is closed; the outbox is flushed when back online.
 *  - Each position carries the time it was reached; the server keeps the newest one.
 *  - Responses follow the outbox rules (lib/outbox): 429, 5xx and network errors are tried again
 *    after a growing delay; a refusal that can't succeed later is dropped.
 */

export type Position = { locator: string; percentage: number; label: string | null };
type Pending = Position & { bookId: string; clientUpdatedAt: number };

const OUTBOX_KEY = "readsync.progressOutbox";
const DEBOUNCE_MS = 1500;

const readOutbox = () => readJson<Record<string, Pending>>(OUTBOX_KEY, {});
const writeOutbox = (outbox: Record<string, Pending>) => writeJson(OUTBOX_KEY, outbox);

/** Position saved on this device but maybe not yet on the server. */
export function getLocalPending(bookId: string): Pending | null {
  return readOutbox()[bookId] ?? null;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;

function retryLater(retryAfter?: string | null) {
  attempt++;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => flushProgress(), retryDelay(attempt, retryAfter));
}
/** Time (ms) of the last position this device produced for a book. */
const lastLocal = new Map<string, number>();

export function lastLocalUpdate(bookId: string) {
  return lastLocal.get(bookId) ?? getLocalPending(bookId)?.clientUpdatedAt ?? 0;
}

export function saveProgress(bookId: string, pos: Position) {
  const pending: Pending = { ...pos, bookId, clientUpdatedAt: Date.now() };
  lastLocal.set(bookId, pending.clientUpdatedAt);
  const outbox = readOutbox();
  outbox[bookId] = pending;
  writeOutbox(outbox);

  clearTimeout(timers.get(bookId));
  timers.set(bookId, setTimeout(() => void send(bookId), DEBOUNCE_MS));
}

async function send(bookId: string, keepalive = false) {
  timers.delete(bookId);
  const pending = readOutbox()[bookId];
  if (!pending) return;
  try {
    const res = await apiFetch(`/api/books/${bookId}/progress`, {
      method: "PUT",
      keepalive,
      body: JSON.stringify({
        locator: pending.locator,
        percentage: Math.min(1, Math.max(0, pending.percentage)),
        label: pending.label,
        deviceId,
        deviceName,
        clientUpdatedAt: pending.clientUpdatedAt,
      }),
    });
    if (settle(res.status) === "retry") return retryLater(res.headers.get("Retry-After"));
    attempt = 0;
    // Saved (or refused for good): remove it, unless something newer was queued meanwhile.
    const outbox = readOutbox();
    if (outbox[bookId]?.clientUpdatedAt === pending.clientUpdatedAt) {
      delete outbox[bookId];
      writeOutbox(outbox);
    }
  } catch {
    retryLater(); // offline: stays in the outbox
  }
}

/** Sends everything immediately (page hide, app background, back online); resolves once answered. */
export async function flushProgress(keepalive = false) {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  await Promise.all(Object.keys(readOutbox()).map((bookId) => send(bookId, keepalive)));
}

/** Drops the positions not yet sent (sign-out: the next account must not send them). */
export function clearProgress() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  clearTimeout(retryTimer);
  attempt = 0;
  lastLocal.clear();
  removeKey(OUTBOX_KEY);
}

keptForAccount({ flush: () => flushProgress(), forget: clearProgress });

export function fetchProgress(bookId: string) {
  return apiJson<Progress | null>(`/api/books/${bookId}/progress`);
}

/**
 * Marks a book as finished at `at` (an import from another app). The server keeps the newest
 * position, so a book read since then keeps its real place.
 */
export function markFinished(bookId: string, at: Date) {
  return apiJson<{ applied: boolean }>(`/api/books/${bookId}/progress`, {
    method: "PUT",
    body: JSON.stringify({ locator: "fraction:1", percentage: 1, label: null, deviceId, deviceName: "Import", clientUpdatedAt: Math.min(at.getTime(), Date.now()) }),
  });
}
