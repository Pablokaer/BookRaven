import { describe, expect, it } from "vitest";
import { findPassage } from "./pdfPassage";

describe("finding KOReader's PDF highlights on the page", () => {
  const page = "Once upon a midnight dreary, while I pon-dered, weak and weary,Over many a quaint and curious volume";

  it("finds the passage whatever the line breaks, spaces, hyphens, case and accents", () => {
    const span = (q: string) => {
      const r = findPassage(page, q);
      return r && page.slice(r[0], r[1]);
    };
    expect(span("midnight dreary")).toBe("midnight dreary");
    expect(span("I pondered,\nweak")).toBe("I pon-dered, weak");
    expect(span("weary, Over many")).toBe("weary,Over many");
    expect(span("ONCE  upon")).toBe("Once upon");
    expect(findPassage("Café crème", "cafe creme")).toEqual([0, 10]);
  });

  it("finds nothing for text that isn't on the page", () => {
    expect(findPassage(page, "nevermore")).toBeNull();
    expect(findPassage(page, "  \n")).toBeNull();
    expect(findPassage("", "raven")).toBeNull();
  });
});
