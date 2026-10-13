import { config } from "../config.js";
import type { Mail } from "./mailer.js";

/** The emails (welcome, password reset, new book request): plain text plus HTML in the app's colours. */

const APP = "BookRaven";
// Email clients ignore stylesheets and CSS variables: inline values from apps/web/src/index.css.
const C = { page: "#eef3f2", card: "#ffffff", fg: "#102327", muted: "#5b6f73", line: "#d9e3e2", button: "#087f78", brand: "#071315", accent: "#16c9b2" };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const greeting = (name: string) => (name.trim() ? `Hi ${name.trim()},` : "Hi,");

type Layout = {
  /** Hidden preview line shown next to the subject in the inbox. */
  preheader: string;
  title: string;
  /** Paragraphs and list items, already HTML-escaped where they contain user data. */
  bodyHtml: string;
  button: { label: string; url: string };
  footer: string;
};

function layout({ preheader, title, bodyHtml, button, footer }: Layout) {
  const host = new URL(config.publicUrl).host;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  <tr><td style="background:${C.brand};border-radius:12px 12px 0 0;padding:20px 28px;font:600 20px/1.2 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">
    <span style="color:${C.accent};">&#9679;</span>&nbsp;${APP}
  </td></tr>
  <tr><td style="background:${C.card};border-radius:0 0 12px 12px;padding:28px;font:16px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.fg};">
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1>
    ${bodyHtml}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
      <td style="background:${C.button};border-radius:8px;">
        <a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 22px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(button.label)}</a>
      </td>
    </tr></table>
    <p style="margin:0;font-size:13px;color:${C.muted};">If the button does not work, copy this link into your browser:<br>
      <a href="${escapeHtml(button.url)}" style="color:${C.button};word-break:break-all;">${escapeHtml(button.url)}</a></p>
    <hr style="border:none;border-top:1px solid ${C.line};margin:24px 0 16px;">
    <p style="margin:0;font-size:13px;color:${C.muted};">${footer}</p>
  </td></tr>
  <tr><td align="center" style="padding:16px;font:12px/1.4 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.muted};">
    ${APP} · <a href="${escapeHtml(config.publicUrl)}" style="color:${C.muted};">${escapeHtml(host)}</a>
  </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px;">${html}</p>`;

/** Sent once, right after an account is created (email and password or Google). */
export function welcomeEmail(user: { email: string; name: string }): Mail {
  const url = config.publicUrl;
  const features = [
    ["Your library", "upload ebooks (EPUB, MOBI, AZW3, FB2), PDFs and comics (CBZ, CBR, CB7, CBT)."],
    ["Pick up where you stopped", "your reading position syncs between the browser, the Android app and KOReader."],
    ["Public Library", "hundreds of public-domain classics, organised by theme, ready to read."],
  ] as const;
  return {
    to: user.email,
    subject: `Welcome to ${APP}`,
    text: [
      greeting(user.name),
      "",
      `Your ${APP} account is ready. Here is what you can do:`,
      "",
      ...features.map(([title, desc]) => `- ${title}: ${desc}`),
      "",
      `Open your library: ${url}`,
      "",
      `Forgot your password later? Use "Forgot password?" on the sign-in screen.`,
      `You received this email because an account was created with ${user.email}. If that wasn't you, you can ignore it.`,
    ].join("\n"),
    html: layout({
      preheader: `Your ${APP} account is ready.`,
      title: `Welcome to ${APP}`,
      bodyHtml:
        p(escapeHtml(greeting(user.name))) +
        p(`Your account is ready. Here is what you can do:`) +
        `<ul style="margin:0 0 14px;padding-left:20px;">${features
          .map(([title, desc]) => `<li style="margin:0 0 8px;"><strong>${title}:</strong> ${escapeHtml(desc)}</li>`)
          .join("")}</ul>`,
      button: { label: "Open your library", url },
      footer: `You received this email because an account was created with ${escapeHtml(user.email)}. If that wasn't you, you can ignore it. Forgot your password later? Use “Forgot password?” on the sign-in screen.`,
    }),
  };
}

/** "Forgot password?": `url` verifies the one-hour token and opens the app's reset page. */
export function resetPasswordEmail(user: { email: string; name: string }, url: string): Mail {
  return {
    to: user.email,
    subject: `Reset your ${APP} password`,
    text: [
      greeting(user.name),
      "",
      `Someone (hopefully you) asked to reset the password of your ${APP} account.`,
      "Open this link within an hour to choose a new one:",
      "",
      url,
      "",
      "Choosing a new password signs you out on your other devices.",
      "If you did not ask for this, ignore this email; your password stays the same.",
    ].join("\n"),
    html: layout({
      preheader: "Choose a new password within the next hour.",
      title: "Reset your password",
      bodyHtml:
        p(escapeHtml(greeting(user.name))) +
        p(`Someone (hopefully you) asked to reset the password of your ${APP} account. The link below works for <strong>one hour</strong> and only once.`) +
        p("Choosing a new password signs you out on your other devices."),
      button: { label: "Choose a new password", url },
      footer: "If you did not ask for this, ignore this email: your password stays the same.",
    }),
  };
}

/** Sent to each administrator (ADMIN_EMAILS) when someone asks for a book in the Public Library. */
export function bookRequestEmail(
  to: string,
  request: { title: string; author: string | null; note: string | null; requester: string },
): Mail {
  const url = `${config.publicUrl}/public?tab=requests`;
  const book = request.author ? `“${request.title}” by ${request.author}` : `“${request.title}”`;
  return {
    to,
    subject: `New book request: ${request.title}`,
    text: [
      `${request.requester} asked for ${book} in the Public Library.`,
      ...(request.note ? ["", `Note: ${request.note}`] : []),
      "",
      `See the requests: ${url}`,
      "",
      "You received this email because your address is in ADMIN_EMAILS on this server.",
    ].join("\n"),
    html: layout({
      preheader: `${request.requester} asked for ${book}.`,
      title: "New book request",
      bodyHtml:
        p(`${escapeHtml(request.requester)} asked for <strong>${escapeHtml(book)}</strong> in the Public Library.`) +
        (request.note ? p(`<em>${escapeHtml(request.note)}</em>`) : ""),
      button: { label: "See the requests", url },
      footer: "You received this email because your address is in ADMIN_EMAILS on this server.",
    }),
  };
}
