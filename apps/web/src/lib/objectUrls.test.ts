import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectUrlCache } from "./objectUrls";

let made = 0;
const revoked: string[] = [];
const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  made = 0;
  revoked.length = 0;
  URL.createObjectURL = () => `blob:${++made}`;
  URL.revokeObjectURL = (url: string) => void revoked.push(url);
});
afterEach(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("cover object URLs", () => {
  it("loads an image once however many places show it", async () => {
    const load = vi.fn(async () => new Blob(["img"]));
    const images = new ObjectUrlCache(load, 2);
    const a = images.acquire("/c/1");
    const b = images.acquire("/c/1");
    expect(await a.url).toBe("blob:1");
    expect(await b.url).toBe("blob:1");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a few images no longer shown and releases the oldest, never one in use", async () => {
    const images = new ObjectUrlCache(async () => new Blob(["img"]), 2);
    const shown = images.acquire("/c/0"); // stays on screen
    const held = ["/c/1", "/c/2", "/c/3", "/c/4"].map((key) => images.acquire(key));
    await Promise.all([shown.url, ...held.map((h) => h.url)]);
    held.forEach((h) => h.release());
    held[0]!.release(); // twice: counted once
    await flush();
    // Two released ones kept (the most recent), the two oldest revoked.
    expect(revoked).toEqual(["blob:2", "blob:3"]);

    // A kept one is reused without loading again; a revoked one loads anew.
    expect(await images.acquire("/c/4").url).toBe("blob:5");
    expect(await images.acquire("/c/1").url).toBe("blob:6");
    expect(await shown.url).toBe("blob:1");
  });

  it("tries a failed image again next time, but not a missing one", async () => {
    const load = vi.fn<(key: string) => Promise<Blob | null>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
    const images = new ObjectUrlCache(load, 10);
    expect(await images.acquire("/c/1").url).toBeNull();
    expect(await images.acquire("/c/1").url).toBeNull();
    expect(await images.acquire("/c/1").url).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
