import { config } from "../config.js";
import { brandedEmail, card, esc, numbered, P, para, SERIF, smallCaps } from "./emailLayout.js";
import type { Mail } from "./mailer.js";

/**
 * The account emails (welcome, email confirmation, password reset) and the book-request email to
 * administrators: plain text plus HTML in the same look as the promotional emails (lib/emailLayout.ts).
 * Admin → Emails previews them (`accountEmailPreviews`).
 */

const APP = "BookRaven";

const greeting = (name: string) => (name.trim() ? `Hi ${name.trim()},` : "Hi,");

/** Sent once, right after an account is created (email and password or Google). */
export function welcomeEmail(user: { email: string; name: string }): Mail {
  const url = config.publicUrl;
  const features = [
    ["Your library", "Upload ebooks (EPUB, MOBI, AZW3, FB2), PDFs and comics (CBZ, CBR, CB7, CBT)."],
    ["Pick up where you stopped", "Your reading position syncs between the browser, the Android app and KOReader."],
    ["The Public Library", "Hundreds of public-domain classics, organised by theme, ready to read."],
  ] as const;
  const preheader = `Your ${APP} account is ready. Here is what you can do.`;
  return {
    to: user.email,
    subject: `Welcome to ${APP}`,
    preheader,
    text: [
      greeting(user.name),
      "",
      `Your ${APP} account is ready. Here is what you can do:`,
      "",
      ...features.map(([title, desc]) => `- ${title}: ${desc}`),
      "",
      `Open your library: ${url}`,
      "",
      "Happy reading,",
      `the ${APP} team`,
      "",
      "---",
      `Forgot your password later? Use "Forgot password?" on the sign-in screen.`,
      `You received this email because an account was created with ${user.email}. If that wasn't you, you can ignore it.`,
    ].join("\n"),
    html: brandedEmail({
      title: `Welcome to ${APP}`,
      preheader,
      hero: "door",
      eyebrow: "Your account is ready",
      headline: `Welcome to ${APP}`,
      bodyHtml:
        para(esc(greeting(user.name))) +
        para("Your library has a new home, and it keeps your place on every device. Here is what you can do:") +
        numbered(features),
      button: { label: "Open your library", url },
      signoff: true,
      footerHtml: `You received this email because an account was created with ${esc(user.email)}. If that wasn't you, you can ignore it.<br>Forgot your password later? Use “Forgot password?” on the sign-in screen.`,
    }),
  };
}

/** With REQUIRE_EMAIL_VERIFICATION: `url` confirms the address and finishes setting up the account. */
export function verifyEmailEmail(user: { email: string; name: string }, url: string): Mail {
  const preheader = `Confirm your email to start using ${APP}.`;
  return {
    to: user.email,
    subject: `Confirm your ${APP} email`,
    preheader,
    text: [
      greeting(user.name),
      "",
      `Confirm this email to finish setting up your ${APP} account:`,
      "",
      url,
      "",
      "If you did not create an account, ignore this email.",
    ].join("\n"),
    html: brandedEmail({
      title: "Confirm your email",
      preheader,
      hero: "none",
      eyebrow: "One last step",
      headline: "Confirm your email",
      bodyHtml:
        para(esc(greeting(user.name))) +
        para(`Confirm this email address to finish setting up your ${APP} account. Your library will be waiting on the other side.`) +
        card(
          `<p style="margin:0;text-align:center;font:italic 18px/1.45 ${SERIF};color:${P.sepia};">Confirming <strong style="font-style:normal;color:${P.ink};">${esc(user.email)}</strong></p>`,
          { center: true },
        ),
      button: { label: "Confirm email", url },
      linkFallback: true,
      footerHtml: "If you did not create an account, ignore this email.",
    }),
  };
}

/** "Forgot password?": `url` verifies the one-hour token and opens the app's reset page. */
export function resetPasswordEmail(user: { email: string; name: string }, url: string): Mail {
  const preheader = "Choose a new password within the next hour.";
  return {
    to: user.email,
    subject: `Reset your ${APP} password`,
    preheader,
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
    html: brandedEmail({
      title: "Reset your password",
      preheader,
      hero: "none",
      eyebrow: "Account security",
      headline: "Reset your password",
      bodyHtml:
        para(esc(greeting(user.name))) +
        para(`Someone (hopefully you) asked to reset the password of your ${APP} account.`) +
        card(
          `${smallCaps("Good to know")}
  <ul style="margin:4px 0 0;padding:0 0 0 20px;font-size:15px;line-height:1.6;color:${P.body};">
    <li style="margin:0 0 6px;">The link works for <strong style="color:${P.ink};">one hour</strong>, and only once.</li>
    <li style="margin:0;">Choosing a new password signs you out on your other devices.</li>
  </ul>`,
          { accent: true },
        ),
      button: { label: "Choose a new password", url },
      linkFallback: true,
      footerHtml: "If you did not ask for this, ignore this email: your password stays the same.",
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
  const preheader = `${request.requester} asked for ${book}.`;
  return {
    to,
    subject: `New book request: ${request.title}`,
    preheader,
    text: [
      `${request.requester} asked for ${book} in the Public Library.`,
      ...(request.note ? ["", `Note: ${request.note}`] : []),
      "",
      `See the requests: ${url}`,
      "",
      "You received this email because your address is in ADMIN_EMAILS on this server.",
    ].join("\n"),
    html: brandedEmail({
      title: "New book request",
      preheader,
      hero: "none",
      eyebrow: "Public Library",
      headline: "A reader asked for a book",
      bodyHtml:
        para(`<strong style="color:${P.ink};">${esc(request.requester)}</strong> would like this book in the Public Library:`) +
        card(
          `${smallCaps("Requested")}
  <p style="margin:0;font:600 23px/1.25 ${SERIF};color:${P.ink};">${esc(request.title)}</p>
  ${request.author ? `<p style="margin:4px 0 0;font:italic 16px/1.4 ${SERIF};color:${P.sepia};">by ${esc(request.author)}</p>` : ""}
  ${request.note ? `<p style="margin:14px 0 0;padding-top:12px;border-top:1px solid ${P.line};font:italic 16px/1.5 ${SERIF};color:${P.sepia};">“${esc(request.note)}”</p>` : ""}`,
          { accent: true },
        ),
      button: { label: "See the requests", url },
      footerHtml: "You received this email because your address is in ADMIN_EMAILS on this server.",
    }),
  };
}

/** The account emails as `user` would receive them, with sample links, for Admin → Emails. */
export function accountEmailPreviews(user: { email: string; name: string }) {
  const list: { id: string; name: string; description: string; mail: Mail }[] = [
    { id: "welcome", name: "Welcome", description: "Sent once, right after an account is created (email and password or Google).", mail: welcomeEmail(user) },
    {
      id: "reset",
      name: "Password reset",
      description: "From “Forgot password?” on the sign-in screen: a link that works once, for one hour.",
      mail: resetPasswordEmail(user, `${config.publicUrl}/reset-password?token=sample-link-for-preview`),
    },
    {
      id: "verify",
      name: "Confirm email",
      description: "With REQUIRE_EMAIL_VERIFICATION on: confirms the address before the account can sign in.",
      mail: verifyEmailEmail(user, `${config.publicUrl}/api/auth/verify-email?token=sample-link-for-preview`),
    },
    {
      id: "book-request",
      name: "Book request",
      description: "To every administrator when a reader asks for a book in the Public Library.",
      mail: bookRequestEmail(user.email, {
        title: "The Count of Monte Cristo",
        author: "Alexandre Dumas",
        note: "The unabridged translation, if possible!",
        requester: "Sample Reader",
      }),
    },
  ];
  return list.map(({ mail, ...e }) => ({ ...e, subject: mail.subject, preheader: mail.preheader ?? "", html: mail.html ?? "" }));
}
