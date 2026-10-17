import { afterEach, describe, expect, it, vi } from "vitest";
import { eventsConnected, eventsLiveSince, startEvents, stopEvents } from "./events";

afterEach(() => {
  stopEvents();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("live events", () => {
  it("count as live since a moment only when connected before it and still heard from", async () => {
    let send!: (text: string) => void;
    const body = new ReadableStream<Uint8Array>({ start: (c) => void (send = (text) => c.enqueue(new TextEncoder().encode(text))) });
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, ok: true, body })));
    const before = Date.now() - 1000;

    startEvents();
    await vi.waitFor(() => expect(eventsConnected()).toBe(true));
    const opened = Date.now();
    expect(eventsLiveSince(opened)).toBe(true);
    expect(eventsLiveSince(before)).toBe(false); // it connected later: events may have been missed

    // Silent for over a minute (a phone asleep): the connection may be dead.
    const later = opened + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect(eventsLiveSince(opened)).toBe(false);

    send(": ping\n\n");
    await vi.waitFor(() => expect(eventsLiveSince(opened)).toBe(true));
  });
});
