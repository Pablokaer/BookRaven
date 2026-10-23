import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { query } from "../db.js";
import { CONVERTED_FORMATS, comicAsCbz } from "../lib/comicConvert.js";
import { verifyAppPassword } from "../lib/devices.js";
import { MIME_TYPES } from "../lib/formats.js";
import { UUID_RE } from "../lib/http.js";
import { audit, log } from "../lib/log.js";
import { FINISHED_AT } from "../lib/progress.js";
import { catalogView, listCatalog, listCatalogByTitle, type CatalogRow } from "../lib/publicCatalog.js";
import { bookKey } from "../lib/storage.js";
import { THEMES, themesFor } from "../lib/themes.js";
import { coverThumbnail } from "../lib/thumbnail.js";
import { SELECT_BOOK, type BookRow } from "../lib/bookDto.js";
import { sendCover, sendFile } from "./books.js";

/**
 * OPDS 1.2 catalog (Atom) for reading apps: KOReader, Moon+ Reader, Thorium, Calibre…
 * Authenticated with HTTP Basic: the account email and an app password from the profile.
 * Entries carry what e-readers show on a book's page: the reader's progress, the description,
 * the series and publisher, a small grayscale thumbnail and, for RAR/7z/TAR comics, a CBZ copy.
 */

const PAGE_SIZE = 50;
const NAV = "application/atom+xml;profile=opds-catalog;kind=navigation";
const ACQ = "application/atom+xml;profile=opds-catalog;kind=acquisition";

/** XML text: escaped, without the control characters XML 1.0 can't carry (descriptions sometimes have them). */
const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

declare module "fastify" {
  interface FastifyRequest {
    /** The app password an OPDS reader or the KOReader plugin signed in with: which device this is. */
    appPasswordId?: string;
  }
}

/**
 * preHandler for app-password sign-in with HTTP Basic (the OPDS catalog and the KOReader plugin,
 * routes/koreader.ts): the account email and an app password.
 */
export async function basicAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization ?? "";
  const m = /^Basic\s+(.+)$/i.exec(header);
  if (m) {
    const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const found = sep > 0 ? await verifyAppPassword(decoded.slice(0, sep), { password: decoded.slice(sep + 1) }) : null;
    if (found && !found.blocked) {
      request.user = found.user;
      request.appPasswordId = found.appPasswordId;
      return;
    }
    // Readers first ask without credentials to get the challenge: only wrong ones are worth a line.
    const via = request.url.startsWith("/api/koreader/") ? "koreader-plugin" : "opds";
    if (found) audit("app_password.blocked_account", { via, userId: found.user.id, ip: request.ip }, "warn");
    else audit("app_password.auth_failed", { via, ip: request.ip }, "warn");
  }
  reply.header("WWW-Authenticate", 'Basic realm="BookRaven", charset="UTF-8"'); // ASCII-only header
  return reply.code(401).type("text/plain").send("Use your account email and an app password (Profile → Other apps).");
}

function feed(opts: { id: string; title: string; self: string; kind: string; entries: string[]; next?: string | null; search?: boolean }) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:calibre="http://calibre.kovidgoyal.net/2009/metadata">
  <id>${esc(opts.id)}</id>
  <title>${esc(opts.title)}</title>
  <updated>${now}</updated>
  <author><name>BookRaven</name></author>
  <link rel="self" href="${esc(opts.self)}" type="${opts.kind}"/>
  <link rel="start" href="/opds" type="${NAV}"/>
  <link rel="search" href="/opds/search.xml" type="application/opensearchdescription+xml"/>
  ${opts.next ? `<link rel="next" href="${esc(opts.next)}" type="${ACQ}"/>` : ""}
  ${opts.entries.join("\n  ")}
</feed>`;
}

const navEntry = (id: string, title: string, href: string, content: string, kind = ACQ) =>
  `<entry><id>${esc(id)}</id><title>${esc(title)}</title><updated>${new Date().toISOString()}</updated>` +
  `<content type="text">${esc(content)}</content><link rel="subsection" href="${esc(href)}" type="${kind}"/></entry>`;

/** The reader's position in a book, for its entry. */
type EntryProgress = { percentage: number; device_name: string | null; updated_at: Date };

type EntryRow = Pick<
  BookRow,
  "id" | "title" | "author" | "language" | "tags" | "published_at" | "created_at" | "mime_type" | "size_bytes" | "has_cover" | "format"
> &
  Partial<Pick<BookRow, "description" | "series" | "series_index" | "publisher" | "issued">> & {
    owner_name?: string | null;
    progress?: EntryProgress | null;
  };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "just now", "3 hours ago", "yesterday", "5 days ago", or "on 12 Mar 2026" (UTC) further back. */
export function readWhen(at: Date, now = new Date()) {
  const s = Math.max(0, (now.getTime() - at.getTime()) / 1000);
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"} ago`;
  if (s < 60) return "just now";
  if (s < 3600) return n(Math.floor(s / 60), "minute");
  if (s < 86_400) return n(Math.floor(s / 3600), "hour");
  if (s < 2 * 86_400) return "yesterday";
  if (s < 7 * 86_400) return n(Math.floor(s / 86_400), "day");
  return `on ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/** "42% · read on Kindle 3 hours ago", or "Finished · …". */
export function progressText(p: EntryProgress, now = new Date()) {
  const where = p.device_name?.trim() ? ` on ${p.device_name.trim()}` : "";
  const done = p.percentage >= FINISHED_AT ? "Finished" : `${Math.floor(p.percentage * 100)}%`;
  return `${done} · read${where} ${readWhen(p.updated_at, now)}`;
}

/** "2", "2.5": a series position as people write it. */
const seriesIndex = (n: number) => String(Math.round(n * 100) / 100);

const rowProgress = (b: BookRow): EntryProgress | null =>
  b.p_updated_at ? { percentage: b.p_percentage ?? 0, device_name: b.p_device_name, updated_at: b.p_updated_at } : null;

function bookEntry(b: EntryRow, base: "books" | "public") {
  const updated = (b.published_at ?? b.created_at).toISOString();
  // Short lines first (KOReader shows the content on the book's page), then the blurb.
  const head = [
    b.progress ? progressText(b.progress) : null,
    b.series ? `Series: ${b.series}${b.series_index != null ? ` #${seriesIndex(b.series_index)}` : ""}` : null,
    b.owner_name ? `Shared by ${b.owner_name}` : null,
  ].filter((l): l is string => Boolean(l));
  const content = [head.join("\n"), b.description?.trim()].filter(Boolean).join("\n\n");
  const file = `/opds/${base}/${b.id}/file`;
  // KOReader reads CBZ best (page by page): the converted copy comes first, the original after it.
  const cbz = CONVERTED_FORMATS.has(b.format)
    ? `<link rel="http://opds-spec.org/acquisition" href="${file}?as=cbz" type="${MIME_TYPES.cbz}" title="CBZ"/>`
    : "";
  return `<entry>
    <id>urn:uuid:${b.id}</id>
    <title>${esc(b.title)}</title>
    ${b.author ? `<author><name>${esc(b.author)}</name></author>` : ""}
    ${b.language ? `<dc:language>${esc(b.language)}</dc:language>` : ""}
    ${b.publisher ? `<dc:publisher>${esc(b.publisher)}</dc:publisher>` : ""}
    ${b.issued ? `<dc:issued>${esc(b.issued)}</dc:issued>` : ""}
    ${b.series ? `<calibre:series>${esc(b.series)}</calibre:series>` : ""}
    ${b.series && b.series_index != null ? `<calibre:series_index>${seriesIndex(b.series_index)}</calibre:series_index>` : ""}
    <updated>${updated}</updated>
    ${b.tags?.length ? b.tags.map((t) => `<category term="${esc(t)}" label="${esc(t)}"/>`).join("") : ""}
    ${head.length ? `<summary type="text">${esc(head.join(" · "))}</summary>` : ""}
    ${content ? `<content type="text">${esc(content)}</content>` : ""}
    ${cbz}
    <link rel="http://opds-spec.org/acquisition" href="${file}" type="${esc(b.mime_type)}" length="${b.size_bytes}"/>
    ${
      b.has_cover
        ? `<link rel="http://opds-spec.org/image" href="/opds/${base}/${b.id}/cover" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="/opds/${base}/${b.id}/thumbnail" type="image/jpeg"/>`
        : ""
    }
  </entry>`;
}

/**
 * "Author - Title.ext", safe as a file name everywhere: no / \ : * ? " < > | or control
 * characters, single spaces, at most 120 characters before the extension.
 */
export function downloadName(b: { title: string; author: string | null }, ext: string) {
  const clean = (s: string) => s.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const title = clean(b.title) || "Untitled";
  const author = b.author ? clean(b.author) : "";
  const name = Array.from(author ? `${author} - ${title}` : title)
    .slice(0, 120)
    .join("")
    .replace(/[. ]+$/, ""); // Windows drops trailing dots and spaces
  return `${name || "Untitled"}.${ext}`;
}

/** A Content-Disposition header for `name`: an ASCII fallback, and the exact name (RFC 5987). */
function attachment(name: string) {
  const ascii = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_");
  const exact = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

const pageOf = (request: FastifyRequest) => Math.max(1, Number((request.query as { page?: string }).page) || 1);

// ---- public library sections ----

const THEME_LABELS = Object.fromEntries(THEMES.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)]));
const byPopularity = (a: CatalogRow, b: CatalogRow) => (b.download_count ?? -1) - (a.download_count ?? -1);

/**
 * The public library's sections, as the web shows them: most popular (imported books, by
 * downloads at their source), one per theme (most popular first) and the books readers shared.
 * Made from the in-memory listing (the newest `CATALOG_SIZE` books), once per read of it.
 */
const publicSections = catalogView((rows) => {
  const themes = new Map<string, CatalogRow[]>();
  for (const r of rows) {
    for (const t of new Set([...(r.themes ?? []), ...themesFor(r.tags ?? [])])) {
      if (!themes.has(t)) themes.set(t, []);
      themes.get(t)!.push(r);
    }
  }
  for (const list of themes.values()) list.sort(byPopularity);
  return {
    popular: rows.filter((r) => r.download_count !== null).sort(byPopularity),
    readers: rows.filter((r) => r.download_count === null),
    themes,
  };
});

/**
 * Public-library rows as entries for `userId`: the description, series and publisher of the
 * listed books (left out of the in-memory listing), and the reader's progress in their own copy.
 */
async function publicEntries(rows: CatalogRow[], userId: string) {
  if (!rows.length) return [];
  const [extra, own] = await Promise.all([
    query<Pick<BookRow, "id" | "description" | "series" | "series_index" | "publisher" | "issued">>(
      "SELECT id, description, series, series_index, publisher, issued FROM book WHERE id = ANY($1)",
      [rows.map((r) => r.id)],
    ),
    query<EntryProgress & { sha256: string }>(
      `SELECT m.sha256, p.percentage, p.device_name, p.updated_at FROM book m
       JOIN reading_progress p ON p.book_id = m.id AND p.user_id = m.user_id
       WHERE m.user_id = $1 AND m.sha256 = ANY($2)`,
      [userId, rows.map((r) => r.sha256)],
    ),
  ]);
  const extras = new Map(extra.rows.map((e) => [e.id, e]));
  const progress = new Map(own.rows.map((p) => [p.sha256, p]));
  return rows.map((r) => bookEntry({ ...r, ...extras.get(r.id), progress: progress.get(r.sha256) ?? null }, "public"));
}

export async function opdsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", basicAuth);
  app.addHook("onSend", async (_request, reply, payload) => {
    if (typeof payload === "string" && payload.startsWith("<?xml") && !reply.hasHeader("content-type")) {
      reply.header("content-type", "application/atom+xml; charset=utf-8");
    }
    return payload;
  });

  app.get("/opds", async (request, reply) => {
    const { rows: folders } = await query<{ id: string; name: string }>("SELECT id, name FROM folder WHERE user_id = $1 ORDER BY lower(name)", [
      request.user.id,
    ]);
    const entries = [
      navEntry("readsync:reading", "Reading now", "/opds/reading", "Books you have started, most recently read first"),
      navEntry("readsync:sent", "Sent to this device", "/opds/sent", "Books you sent to your e-readers from BookRaven, newest first"),
      navEntry("readsync:library", "My library", "/opds/library", "All your books, most recently read first"),
      navEntry("readsync:recent", "Recently added", "/opds/library?sort=added", "Newest uploads first"),
      navEntry("readsync:finished", "Finished", "/opds/finished", "Books you have read to the end"),
      ...folders.map((f) => navEntry(`readsync:folder:${f.id}`, `Collection: ${f.name}`, `/opds/collections/${f.id}`, `Books in ${f.name}`)),
      navEntry("readsync:public", "Public Library", "/opds/public", `Books shared with everyone on ${config.publicUrl}`, NAV),
    ];
    return reply.type(NAV).send(feed({ id: "readsync:root", title: "BookRaven", self: "/opds", kind: NAV, entries }));
  });

  async function libraryFeed(
    request: FastifyRequest,
    reply: FastifyReply,
    opts: { where: string; params: unknown[]; title: string; self: string; order?: string; join?: string },
  ) {
    const page = pageOf(request);
    const order =
      opts.order ?? ((request.query as { sort?: string }).sort === "added" ? "b.created_at DESC" : "COALESCE(p.updated_at, b.created_at) DESC");
    const { rows } = await query<BookRow>(
      `${SELECT_BOOK} ${opts.join ?? ""} WHERE b.user_id = $1 ${opts.where} ORDER BY ${order} LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`,
      [request.user.id, ...opts.params],
    );
    const sep = opts.self.includes("?") ? "&" : "?";
    const next = rows.length > PAGE_SIZE ? `${opts.self}${sep}page=${page + 1}` : null;
    const entries = rows.slice(0, PAGE_SIZE).map((b) => bookEntry({ ...b, progress: rowProgress(b) }, "books"));
    return reply.type(ACQ).send(feed({ id: `readsync:${opts.self}`, title: opts.title, self: opts.self, kind: ACQ, next, entries }));
  }

  app.get("/opds/library", (request, reply) =>
    libraryFeed(request, reply, {
      where: "",
      params: [],
      title: "My library",
      self: (request.query as { sort?: string }).sort === "added" ? "/opds/library?sort=added" : "/opds/library",
    }),
  );

  app.get("/opds/reading", (request, reply) =>
    libraryFeed(request, reply, {
      where: "AND p.locator IS NOT NULL AND p.percentage < $2",
      params: [FINISHED_AT],
      title: "Reading now",
      self: "/opds/reading",
      order: "p.updated_at DESC",
    }),
  );

  /** "Send to Kindle" (routes/deliveries.ts): the books sent to the account's e-readers, newest first. */
  app.get("/opds/sent", (request, reply) =>
    libraryFeed(request, reply, {
      where: "",
      params: [],
      title: "Sent to this device",
      self: "/opds/sent",
      join: "JOIN book_delivery d ON d.book_id = b.id AND d.user_id = b.user_id",
      order: "d.created_at DESC",
    }),
  );

  app.get("/opds/finished", (request, reply) =>
    libraryFeed(request, reply, {
      where: "AND p.percentage >= $2",
      params: [FINISHED_AT],
      title: "Finished",
      self: "/opds/finished",
      order: "p.updated_at DESC",
    }),
  );

  app.get<{ Params: { id: string } }>("/opds/collections/:id", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send();
    const f = await query<{ name: string }>("SELECT name FROM folder WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
    if (!f.rows[0]) return reply.code(404).send();
    return libraryFeed(request, reply, { where: "AND b.folder_id = $2", params: [request.params.id], title: f.rows[0].name, self: `/opds/collections/${request.params.id}` });
  });

  app.get<{ Querystring: { q?: string } }>("/opds/search", async (request, reply) => {
    const q = (request.query.q ?? "").trim();
    return libraryFeed(request, reply, {
      where: "AND (b.title ILIKE $2 OR b.author ILIKE $2 OR b.series ILIKE $2 OR array_to_string(b.tags, ' ') ILIKE $2)",
      params: [`%${q.replace(/[%_\\]/g, "\\$&")}%`],
      title: `Search: ${q}`,
      self: `/opds/search?q=${encodeURIComponent(q)}`,
    });
  });

  app.get("/opds/search.xml", async (_request, reply) =>
    reply.type("application/opensearchdescription+xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>BookRaven</ShortName>
  <Description>Search your BookRaven library</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <OutputEncoding>UTF-8</OutputEncoding>
  <Url type="${ACQ}" template="/opds/search?q={searchTerms}"/>
</OpenSearchDescription>`),
  );

  // ---- public library ----

  /** One page of `rows` (with one more to tell whether a next page exists) as an acquisition feed. */
  async function publicFeed(request: FastifyRequest, reply: FastifyReply, opts: { rows: CatalogRow[]; page: number; title: string; self: string }) {
    const next = opts.rows.length > PAGE_SIZE ? `${opts.self}?page=${opts.page + 1}` : null;
    const entries = await publicEntries(opts.rows.slice(0, PAGE_SIZE), request.user.id);
    return reply.type(ACQ).send(feed({ id: `readsync:${opts.self}`, title: opts.title, self: opts.self, kind: ACQ, next, entries }));
  }
  const inMemoryPage = (rows: CatalogRow[], page: number) => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE + 1);

  const recentFeed = async (request: FastifyRequest, reply: FastifyReply, self: string) => {
    const page = pageOf(request);
    const rows = await listCatalog({ offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 });
    return publicFeed(request, reply, { rows, page, title: "Public Library: Recently added", self });
  };

  /**
   * The public library's sections. It used to be one feed of every book, newest first, paged
   * with `?page=`: its next links (which some readers keep) still get those pages.
   */
  app.get("/opds/public", async (request, reply) => {
    if ((request.query as { page?: string }).page) return recentFeed(request, reply, "/opds/public");
    const sections = await publicSections();
    const count = (n: number) => `${n} book${n === 1 ? "" : "s"}`;
    const entries = [
      navEntry("readsync:public:recent", "Recently added", "/opds/public/recent", "Newest in the public library first"),
      ...(sections.popular.length
        ? [navEntry("readsync:public:popular", "Most popular", "/opds/public/popular", "The most downloaded public-domain classics")]
        : []),
      ...THEMES.filter((t) => sections.themes.get(t)?.length).map((t) =>
        navEntry(`readsync:public:theme:${t}`, THEME_LABELS[t]!, `/opds/public/themes/${t}`, count(sections.themes.get(t)!.length)),
      ),
      ...(sections.readers.length
        ? [navEntry("readsync:public:readers", "Shared by readers", "/opds/public/readers", "Books people on this server published")]
        : []),
      navEntry("readsync:public:all", "All books", "/opds/public/all", "The whole public library, by title"),
    ];
    return reply.type(NAV).send(feed({ id: "readsync:public", title: "Public Library", self: "/opds/public", kind: NAV, entries }));
  });

  app.get("/opds/public/recent", (request, reply) => recentFeed(request, reply, "/opds/public/recent"));

  app.get("/opds/public/all", async (request, reply) => {
    const page = pageOf(request);
    const rows = await listCatalogByTitle({ offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 });
    return publicFeed(request, reply, { rows, page, title: "Public Library: All books", self: "/opds/public/all" });
  });

  for (const [section, title] of [["popular", "Most popular"], ["readers", "Shared by readers"]] as const) {
    app.get(`/opds/public/${section}`, async (request, reply) => {
      const page = pageOf(request);
      const rows = inMemoryPage((await publicSections())[section], page);
      return publicFeed(request, reply, { rows, page, title: `Public Library: ${title}`, self: `/opds/public/${section}` });
    });
  }

  app.get<{ Params: { theme: string } }>("/opds/public/themes/:theme", async (request, reply) => {
    const { theme } = request.params;
    if (!(THEMES as readonly string[]).includes(theme)) return reply.code(404).send();
    const page = pageOf(request);
    const rows = inMemoryPage((await publicSections()).themes.get(theme) ?? [], page);
    return publicFeed(request, reply, { rows, page, title: `Public Library: ${THEME_LABELS[theme]}`, self: `/opds/public/themes/${theme}` });
  });

  // ---- files ----

  async function own(request: FastifyRequest<{ Params: { id: string } }>) {
    if (!UUID_RE.test(request.params.id)) return null;
    return (await query<BookRow>(`${SELECT_BOOK} WHERE b.id = $1 AND b.user_id = $2`, [request.params.id, request.user.id])).rows[0] ?? null;
  }
  async function pub(request: FastifyRequest<{ Params: { id: string } }>) {
    if (!UUID_RE.test(request.params.id)) return null;
    return (await query<BookRow>(`SELECT b.*, false AS is_shared FROM book b WHERE b.id = $1 AND b.is_public`, [request.params.id])).rows[0] ?? null;
  }
  for (const [base, load] of [["books", own], ["public", pub]] as const) {
    /** The book's file, saved as "Author - Title.ext"; `?as=cbz` serves a RAR/7z/TAR comic as CBZ (see comicConvert.ts). */
    app.get<{ Params: { id: string }; Querystring: { as?: string } }>(`/opds/${base}/:id/file`, async (request, reply) => {
      const b = await load(request);
      if (!b) return reply.code(404).send();
      if (request.query.as === "cbz" && b.format !== "cbz") {
        if (!CONVERTED_FORMATS.has(b.format)) return reply.code(400).send({ error: "not_a_comic_archive" });
        const converted = await comicAsCbz(b.sha256);
        if (!converted) return reply.code(422).send({ error: "unconvertible" });
        reply.header("Content-Disposition", attachment(downloadName(b, "cbz")));
        return sendFile(request, reply, converted, MIME_TYPES.cbz, `${b.sha256}-cbz`);
      }
      reply.header("Content-Disposition", attachment(downloadName(b, b.format)));
      return sendFile(request, reply, bookKey(b.sha256), b.mime_type, b.sha256);
    });
    app.get<{ Params: { id: string } }>(`/opds/${base}/:id/cover`, async (request, reply) => {
      const b = await load(request);
      return b ? sendCover(request, reply, b) : reply.code(404).send();
    });
    /** A small grayscale JPEG of the cover, for e-ink lists; the full cover when one can't be made. */
    app.get<{ Params: { id: string } }>(`/opds/${base}/:id/thumbnail`, async (request, reply) => {
      const b = await load(request);
      if (!b?.has_cover) return reply.code(404).send();
      const etag = `"thumb-${b.id}"`;
      // A book's cover never changes, so neither does its thumbnail.
      reply.header("ETag", etag);
      reply.header("Cache-Control", "private, max-age=31536000, immutable");
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      const thumb = await coverThumbnail(b.id).catch((err) => {
        log.warn({ err, bookId: b.id }, "could not make a cover thumbnail");
        return null;
      });
      if (!thumb) {
        reply.removeHeader("ETag");
        return sendCover(request, reply, b);
      }
      return reply.type("image/jpeg").send(thumb);
    });
  }
}
