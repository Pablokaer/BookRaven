import { apiUrl, authHeaders } from "./api";

/**
 * Server-Sent Events client built on fetch (instead of EventSource) so it can send the
 * Authorization header used by the native app. Reconnects with backoff, at once when the device
 * comes back online or the app back to the screen. Events sent while it was disconnected are
 * lost: after a reconnection subscribers get a "reconnected" event and reload what they show.
 */
type Handler = (event: string, data: any) => void;

/** Sent to subscribers (with `{}`) when the connection is back after a drop or a failed first try. */
export const RECONNECTED = "reconnected";

const handlers = new Set<Handler>();
let controller: AbortController | null = null;
let running = false;
let generation = 0;
let connected = false;
/** Ends the wait before the next attempt (the backoff delay, or the wait after a 401). */
let wake: (() => void) | null = null;
/** Asked to retry now: the next wait starts again from the shortest delay. */
let resetBackoff = false;
/** Came back online during an attempt: retry as soon as it ends, without waiting. */
let skipWait = false;

export function onServerEvent(handler: Handler) {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

/** The live connection is open: changes made elsewhere arrive as they happen. */
export const eventsConnected = () => connected;

export function startEvents() {
  if (running) return;
  running = true;
  resetBackoff = skipWait = false;
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  void loop(++generation);
}

export function stopEvents() {
  running = false;
  generation++;
  connected = false;
  controller?.abort();
  controller = null;
  window.removeEventListener("online", onOnline);
  document.removeEventListener("visibilitychange", onVisible);
  retryNow();
}

/**
 * Tries again now if the connection is down (waiting out a backoff, or stopped by a 401: the
 * session may have been renewed since). Does nothing while connected.
 */
export function retryEvents() {
  if (running && !connected) retryNow();
}

function retryNow() {
  resetBackoff = true;
  wake?.();
}

// Back online: the open connection (if any) went through the old network and may be dead.
function onOnline() {
  if (!wake) skipWait = true;
  if (connected) controller?.abort();
  retryNow();
}

function onVisible() {
  if (document.visibilityState === "visible") retryEvents();
}

/** Waits `ms` (forever when null), or until `retryNow()`. */
function pause(ms: number | null) {
  return new Promise<void>((resolve) => {
    const timer = ms === null ? undefined : setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (wake === done) wake = null;
      resolve();
    }
    wake = done;
  });
}

async function loop(gen: number) {
  let delay = 1000;
  let attempts = 0;
  const alive = () => running && gen === generation;
  while (alive()) {
    controller = new AbortController();
    let unauthorized = false;
    try {
      const res = await fetch(apiUrl("/api/events"), {
        headers: { Accept: "text/event-stream", ...authHeaders() },
        credentials: "include",
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 401) unauthorized = true;
      else {
        if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
        delay = 1000;
        connected = true;
        skipWait = false;
        // Anything that changed while disconnected was missed (the first try needs no catch-up).
        if (attempts > 0) handlers.forEach((h) => h(RECONNECTED, {}));
        await readStream(res.body);
      }
    } catch {
      /* dropped or unreachable: try again below */
    }
    if (!alive()) return;
    connected = false;
    attempts++;
    if (skipWait) {
      skipWait = resetBackoff = false;
      delay = 1000;
      continue;
    }
    resetBackoff = false;
    // After a 401 there is no point in trying on a timer: wait for a sign the session may be
    // valid again (back online, back on screen, the session refetched), one attempt each.
    await pause(unauthorized ? null : delay);
    delay = resetBackoff ? 1000 : Math.min(delay * 2, 30_000);
    resetBackoff = false;
  }
}

async function readStream(body: ReadableStream<Uint8Array>) {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.join("\n"));
      } catch {
        continue;
      }
      handlers.forEach((h) => h(event, parsed));
    }
  }
}
