import { inflateRawSync } from "node:zlib";
import { log } from "./log.js";
import { bookKey, readObject } from "./storage.js";
import { cfiToXpointer, parseXml, xpointerToCfi, type EpubDocuments, type SpineItem, type XmlElement } from "./xpointer.js";

/**
 * KOReader positions in stored EPUBs (see xpointer.ts for the conversion itself). KOReader syncs
 * on every few page turns, so the spine of recent books and their recently used chapters stay
 * parsed in memory, and only the pieces of the file a conversion needs are read from storage
 * (the ZIP's directory, the package document, one chapter).
 */

type ByteReader = (offset: number, length: number) => Promise<Buffer>;
type ZipEntry = { method: number; size: number; local: number };

/** A small LRU: past `maxEntries` entries or `maxWeight` total weight, the least recently used go. */
class Lru<V> {
  private entries = new Map<string, { value: V; weight: number }>();
  private weight = 0;
  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight = Infinity,
  ) {}
  get(key: string) {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value;
  }
  set(key: string, value: V, weight = 1) {
    this.delete(key);
    this.entries.set(key, { value, weight });
    this.weight += weight;
    while (this.entries.size > this.maxEntries || (this.weight > this.maxWeight && this.entries.size > 1)) this.delete(this.entries.keys().next().value!);
  }
  delete(key: string) {
    const e = this.entries.get(key);
    if (e) this.weight -= e.weight;
    this.entries.delete(key);
  }
}

/** The ZIP's central directory, read from the end of the file (no ZIP64: EPUBs under 4 GB). */
async function zipDirectory(read: ByteReader, size: number) {
  const tailLength = Math.min(size, 65_557);
  const tail = await read(size - tailLength, tailLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = tail.readUInt16LE(eocd + 10);
  const dirSize = tail.readUInt32LE(eocd + 12);
  const dirOffset = tail.readUInt32LE(eocd + 16);
  const dir = await read(dirOffset, dirSize);
  const entries = new Map<string, ZipEntry>();
  for (let p = 0, n = 0; n < count && p + 46 <= dir.length; n++) {
    if (dir.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = dir.readUInt16LE(p + 28);
    entries.set(dir.toString("utf8", p + 46, p + 46 + nameLen), {
      method: dir.readUInt16LE(p + 10),
      size: dir.readUInt32LE(p + 20),
      local: dir.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + dir.readUInt16LE(p + 30) + dir.readUInt16LE(p + 32);
  }
  return async (name: string) => {
    const e = entries.get(name);
    if (!e) return null;
    const header = await read(e.local, 30);
    const data = await read(e.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28), e.size);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data);
    throw new Error(`zip method ${e.method}`);
  };
}

/** Text of an XML file in its declared encoding (UTF-8 by default). */
function xmlText(data: Buffer) {
  const declared = /^<\?xml[^>]*encoding=["']([\w.:-]+)["']/.exec(data.subarray(0, 200).toString("latin1"))?.[1];
  try {
    return new TextDecoder(declared ?? "utf-8").decode(data);
  } catch {
    return new TextDecoder("utf-8").decode(data);
  }
}

const HTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);
const elements = (el: XmlElement) => el.children.filter((c): c is XmlElement => c.kind === "element");
const escapeCfi = (s: string) => s.replace(/[\^[\](),;=]/g, "^$&");

/**
 * The spine of a package document: each itemref's CFI in it (as foliate-js computes them, from
 * the elements' positions and ids), whether it is (X)HTML, and the ZIP entry of its file.
 */
export function packageSpine(opf: string, opfPath: string): (SpineItem & { href: string | null })[] {
  const top = elements(parseXml(opf, { attributes: true }));
  const spineAt = top.findIndex((e) => e.name === "spine");
  const spine = top[spineAt];
  if (!spine) throw new Error("no spine");
  const manifest = new Map<string, Record<string, string>>();
  const manifestEl = top.find((e) => e.name === "manifest");
  for (const item of manifestEl ? elements(manifestEl) : []) {
    if (item.name === "item" && item.id) manifest.set(item.id, item.attributes!);
  }
  const dir = opfPath.slice(0, opfPath.lastIndexOf("/") + 1);
  const step = (el: XmlElement, index: number) => `/${2 * (index + 1)}${el.id ? `[${escapeCfi(el.id)}]` : ""}`;
  return elements(spine).map((ref, i) => {
    const item = manifest.get(ref.attributes!.idref ?? "");
    let href: string | null = null;
    if (item?.href) {
      const parts: string[] = [];
      for (const seg of (dir + decodeURIComponent(item.href.split("#")[0]!)).split("/")) {
        if (seg === "..") parts.pop();
        else if (seg && seg !== ".") parts.push(seg);
      }
      href = parts.join("/");
    }
    return { cfi: step(spine, spineAt) + step(ref, i), html: HTML_TYPES.has(item?.["media-type"]?.toLowerCase() ?? ""), href };
  });
}

type Book = { spine: (SpineItem & { href: string | null })[]; entry: (name: string) => Promise<Buffer | null> };

const books = new Lru<Promise<Book>>(32);
/** Parsed chapters, weighed by their size: about 8 MB of XHTML. */
const documents = new Lru<Promise<{ root: XmlElement; size: number } | null>>(64, 8_000_000);

/** Caches a load's promise (so concurrent requests share it); a failed load is forgotten. */
function cached<V>(cache: Lru<Promise<V>>, key: string, load: () => Promise<V>, weigh: (v: V) => number = () => 1) {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = load();
  cache.set(key, p);
  p.then(
    (v) => cache.get(key) === p && cache.set(key, p, weigh(v)),
    () => cache.delete(key),
  );
  return p;
}

/** A stored EPUB, by its file's SHA-256 and size, as documents to convert positions in. */
async function storedEpub(sha256: string, size: number): Promise<EpubDocuments> {
  const book = await cached(books, sha256, async () => {
    const read: ByteReader = async (offset, length) => {
      if (length <= 0) return Buffer.alloc(0);
      const chunks: Buffer[] = [];
      for await (const c of await readObject(bookKey(sha256), offset, offset + length - 1)) chunks.push(Buffer.from(c as Buffer));
      return Buffer.concat(chunks);
    };
    const entry = await zipDirectory(read, size);
    const container = (await entry("META-INF/container.xml"))?.toString("utf8");
    const opfPath = container && /full-path\s*=\s*["']([^"']+)["']/.exec(container)?.[1];
    const opf = opfPath ? await entry(opfPath) : null;
    if (!opfPath || !opf) throw new Error("no package document");
    return { spine: packageSpine(xmlText(opf), opfPath), entry };
  });
  return {
    spine: book.spine,
    document: async (index) => {
      const doc = await cached(
        documents,
        `${sha256}:${index}`,
        async () => {
          const href = book.spine[index]?.href;
          const data = href ? await book.entry(href) : null;
          return data ? { root: parseXml(xmlText(data)), size: data.length } : null;
        },
        (d) => d?.size ?? 1,
      );
      return doc?.root ?? null;
    },
  };
}

/** The CFI of a KOReader XPointer in a stored EPUB, or null when it can't be converted. */
export async function storedXpointerToCfi(sha256: string, size: number, xpointer: string) {
  try {
    return await xpointerToCfi(await storedEpub(sha256, size), xpointer);
  } catch (err) {
    log.debug({ err, sha256 }, "KOReader position not converted");
    return null;
  }
}

/** The KOReader XPointer of a CFI in a stored EPUB, or null when it can't be converted. */
export async function storedCfiToXpointer(sha256: string, size: number, cfi: string) {
  try {
    return await cfiToXpointer(await storedEpub(sha256, size), cfi);
  } catch (err) {
    log.debug({ err, sha256 }, "position not converted for KOReader");
    return null;
  }
}
