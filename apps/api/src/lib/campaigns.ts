import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { query } from "../db.js";
import { brandedEmail, esc, numbered, P, SANS, SERIF, smallCaps, type Hero } from "./emailLayout.js";
import { audit, log } from "./log.js";
import { sendMail, type Mail } from "./mailer.js";

export { HEROES, type Hero } from "./emailLayout.js";
import { FINISHED_AT } from "./progress.js";

/**
 * Promotional emails (Admin → Emails): a few designed templates in the front page's look
 * (midnight, parchment and gold, Doré's engravings), personalised for each reader, sent to a
 * chosen audience in the background. Every one carries an unsubscribe link (and the one-click
 * List-Unsubscribe header); accounts that used it (email_opt_out) and blocked accounts are skipped.
 */

export const TEMPLATE_IDS = ["missyou", "comeback", "continue", "classics", "share", "recap", "announcement"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];


/**
 * Who receives it. `days` is the quiet period of "inactive" (no reading for that many days, and
 * an account at least that old) and "in_progress" (a book started, not finished, nothing read
 * for that many days).
 */
export const SEGMENTS = ["all", "inactive", "in_progress", "never_read", "accounts"] as const;
export type Segment = (typeof SEGMENTS)[number];
/** "accounts": only the accounts in `userIds`, picked by the administrator. */
export type Audience = { segment: Segment; days: number; userIds?: string[] };

/** What the administrator edits. {name} (the reader's first name) and {year} work in every text field. */
export type CampaignContent = {
  subject: string;
  preheader: string;
  eyebrow: string;
  headline: string;
  /** Plain text: a blank line starts a paragraph, lines starting with "- " make a list, **bold**. */
  message: string;
  buttonLabel: string;
  /** Where the button goes, a path in the app ("/public"). "Continue reading" opens the reader's book instead. */
  buttonPath: string;
  hero: Hero;
};

type Template = {
  name: string;
  description: string;
  defaults: CampaignContent;
  audience: Audience;
};

export const TEMPLATES: Record<TemplateId, Template> = {
  missyou: {
    name: "We miss you",
    description: "A warm note for readers who have been gone a long time, with their own shelf as they left it.",
    audience: { segment: "inactive", days: 60 },
    defaults: {
      subject: "We miss you, {name}",
      preheader: "Your shelf is just as you left it, and there's a chair by the fire for you.",
      eyebrow: "It's been a while",
      headline: "We miss you, {name}",
      message:
        "The lamp is still lit and your bookmark hasn't moved. Whatever pulled you away, your books have waited patiently, every highlight and note in its place.\n\nCome back for a chapter. Just one, tonight. We'd love to have you reading with us again.",
      buttonLabel: "Come back to my books",
      buttonPath: "/",
      hero: "clouds",
    },
  },
  comeback: {
    name: "We kept your place",
    description: "Invites readers who have been away back to their library, with what is waiting for them.",
    audience: { segment: "inactive", days: 30 },
    defaults: {
      subject: "{name}, your library misses you",
      preheader: "Your books, bookmarks and highlights are right where you left them.",
      eyebrow: "A note from BookRaven",
      headline: "Your place is still kept",
      message:
        "It has been a little while, {name}. Your books, highlights and bookmarks are exactly where you left them, on every device.\n\nTen quiet minutes tonight is all a chapter takes.",
      buttonLabel: "Open my library",
      buttonPath: "/",
      hero: "door",
    },
  },
  continue: {
    name: "Continue reading",
    description: "Shows each reader the book they left halfway, with their progress, and opens it in one tap.",
    audience: { segment: "in_progress", days: 14 },
    defaults: {
      subject: "{name}, your bookmark is waiting",
      preheader: "Pick up right where you stopped, to the exact sentence.",
      eyebrow: "Your bookmark",
      headline: "The story paused. It hasn't ended.",
      message:
        "You were partway through a book when life got busy. Your place is saved to the exact sentence, so you can carry on in the browser, on Android or on your e-reader.",
      buttonLabel: "Continue reading",
      buttonPath: "/reading",
      hero: "scholar",
    },
  },
  classics: {
    name: "New on the shelves",
    description: "Presents the latest classics added to the Public Library, with their covers.",
    audience: { segment: "all", days: 30 },
    defaults: {
      subject: "New classics on the BookRaven shelves",
      preheader: "Free public-domain books, ready to read in a tap.",
      eyebrow: "From the Public Library",
      headline: "Fresh from the shelves",
      message:
        "Great books never go out of print here. These classics were just added to the Public Library: free for every reader, and one tap puts them in your library.",
      buttonLabel: "Browse the Public Library",
      buttonPath: "/public",
      hero: "clouds",
    },
  },
  share: {
    name: "Upload and share",
    description: "Shows readers they can upload their own books and comics, and share them with friends by link.",
    audience: { segment: "all", days: 30 },
    defaults: {
      subject: "{name}, bring your books and share them with friends",
      preheader: "Upload your ebooks, PDFs and comics, then send them to a friend with a link.",
      eyebrow: "Your library, your way",
      headline: "Bring your books. Share them with friends.",
      message:
        "BookRaven isn't only the classics on our shelves. Upload the ebooks, PDFs and comics you already have, and they follow you to every device with your place saved.\n\nLoved one? Send it to a friend with a link: one tap and it's in their library too, with their own bookmarks.",
      buttonLabel: "Upload a book",
      buttonPath: "/",
      hero: "door",
    },
  },
  recap: {
    name: "Your reading year",
    description: "Each reader's own numbers for the year (hours, books finished, reading days) and their yearly goal.",
    audience: { segment: "all", days: 30 },
    defaults: {
      subject: "{name}, your {year} in reading",
      preheader: "The hours, days and books behind you this year.",
      eyebrow: "Your reading year",
      headline: "Look how far you've come",
      message: "Every page counts. Here is what you have read with BookRaven so far this year, and a gentle nudge toward the next chapter.",
      buttonLabel: "See my reading stats",
      buttonPath: "/stats",
      hero: "scholar",
    },
  },
  announcement: {
    name: "Announcement",
    description: "A free-form message for news and new features, with a list of highlights.",
    audience: { segment: "all", days: 30 },
    defaults: {
      subject: "Something new in BookRaven",
      preheader: "A few things we built for readers like you.",
      eyebrow: "What's new",
      headline: "A new chapter for BookRaven",
      message:
        "We have been busy building things for readers like you, {name}:\n\n- **First highlight:** what it does for readers\n- **Second highlight:** why it makes reading nicer\n\nOpen BookRaven to try them.",
      buttonLabel: "See what's new",
      buttonPath: "/",
      hero: "clouds",
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Audience

const SEGMENT_SQL: Record<Segment, string> = {
  all: "true",
  inactive: `u."createdAt" < now() - make_interval(days => opts.days)
    AND NOT EXISTS (SELECT 1 FROM reading_activity r WHERE r.user_id = u.id AND r.hour > now() - make_interval(days => opts.days))`,
  in_progress: `EXISTS (SELECT 1 FROM reading_progress p WHERE p.user_id = u.id AND p.percentage > 0.01 AND p.percentage < ${FINISHED_AT})
    AND NOT EXISTS (SELECT 1 FROM reading_activity r WHERE r.user_id = u.id AND r.hour > now() - make_interval(days => opts.days))`,
  never_read: `NOT EXISTS (SELECT 1 FROM reading_progress p WHERE p.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM reading_activity r WHERE r.user_id = u.id)`,
  accounts: `u.id = ANY(opts.ids)`,
};

type Recipient = { id: string; email: string; name: string };

/** The accounts an audience reaches: never blocked ones, unsubscribed ones or (when sign-in needs it) unconfirmed emails. */
export async function audienceRecipients(a: Audience) {
  const { rows } = await query<Recipient>(
    `WITH opts AS (SELECT $1::int AS days, $2::boolean AS verified_only, $3::text[] AS ids)
     SELECT u.id, u.email, u.name FROM "user" u, opts
      WHERE NOT EXISTS (SELECT 1 FROM account_admin ad WHERE ad.user_id = u.id AND ad.blocked)
        AND NOT EXISTS (SELECT 1 FROM email_opt_out o WHERE o.user_id = u.id)
        AND (NOT opts.verified_only OR u."emailVerified")
        AND ${SEGMENT_SQL[a.segment]}
      ORDER BY u."createdAt"`,
    [a.days, config.requireEmailVerification, a.segment === "accounts" ? (a.userIds ?? []) : []],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The data that fills a template

type Bookmark = { id: string; title: string; author: string | null; percentage: number; updatedAt: Date };
type Classic = { id: string; title: string; author: string | null };
type Recap = { hours: number; finished: number; days: number; goal: number };

/** Read once per send: the same for every recipient. */
type Shared = { classics: Classic[] };
/** Read for each recipient. */
type Shelf = { books: number; last: { title: string; author: string | null; at: Date } | null };
type Personal = { bookmark?: Bookmark | null; recap?: Recap; shelf?: Shelf };

async function sharedData(template: TemplateId): Promise<Shared> {
  if (template !== "classics") return { classics: [] };
  const { rows } = await query<Classic>(
    `SELECT b.id, b.title, b.author FROM catalog_book c JOIN book b ON b.id = c.book_id
      WHERE b.is_public AND b.has_cover
      ORDER BY c.imported_at DESC, c.download_count DESC LIMIT 3`,
  );
  return { classics: rows };
}

async function personalData(template: TemplateId, userId: string): Promise<Personal> {
  if (template === "continue") {
    const { rows } = await query<{ id: string; title: string; author: string | null; percentage: number; updated_at: Date }>(
      `SELECT b.id, b.title, b.author, p.percentage, p.updated_at FROM reading_progress p JOIN book b ON b.id = p.book_id
        WHERE p.user_id = $1 AND p.percentage < $2 ORDER BY p.updated_at DESC LIMIT 1`,
      [userId, FINISHED_AT],
    );
    const r = rows[0];
    return { bookmark: r ? { id: r.id, title: r.title, author: r.author, percentage: r.percentage, updatedAt: r.updated_at } : null };
  }
  if (template === "missyou") {
    const { rows } = await query<{ books: string; title: string | null; author: string | null; at: Date | null }>(
      `SELECT (SELECT count(*) FROM book WHERE user_id = $1) AS books, l.title, l.author, l.updated_at AS at
         FROM (SELECT 1) x
         LEFT JOIN LATERAL (SELECT b.title, b.author, p.updated_at FROM reading_progress p JOIN book b ON b.id = p.book_id
                             WHERE p.user_id = $1 ORDER BY p.updated_at DESC LIMIT 1) l ON true`,
      [userId],
    );
    const r = rows[0]!;
    return { shelf: { books: Number(r.books), last: r.title && r.at ? { title: r.title, author: r.author, at: r.at } : null } };
  }
  if (template === "recap") {
    const { rows } = await query<{ seconds: string; finished: string; days: string; goal: string | null }>(
      `SELECT COALESCE(SUM(seconds), 0) AS seconds,
              count(DISTINCT book_id) FILTER (WHERE finished) AS finished,
              count(DISTINCT date_trunc('day', hour)) AS days,
              (SELECT settings->>'readingGoal' FROM user_settings WHERE user_id = $1) AS goal
         FROM reading_activity WHERE user_id = $1 AND hour >= date_trunc('year', now())`,
      [userId],
    );
    const r = rows[0]!;
    const goal = Math.round(Number(r.goal));
    return {
      recap: {
        hours: Math.round(Number(r.seconds) / 360) / 10,
        finished: Number(r.finished),
        days: Number(r.days),
        goal: Number.isFinite(goal) && goal >= 1 ? goal : 12,
      },
    };
  }
  return {};
}

/** Shown in the preview when the administrator has no data of their own for the template. */
const SAMPLE: Required<Personal> = {
  bookmark: { id: "", title: "The Fall of the House of Usher", author: "Edgar Allan Poe", percentage: 0.42, updatedAt: new Date(Date.now() - 12 * 86400_000) },
  recap: { hours: 37.5, finished: 6, days: 54, goal: 12 },
  shelf: { books: 14, last: { title: "Wuthering Heights", author: "Emily Brontë", at: new Date(Date.now() - 74 * 86400_000) } },
};

// ---------------------------------------------------------------------------------------------
// Unsubscribing

const unsubscribeToken = (userId: string) => createHmac("sha256", config.authSecret).update(`unsubscribe:${userId}`).digest("base64url").slice(0, 32);

export function unsubscribeUrl(userId: string) {
  return `${config.publicUrl}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&token=${unsubscribeToken(userId)}`;
}

export function validUnsubscribe(userId: unknown, token: unknown): userId is string {
  if (typeof userId !== "string" || typeof token !== "string" || !userId || userId.length > 200) return false;
  const want = Buffer.from(unsubscribeToken(userId));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function setPromotionalEmails(userId: string, on: boolean) {
  if (on) await query(`DELETE FROM email_opt_out WHERE user_id = $1`, [userId]);
  else await query(`INSERT INTO email_opt_out (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
}

export async function wantsPromotionalEmails(userId: string) {
  const { rowCount } = await query(`SELECT 1 FROM email_opt_out WHERE user_id = $1`, [userId]);
  return !rowCount;
}

// ---------------------------------------------------------------------------------------------
// Rendering


const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** Fills {name} and {year}; with no name, "reader" (capitalised at the start of a line). */
function fill(text: string, r: Recipient) {
  const name = firstName(r.name);
  return text
    .replace(/\{name\}/g, (_m, offset: number, all: string) => {
      if (name) return name;
      const start = offset === 0 || all[offset - 1] === "\n";
      return start ? "Reader" : "reader";
    })
    .replace(/\{year\}/g, String(new Date().getFullYear()));
}

/** **bold** inside already-escaped text. */
const inline = (escaped: string) => escaped.replace(/\*\*(.+?)\*\*/g, `<strong style="color:${P.ink};">$1</strong>`);

/** The message as HTML paragraphs and lists, and as plain text. */
function messageHtml(message: string) {
  return message
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => /^[-•*]\s+/.test(l))) {
        return `<ul style="margin:0 0 18px;padding:0 0 0 22px;">${lines
          .map((l) => `<li style="margin:0 0 8px;padding-left:4px;">${inline(esc(l.replace(/^[-•*]\s+/, "")))}</li>`)
          .join("")}</ul>`;
      }
      return `<p style="margin:0 0 18px;">${lines.map((l) => inline(esc(l))).join("<br>")}</p>`;
    })
    .join("");
}

const plain = (message: string) => message.trim().replace(/\*\*(.+?)\*\*/g, "$1");

const appUrl = (path: string) => `${config.publicUrl}${path.startsWith("/") ? path : `/${path}`}`;

const daysAgo = (d: Date) => {
  const days = Math.max(0, Math.round((Date.now() - d.getTime()) / 86400_000));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

/** A thin progress bar (nested tables: the only widths every email client draws). */
function bar(fraction: number) {
  const pct = Math.max(2, Math.min(100, Math.round(fraction * 100)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${P.track};border-radius:3px;font-size:0;line-height:0;height:6px;">
<table role="presentation" width="${pct}%" cellpadding="0" cellspacing="0"><tr><td style="background:${P.gold};border-radius:3px;font-size:0;line-height:0;height:6px;">&nbsp;</td></tr></table>
</td></tr></table>`;
}

type Block = { html: string; text: string };

function bookmarkBlock(b: Bookmark): Block {
  const pct = Math.round(b.percentage * 100);
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 26px;background:${P.paper};border:1px solid ${P.line};border-left:4px solid ${P.gold};border-radius:4px;">
<tr><td style="padding:20px 22px;">
  ${smallCaps("Currently reading")}
  <p style="margin:0;font:600 23px/1.25 ${SERIF};color:${P.ink};">${esc(b.title)}</p>
  ${b.author ? `<p style="margin:4px 0 0;font:italic 16px/1.4 ${SERIF};color:${P.sepia};">by ${esc(b.author)}</p>` : ""}
  <div style="height:16px;line-height:16px;font-size:0;">&nbsp;</div>
  ${bar(b.percentage)}
  <p style="margin:8px 0 0;font:13px/1.4 ${SANS};color:${P.sepia};">${pct}% read · last opened ${daysAgo(b.updatedAt)}</p>
</td></tr></table>`,
    text: `Currently reading: ${b.title}${b.author ? ` by ${b.author}` : ""} (${pct}% read, last opened ${daysAgo(b.updatedAt)})`,
  };
}

const FEATURES = [
  ["Pick up mid-sentence", "Your position syncs between the browser, the Android app and KOReader on your e-reader."],
  ["A shelf of classics", "Hundreds of public-domain books in the Public Library, organised by theme and free to read."],
  ["Read together", "Start a book club, share a collection and talk about the chapter you just finished."],
] as const;

const SHARE_STEPS = [
  ["Upload", "Drag in your ebooks (EPUB, MOBI, AZW3, FB2), PDFs and comics (CBZ, CBR, CB7, CBT). Title, author and cover are read from the file."],
  ["Share", "Send a link to one book or a whole collection. Friends who accept get their own copy and keep their own place."],
  ["Read together", "Start a book club, follow each other's progress and talk about the chapter you just finished."],
] as const;

/** "Upload and share": the three steps, and the formats that can be uploaded. */
function shareBlock(): Block {
  const formats = ["EPUB", "MOBI", "PDF", "CBZ", "CBR"]
    .map(
      (f) =>
        `<span style="display:inline-block;margin:0 3px 6px;padding:5px 10px;border:1px solid ${P.line};border-radius:3px;background:${P.paper};font:600 11px/1 ${SANS};letter-spacing:0.12em;color:${P.goldDeep};">${f}</span>`,
    )
    .join("");
  return {
    html: `${numbered(SHARE_STEPS)}<p style="margin:0 0 22px;text-align:center;">${formats}</p>`,
    text: SHARE_STEPS.map(([t, d]) => `- ${t}: ${d}`).join("\n"),
  };
}

function featuresBlock(): Block {
  return { html: numbered(FEATURES), text: FEATURES.map(([t, d]) => `- ${t}: ${d}`).join("\n") };
}

function classicsBlock(books: Classic[]): Block {
  if (!books.length) return { html: "", text: "" };
  const cells = books
    .map(
      (b) => `<td class="stack" width="${Math.floor(100 / books.length)}%" valign="top" align="center" style="padding:0 7px 18px;">
  <a href="${esc(appUrl(`/public/books/${b.id}`))}" style="text-decoration:none;">
    <img src="${esc(`${config.publicUrl}/api/public/${b.id}/cover`)}" width="140" alt="${esc(b.title)}" style="display:block;width:140px;max-width:100%;height:auto;margin:0 auto 12px;border:1px solid ${P.line};border-radius:3px;">
    <span style="display:block;font:600 17px/1.25 ${SERIF};color:${P.ink};">${esc(b.title)}</span>
  </a>
  ${b.author ? `<span style="display:block;margin-top:3px;font:13px/1.4 ${SANS};color:${P.sepia};">${esc(b.author)}</span>` : ""}
</td>`,
    )
    .join("");
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 10px;"><tr>${cells}</tr></table>`,
    text: books.map((b) => `- ${b.title}${b.author ? `, ${b.author}` : ""}: ${appUrl(`/public/books/${b.id}`)}`).join("\n"),
  };
}

function recapBlock(r: Recap): Block {
  const year = new Date().getFullYear();
  if (!r.hours && !r.finished && !r.days) {
    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 26px;background:${P.paper};border:1px solid ${P.line};border-radius:4px;">
<tr><td align="center" style="padding:24px 22px;font:italic 19px/1.45 ${SERIF};color:${P.sepia};">Your first chapter of ${year} is still waiting to be read.<br>Your goal: <strong style="color:${P.ink};font-style:normal;">${r.goal} books</strong>.</td></tr></table>`;
    return { html, text: `Your first chapter of ${year} is still waiting. Your goal: ${r.goal} books.` };
  }
  const tile = (value: string, label: string) => `<td class="stack" width="33%" align="center" valign="top" style="padding:0 5px 10px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${P.paper};border:1px solid ${P.line};border-radius:4px;"><tr><td align="center" style="padding:18px 8px 16px;">
    <span style="display:block;font:600 36px/1 ${SERIF};color:${P.ink};">${value}</span>
    <span style="display:block;margin-top:8px;font:600 11px/1.3 ${SANS};letter-spacing:0.14em;text-transform:uppercase;color:${P.goldDeep};">${label}</span>
  </td></tr></table></td>`;
  const hours = r.hours >= 10 ? String(Math.round(r.hours)) : String(r.hours);
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;"><tr>
${tile(hours, r.hours === 1 ? "hour read" : "hours read")}${tile(String(r.finished), r.finished === 1 ? "book finished" : "books finished")}${tile(String(r.days), r.days === 1 ? "reading day" : "reading days")}
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr><td style="padding:0 5px;">
  ${bar(r.finished / r.goal)}
  <p style="margin:8px 0 0;font:13px/1.4 ${SANS};color:${P.sepia};">${r.finished} of ${r.goal} books toward your ${year} goal</p>
</td></tr></table>`;
  return { html, text: `This year: ${hours} hours read, ${r.finished} books finished, ${r.days} reading days (${r.finished} of ${r.goal} toward your goal).` };
}

/** "We miss you": the reader's shelf as they left it (how many books, the last one opened). */
function shelfBlock(shelf: Shelf): Block {
  if (!shelf.books) {
    return {
      html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 26px;background:${P.paper};border:1px solid ${P.line};border-radius:4px;">
<tr><td align="center" style="padding:24px 22px;font:italic 19px/1.45 ${SERIF};color:${P.sepia};">Your shelf is still empty, and hundreds of free classics<br>are waiting in the Public Library to fill it.</td></tr></table>`,
      text: "Your shelf is still empty, and hundreds of free classics are waiting in the Public Library.",
    };
  }
  const books = `${shelf.books} ${shelf.books === 1 ? "book" : "books"}`;
  const last = shelf.last;
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 26px;background:${P.paper};border:1px solid ${P.line};border-radius:4px;">
<tr><td align="center" style="padding:24px 22px 22px;">
  ${smallCaps("Your shelf, as you left it")}
  <span style="display:block;margin:6px 0 4px;font:600 44px/1 ${SERIF};color:${P.ink};">${shelf.books}</span>
  <span style="display:block;font:600 11px/1.3 ${SANS};letter-spacing:0.14em;text-transform:uppercase;color:${P.goldDeep};">${shelf.books === 1 ? "book waiting" : "books waiting"}</span>
  ${
    last
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid ${P.line};"><tr><td align="center" style="padding-top:16px;font:15px/1.5 ${SANS};color:${P.sepia};">
    The last one you opened, ${daysAgo(last.at)}:<br>
    <span style="font:600 20px/1.35 ${SERIF};color:${P.ink};">${esc(last.title)}</span>${last.author ? `<span style="font:italic 16px/1.35 ${SERIF};color:${P.sepia};"> by ${esc(last.author)}</span>` : ""}
  </td></tr></table>`
      : ""
  }
</td></tr></table>`,
    text: `Your shelf, as you left it: ${books}.${last ? ` The last one you opened (${daysAgo(last.at)}): ${last.title}${last.author ? ` by ${last.author}` : ""}.` : ""}`,
  };
}

export type Rendered = Mail & { preheader: string };

/** The email for one reader. */
function render(template: TemplateId, c: CampaignContent, r: Recipient, shared: Shared, personal: Personal): Rendered {
  const subject = fill(c.subject, r).trim();
  const preheader = fill(c.preheader, r).trim();
  const eyebrow = fill(c.eyebrow, r).trim();
  const headline = fill(c.headline, r).trim();
  const message = fill(c.message, r);
  let buttonUrl = appUrl(c.buttonPath || "/");

  let block: Block = { html: "", text: "" };
  if (template === "continue" && personal.bookmark) {
    block = bookmarkBlock(personal.bookmark);
    if (personal.bookmark.id) buttonUrl = appUrl(`/read/${personal.bookmark.id}`);
  } else if (template === "comeback") block = featuresBlock();
  else if (template === "missyou" && personal.shelf) block = shelfBlock(personal.shelf);
  else if (template === "classics") block = classicsBlock(shared.classics);
  else if (template === "share") block = shareBlock();
  else if (template === "recap" && personal.recap) block = recapBlock(personal.recap);

  const unsubscribe = unsubscribeUrl(r.id);
  const html = brandedEmail({
    title: subject,
    preheader,
    hero: c.hero,
    eyebrow,
    headline,
    bodyHtml: messageHtml(message) + block.html,
    button: { label: c.buttonLabel, url: buttonUrl },
    signoff: true,
    footerHtml: `You are receiving this because you have a BookRaven account (${esc(r.email)}).<br>
    <a href="${esc(unsubscribe)}" style="color:${P.gold};">Unsubscribe from these emails</a>`,
  });

  const text = [
    headline,
    "",
    plain(message),
    ...(block.text ? ["", block.text] : []),
    "",
    `${c.buttonLabel}: ${buttonUrl}`,
    "",
    "Happy reading,",
    "the BookRaven team",
    "",
    "---",
    `You are receiving this because you have a BookRaven account (${r.email}).`,
    `Unsubscribe: ${unsubscribe}`,
  ].join("\n");

  return {
    to: r.email,
    subject,
    preheader,
    text,
    html,
    headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

/**
 * The email as `user` would receive it. `sample` says the template's personal part shows made-up
 * data (the administrator has no book in progress, for example).
 */
export async function previewCampaign(template: TemplateId, content: CampaignContent, user: Recipient) {
  const [shared, personal] = await Promise.all([sharedData(template), personalData(template, user.id)]);
  let sample = false;
  if (template === "continue" && !personal.bookmark) {
    personal.bookmark = SAMPLE.bookmark;
    sample = true;
  }
  if (template === "missyou" && personal.shelf && !personal.shelf.books) {
    personal.shelf = SAMPLE.shelf;
    sample = true;
  }
  if (template === "recap" && personal.recap && !personal.recap.hours && !personal.recap.finished) {
    personal.recap = { ...SAMPLE.recap, goal: personal.recap.goal };
    sample = true;
  }
  return { ...render(template, content, user, shared, personal), sample, emptyClassics: template === "classics" && !shared.classics.length };
}

/** Sends the preview to the administrator themselves, subject marked as a test. */
export async function sendTest(template: TemplateId, content: CampaignContent, user: Recipient) {
  const { sample: _s, emptyClassics: _e, preheader: _p, ...mail } = await previewCampaign(template, content, user);
  await sendMail({ ...mail, subject: `[Test] ${mail.subject}` });
}

export type { Recipient };

/**
 * Sends `template` to one reader (automations: lib/automations.ts). `shared` can be read once for
 * many readers. Returns false, without sending, when the reader lacks what the template is about
 * (no book in progress for "Continue reading", no classics for "New on the shelves").
 */
export async function sendTemplateTo(template: TemplateId, content: CampaignContent, r: Recipient, shared?: Shared) {
  const s = shared ?? (await sharedData(template));
  const personal = await personalData(template, r.id);
  if (template === "continue" && !personal.bookmark) return false;
  if (template === "classics" && !s.classics.length) return false;
  const { preheader: _p, ...mail } = render(template, content, r, s, personal);
  await sendMail(mail);
  return true;
}

export { sharedData };

// ---------------------------------------------------------------------------------------------
// Sending

/** Pause between two emails, so a large audience doesn't trip the SMTP provider's rate limits. */
const SEND_GAP_MS = config.isTest ? 0 : 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let sending: Promise<void> | null = null;

/** True while a campaign is being sent (one at a time). */
export const campaignRunning = () => sending !== null;

/** Waits for the campaign being sent, if any (tests). */
export const campaignDone = () => sending ?? Promise.resolve();

/**
 * Records the campaign and sends it in the background, one email after another, writing the
 * counts as it goes. Returns null when the audience is empty.
 */
export async function startCampaign(template: TemplateId, content: CampaignContent, audience: Audience, adminId: string) {
  const recipients = await audienceRecipients(audience);
  if (!recipients.length) return null;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO email_campaign (template, subject, content, audience, recipients, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [template, content.subject, JSON.stringify(content), JSON.stringify(audience), recipients.length, adminId],
  );
  const id = rows[0]!.id;
  audit("email_campaign_started", { campaign: id, template, segment: audience.segment, recipients: recipients.length, by: adminId });
  sending = run(id, template, content, recipients).finally(() => {
    sending = null;
  });
  return { id, recipients: recipients.length };
}

async function run(id: string, template: TemplateId, content: CampaignContent, recipients: Recipient[]) {
  let sent = 0;
  let failed = 0;
  const save = (done: boolean) =>
    query(
      `UPDATE email_campaign SET sent = $2, failed = $3, updated_at = now()${done ? `, status = 'sent', finished_at = now()` : ""} WHERE id = $1`,
      [id, sent, failed],
    );
  try {
    const shared = await sharedData(template);
    for (const [i, r] of recipients.entries()) {
      try {
        const { preheader: _p, ...mail } = render(template, content, r, shared, await personalData(template, r.id));
        await sendMail(mail);
        // Counts toward the weekly spacing of automatic emails (lib/automations.ts).
        await query(`INSERT INTO email_send_log (user_id, kind, ref) VALUES ($1, 'campaign', $2) ON CONFLICT DO NOTHING`, [r.id, id]);
        sent++;
      } catch (err) {
        failed++;
        log.warn({ err, campaign: id }, "promotional email could not be sent");
      }
      if ((i + 1) % 10 === 0) await save(false);
      if (SEND_GAP_MS) await sleep(SEND_GAP_MS);
    }
    await save(true);
    audit("email_campaign_sent", { campaign: id, sent, failed });
  } catch (err) {
    log.error({ err, campaign: id }, "email campaign stopped");
    await query(`UPDATE email_campaign SET sent = $2, failed = $3, status = 'interrupted', updated_at = now() WHERE id = $1`, [id, sent, failed]).catch(() => {});
  }
}

/** At startup: a campaign still "sending" was cut short by a restart. */
export async function markInterruptedCampaigns() {
  await query(`UPDATE email_campaign SET status = 'interrupted' WHERE status = 'sending'`);
}
