import { describe, expect, it } from "vitest";
import { comicFormatOfName, imageSize, isComicFormat } from "./comics";

describe("comic formats", () => {
  it("recognises comic formats and file names", () => {
    expect(isComicFormat("cbr")).toBe(true);
    expect(isComicFormat("epub")).toBe(false);
    expect(comicFormatOfName("One Piece 01.CBR")).toBe("cbr");
    expect(comicFormatOfName("x.7z")).toBe("cb7");
    expect(comicFormatOfName("x.pdf")).toBeNull();
  });
});

describe("image size from headers", () => {
  it("reads PNG", async () => {
    const png = new Uint8Array(32);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(png.buffer).setUint32(16, 1200);
    new DataView(png.buffer).setUint32(20, 900);
    expect(await imageSize(new Blob([png]))).toEqual({ width: 1200, height: 900 });
  });

  it("reads JPEG start-of-frame after other segments", async () => {
    // SOI, an APP0 segment of length 16, then SOF0 with height 1600 and width 1000
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0),
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x06, 0x40, 0x03, 0xe8, 0x03, ...new Array(9).fill(0),
    ]);
    expect(await imageSize(new Blob([jpeg]))).toEqual({ width: 1000, height: 1600 });
  });

  it("returns null for unknown data", async () => {
    expect(await imageSize(new Blob([new Uint8Array([1, 2, 3])]))).toBeNull();
  });
});
