import { describe, expect, it } from "vitest";
import { seriesOf } from "./books";

describe("seriesOf", () => {
  it("reads EPUB 3 collections and Calibre's series", () => {
    expect(seriesOf({ series: [{ name: "Dune Chronicles", position: "2" }] })).toEqual({ series: "Dune Chronicles", seriesIndex: 2 });
    expect(seriesOf({ series: { name: "Discworld", position: 1.5 } })).toEqual({ series: "Discworld", seriesIndex: 1.5 });
    expect(seriesOf({ series: [{ name: { en: "Foundation" } }] })).toEqual({ series: "Foundation", seriesIndex: undefined });
  });

  it("ignores a missing or nameless series", () => {
    expect(seriesOf(undefined)).toEqual({});
    expect(seriesOf({ series: null })).toEqual({});
    expect(seriesOf({ series: { name: undefined, position: Number.NaN } })).toEqual({});
  });
});
