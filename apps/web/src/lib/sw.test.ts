import { describe, expect, it } from "vitest";
import source from "../../public/sw.js?raw";

// The service worker is a plain script in public/: run it with a stand-in `self` and take out
// its pruning logic.
const { unreachableAssets, isLandingPage } = new Function("self", `${source}\nreturn { unreachableAssets, isLandingPage };`)({ addEventListener() {} }) as {
  unreachableAssets: (roots: string[], names: string[], readText: (name: string) => Promise<string>) => Promise<string[]>;
  isLandingPage: (html: string) => boolean;
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
