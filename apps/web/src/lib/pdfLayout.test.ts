import { describe, expect, it } from "vitest";
import { canvasPixelRatio, contentBox, fitScale, FULL_PAGE, MAX_CANVAS_PIXELS } from "./pdfLayout";

/** A white w×h RGBA image with black pixels at `dots`. */
function image(w: number, h: number, dots: [number, number][]) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x, y] of dots) data.set([0, 0, 0, 255], (y * w + x) * 4);
  return data;
}

describe("fitScale", () => {
  const page = { w: 600, h: 800 };
  it("fits the whole page or its width, inside the margins", () => {
    expect(fitScale(page, { w: 432, h: 2000 }, 16, "page")).toBeCloseTo(400 / 600);
    expect(fitScale(page, { w: 2000, h: 832 }, 16, "page")).toBeCloseTo(800 / 800);
    expect(fitScale(page, { w: 2000, h: 832 }, 16, "width")).toBeCloseTo(1968 / 600);
  });
  it("uses the whole screen with no margin", () => {
    expect(fitScale(page, { w: 300, h: 2000 }, 0, "width")).toBeCloseTo(0.5);
  });
});

describe("canvasPixelRatio", () => {
  it("is the screen's ratio for normal pages", () => {
    expect(canvasPixelRatio(400, 600, 2)).toBe(2);
    expect(canvasPixelRatio(400, 600, 4)).toBe(3);
  });
  it("drops for very large (zoomed) pages so the canvas still draws", () => {
    const r = canvasPixelRatio(1600, 2400, 3);
    expect(r).toBeLessThan(3);
    expect(1600 * r * 2400 * r).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
  });
});

describe("contentBox", () => {
  it("finds the content with some room around it", () => {
    // Text block from (20, 30) to (79, 69) on a 100×100 page.
    const dots: [number, number][] = [];
    for (let y = 30; y < 70; y++) for (let x = 20; x < 80; x++) dots.push([x, y]);
    const box = contentBox(image(100, 100, dots), 100, 100, 0.02);
    expect(box.x0).toBeCloseTo(0.18);
    expect(box.y0).toBeCloseTo(0.28);
    expect(box.x1).toBeCloseTo(0.82);
    expect(box.y1).toBeCloseTo(0.72);
  });
  it("ignores lone specks and keeps blank pages whole", () => {
    expect(contentBox(image(50, 50, [[2, 2]]), 50, 50)).toEqual(FULL_PAGE);
    expect(contentBox(image(50, 50, []), 50, 50)).toEqual(FULL_PAGE);
  });
});
