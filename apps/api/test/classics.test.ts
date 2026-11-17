import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { query } from "../src/db.js";
import { forgetClassics, slugify } from "../src/routes/classics.js";
import { api, signUp } from "./helpers.js";

/** A public book, imported from a catalog when `catalog` is given (otherwise published by a reader). */
async function publicBook(ownerId: string, title: string, author: string, language: string, catalog?: { downloads: number }) {
  const id = randomUUID();
  await query(
    `INSERT INTO book (id, user_id, title, author, format, original_filename, mime_type, size_bytes, sha256, has_cover,
                       language, description, is_public, published_at)
     VALUES ($1, $2, $3, $4, 'epub', 'x.epub', 'application/epub+zip', 10, $5, false, $6, $7, true, now())`,
    [id, ownerId, title, author, randomBytes(32).toString("hex"), language, `A story <b>about</b> ${title}.\n\nSecond paragraph.`],
  );
  if (catalog) {
    await query(
      `INSERT INTO catalog_book (source, source_id, title, authors, language, download_count, source_url, book_id, themes)
       VALUES ('gutenberg', $1, $2, $3, $4, $5, 'https://www.gutenberg.org/ebooks/1', $6, '{literature}')`,
      [randomUUID(), title, JSON.stringify([{ name: author, birth_year: 1839, death_year: 1908 }]), language, catalog.downloads, id],
    );
  }
  return id;
}

describe("classics pages", () => {
  it("makes readable slugs", () => {
    expect(slugify("Dom Casmurro Machado de Assis")).toBe("dom-casmurro-machado-de-assis");
    expect(slugify("Memórias Póstumas de Brás Cubas!")).toBe("memorias-postumas-de-bras-cubas");
    expect(slugify("¿?")).toBe("");
  });

  it("shows the imported classics to anyone, never the books readers published", async () => {
    const owner = await signUp();
    const tag = randomBytes(3).toString("hex");
    const classic = await publicBook(owner.id, `Helena ${tag}`, "Machado de Assis", "pt", { downloads: 99999 });
    const other = await publicBook(owner.id, `Iaia Garcia ${tag}`, "Machado de Assis", "pt", { downloads: 99998 });
    const english = await publicBook(owner.id, `Annabel Lee ${tag}`, "Edgar Allan Poe", "en", { downloads: 99997 });
    const mine = await publicBook(owner.id, `My own upload ${tag}`, "Someone", "pt");
    forgetClassics();

    const hub = await api(null, "GET", "/classics");
    expect(hub.statusCode).toBe(200);
    expect(hub.headers["content-type"]).toContain("text/html");
    expect(hub.body).toContain(`Helena ${tag}`);
    expect(hub.body).toContain(`Annabel Lee ${tag}`);
    expect(hub.body).not.toContain(`My own upload ${tag}`);
    expect(hub.body).toContain('<link rel="canonical"');

    const pt = await api(null, "GET", "/classics/pt");
    expect(pt.statusCode).toBe(200);
    expect(pt.body).toContain('<html lang="pt-BR">');
    expect(pt.body).toContain("Livros clássicos em português");
    expect(pt.body).toContain(`Iaia Garcia ${tag}`);
    expect(pt.body).not.toContain(`My own upload ${tag}`);
    expect((await api(null, "GET", "/classics/xx")).statusCode).toBe(404);

    const path = `/classics/helena-${tag}-machado-de-assis-${classic}`;
    const page = await api(null, "GET", path);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Ler grátis");
    expect(page.body).toContain(`href="/public/books/${classic}"`);
    expect(page.body).toContain('"@type":"Book"');
    expect(page.body).toContain("A story about Helena"); // tags stripped
    expect(page.body).not.toContain("<b>about</b>");
    expect(page.body).toContain(`Mais de Machado de Assis`);
    expect(page.body).toContain(`/classics/iaia-garcia-${tag}-machado-de-assis-${other}`);

    // A wrong or missing slug goes to the right address; a reader's own book has no page.
    const moved = await api(null, "GET", `/classics/whatever-${classic}`);
    expect(moved.statusCode).toBe(301);
    expect(moved.headers.location).toBe(path);
    expect((await api(null, "GET", `/classics/x-${mine}`)).statusCode).toBe(404);
    expect((await api(null, "GET", `/classics/annabel-lee-${tag}-edgar-allan-poe-${english}`)).body).toContain("Read free");

    const sitemap = await api(null, "GET", "/sitemap.xml");
    expect(sitemap.statusCode).toBe(200);
    expect(sitemap.body).toContain("/classics/pt</loc>");
    expect(sitemap.body).toContain(`${path}</loc>`);
    expect(sitemap.body).toContain("/pt</loc>");
    expect(sitemap.body).not.toContain(mine);

    // Covers: classics only, and only when there is one.
    expect((await api(null, "GET", `/api/classics/${classic}/cover`)).statusCode).toBe(404);
    expect((await api(null, "GET", `/api/classics/${mine}/cover`)).statusCode).toBe(404);
  });
});
