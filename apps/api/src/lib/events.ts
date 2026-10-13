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

export function publish(userId: string, event: string, data: unknown) {
  const set = streams.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of set) {
    try {
      reply.raw.write(payload);
    } catch {
      set.delete(reply);
    }
  }
}

/** Sends an event to every connected user (e.g. the public library changed). */
export function broadcast(event: string, data: unknown) {
  for (const userId of streams.keys()) publish(userId, event, data);
}

export function connectionCount() {
  let n = 0;
  for (const set of streams.values()) n += set.size;
  return n;
}
