import { config } from "../config.js";

/**
 * The look every BookRaven email shares, account emails (lib/emails.ts) and promotional ones
 * (lib/campaigns.ts): the front page's midnight, parchment and gold, the brand header, an optional
 * engraving by Doré, a centred serif headline under a fleuron, and the midnight footer. Images are
 * in apps/web/public/email/. Email clients ignore stylesheets' variables and most of <style>, so
 * every value is inlined; <style> only adds the phone-width adjustments clients that support it use.
 */

// The front page's palette (apps/web/src/index.css).
export const P = {
  page: "#e6dac4",
  midnight: "#071521",
  ivory: "#f5eedf",
  paper: "#fbf7ee",
  gold: "#c9a474",
  goldDeep: "#7a5c34",
  ink: "#151b23",
  body: "#2c3038",
  sepia: "#5a5348",
  silver: "#aab8c6",
  line: "#dfd1b8",
  track: "#e8dcc6",
};
export const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
export const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The engraving at the top of an email (apps/web/public/email/hero-*.jpg), or none. */
export const HEROES = ["clouds", "door", "scholar", "none"] as const;
export type Hero = (typeof HEROES)[number];

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A body paragraph; `html` is already escaped where it holds user data. */
export const para = (html: string) => `<p style="margin:0 0 18px;">${html}</p>`;

export const smallCaps = (text: string, color: string = P.goldDeep) =>
  `<p style="margin:0 0 8px;font:600 11px/1.4 ${SANS};letter-spacing:0.18em;text-transform:uppercase;color:${color};">${esc(text)}</p>`;

/** A parchment card with a gold edge, for the part of an email that matters most. */
export const card = (inner: string, opts: { accent?: boolean; center?: boolean } = {}) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 26px;background:${P.paper};border:1px solid ${P.line};${
    opts.accent ? `border-left:4px solid ${P.gold};` : ""
  }border-radius:4px;"><tr><td${opts.center ? ' align="center"' : ""} style="padding:20px 22px;">${inner}</td></tr></table>`;

/** Rows numbered I, II, III… in gold, each a serif title over a line of text. */
export function numbered(items: readonly (readonly [string, string])[]) {
  const roman = ["I", "II", "III", "IV", "V", "VI"];
  const rows = items
    .map(
      ([title, desc], i) => `<tr>
  <td width="46" valign="top" style="padding:2px 0 18px;font:600 24px/1 ${SERIF};color:${P.gold};">${roman[i]}</td>
  <td valign="top" style="padding:0 0 18px;font:15px/1.6 ${SANS};color:${P.body};">
    <span style="display:block;margin:0 0 2px;font:600 19px/1.3 ${SERIF};color:${P.ink};">${esc(title)}</span>${esc(desc)}
  </td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 12px;border-top:1px solid ${P.line};">
<tr><td colspan="2" style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>${rows}</table>`;
}

export type BrandedEmail = {
  /** The document title (some clients show it). */
  title: string;
  /** Hidden preview line shown after the subject in the inbox. */
  preheader: string;
  hero: Hero;
  eyebrow?: string;
  /** Plain text: escaped here. */
  headline: string;
  /** Paragraphs and blocks, already escaped where they hold user data. */
  bodyHtml: string;
  button?: { label: string; url: string };
  /** Under the button, the link written out, for clients that break buttons (one-time links). */
  linkFallback?: boolean;
  /** Ends with "Happy reading, the BookRaven team". */
  signoff?: boolean;
  /** The footer's small print (why they got it, unsubscribe link), already escaped. */
  footerHtml: string;
};

export function brandedEmail(e: BrandedEmail) {
  const host = new URL(config.publicUrl).host;
  const hero =
    e.hero === "none"
      ? ""
      : `<tr><td style="background:${P.midnight};font-size:0;line-height:0;"><img src="${esc(`${config.publicUrl}/email/hero-${e.hero}.jpg`)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`;
  const button = e.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:10px auto 6px;"><tr>
      <td style="background:${P.midnight};border:1px solid ${P.gold};border-radius:3px;">
        <a href="${esc(e.button.url)}" style="display:inline-block;padding:15px 32px;font:600 15px/1 ${SANS};letter-spacing:0.02em;color:${P.ivory};text-decoration:none;">${esc(e.button.label)}&nbsp;&rarr;</a>
      </td>
    </tr></table>${
      e.linkFallback
        ? `<p style="margin:18px 0 0;text-align:center;font:13px/1.5 ${SANS};color:${P.sepia};">If the button does not work, copy this link into your browser:<br>
      <a href="${esc(e.button.url)}" style="color:${P.goldDeep};word-break:break-all;">${esc(e.button.url)}</a></p>`
        : ""
    }`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(e.title)}</title>
<style>
  @media (max-width: 620px) {
    .pad { padding-left: 24px !important; padding-right: 24px !important; }
    .headline { font-size: 30px !important; }
    .stack { display: block !important; width: 100% !important; box-sizing: border-box; }
  }
  a { color: ${P.goldDeep}; }
</style>
</head>
<body style="margin:0;padding:0;background:${P.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(e.preheader)}${"&#847;&zwnj;&nbsp;".repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${P.page};">
<tr><td align="center" style="padding:28px 12px 36px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
  <tr><td class="pad" style="background:${P.midnight};border-radius:6px 6px 0 0;padding:22px 40px;">
    <a href="${esc(config.publicUrl)}"><img src="${esc(`${config.publicUrl}/email/brand.png`)}" width="220" height="48" alt="BookRaven" style="display:block;border:0;"></a>
  </td></tr>
  ${hero}
  <tr><td style="background:${P.gold};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
  <tr><td class="pad" style="background:${P.ivory};padding:40px 48px 38px;font:16px/1.7 ${SANS};color:${P.body};">
    <div style="text-align:center;">
      ${e.eyebrow ? smallCaps(e.eyebrow) : ""}
      <h1 class="headline" style="margin:0;font:600 36px/1.15 ${SERIF};color:${P.ink};">${esc(e.headline)}</h1>
      <p style="margin:16px 0 26px;font:20px/1 ${SERIF};color:${P.gold};">&#8213;&nbsp;&#10086;&nbsp;&#8213;</p>
    </div>
    ${e.bodyHtml}
    ${button}
    ${e.signoff ? `<p style="margin:30px 0 0;text-align:center;font:italic 19px/1.4 ${SERIF};color:${P.sepia};">Happy reading,<br>the BookRaven team</p>` : ""}
  </td></tr>
  <tr><td class="pad" align="center" style="background:${P.midnight};border-radius:0 0 6px 6px;padding:26px 40px 28px;font:12px/1.65 ${SANS};color:${P.silver};">
    <p style="margin:0 0 10px;font:italic 16px/1.4 ${SERIF};color:${P.gold};">Ebooks, PDFs and comics, with your place saved on every device.</p>
    <p style="margin:0;">${e.footerHtml}<br><a href="${esc(config.publicUrl)}" style="color:${P.silver};">${esc(host)}</a></p>
  </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
