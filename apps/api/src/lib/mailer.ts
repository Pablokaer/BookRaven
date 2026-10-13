import nodemailer from "nodemailer";
import { config } from "../config.js";

/** `html` is optional; `text` is always sent too, for clients that show plain text. */
export type Mail = { to: string; subject: string; text: string; html?: string };

/** Mails "sent" while running tests or without SMTP, newest last (tests read the links from here). */
export const outbox: Mail[] = [];

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

/** True when the server can send real email (SMTP_URL is set). */
export const mailEnabled = Boolean(transport);

// A wrong SMTP_URL shows up in the log at startup instead of on the first forgotten password.
if (transport && !config.isTest) {
  transport.verify().then(
    () => console.info("SMTP ready"),
    (err: Error) => console.error(`SMTP_URL does not work: ${err.message}`),
  );
}

/**
 * Sends an email through SMTP_URL. Without SMTP (development) the message is printed
 * to the server log instead, so password-reset links still work locally.
 */
export async function sendMail(mail: Mail) {
  if (!transport || config.isTest) {
    outbox.push(mail);
    if (!config.isTest) console.info(`[mail to ${mail.to}] ${mail.subject}\n${mail.text}`);
    return;
  }
  await transport.sendMail({ from: config.mailFrom, ...mail });
}

/**
 * Sends in the background: the request that triggered it does not wait for SMTP, so a slow
 * or failing mail server neither breaks sign-up nor reveals (by timing) whether an email has
 * an account. Failures are logged.
 */
export function sendMailInBackground(mail: Mail) {
  sendMail(mail).catch((err: Error) => console.error(`email "${mail.subject}" to ${mail.to} failed: ${err.message}`));
}
