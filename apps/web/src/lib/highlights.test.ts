import { describe, expect, it } from "vitest";
import type { Highlight } from "./api";
import { fileSize } from "./format";
import { highlightsToMarkdown } from "./highlights";

const h = (text: string, label: string | null, note: string | null = null): Highlight => ({
  id: text,
  bookId: "b",
  cfi: "x",
  text,
  color: "yellow",
  label,
  note,
  createdAt: "2026-01-01T00:00:00Z",
});

describe("highlights export", () => {
  it("groups by chapter, quotes passages and keeps notes", () => {
    const md = highlightsToMarkdown({ title: "Dune", author: "Frank Herbert" }, [
      h("Fear is the mind-killer.", "Chapter 1", "The litany!"),
      h("Line one\nline two", "Chapter 1"),
      h("The spice must flow.", "Chapter 2"),
    ]);
    expect(md).toBe(
      [
        "# Dune",
        "*Frank Herbert*",
        "",
        "## Chapter 1",
        "",
        "> Fear is the mind-killer.",
        "",
        "The litany!",
        "",
        "> Line one",
        "> line two",
        "",
        "## Chapter 2",
        "",
        "> The spice must flow.",
        "",
      ].join("\n"),
    );
  });
});

describe("file sizes", () => {
  it("formats bytes for people", () => {
    expect(fileSize(0)).toBe("0 KB");
    expect(fileSize(500)).toBe("1 KB");
    expect(fileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fileSize(2 * 1024 ** 3)).toBe("2 GB");
    expect(fileSize(1.5 * 1024 ** 3)).toBe("1.50 GB");
  });
});
