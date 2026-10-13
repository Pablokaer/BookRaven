/**
 * Extracts RAR / 7z / TAR comic archives with 7-Zip compiled to WebAssembly, off the
 * main thread. Only images and ComicInfo.xml are sent back.
 */
import SevenZip from "7z-wasm";
import wasmUrl from "7z-wasm/7zz.wasm?url";

const KEEP = /\.(jpe?g|png|gif|webp|avif|bmp|jxl|svg)$|(^|\/)comicinfo\.xml$/i;

type Entry = { name: string; data: Uint8Array };

self.onmessage = async (e: MessageEvent<{ data: ArrayBuffer }>) => {
  try {
    const sz = await SevenZip({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} });
    sz.FS.writeFile("/archive", new Uint8Array(e.data.data));
    sz.FS.mkdir("/out");
    // -p- : never prompt for a password (encrypted archives fail instead of hanging)
    // Typed as void, but returns 7-Zip's exit code (0 ok, 1 warnings, 2+ errors).
    const code = sz.callMain(["x", "/archive", "-o/out", "-y", "-p-", "-bso0", "-bsp0"]) as unknown as number | undefined;
    if ((code ?? 0) > 1) throw new Error("This archive could not be opened (damaged or password protected).");

    const files: Entry[] = [];
    const walk = (dir: string, rel: string) => {
      for (const name of sz.FS.readdir(dir)) {
        if (name === "." || name === "..") continue;
        const path = `${dir}/${name}`;
        const relPath = rel ? `${rel}/${name}` : name;
        if (sz.FS.isDir(sz.FS.stat(path).mode)) walk(path, relPath);
        else if (KEEP.test(relPath)) files.push({ name: relPath, data: sz.FS.readFile(path) });
      }
    };
    walk("/out", "");
    (self as unknown as Worker).postMessage({ files }, files.map((f) => f.data.buffer as ArrayBuffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
