import { beforeEach, describe, expect, it, vi } from "vitest";

// Live events from the server, sent by the test.
const live = vi.hoisted(() => new Set<(event: string, data: unknown) => void>());
vi.mock("./events", () => ({
  RECONNECTED: "reconnected",
  onServerEvent: (handler: (event: string, data: unknown) => void) => {
    live.add(handler);
    return () => live.delete(handler);
  },
}));
const serverEvent = (event: string, data: unknown = {}) => live.forEach((h) => h(event, data));

// The server's catalog: each download is counted.
const downloads = vi.hoisted(() => ({ count: 0 }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  apiJson: async () => {
    downloads.count++;
    return [];
  },
}));

const { listPublicBooks } = await import("./publicLibrary");

/** Whether listing the catalog downloads it again. */
async function downloadsAgain() {
  const before = downloads.count;
  await listPublicBooks();
  return downloads.count > before;
}

beforeEach(async () => {
  serverEvent("public.changed");
  await listPublicBooks();
});

describe("public catalog cache", () => {
  it("is reused while nothing changed", async () => {
    expect(await downloadsAgain()).toBe(false);
    serverEvent("book.updated", { id: "a" });
    serverEvent("progress.updated", { bookId: "a" });
    expect(await downloadsAgain()).toBe(false);
  });

  it.each(["public.changed", "book.created", "book.deleted", "reconnected"])("is downloaded again after %s", async (event) => {
    serverEvent(event, { id: "a" });
    expect(await downloadsAgain()).toBe(true);
    expect(await downloadsAgain()).toBe(false);
  });
});
