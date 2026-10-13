import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { query } from "../db.js";
import { verifyAppPassword } from "../lib/devices.js";
import { bookKey } from "../lib/storage.js";
import { SELECT_BOOK, sendCover, sendFile, type BookRow } from "./books.js";

/**
 * OPDS 1.2 catalog (Atom) for reading apps: KOReader, Moon+ Reader, Thorium, Calibre…
 * Authenticated with HTTP Basic: the account email and an app password from the profile.
 */

const PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAV = "application/atom+xml;profile=opds-catalog;kind=navigation";
const ACQ = "application/atom+xml;profile=opds-catalog;kind=acquisition";

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

async function basicAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization ?? "";
  const m = /^Basic\s+(.+)$/i.exec(header);
  if (m) {
    const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep > 0) {
      const user = await verifyAppPassword(decoded.slice(0, sep), { password: decoded.slice(sep + 1) });
      if (user) {
        request.user = user;
        return;
      }
    }
  }
  reply.header("WWW-Authenticate", 'Basic realm="BookRaven", charset="UTF-8"'); // ASCII-only header
  return reply.code(401).type("text/plain").send("Use your account email and an app password (Profile → Other apps).");
}

function feed(opts: { id: string; title: string; self: string; kind: string; entries: string[]; next?: string | null; search?: boolean }) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog">
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

const navEntry = (id: string, title: string, href: string, content: string) =>
  `<entry><id>${esc(id)}</id><title>${esc(title)}</title><updated>${new Date().toISOString()}</updated>` +
  `<content type="text">${esc(content)}</content><link rel="subsection" href="${esc(href)}" type="${ACQ}"/></entry>`;

function bookEntry(b: BookRow & { owner_name?: string | null }, base: "books" | "public") {
  const updated = (b.published_at ?? b.created_at).toISOString();
  return `<entry>
    <id>urn:uuid:${b.id}</id>
    <title>${esc(b.title)}</title>
    ${b.author ? `<author><name>${esc(b.author)}</name></author>` : ""}
    ${b.language ? `<dc:language>${esc(b.language)}</dc:language>` : ""}
    <updated>${updated}</updated>
    ${b.tags?.length ? b.tags.map((t) => `<category term="${esc(t)}" label="${esc(t)}"/>`).join("") : ""}
    ${b.owner_name ? `<content type="text">Shared by ${esc(b.owner_name)}</content>` : ""}
    <link rel="http://opds-spec.org/acquisition" href="/opds/${base}/${b.id}/file" type="${esc(b.mime_type)}" length="${b.size_bytes}"/>
    ${
      b.has_cover
        ? `<link rel="http://opds-spec.org/image" href="/opds/${base}/${b.id}/cover" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="/opds/${base}/${b.id}/cover" type="image/jpeg"/>`
        : ""
    }
  </entry>`;
}

const pageOf = (request: FastifyRequest) => Math.max(1, Number((request.query as { page?: string }).page) || 1);

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
      navEntry("readsync:library", "My library", "/opds/library", "All your books, most recently read first"),
      navEntry("readsync:recent", "Recently added", "/opds/library?sort=added", "Newest uploads first"),
      ...folders.map((f) => navEntry(`readsync:folder:${f.id}`, `Collection: ${f.name}`, `/opds/collections/${f.id}`, `Books in ${f.name}`)),
      navEntry("readsync:public", "Public Library", "/opds/public", `Books shared with everyone on ${config.publicUrl}`),
    ];
    return reply.type(NAV).send(feed({ id: "readsync:root", title: "BookRaven", self: "/opds", kind: NAV, entries }));
  });

  async function libraryFeed(request: FastifyRequest, reply: FastifyReply, opts: { where: string; params: unknown[]; title: string; self: string }) {
    const page = pageOf(request);
    const order = (request.query as { sort?: string }).sort === "added" ? "b.created_at DESC" : "COALESCE(p.updated_at, b.created_at) DESC";
    const { rows } = await query<BookRow>(
      `${SELECT_BOOK} WHERE b.user_id = $1 ${opts.where} ORDER BY ${order} LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`,
      [request.user.id, ...opts.params],
    );
    const sep = opts.self.includes("?") ? "&" : "?";
    const next = rows.length > PAGE_SIZE ? `${opts.self}${sep}page=${page + 1}` : null;
    return reply.type(ACQ).send(
      feed({ id: `readsync:${opts.self}`, title: opts.title, self: opts.self, kind: ACQ, next, entries: rows.slice(0, PAGE_SIZE).map((b) => bookEntry(b, "books")) }),
    );
  }

  app.get("/opds/library", (request, reply) =>
    libraryFeed(request, reply, {
      where: "",
      params: [],
      title: "My library",
      self: (request.query as { sort?: string }).sort === "added" ? "/opds/library?sort=added" : "/opds/library",
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
      where: "AND (b.title ILIKE $2 OR b.author ILIKE $2 OR array_to_string(b.tags, ' ') ILIKE $2)",
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

  app.get("/opds/public", async (request, reply) => {
    const page = pageOf(request);
    const { rows } = await query<BookRow & { owner_name: string | null }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (b.sha256) b.*, u.name AS owner_name, false AS is_shared
         FROM book b JOIN "user" u ON u.id = b.user_id WHERE b.is_public ORDER BY b.sha256, b.published_at
       ) t ORDER BY published_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`,
    );
    const next = rows.length > PAGE_SIZE ? `/opds/public?page=${page + 1}` : null;
    return reply.type(ACQ).send(feed({ id: "readsync:public", title: "Public Library", self: "/opds/public", kind: ACQ, next, entries: rows.slice(0, PAGE_SIZE).map((b) => bookEntry(b, "public")) }));
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
  const download = (reply: FastifyReply, b: BookRow) =>
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(b.original_filename)}`);

  app.get<{ Params: { id: string } }>("/opds/books/:id/file", async (request, reply) => {
    const b = await own(request);
    if (!b) return reply.code(404).send();
    return sendFile(request, download(reply, b), bookKey(b.sha256), b.mime_type, b.sha256);
  });
  app.get<{ Params: { id: string } }>("/opds/books/:id/cover", async (request, reply) => {
    const b = await own(request);
    return b ? sendCover(request, reply, b) : reply.code(404).send();
  });
  app.get<{ Params: { id: string } }>("/opds/public/:id/file", async (request, reply) => {
    const b = await pub(request);
    if (!b) return reply.code(404).send();
    return sendFile(request, download(reply, b), bookKey(b.sha256), b.mime_type, b.sha256);
  });
  app.get<{ Params: { id: string } }>("/opds/public/:id/cover", async (request, reply) => {
    const b = await pub(request);
    return b ? sendCover(request, reply, b) : reply.code(404).send();
  });
}
