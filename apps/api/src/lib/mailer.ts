import nodemailer from "nodemailer";
import { config } from "../config.js";

export type Mail = { to: string; subject: string; text: string };

/** Mails "sent" while running tests or without SMTP, newest last (tests read the links from here). */
export const outbox: Mail[] = [];

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

/** True when the server can send real email (SMTP_URL is set). */
export const mailEnabled = Boolean(transport);

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
