// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import luaparse from "luaparse";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIR, PLUGIN_FOLDER, pluginFiles, pluginZip } from "../../scripts/koreader-plugin.mjs";

// The BookRaven plugin for KOReader (koreader/bookraven.koplugin): no Lua runs here, so its files
// are checked for what can be checked without KOReader, and its download is checked as a ZIP.

/** Names the plugin may use without declaring them: Lua's and KOReader's globals. */
const GLOBALS = new Set(
  "G_reader_settings _G assert error ipairs math next os pairs pcall print rawget rawset require select setmetatable getmetatable string table tonumber tostring type unpack io xpcall".split(" "),
);

type Node = { type: string; [key: string]: unknown };

/** Every identifier that is neither a local nor a known global, and every assignment to a global. */
function globalsIn(ast: Node) {
  const found: string[] = [];
  const walk = (node: unknown, skip = false) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n));
    if (!node || typeof node !== "object") return;
    const n = node as Node;
    if (n.type === "Identifier" && !skip && n.isLocal === false && !GLOBALS.has(n.name as string)) found.push(n.name as string);
    for (const [key, value] of Object.entries(n)) {
      if (key === "loc" || key === "range") continue;
      // Field names (a.b, a:b(), { b = … }) aren't variables.
      const field = (n.type === "MemberExpression" && key === "identifier") || (n.type === "TableKeyString" && key === "key");
      walk(value, field);
    }
  };
  walk(ast);
  return found;
}

const lua = pluginFiles().filter((f) => f.endsWith(".lua"));

describe("the KOReader plugin's Lua", () => {
  it("has KOReader's plugin layout", () => {
    expect(lua).toEqual(expect.arrayContaining(["_meta.lua", "main.lua"]));
    const meta = readFileSync(join(PLUGIN_DIR, "_meta.lua"), "utf8");
    expect(meta).toMatch(/name = "bookraven"/);
    expect(readFileSync(join(PLUGIN_DIR, "main.lua"), "utf8")).toMatch(/registerToMainMenu\(self\)/);
  });

  it.each(lua)("%s parses as LuaJIT and uses no undeclared globals", (file) => {
    const source = readFileSync(join(PLUGIN_DIR, file), "utf8");
    const ast = luaparse.parse(source, { luaVersion: "LuaJIT", scope: true, locations: true }) as unknown as Node;
    expect(globalsIn(ast)).toEqual([]);
  });
});

describe("the plugin's download", () => {
  /** The entries of a ZIP, from its central directory, with their contents. */
  function unzip(zip: Buffer) {
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    const count = zip.readUInt16LE(end + 10);
    const entries = new Map<string, Buffer | null>();
    for (let p = zip.readUInt32LE(end + 16), i = 0; i < count; i++) {
      expect(zip.readUInt32LE(p)).toBe(0x02014b50);
      const method = zip.readUInt16LE(p + 10);
      const size = zip.readUInt32LE(p + 20);
      const nameLength = zip.readUInt16LE(p + 28);
      const local = zip.readUInt32LE(p + 42);
      const name = zip.toString("utf8", p + 46, p + 46 + nameLength);
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      entries.set(name, name.endsWith("/") ? null : method === 8 ? inflateRawSync(data) : data);
      p += 46 + nameLength + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    }
    return entries;
  }

  it("is a ZIP of the bookraven.koplugin folder, the same every time", () => {
    const zip = pluginZip();
    const entries = unzip(zip);
    expect([...entries.keys()]).toEqual([`${PLUGIN_FOLDER}/`, ...pluginFiles().map((f) => `${PLUGIN_FOLDER}/${f}`)]);
    for (const f of pluginFiles()) expect(entries.get(`${PLUGIN_FOLDER}/${f}`)!.equals(readFileSync(join(PLUGIN_DIR, f)))).toBe(true);
    expect(pluginZip().equals(zip)).toBe(true);
  });
});
