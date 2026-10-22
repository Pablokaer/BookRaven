import { describe, expect, it } from "vitest";
import source from "../../public/sw.js?raw";
import { OFFLINE_CACHE, OFFLINE_COPIES, OFFLINE_COPIES_SCRIPT, OFFLINE_COPY_HEADER, offlineCopiesScript } from "./offlineCopies";

// The service worker is a plain script in public/: run it with a stand-in `self` (and the list of
// offline copies the build writes next to it) and take out its logic.
const self = { addEventListener() {} };
const importScripts = (url: string) => {
  expect(url).toBe(`/${OFFLINE_COPIES_SCRIPT}`);
  new Function("self", offlineCopiesScript())(self);
};
const { unreachableAssets, isLandingPage, API, API_CACHED, OFFLINE_COPY } = new Function(
  "self",
  "importScripts",
  `${source}
return { unreachableAssets, isLandingPage, API, API_CACHED, OFFLINE_COPY };`,
)(self, importScripts) as {
  unreachableAssets: (roots: string[], names: string[], readText: (name: string) => Promise<string>) => Promise<string[]>;
  isLandingPage: (html: string) => boolean;
  API: string;
  API_CACHED: RegExp[];
  OFFLINE_COPY: string;
};

const shell = (entry: string, css: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="/assets/${entry}"></script><link rel="stylesheet" crossorigin href="/assets/${css}"></head></html>`;

describe("service worker pruning", () => {
  const files: Record<string, string> = {
    // This version: the entry imports React and lazy pages; a page imports a shared chunk; the
    // reader starts a worker; the stylesheet uses a font.
    "index-NEW00001.js": `import{r}from"./react-RRRRRRRR.js";const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/SearchPage-NEW00002.js","assets/shared-NEW00003.js"])))=>i.map(i=>d[i]);const R=()=>import("./ReaderPage-NEW00004.js");`,
    "react-RRRRRRRR.js": "export const r=1;",
    "SearchPage-NEW00002.js": `import"./shared-NEW00003.js";`,
    "shared-NEW00003.js": "export{};",
    "ReaderPage-NEW00004.js": `new Worker(new URL("pdf.worker-NEW00005.mjs",import.meta.url));`,
    "pdf.worker-NEW00005.mjs": "self.onmessage=()=>{};",
    "index-NEW0000c.css": "@font-face{src:url(/assets/inter-NEW00006.woff2)}",
    "inter-NEW00006.woff2": "",
    // The version before: only reachable from its own shell.
    "index-OLD00001.js": `import("./StatsPage-OLD00002.js");`,
    "StatsPage-OLD00002.js": "export{};",
    "index-OLD0000c.css": "",
    // Files no shell leads to any more.
    "index-GONE0001.js": `import("./ClubPages-GONE0002.js");`,
    "ClubPages-GONE0002.js": "export{};",
    "cover-GONE0003.png": "",
  };
  const names = Object.keys(files);
  const read = async (name: string) => files[name]!;

  it("keeps what each shell leads to, lazy chunks and workers included", async () => {
    const roots = [shell("index-NEW00001.js", "index-NEW0000c.css"), shell("index-OLD00001.js", "index-OLD0000c.css")];
    expect(await unreachableAssets(roots, names, read)).toEqual(["index-GONE0001.js", "ClubPages-GONE0002.js", "cover-GONE0003.png"]);
  });

  it("drops the previous version once no shell names it", async () => {
    const unused = await unreachableAssets([shell("index-NEW00001.js", "index-NEW0000c.css")], names, read);
    expect(unused).toContain("StatsPage-OLD00002.js");
    expect(unused).not.toContain("pdf.worker-NEW00005.mjs");
    expect(unused).not.toContain("inter-NEW00006.woff2");
  });

  it("deletes nothing when a file can't be read", async () => {
    const failing = async (name: string) => (name === "SearchPage-NEW00002.js" ? Promise.reject(new Error("gone")) : files[name]!);
    await expect(unreachableAssets([shell("index-NEW00001.js", "index-NEW0000c.css")], names, failing)).rejects.toThrow("gone");
  });
});

describe("service worker shell", () => {
  it("doesn't take the prerendered landing page for the app's shell", () => {
    expect(isLandingPage('<body><div id="root" data-landing><!--$--><div class="lit">')).toBe(true);
    expect(isLandingPage('<body><div id="root" data-landing="signup-closed"><!--$-->')).toBe(true);
    expect(isLandingPage('<body><div id="root"></div><script type="module" src="/assets/index.js"></script>')).toBe(false);
  });
});

describe("service worker offline copies", () => {
  it("follows the app's list, cache and marker (src/lib/offlineCopies.ts)", () => {
    expect(API).toBe(OFFLINE_CACHE);
    expect(OFFLINE_COPY).toBe(OFFLINE_COPY_HEADER);
    expect(API_CACHED.map(String)).toEqual(OFFLINE_COPIES.map((c) => String(c.path)));
    expect(API_CACHED.some((re) => re.test("/api/auth/get-session"))).toBe(true);
  });
});
