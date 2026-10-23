import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../../lib/api";
import { Toaster } from "../ui/Toaster";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The menu's other actions need the library; only "Send to Kindle" is exercised here.
vi.mock("../../lib/libraryStore", () => ({
  useLibraryActions: () => ({ openShare() {}, openOrganize() {}, removeBook() {}, toggleFavorite() {}, replaceBook() {} }),
}));

const { BookMenu } = await import("./BookActions");

const book = { id: "b1", title: "Dune", author: "Frank Herbert", favorite: false, isPublic: false, progress: null } as unknown as Book;

describe("Send to Kindle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let requests: { url: string; method: string; body: unknown }[];
  let fail: boolean;

  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  const item = (label: string) => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((b) => b.textContent?.trim() === label);

  beforeEach(async () => {
    requests = [];
    fail = false;
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      requests.push({ url: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : null });
      if (fail) return Response.json({ error: "oops" }, { status: 500 });
      return Response.json({ id: "d1", bookId: "b1", title: "Dune", deliveredTo: [] }, { status: 201 });
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root.render(
        <MemoryRouter>
          <BookMenu book={book} />
          <Toaster />
        </MemoryRouter>,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const send = async () => {
    await act(async () => (container.querySelector('[aria-label="More actions for Dune"]') as HTMLButtonElement).click());
    await act(async () => item("Send to Kindle")!.click());
    await flush();
  };

  it("queues the book for the e-readers and says so", async () => {
    await send();
    expect(requests).toEqual([{ url: "/api/deliveries", method: "POST", body: { bookId: "b1" } }]);
    expect(container.querySelector("[role=status]")!.textContent).toContain("“Dune” is on its way to your e-readers");
  });

  it("says when it could not be sent", async () => {
    fail = true;
    await send();
    expect(container.querySelector("[role=status]")!.textContent).toContain("Could not send it");
  });
});
