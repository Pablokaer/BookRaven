import { apiUrl, authHeaders } from "./api";

/**
 * Server-Sent Events client built on fetch (instead of EventSource) so it can send the
 * Authorization header used by the native app. Reconnects with backoff.
 */
type Handler = (event: string, data: any) => void;

const handlers = new Set<Handler>();
let controller: AbortController | null = null;
let running = false;
let generation = 0;

export function onServerEvent(handler: Handler) {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function startEvents() {
  if (running) return;
  running = true;
  void loop(++generation);
}

export function stopEvents() {
  running = false;
  generation++;
  controller?.abort();
  controller = null;
}

async function loop(gen: number) {
  let delay = 1000;
  const alive = () => running && gen === generation;
  while (alive()) {
    controller = new AbortController();
    try {
      const res = await fetch(apiUrl("/api/events"), {
        headers: { Accept: "text/event-stream", ...authHeaders() },
        credentials: "include",
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 401) {
        if (alive()) running = false;
        return;
      }
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
      delay = 1000;
      await readStream(res.body);
    } catch {
      if (!alive()) return;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
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
