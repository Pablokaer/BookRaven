import { describe, expect, it, vi } from "vitest";
import type { Book, Folder, Progress } from "./api";
import { createLibrary, emptyLibrary, reduceLibrary, type LibraryEffect, type LibraryInput, type LibraryState, type Note } from "./libraryState";

// Live events from the server, sent by the test (for lib/progress's onPositionChange).
const live = vi.hoisted(() => new Set<(event: string, data: any) => void>());
vi.mock("./events", () => ({
  onServerEvent: (handler: (event: string, data: any) => void) => {
    live.add(handler);
    return () => live.delete(handler);
  },
}));

const ME = "user-1";

const book = (id: string, extra: Partial<Book> = {}): Book => ({
  id,
  title: `Book ${id}`,
  author: null,
  format: "epub",
  filename: `${id}.epub`,
  sizeBytes: 1,
  hasCover: false,
  folderId: null,
  tags: [],
  favorite: false,
  isShared: false,
  sharedBy: null,
  sharedAt: null,
  isPublic: false,
  language: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  progress: null,
  ...extra,
});
const folder = (id: string, name: string): Folder => ({ id, name, createdAt: "2026-01-01T00:00:00.000Z" });
const progress = (bookId: string, extra: Partial<Progress> = {}): Progress & { bookId: string } => ({
  bookId,
  locator: "x",
  percentage: 0.42,
  label: null,
  deviceId: "phone",
  deviceName: "Phone",
  updatedAt: "2026-06-01T00:00:00.000Z",
  ...extra,
});

/** Feeds `inputs` in turn, collecting every note and effect. */
function run(inputs: LibraryInput[], state: LibraryState = { ...emptyLibrary(), books: [] }) {
  const notes: Note[] = [];
  const effects: LibraryEffect[] = [];
  for (const input of inputs) {
    const r = reduceLibrary(state, input, { userId: ME });
    state = r.state;
    notes.push(...r.notes);
    effects.push(...r.effects);
  }
  return { state, notes: notes.map((n) => n.text), effects };
}

describe("library reducer", () => {
  it("adds books from other devices, announcing them once, and keeps the newest first", () => {
    const { state, notes, effects } = run([
      { type: "books.loaded", books: [book("a")] },
      { type: "book.created", data: book("b", { createdAt: "2026-02-01T00:00:00.000Z" }) },
      { type: "book.created", data: book("b", { createdAt: "2026-02-01T00:00:00.000Z" }) },
    ]);
    expect(state.books?.map((b) => b.id)).toEqual(["b", "a"]);
    expect(notes).toEqual(["“Book b” was added to your library"]);
    expect(effects).toEqual([{ type: "refreshMe" }, { type: "refreshMe" }]);
  });

  it("does not log an upload from this device twice when its live event follows", () => {
    const uploaded = book("u");
    const { state, notes } = run([{ type: "book.uploaded", book: uploaded }, { type: "book.created", data: uploaded }]);
    expect(state.books?.map((b) => b.id)).toEqual(["u"]);
    expect(notes).toEqual(["Uploaded “Book u”"]);
  });

  it("removes deleted books and forgets what the device kept of them", () => {
    const { state, effects } = run([{ type: "books.loaded", books: [book("a"), book("b")] }, { type: "book.deleted", data: { id: "a" } }]);
    expect(state.books?.map((b) => b.id)).toEqual(["b"]);
    expect(effects).toEqual([{ type: "refreshMe" }, { type: "forgetDeviceBook", bookId: "a" }]);
    expect(run([{ type: "book.removed", id: "b" }], state).state.books).toEqual([]);
  });

  it("replaces updated books", () => {
    const { state } = run([{ type: "books.loaded", books: [book("a")] }, { type: "book.updated", data: book("a", { favorite: true }) }]);
    expect(state.books?.[0]?.favorite).toBe(true);
  });

  it("keeps collections sorted by name, and unfiles the books of a deleted one", () => {
    const { state } = run([
      { type: "books.loaded", books: [book("a", { folderId: "f1" }), book("b", { folderId: "f2" })] },
      { type: "folders.loaded", folders: [folder("f1", "Zebra")] },
      { type: "folder.created", data: folder("f2", "apple") },
      { type: "folder.updated", data: folder("f1", "Banana") },
      { type: "folder.deleted", data: { id: "f1" } },
    ]);
    expect(state.foldersReady).toBe(true);
    expect(state.folders.map((f) => f.name)).toEqual(["apple"]);
    expect(state.books?.map((b) => [b.id, b.folderId])).toEqual([
      ["a", null],
      ["b", "f2"],
    ]);
    const removed = run([{ type: "folder.removed", id: "f2" }], state).state;
    expect(removed.folders).toEqual([]);
    expect(removed.books?.every((b) => b.folderId === null)).toBe(true);
  });

  it("shows positions, announcing only those reached on another device", () => {
    const loaded: LibraryInput = { type: "books.loaded", books: [book("a"), book("b", { createdAt: "2026-03-01T00:00:00.000Z" })] };
    const here = run([loaded, { type: "position", progress: progress("a", { deviceId: "me" }), elsewhere: false }]);
    expect(here.notes).toEqual([]);
    expect(here.state.books?.map((b) => b.id)).toEqual(["a", "b"]); // read most recently first
    const there = run([loaded, { type: "position", progress: progress("a"), elsewhere: true }]);
    expect(there.notes).toEqual(["Reached 42% of “Book a” on Phone"]);
  });

  it("bumps the counters the public library, requests and clubs pages reload on", () => {
    const { state, notes, effects } = run([
      { type: "public.changed", data: {} },
      { type: "requests.changed", data: {} },
      { type: "request.fulfilled", data: { requestId: "r", title: "Dune", bookId: "p" } },
      { type: "club.message", data: { clubId: "c", clubName: "Readers", author: "Ana", fromId: "user-2" } },
      { type: "club.message", data: { clubId: "c", clubName: "Readers", author: "Me", fromId: ME } },
      { type: "club.member", data: { clubId: "c" } },
      { type: "admin.report", data: { title: "Spam" } },
    ]);
    expect([state.publicVersion, state.requestsVersion, state.clubsVersion]).toEqual([1, 2, 3]);
    expect(notes).toEqual([
      "Your request “Dune” was answered: it is in the Public Library now",
      "Ana wrote in “Readers”",
      "New report about “Spam” is waiting in the admin panel",
    ]);
    expect(effects).toEqual([]);
  });

  it("reloads everything after a reconnection", () => {
    const { state, effects } = run([{ type: "reconnected", data: {} }]);
    expect([state.publicVersion, state.requestsVersion, state.clubsVersion]).toEqual([1, 1, 1]);
    expect(effects).toEqual([{ type: "reload" }, { type: "refreshMe" }]);
  });

  it("keeps the shown list when it cannot load, and an empty one when there was none", () => {
    expect(run([{ type: "books.unavailable" }], { ...emptyLibrary(), books: [book("a")] }).state.books).toHaveLength(1);
    expect(run([{ type: "books.unavailable" }], emptyLibrary()).state.books).toEqual([]);
  });

  it("ignores the events it does not show", () => {
    const state = { ...emptyLibrary(), books: [] };
    expect(reduceLibrary(state, { type: "highlight.deleted", data: { id: "h", bookId: "a" } }, { userId: ME }).state).toBe(state);
  });
});

describe("library store", () => {
  it("lists notes newest first, runs effects and tells subscribers", () => {
    const effects: LibraryEffect[] = [];
    const library = createLibrary({ ...emptyLibrary(), books: [] }, { context: () => ({ userId: ME }), run: (e) => effects.push(e) });
    const heard = vi.fn();
    library.subscribe(heard);
    library.dispatch({ type: "book.created", data: book("a") });
    library.dispatch({ type: "admin.report", data: { title: "Spam" } });
    expect(library.get().activity.map((a) => [a.text, a.bookId])).toEqual([
      ["New report about “Spam” is waiting in the admin panel", undefined],
      ["“Book a” was added to your library", "a"],
    ]);
    expect(effects).toEqual([{ type: "refreshMe" }]);
    expect(heard).toHaveBeenCalledTimes(2);
    library.dispatch({ type: "settings.updated", data: { settings: {}, updatedAt: "", deviceId: null } });
    expect(heard).toHaveBeenCalledTimes(2); // nothing changed
  });

  it("shows positions saved on other devices as lib/progress reports them", async () => {
    const { onPositionChange } = await import("./progress");
    const library = createLibrary({ ...emptyLibrary(), books: [book("a")] }, { context: () => ({ userId: ME }), run: () => {} });
    const off = onPositionChange((p, elsewhere) => library.dispatch({ type: "position", progress: p, elsewhere }));
    live.forEach((h) => h("progress.updated", progress("a", { deviceId: "another-device" })));
    off();
    expect(library.get().books?.[0]?.progress?.percentage).toBe(0.42);
    expect(library.get().activity.map((a) => a.text)).toEqual(["Reached 42% of “Book a” on Phone"]);
  });
});
