import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OtherApps } from "./OtherApps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Other apps: KOReader setup", () => {
  let container: HTMLDivElement;
  let root: Root;
  let passwords: { id: string; name: string; createdAt: string; lastUsedAt: null }[];
  let deliveries: { id: string; bookId: string; title: string; author: string | null; format: string; hasCover: boolean; sentAt: string; deliveredTo: { name: string; at: string }[] }[];
  let deleted: string[];

  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
  /** The value shown under a label in the setup steps. */
  const values = (label: string) =>
    [...container.querySelectorAll(".eyebrow")].filter((e) => e.textContent === label).map((e) => e.nextElementSibling!.textContent);

  beforeEach(async () => {
    passwords = [];
    deleted = [];
    const now = new Date().toISOString();
    deliveries = [
      { id: "d1", bookId: "b1", title: "Dune", author: "Frank Herbert", format: "epub", hasCover: false, sentAt: now, deliveredTo: [{ name: "Kindle", at: now }] },
      { id: "d2", bookId: "b2", title: "Emma", author: null, format: "pdf", hasCover: false, sentAt: now, deliveredTo: [] },
    ];
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname.startsWith("/api/deliveries")) {
        if (init?.method === "DELETE") {
          deleted.push(url.pathname);
          deliveries = deliveries.filter((d) => !url.pathname.endsWith(d.id));
          return new Response(null, { status: 204 });
        }
        return Response.json(deliveries);
      }
      if (url.pathname !== "/api/app-passwords") return Response.json({});
      if (init?.method === "POST") {
        const { name } = JSON.parse(init.body as string) as { name: string };
        passwords.unshift({ id: "p1", name, createdAt: new Date().toISOString(), lastUsedAt: null });
        return Response.json({ id: "p1", name, password: "otter-pecan-quilt-lunar-robin-tulip" }, { status: 201 });
      }
      return Response.json(passwords);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <OtherApps email="reader@example.com" />
        </MemoryRouter>,
      ),
    );
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows this server's catalog and sync addresses and the account's email", () => {
    const origin = window.location.origin;
    expect(values("Catalog URL")).toEqual([`${origin}/opds`]);
    expect(values("Sync server")).toEqual([`${origin}/kosync`]);
    expect(values("Username")).toEqual(["reader@example.com"]);
    expect(values("Password")).toEqual(["Your app password"]);
    expect(container.textContent).toContain("Binary");
    expect(container.querySelector('[aria-label="Copy Catalog URL"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Copy Password"]')).toBeNull(); // nothing to copy yet
  });

  it("shows a new app password in the steps, once, until hidden", async () => {
    vi.stubGlobal("prompt", () => "Kindle Paperwhite");
    await act(async () => button("Create an app password").click());
    await flush();

    expect(values("App password")).toEqual(["otter-pecan-quilt-lunar-robin-tulip"]);
    expect(values("Password")).toEqual(["otter-pecan-quilt-lunar-robin-tulip"]);
    expect(container.textContent).toContain("For “Kindle Paperwhite”");
    expect(container.querySelector('[aria-label="Copy App password"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Copy Password"]')).not.toBeNull();
    expect([...container.querySelectorAll("ul li")].some((li) => li.textContent?.includes("Kindle Paperwhite"))).toBe(true); // and in the list

    await act(async () => (container.querySelector('[aria-label="Hide the password"]') as HTMLButtonElement).click());
    expect(container.textContent).not.toContain("otter-pecan");
    expect(values("Password")).toEqual(["Your app password"]);
  });

  it("links the BookRaven plugin, with the server to type in its settings", () => {
    const origin = window.location.origin;
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("Download the plugin"))!;
    expect(link.getAttribute("href")).toBe(`${origin}/koreader/bookraven.koplugin.zip`);
    expect(values("Server")).toEqual([origin]);
    expect(container.textContent).toContain("highlights, notes and bookmarks");
    expect(container.textContent).toContain("/mnt/us/koreader/plugins");
  });

  it("lists the books sent to the e-readers, and stops sending one", async () => {
    const rows = () => [...container.querySelectorAll("li")].filter((li) => li.querySelector('[aria-label^="Stop sending"]'));
    expect(rows().map((li) => li.textContent)).toEqual([expect.stringContaining("On Kindle"), expect.stringContaining("Waiting for your e-readers")]);
    expect(rows()[0]!.querySelector("a")!.getAttribute("href")).toBe("/books/b1");

    await act(async () => (container.querySelector('[aria-label="Stop sending Emma"]') as HTMLButtonElement).click());
    await flush();
    expect(deleted).toEqual(["/api/deliveries/d2"]);
    expect(rows().map((li) => li.querySelector("a")!.textContent)).toEqual(["Dune"]);
  });
});
