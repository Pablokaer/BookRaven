// The BookRaven plugin for KOReader (koreader/bookraven.koplugin at the repository's root),
// zipped for download: bookraven.koplugin.zip holds the bookraven.koplugin/ folder, to unzip into
// KOReader's plugins folder. vite.config.ts writes it into the web build as
// /koreader/bookraven.koplugin.zip (apps/web/Dockerfile copies koreader/ for it).
//
// A plain ZIP made here (deflated entries, fixed dates) so the same files always give the same
// archive, without a dependency.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

export const PLUGIN_FOLDER = "bookraven.koplugin";
export const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "koreader", PLUGIN_FOLDER);
/** Where the web build serves it. */
export const PLUGIN_ZIP_PATH = "koreader/bookraven.koplugin.zip";

/** The plugin's files, as paths relative to its folder ("main.lua", …), sorted. */
export function pluginFiles() {
  return readdirSync(PLUGIN_DIR, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(PLUGIN_DIR.length + 1).replaceAll("\\", "/"))
    .sort();
}

// 1980-01-01 00:00, the earliest date a ZIP can hold.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** The ZIP of the plugin's folder. */
export function pluginZip() {
  const entries = [
    [`${PLUGIN_FOLDER}/`, null],
    ...pluginFiles().map((f) => [`${PLUGIN_FOLDER}/${f}`, readFileSync(join(PLUGIN_DIR, f))]),
  ];
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const n = Buffer.from(name, "utf8");
    const data = raw ? deflateRawSync(raw, { level: 9 }) : Buffer.alloc(0);
    const crc = raw ? crc32(raw) : 0;
    const size = raw ? raw.length : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(raw ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0 (so the permissions below count)
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(raw ? 8 : 0, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(((raw ? 0o100644 : 0o040755) << 16) >>> 0, 38); // rw-r--r-- files, rwxr-xr-x folder
    dir.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
