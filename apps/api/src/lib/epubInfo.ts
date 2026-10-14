import { inflateRawSync } from "node:zlib";

/**
 * Just enough ZIP to read one file out of an EPUB in memory: the central directory lists
 * the entries, each stored (0) or deflated (8). EPUBs from public-domain sources are small.
 */
export function readZipEntry(zip: Buffer, matches: (name: string) => boolean): Buffer | null {
  // The end-of-central-directory record is in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (matches(name)) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();

export type EpubPeople = { authors: string[]; translators: string[]; language: string | null };

/**
 * Authors and translators from an EPUB's package document: EPUB 3 roles
 * (<meta property="role" refines="#id">trl</meta>) and EPUB 2 ones (opf:role="trl").
 */
export function opfPeople(opf: string): EpubPeople {
  // A person can have several roles (author and dedicator, say).
  const roles = new Map<string, Set<string>>();
  for (const m of opf.matchAll(/<meta\b[^>]*property="role"[^>]*refines="#([^"]+)"[^>]*>([^<]*)<\/meta>/g)) {
    roles.set(m[1]!, (roles.get(m[1]!) ?? new Set()).add(m[2]!.trim()));
  }
  const authors: string[] = [];
  const translators: string[] = [];
  for (const m of opf.matchAll(/<dc:(creator|contributor)\b([^>]*)>([\s\S]*?)<\/dc:\1>/g)) {
    const attrs = m[2]!;
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    const epub2 = /opf:role="([^"]+)"/.exec(attrs)?.[1];
    const has = (role: string) => (epub2 ? epub2 === role : (id && roles.get(id)?.has(role)) || (role === "aut" && m[1] === "creator" && !(id && roles.has(id))));
    const name = decode(m[3]!);
    if (!name) continue;
    if (has("aut")) authors.push(name);
    if (has("trl")) translators.push(name);
  }
  const language = /<dc:language\b[^>]*>([^<]+)<\/dc:language>/.exec(opf)?.[1]?.trim().slice(0, 2).toLowerCase() ?? null;
  return { authors, translators, language };
}

/** The package document of an EPUB (the .opf named in META-INF/container.xml). */
export function epubPackage(zip: Buffer): string | null {
  const container = readZipEntry(zip, (n) => n === "META-INF/container.xml")?.toString("utf8");
  const path = container && /full-path="([^"]+)"/.exec(container)?.[1];
  const opf = readZipEntry(zip, path ? (n) => n === path : (n) => n.endsWith(".opf"));
  return opf?.toString("utf8") ?? null;
}
