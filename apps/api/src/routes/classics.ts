import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "../config.js";
import { query } from "../db.js";
import { UUID_RE } from "../lib/http.js";
import { SOURCE_NAMES } from "../lib/otherSources.js";
import { themesFor } from "../lib/themes.js";
import { sendCover } from "./books.js";

/**
 * Pages search engines can find: the public-domain classics of the Public Library (the books
 * imported from Project Gutenberg, Standard Ebooks and Wikisource, never the books readers
 * published), drawn on the server as plain HTML, with no sign-in. Caddy sends /classics and
 * /sitemap.xml here (infra/Caddyfile).
 *
 *   /classics              every language, the most read books of each
 *   /classics/:lang        one language: the most read, then every author and their books
 *   /classics/:slug-:id    one book: cover, author, description, and "Read free" (sign in or
 *                          create an account, then the book's page in the app)
 *   /sitemap.xml           the front pages and all of the above
 *
 * Pages for Portuguese books (and /classics/pt) are written in Portuguese, the others in English.
 */

type Lang = "en" | "pt";

type ClassicRow = {
  id: string;
  title: string;
  author: string | null;
  has_cover: boolean;
  language: string;
  themes: string[];
  tags: string[];
  authors: { name: string; birth_year: number | null; death_year: number | null }[];
  download_count: number;
  source: string;
  source_url: string;
  imported_at: Date;
};

type Classic = ClassicRow & { slug: string; path: string; sections: string[] };

const LANGUAGE_NAMES: Record<string, { en: string; pt: string; native: string }> = {
  pt: { en: "Portuguese", pt: "português", native: "Português" },
  en: { en: "English", pt: "inglês", native: "English" },
  es: { en: "Spanish", pt: "espanhol", native: "Español" },
  fr: { en: "French", pt: "francês", native: "Français" },
  de: { en: "German", pt: "alemão", native: "Deutsch" },
  it: { en: "Italian", pt: "italiano", native: "Italiano" },
  la: { en: "Latin", pt: "latim", native: "Latina" },
  nl: { en: "Dutch", pt: "holandês", native: "Nederlands" },
};
const languageName = (code: string, lang: Lang) => LANGUAGE_NAMES[code]?.[lang] ?? code.toUpperCase();

const SECTION_NAMES: Record<string, { en: string; pt: string }> = {
  philosophy: { en: "Philosophy", pt: "Filosofia" },
  politics: { en: "Politics", pt: "Política" },
  economics: { en: "Economics", pt: "Economia" },
  technology: { en: "Technology", pt: "Tecnologia" },
  computing: { en: "Computing", pt: "Computação" },
  science: { en: "Science", pt: "Ciência" },
  history: { en: "History", pt: "História" },
  literature: { en: "Literature", pt: "Literatura" },
  poetry: { en: "Poetry", pt: "Poesia" },
  religion: { en: "Religion", pt: "Religião" },
  children: { en: "Children", pt: "Infantil" },
};
const sectionName = (key: string, lang: Lang) => SECTION_NAMES[key]?.[lang] ?? key;

const T = {
  en: {
    home: "/",
    classics: "Classics",
    hubTitle: "Free classic books to read online",
    hubIntro:
      "Public-domain classics, from novels and poetry to philosophy and history, free to read in your browser, on Android or on an e-reader. BookRaven keeps your place, highlights and notes in step on every device.",
    langTitle: (name: string) => `Free classics in ${name} to read online`,
    langIntro: (name: string, n: number) =>
      `${n} public-domain ${n === 1 ? "book" : "books"} in ${name}, free to read online with BookRaven: in the browser, on Android or on an e-reader, with your place synced across devices.`,
    mostRead: "Most read",
    authors: "Authors",
    seeAll: (n: number) => `See all ${n} books`,
    books: (n: number) => `${n} ${n === 1 ? "book" : "books"}`,
    in: (name: string) => `In ${name}`,
    readFree: "Read free",
    whatIs: "What is BookRaven?",
    by: "by",
    language: "Language",
    sections: "Shelved under",
    source: "Edition",
    publicDomain: "Public domain",
    about: "About this book",
    noDescription: (title: string, author: string) =>
      `${title}${author ? ` by ${author}` : ""} is a public-domain classic: free to read, with no ads and nothing to buy.`,
    moreBy: (author: string) => `More by ${author}`,
    moreIn: (section: string) => `More ${section.toLowerCase()}`,
    why: "Why read it on BookRaven",
    whyItems: [
      ["Free, no ads", "Public-domain books cost nothing, and there is nothing to buy to read them."],
      ["Your place everywhere", "Start in the browser, carry on in the Android app or on KOReader, down to the sentence."],
      ["Notes in the margin", "Highlights, notes, bookmarks and a dictionary for any word you select."],
      ["Your own books too", "Add your EPUBs, PDFs and comics to the same library."],
    ],
    bookTitle: (title: string, author: string) => `${title}${author ? ` by ${author}` : ""} · Read free online · BookRaven`,
    bookDescription: (title: string, author: string) =>
      `Read ${title}${author ? ` by ${author}` : ""} free online: a public-domain ebook you can open in the browser, on Android or on an e-reader, with your place synced.`,
    footer: "A reader for ebooks, PDFs and comics, with your place synced on every device.",
    privacy: "Privacy",
    allLanguages: "All languages",
  },
  pt: {
    home: "/pt",
    classics: "Clássicos",
    hubTitle: "Livros clássicos para ler online grátis",
    hubIntro:
      "Clássicos em domínio público, de romances e poesia a filosofia e história, para ler de graça no navegador, no Android ou num leitor de e-book. O BookRaven guarda a sua página, seus destaques e suas notas em todos os aparelhos.",
    langTitle: (name: string) => `Livros clássicos em ${name} para ler online grátis`,
    langIntro: (name: string, n: number) =>
      `${n} ${n === 1 ? "livro" : "livros"} em domínio público em ${name}, para ler online de graça no BookRaven: no navegador, no Android ou num leitor de e-book, com a página sincronizada entre os aparelhos.`,
    mostRead: "Mais lidos",
    authors: "Autores",
    seeAll: (n: number) => `Ver os ${n} livros`,
    books: (n: number) => `${n} ${n === 1 ? "livro" : "livros"}`,
    in: (name: string) => `Em ${name}`,
    readFree: "Ler grátis",
    whatIs: "O que é o BookRaven?",
    by: "de",
    language: "Idioma",
    sections: "Estante",
    source: "Edição",
    publicDomain: "Domínio público",
    about: "Sobre o livro",
    noDescription: (title: string, author: string) =>
      `${title}${author ? `, de ${author},` : ""} é um clássico em domínio público: grátis para ler, sem anúncios e sem nada para comprar.`,
    moreBy: (author: string) => `Mais de ${author}`,
    moreIn: (section: string) => `Mais em ${section}`,
    why: "Por que ler no BookRaven",
    whyItems: [
      ["Grátis, sem anúncios", "Livros em domínio público não custam nada, e não há nada para comprar."],
      ["Sua página em todo lugar", "Comece no navegador e continue no app Android ou no KOReader, na mesma frase."],
      ["Notas na margem", "Destaques, notas, marcadores e dicionário para qualquer palavra."],
      ["Seus livros também", "Coloque seus EPUBs, PDFs e quadrinhos na mesma biblioteca."],
    ],
    bookTitle: (title: string, author: string) => `${title}${author ? `, ${author}` : ""} · Ler online grátis · BookRaven`,
    bookDescription: (title: string, author: string) =>
      `Leia ${title}${author ? `, de ${author},` : ""} online e grátis: e-book em domínio público para ler no navegador, no Android ou num leitor de e-book, com a página sincronizada.`,
    footer: "Um leitor de e-books, PDFs e quadrinhos, com a sua página sincronizada em todos os aparelhos.",
    privacy: "Privacidade",
    allLanguages: "Todos os idiomas",
  },
} as const;

const pageLang = (language: string): Lang => (language === "pt" ? "pt" : "en");

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Dom Casmurro" by "Machado de Assis" → "dom-casmurro-machado-de-assis". */
export function slugify(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

const classicPath = (r: Pick<ClassicRow, "id" | "title" | "author">) => {
  const slug = slugify(`${r.title} ${r.author ?? ""}`);
  return `/classics/${slug ? `${slug}-` : ""}${r.id}`;
};

/** A book's description as plain paragraphs (some catalogs send a little HTML). */
function paragraphs(text: string | null) {
  if (!text) return [];
  return text
    .replace(/<\s*(br|\/p|\/div)\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split(/\n\s*\n|\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);

const lifeYears = (a: ClassicRow["authors"][number] | undefined) =>
  a && (a.birth_year != null || a.death_year != null) ? `${a.birth_year ?? "?"}–${a.death_year ?? "?"}` : "";

/** Every classic, most read first: one query for all the pages, kept for a few minutes. */
let cached: { at: number; list: Promise<Classic[]> } | null = null;
function classics(): Promise<Classic[]> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.list;
  const load = query<ClassicRow>(
    `SELECT b.id, b.title, b.author, b.has_cover, cb.language, cb.themes, b.tags, cb.authors,
            cb.download_count, cb.source, cb.source_url, cb.imported_at
     FROM catalog_book cb JOIN book b ON b.id = cb.book_id
     WHERE b.is_public
     ORDER BY cb.download_count DESC, lower(b.title)`,
  ).then(({ rows }) =>
    rows.map((r) => ({
      ...r,
      slug: slugify(`${r.title} ${r.author ?? ""}`),
      path: classicPath(r),
      sections: [...new Set([...(r.themes ?? []), ...themesFor(r.tags ?? [])])],
    })),
  );
  const entry = { at: Date.now(), list: load };
  cached = entry;
  load.catch(() => {
    if (cached === entry) cached = null;
  });
  return load;
}

/** Languages with at least one classic: Portuguese and English first, then by number of books. */
function languagesOf(all: Classic[]) {
  const counts = new Map<string, number>();
  for (const c of all) counts.set(c.language, (counts.get(c.language) ?? 0) + 1);
  const rank = (code: string) => (code === "pt" ? 0 : code === "en" ? 1 : 2);
  return [...counts].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]).map(([code, count]) => ({ code, count }));
}

const coverUrl = (id: string) => `/api/classics/${id}/cover`;
const abs = (path: string) => `${config.publicUrl}${path}`;
const ldJson = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

const STYLE = `
:root{--midnight:#071521;--navy:#0c2033;--ivory:#f5eedf;--paper:#fbf7ee;--parchment:#efe5d2;--gold:#c9a474;--gold-deep:#7a5c34;--ink:#151b23;--sepia:#5a5348;--silver:#aab8c6;--line:#dfd1b8}
*{box-sizing:border-box}
body{margin:0;background:var(--parchment);color:var(--ink);font:16px/1.65 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--gold-deep)}
.serif,h1,h2,h3{font-family:"Cormorant Garamond",Georgia,"Times New Roman",serif}
.wrap{max-width:1100px;margin:0 auto;padding:0 16px}
header.top{background:var(--midnight);color:var(--ivory)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ivory);text-decoration:none;font:600 21px/1 "Cormorant Garamond",Georgia,serif;letter-spacing:.02em}
.brand img{width:34px;height:34px;border-radius:9px}
.top nav{display:flex;gap:16px;align-items:center;font-size:14px}
.top nav a{color:var(--silver);text-decoration:none}
.top nav a:hover{color:var(--ivory)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 24px;border-radius:3px;background:var(--midnight);color:var(--ivory);font-weight:600;text-decoration:none;box-shadow:0 0 0 1px rgba(201,164,116,.55)}
.btn:hover{background:var(--navy)}
.btn-light{background:transparent;color:var(--ink);box-shadow:0 0 0 1px rgba(21,27,35,.25)}
.btn-light:hover{background:rgba(21,27,35,.05)}
.hero{background:linear-gradient(180deg,#0b1d2e,#071521);color:var(--ivory);padding:44px 0 52px}
.eyebrow{margin:0;font:600 11.5px/1.4 Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
.hero h1{margin:12px 0 0;font-size:clamp(2.3rem,6vw,3.6rem);font-weight:600;line-height:1.05;color:var(--ivory)}
.hero p.lead{max-width:44rem;margin:16px 0 0;color:var(--silver);font-size:17px}
.crumbs{font-size:13px;color:var(--silver);margin:0 0 18px}
.crumbs a{color:var(--silver)}
.crumbs.light{color:var(--sepia)}
.crumbs.light a{color:var(--gold-deep)}
main{padding:40px 0 64px}
h2{font-size:2rem;font-weight:600;line-height:1.15;margin:0 0 16px}
main section+section,main article+section{margin-top:56px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:22px 18px;list-style:none;margin:0;padding:0}
.card a{text-decoration:none;color:var(--ink);display:block}
.card .cover{aspect-ratio:2/3;width:100%;object-fit:cover;border-radius:3px;background:var(--navy);box-shadow:0 12px 24px -14px rgba(21,27,35,.7),0 0 0 1px rgba(21,27,35,.12)}
.card .blank{aspect-ratio:2/3;border-radius:3px;background:var(--navy);color:var(--gold);display:flex;align-items:center;justify-content:center;padding:12px;text-align:center;font:600 17px/1.2 "Cormorant Garamond",Georgia,serif;box-shadow:0 0 0 1px rgba(201,164,116,.35) inset}
.card .t{margin:10px 0 0;font:600 17px/1.2 "Cormorant Garamond",Georgia,serif}
.card .a{margin:3px 0 0;font-size:13px;color:var(--sepia)}
.more{margin:18px 0 0;font-weight:600}
.langs{display:flex;flex-wrap:wrap;gap:10px;list-style:none;margin:22px 0 0;padding:0}
.langs a{display:inline-block;padding:7px 14px;border-radius:999px;color:var(--ivory);text-decoration:none;box-shadow:0 0 0 1px rgba(201,164,116,.5);font-size:14px}
.langs a:hover{background:rgba(201,164,116,.15)}
.authors{columns:3 260px;column-gap:32px;margin:0;padding:0;list-style:none}
.authors li{break-inside:avoid;margin:0 0 16px}
.authors h3{margin:0;font-size:1.3rem}
.authors .yrs{font-size:12px;color:var(--sepia)}
.authors ul{margin:4px 0 0;padding:0 0 0 16px;font-size:14.5px}
.book{display:grid;gap:32px;grid-template-columns:1fr}
@media(min-width:760px){.book{grid-template-columns:260px 1fr;gap:48px}}
.book .cover,.book .blank{margin:0 auto}
.book .cover{width:100%;max-width:260px;aspect-ratio:2/3;object-fit:cover;border-radius:3px;box-shadow:0 30px 50px -30px rgba(21,27,35,.8),0 0 0 1px rgba(21,27,35,.15)}
.book .blank{max-width:260px;aspect-ratio:2/3;border-radius:3px;background:var(--navy);color:var(--gold);display:flex;align-items:center;justify-content:center;padding:20px;text-align:center;font:600 26px/1.15 "Cormorant Garamond",Georgia,serif}
.book h1{margin:0;font-size:clamp(2.2rem,5vw,3.3rem);line-height:1.05;font-weight:600}
.book .by{margin:8px 0 0;font:italic 22px/1.3 "Cormorant Garamond",Georgia,serif;color:var(--sepia)}
.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:22px 0 0;font-size:14.5px}
.facts dt{font:italic 16px/1.5 "Cormorant Garamond",Georgia,serif;color:var(--gold-deep)}
.facts dd{margin:0;color:var(--sepia)}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0 0}
.desc{max-width:44rem;margin:32px 0 0}
.desc p{margin:0 0 14px}
.why{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px;list-style:none;margin:0;padding:0}
.why li{border-top:1px solid rgba(21,27,35,.18);padding-top:12px}
.why b{display:block;font:600 19px/1.3 "Cormorant Garamond",Georgia,serif}
.why span{font-size:14.5px;color:var(--sepia)}
footer.foot{background:var(--midnight);color:var(--silver);font-size:13.5px;padding:36px 0 44px}
footer.foot .wrap{display:flex;flex-wrap:wrap;gap:16px 28px;justify-content:space-between}
footer.foot a{color:var(--silver)}
footer.foot nav{display:flex;flex-wrap:wrap;gap:8px 20px}
@media(max-width:759px){.book .cover,.book .blank{max-width:210px}}
`;

function layout(o: {
  lang: Lang;
  title: string;
  description: string;
  path: string;
  image?: string;
  ogType?: "website" | "book";
  ld: unknown[];
  hero: string;
  body: string;
  languages: { code: string; count: number }[];
}) {
  const t = T[o.lang];
  const url = abs(o.path);
  const image = o.image ? abs(o.image) : abs("/og-image.png?v=2");
  return `<!doctype html>
<html lang="${o.lang === "pt" ? "pt-BR" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#071521">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="${o.ogType ?? "website"}">
<meta property="og:site_name" content="BookRaven">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="${o.image ? "summary" : "summary_large_image"}">
${o.ld.map(ldJson).join("\n")}
<style>${STYLE}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="${t.home}"><img src="/icon-192.png" alt="" width="34" height="34">BookRaven</a>
  <nav aria-label="Main"><a href="/classics">${o.lang === "pt" ? "Clássicos" : "Classics"}</a><a href="/login">${o.lang === "pt" ? "Entrar" : "Sign in"}</a></nav>
</div></header>
${o.hero}
<main><div class="wrap">${o.body}</div></main>
<footer class="foot"><div class="wrap">
  <p style="margin:0;max-width:30rem">${esc(t.footer)}</p>
  <nav aria-label="Footer">
    <a href="/classics">${esc(t.allLanguages)}</a>
    ${o.languages.map((l) => `<a href="/classics/${l.code}" hreflang="${l.code}">${esc(LANGUAGE_NAMES[l.code]?.native ?? l.code)}</a>`).join("")}
    <a href="/">BookRaven (English)</a><a href="/pt" hreflang="pt-BR">BookRaven (Português)</a><a href="/privacy">${esc(t.privacy)}</a>
  </nav>
</div></footer>
</body>
</html>`;
}

function card(c: Classic, lang: Lang, eager = false) {
  const img = c.has_cover
    ? `<img class="cover" src="${coverUrl(c.id)}" alt="" width="200" height="300"${eager ? "" : ' loading="lazy"'} decoding="async">`
    : `<div class="blank" aria-hidden="true">${esc(c.title)}</div>`;
  return `<li class="card"><a href="${c.path}" hreflang="${c.language}">${img}<p class="t">${esc(c.title)}</p>${
    c.author ? `<p class="a">${esc(c.author)}</p>` : ""
  }</a></li>`;
}
const grid = (items: Classic[], lang: Lang, eagerCount = 0) =>
  `<ul class="grid">${items.map((c, i) => card(c, lang, i < eagerCount)).join("")}</ul>`;

const breadcrumbLd = (items: [string, string][]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: abs(path) })),
});

function sendHtml(reply: FastifyReply, html: string, code = 200) {
  return reply
    .code(code)
    .type("text/html; charset=utf-8")
    .header("Cache-Control", code === 200 ? "public, max-age=600" : "no-cache")
    .send(html);
}

function notFound(reply: FastifyReply, languages: { code: string; count: number }[]) {
  const t = T.en;
  return sendHtml(
    reply,
    layout({
      lang: "en",
      title: "Not found · BookRaven",
      description: "This book is not in the Public Library.",
      path: "/classics",
      ld: [],
      hero: `<section class="hero"><div class="wrap"><p class="eyebrow">${t.classics}</p><h1>Not found</h1><p class="lead">This book is not in the Public Library any more, or the link is wrong.</p></div></section>`,
      body: `<p><a class="btn" href="/classics">${esc(t.hubTitle)}</a></p>`,
      languages,
    }).replace("<head>", '<head>\n<meta name="robots" content="noindex">'),
    404,
  );
}

export async function classicsRoutes(app: FastifyInstance) {
  app.get("/classics", async (_request, reply) => {
    const all = await classics();
    const languages = languagesOf(all);
    const t = T.en;
    const sections = languages
      .map(({ code, count }) => {
        const books = all.filter((c) => c.language === code);
        const name = languageName(code, "en");
        return `<section><h2 lang="en">${esc(t.in(name))} <span style="font-size:.6em;color:var(--sepia);font-family:Inter,system-ui,sans-serif">· ${t.books(count)}</span></h2>
${grid(books.slice(0, 12), "en", code === languages[0]?.code ? 6 : 0)}
<p class="more"><a href="/classics/${code}" hreflang="${code}">${esc(code === "pt" ? `Ver os ${count} livros em português` : t.seeAll(count))} →</a></p></section>`;
      })
      .join("\n");
    return sendHtml(
      reply,
      layout({
        lang: "en",
        title: `${t.hubTitle} · BookRaven`,
        description: clip(t.hubIntro, 160),
        path: "/classics",
        languages,
        ld: [
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: t.hubTitle,
            url: abs("/classics"),
            description: t.hubIntro,
            isPartOf: { "@type": "WebSite", name: "BookRaven", url: abs("/") },
          },
          breadcrumbLd([
            ["BookRaven", "/"],
            [t.classics, "/classics"],
          ]),
        ],
        hero: `<section class="hero"><div class="wrap">
<p class="eyebrow">${t.classics} · ${t.publicDomain}</p>
<h1>${esc(t.hubTitle)}</h1>
<p class="lead">${esc(t.hubIntro)}</p>
<ul class="langs">${languages
          .map((l) => `<li><a href="/classics/${l.code}" hreflang="${l.code}">${esc(LANGUAGE_NAMES[l.code]?.native ?? l.code)} · ${l.count}</a></li>`)
          .join("")}</ul>
</div></section>`,
        body: sections || `<p>${esc("The Public Library has no classics yet.")}</p>`,
      }),
    );
  });

  app.get<{ Params: { key: string } }>("/classics/:key", async (request, reply) => {
    const all = await classics();
    const languages = languagesOf(all);
    const key = request.params.key;

    // One language
    if (/^[a-z]{2,3}$/.test(key)) {
      const books = all.filter((c) => c.language === key);
      if (!books.length) return notFound(reply, languages);
      const lang = pageLang(key);
      const t = T[lang];
      const name = languageName(key, lang);
      const byAuthor = new Map<string, Classic[]>();
      for (const c of books) {
        const a = c.author?.trim() || "—";
        byAuthor.set(a, [...(byAuthor.get(a) ?? []), c]);
      }
      const authors = [...byAuthor].sort((a, b) => a[0].localeCompare(b[0], key));
      const authorList = `<ul class="authors">${authors
        .map(([author, list]) => {
          const years = lifeYears(list[0]!.authors?.[0]);
          return `<li><h3>${esc(author)}</h3>${years ? `<span class="yrs">${years}</span>` : ""}<ul>${[...list]
            .sort((a, b) => a.title.localeCompare(b.title, key))
            .map((c) => `<li><a href="${c.path}">${esc(c.title)}</a></li>`)
            .join("")}</ul></li>`;
        })
        .join("")}</ul>`;
      const title = t.langTitle(name);
      const intro = t.langIntro(name, books.length);
      return sendHtml(
        reply,
        layout({
          lang,
          title: `${title} · BookRaven`,
          description: clip(intro, 160),
          path: `/classics/${key}`,
          languages,
          ld: [
            {
              "@context": "https://schema.org",
              "@type": "CollectionPage",
              name: title,
              url: abs(`/classics/${key}`),
              inLanguage: key,
              description: intro,
              mainEntity: {
                "@type": "ItemList",
                numberOfItems: books.length,
                itemListElement: books.slice(0, 24).map((c, i) => ({ "@type": "ListItem", position: i + 1, url: abs(c.path), name: c.title })),
              },
            },
            breadcrumbLd([
              ["BookRaven", t.home],
              [t.classics, "/classics"],
              [LANGUAGE_NAMES[key]?.native ?? key, `/classics/${key}`],
            ]),
          ],
          hero: `<section class="hero"><div class="wrap">
<p class="crumbs"><a href="/classics">${t.classics}</a> › ${esc(LANGUAGE_NAMES[key]?.native ?? key)}</p>
<h1>${esc(title)}</h1>
<p class="lead">${esc(intro)}</p>
</div></section>`,
          body: `<section><h2>${t.mostRead}</h2>${grid(books.slice(0, 24), lang, 6)}</section>
<section><h2>${t.authors}</h2>${authorList}</section>`,
        }),
      );
    }

    // One book: "<slug>-<id>"
    const id = key.slice(-36);
    if (!UUID_RE.test(id)) return notFound(reply, languages);
    const c = all.find((b) => b.id === id);
    if (!c) return notFound(reply, languages);
    if (key !== c.path.slice("/classics/".length)) return reply.redirect(c.path, 301);

    const { rows } = await query<{ description: string | null }>("SELECT description FROM book WHERE id = $1", [id]);
    const lang = pageLang(c.language);
    const t = T[lang];
    const author = c.author?.trim() ?? "";
    const desc = paragraphs(rows[0]?.description ?? null);
    const years = lifeYears(c.authors?.[0]);
    const byAuthor = author ? all.filter((b) => b.id !== c.id && b.author === c.author).slice(0, 12) : [];
    const shown = new Set([c.id, ...byAuthor.map((b) => b.id)]);
    const section = c.sections[0];
    const alike = section
      ? all.filter((b) => !shown.has(b.id) && b.language === c.language && b.sections.includes(section)).slice(0, 12)
      : [];
    const langLabel = LANGUAGE_NAMES[c.language]?.native ?? c.language;
    const sourceName = SOURCE_NAMES[c.source] ?? t.publicDomain;
    const readUrl = `/public/books/${c.id}`;
    const description = desc.length ? clip(desc.join(" "), 158) : t.bookDescription(c.title, author);

    const cover = c.has_cover
      ? `<img class="cover" src="${coverUrl(c.id)}" alt="${esc(`${c.title}${author ? ` · ${author}` : ""}`)}" width="260" height="390">`
      : `<div class="blank" aria-hidden="true">${esc(c.title)}</div>`;

    return sendHtml(
      reply,
      layout({
        lang,
        title: t.bookTitle(c.title, author),
        description,
        path: c.path,
        image: c.has_cover ? coverUrl(c.id) : undefined,
        ogType: "book",
        languages,
        ld: [
          {
            "@context": "https://schema.org",
            "@type": "Book",
            name: c.title,
            url: abs(c.path),
            inLanguage: c.language,
            ...(c.has_cover ? { image: abs(coverUrl(c.id)) } : {}),
            ...(author
              ? {
                  author: {
                    "@type": "Person",
                    name: author,
                    ...(c.authors?.[0]?.birth_year != null ? { birthDate: String(c.authors[0].birth_year) } : {}),
                    ...(c.authors?.[0]?.death_year != null ? { deathDate: String(c.authors[0].death_year) } : {}),
                  },
                }
              : {}),
            ...(desc.length ? { description: clip(desc.join(" "), 500) } : {}),
            ...(c.sections.length ? { genre: c.sections.map((s) => sectionName(s, lang)) } : {}),
            bookFormat: "https://schema.org/EBook",
            isAccessibleForFree: true,
            copyrightNotice: t.publicDomain,
            sameAs: c.source_url,
            potentialAction: { "@type": "ReadAction", target: abs(readUrl) },
          },
          breadcrumbLd([
            ["BookRaven", t.home],
            [t.classics, "/classics"],
            [langLabel, `/classics/${c.language}`],
            [c.title, c.path],
          ]),
        ],
        hero: "",
        body: `<p class="crumbs light"><a href="/classics">${t.classics}</a> › <a href="/classics/${c.language}">${esc(langLabel)}</a> › ${esc(c.title)}</p>
<article class="book">
  <div>${cover}</div>
  <div>
    <p class="eyebrow" style="color:var(--gold-deep)">${t.publicDomain} · ${esc(langLabel)}</p>
    <h1 style="margin-top:10px">${esc(c.title)}</h1>
    ${author ? `<p class="by">${t.by} ${esc(author)}${years ? ` <span style="font-size:15px;font-style:normal">(${years})</span>` : ""}</p>` : ""}
    <div class="actions"><a class="btn" href="${readUrl}" rel="nofollow">${t.readFree} →</a><a class="btn btn-light" href="${t.home}">${t.whatIs}</a></div>
    <dl class="facts">
      <dt>${t.language}</dt><dd>${esc(languageName(c.language, lang).replace(/^./, (s) => s.toUpperCase()))}</dd>
      ${c.sections.length ? `<dt>${t.sections}</dt><dd>${c.sections.map((s) => esc(sectionName(s, lang))).join(" · ")}</dd>` : ""}
      <dt>${t.source}</dt><dd><a href="${esc(c.source_url)}" rel="noopener">${esc(sourceName)}</a></dd>
    </dl>
    <section class="desc"><h2 style="font-size:1.6rem;margin:0 0 10px">${t.about}</h2>${
      desc.length ? desc.slice(0, 12).map((p) => `<p>${esc(p)}</p>`).join("") : `<p>${esc(t.noDescription(c.title, author))}</p>`
    }</section>
  </div>
</article>
<section><h2>${t.why}</h2><ul class="why">${t.whyItems.map(([b, s]) => `<li><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join("")}</ul></section>
${byAuthor.length ? `<section><h2>${esc(t.moreBy(author))}</h2>${grid(byAuthor, lang)}</section>` : ""}
${alike.length && section ? `<section><h2>${esc(t.moreIn(sectionName(section, lang)))}</h2>${grid(alike, lang)}</section>` : ""}`,
      }),
    );
  });

  /** A classic's cover, for these pages and link previews (no sign-in, unlike /api/public/:id/cover). */
  app.get<{ Params: { id: string } }>("/api/classics/:id/cover", async (request, reply) => {
    if (!UUID_RE.test(request.params.id)) return reply.code(404).send({ error: "not_found" });
    const { rows } = await query<{ id: string; has_cover: boolean }>(
      `SELECT b.id, b.has_cover FROM catalog_book cb JOIN book b ON b.id = cb.book_id WHERE b.id = $1 AND b.is_public`,
      [request.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    return sendCover(request, reply, rows[0]);
  });

  /** Everything search engines may index: the front pages and the classics. */
  app.get("/sitemap.xml", async (_request, reply) => {
    const all = await classics();
    const urls: { loc: string; lastmod?: Date }[] = [
      { loc: "/" },
      { loc: "/pt" },
      { loc: "/classics" },
      ...languagesOf(all).map((l) => ({ loc: `/classics/${l.code}` })),
      ...all.map((c) => ({ loc: c.path, lastmod: c.imported_at })),
    ];
    const body = urls
      .map((u) => `  <url><loc>${esc(abs(u.loc))}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`)
      .join("\n");
    return reply
      .type("application/xml; charset=utf-8")
      .header("Cache-Control", "public, max-age=3600")
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
  });
}

/** Forgets the cached list (tests, and after the catalog changes). */
export const forgetClassics = () => {
  cached = null;
};
