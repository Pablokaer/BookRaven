import type { FastifyReply } from "fastify";

/**
 * In-memory Server-Sent Events hub: userId -> open streams.
 * Fine for a single API instance. To run several instances, publish through
 * Postgres LISTEN/NOTIFY and call `deliver` from the listener on each instance.
 */
const streams = new Map<string, Set<FastifyReply>>();

export function subscribe(userId: string, reply: FastifyReply) {
  let set = streams.get(userId);
  if (!set) streams.set(userId, (set = new Set()));
  set.add(reply);
  return () => {
    set!.delete(reply);
    if (set!.size === 0) streams.delete(userId);
  };
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function send(set: Set<FastifyReply>, payload: string) {
  for (const reply of set) {
    try {
      reply.raw.write(payload);
    } catch {
      set.delete(reply);
    }
  }
}

export function publish(userId: string, event: string, data: unknown) {
  const set = streams.get(userId);
  if (set) send(set, frame(event, data));
}

const listeners = new Map<string, (() => void)[]>();

/**
 * Runs `fn` whenever `event` is broadcast in this process, before it goes out: e.g. to forget a
 * cache it makes stale, so the clients that reload on it get fresh data.
 */
export function onBroadcast(event: string, fn: () => void) {
  listeners.set(event, [...(listeners.get(event) ?? []), fn]);
}

/** Sends an event to every connected user (e.g. the public library changed). */
export function broadcast(event: string, data: unknown) {
  for (const fn of listeners.get(event) ?? []) fn();
  const payload = frame(event, data);
  for (const set of streams.values()) send(set, payload);
}

export function connectionCount() {
  let n = 0;
  for (const set of streams.values()) n += set.size;
  return n;
}
