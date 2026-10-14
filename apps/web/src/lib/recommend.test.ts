import { describe, expect, it } from "vitest";
import type { Book, PublicBook } from "./api";
import { recommend } from "./recommend";

const own = (id: string, author: string | null, percentage: number | null, extra: Partial<Book> = {}) =>
  ({
    id,
    title: `Book ${id}`,
    author,
    language: "pt",
    favorite: false,
    createdAt: "2026-01-01T00:00:00Z",
    progress: percentage === null ? null : { percentage, updatedAt: "2026-05-01T00:00:00Z" },
    ...extra,
  }) as unknown as Book;

const pub = (id: string, author: string | null, themes: string[], extra: Partial<PublicBook> = {}) =>
  ({ id, title: `Public ${id}`, author, themes, language: "pt", popularity: 0, ownBookId: null, isMine: false, ...extra }) as unknown as PublicBook;

describe("recommend", () => {
  const library = [own("a", "Machado de Assis", 1), own("b", "Eça de Queirós", 0.4), own("c", "Unread Person", null)];
  const publicBooks = [
    pub("pa", "Machado de Assis", ["literature"], { ownBookId: "a" }), // the reader's own copy: gives "a" its sections
    pub("p1", "Machado de Assis", ["literature"]),
    pub("p2", "Someone Else", ["literature"], { popularity: 900 }),
    pub("p3", "Someone Else", ["literature"], { popularity: 100 }),
    pub("p4", "Eca de Queiros", ["history"]),
    pub("p5", "Nobody", ["science"]),
    pub("p6", "Machado de Assis", ["literature"], { language: "en" }),
    pub("p7", "Machado de Assis", ["literature"], { isMine: true }),
  ];

  it("ranks by author and shared sections, weighted by how the books were read", () => {
    const r = recommend(library, publicBooks);
    const ids = r.forYou.map((p) => p.id);
    // Same author as a finished book first; then the other author; then same section, popular first.
    expect(ids).toEqual(["p1", "p4", "p2", "p3"]);
    // Never what the reader has or published, nothing unrelated, nothing in a language they don't read.
    expect(ids).not.toContain("pa");
    expect(ids).not.toContain("p7");
    expect(ids).not.toContain("p5");
    expect(ids).not.toContain("p6");
  });

  it("adds 'because you read' rows only when they have enough new books", () => {
    const r = recommend(library, publicBooks, { forYou: 1, minRow: 2 });
    expect(r.forYou.map((p) => p.id)).toEqual(["p1"]);
    expect(r.because).toHaveLength(1);
    expect(r.because[0]!.seed.id).toBe("a");
    expect(r.because[0]!.books.map((p) => p.id)).toEqual(["p2", "p3"]);
  });

  it("suggests nothing from an empty library", () => {
    expect(recommend([], publicBooks)).toEqual({ forYou: [], because: [] });
  });
});
