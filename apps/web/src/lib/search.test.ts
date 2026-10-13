import { describe, expect, it } from "vitest";
import { matchesText } from "./search";

describe("matchesText", () => {
  it("matches everything for an empty query", () => {
    expect(matchesText("Dom Casmurro", "  ")).toBe(true);
  });

  it("ignores case and accents on both sides", () => {
    expect(matchesText("Memórias Póstumas de Brás Cubas", "memorias")).toBe(true);
    expect(matchesText("Eça de Queirós", "ECA")).toBe(true);
    expect(matchesText("Memorias Posthumas", "Memórias")).toBe(true);
  });

  it("matches words in any order", () => {
    expect(matchesText("Dom Casmurro Machado de Assis", "assis casmurro")).toBe(true);
    expect(matchesText("Dom Casmurro Machado de Assis", "assis hamlet")).toBe(false);
  });
});
