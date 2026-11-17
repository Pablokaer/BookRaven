import { describe, expect, it } from "vitest";
import { MAX_SHOWN, RELEASE_NOTES, unseenNotes, type ReleaseNote } from "./whatsNew";

const note = (id: string, date: string): ReleaseNote => ({ id, date, title: id, items: ["x"] });
const notes = [note("e", "2026-10-15"), note("d", "2026-10-14"), note("c", "2026-10-10"), note("b", "2026-09-20"), note("a", "2026-08-01")];
const ids = (list: ReleaseNote[]) => list.map((n) => n.id);

describe("what's new", () => {
  it("shows the notes newer than the last one seen, and nothing once the newest was seen", () => {
    expect(ids(unseenNotes(notes, "c"))).toEqual(["e", "d"]);
    expect(unseenNotes(notes, "e")).toEqual([]);
  });

  it("on a first visit (or if the seen note is gone), shows only the recent notes", () => {
    expect(ids(unseenNotes(notes, null))).toEqual(["e", "d", "c"]);
    expect(ids(unseenNotes(notes, "removed"))).toEqual(["e", "d", "c"]);
  });

  it("shows the notes about the Admin page to administrators only", () => {
    const withAdmin = [{ ...note("f", "2026-10-16"), admin: true as const }, ...notes];
    expect(ids(unseenNotes(withAdmin, "c"))).toEqual(["e", "d"]);
    expect(ids(unseenNotes(withAdmin, "c", true))).toEqual(["f", "e", "d"]);
    expect(ids(unseenNotes(withAdmin, null))).toEqual(["e", "d", "c"]);
    // A reader who closed the window after an admin note was published sees nothing again.
    expect(unseenNotes(withAdmin, "f")).toEqual([]);
    expect(unseenNotes([withAdmin[0]!, ...notes], "e")).toEqual([]);
  });

  it("marks every note about the Admin page as one for administrators", () => {
    for (const n of RELEASE_NOTES) {
      if (n.items.some((i) => /^For administrators|Admin →/.test(i))) expect(n.admin, n.id).toBe(true);
    }
  });

  it("never shows more than a few at once", () => {
    const many = Array.from({ length: 10 }, (_, i) => note(`n${i}`, "2026-10-15"));
    expect(unseenNotes(many, null)).toHaveLength(MAX_SHOWN);
    expect(unseenNotes(many, "n9")).toHaveLength(MAX_SHOWN);
  });

  it("keeps the published notes well-formed: unique ids, valid dates, newest first, something to say", () => {
    expect(new Set(RELEASE_NOTES.map((n) => n.id)).size).toBe(RELEASE_NOTES.length);
    for (const n of RELEASE_NOTES) {
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(n.date))).toBe(false);
      expect(n.title.trim()).not.toBe("");
      expect(n.items.length).toBeGreaterThan(0);
    }
    const dates = RELEASE_NOTES.map((n) => n.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});
