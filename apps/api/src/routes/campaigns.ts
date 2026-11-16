import type { FastifyInstance, FastifyReply } from "fastify";
import { requireUser } from "../auth.js";
import { config } from "../config.js";
import { mailEnabled } from "../lib/mailer.js";
import { obj } from "../lib/http.js";
import { audit } from "../lib/log.js";
import {
  audienceRecipients,
  campaignRunning,
  HEROES,
  previewCampaign,
  SEGMENTS,
  sendTest,
  setPromotionalEmails,
  startCampaign,
  TEMPLATE_IDS,
  TEMPLATES,
  validUnsubscribe,
  type Audience,
  type CampaignContent,
  type TemplateId,
} from "../lib/campaigns.js";
import { query } from "../db.js";
import { accountEmailPreviews } from "../lib/emails.js";
import { requireAdmin } from "./admin.js";

const contentSchema = obj(
  {
    subject: { type: "string", minLength: 1, maxLength: 150 },
    preheader: { type: "string", maxLength: 200 },
    eyebrow: { type: "string", maxLength: 60 },
    headline: { type: "string", minLength: 1, maxLength: 150 },
    message: { type: "string", maxLength: 5000 },
    buttonLabel: { type: "string", minLength: 1, maxLength: 40 },
    // A path inside the app: no other site, no "javascript:".
    buttonPath: { type: "string", maxLength: 300, pattern: "^/[A-Za-z0-9/_?=&.%#-]*$" },
    hero: { enum: HEROES },
  },
  ["subject", "preheader", "eyebrow", "headline", "message", "buttonLabel", "buttonPath", "hero"],
);
const audienceSchema = obj({ segment: { enum: SEGMENTS }, days: { type: "integer", minimum: 1, maximum: 3650 } }, ["segment", "days"]);
const templateSchema = { enum: TEMPLATE_IDS };

type Draft = { template: TemplateId; content: CampaignContent };

/** Admin → Emails: promotional emails to the readers (administrators only). */
export async function campaignAdminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);
  app.addHook("preHandler", requireAdmin);

  /** The templates with their default texts, and whether this server can deliver email. */
  app.get("/api/admin/emails/templates", async () => ({
    templates: TEMPLATE_IDS.map((id) => ({ id, ...TEMPLATES[id] })),
    mailEnabled,
  }));

  /** The account emails (welcome, password reset...) as the administrator would receive them, with sample links. */
  app.get("/api/admin/emails/account", async (request) => accountEmailPreviews(request.user));

  /** How many accounts an audience reaches right now. */
  app.post<{ Body: Audience }>("/api/admin/emails/audience", { schema: { body: audienceSchema } }, async (request) => {
    return { count: (await audienceRecipients(request.body)).length };
  });

  /** The email rendered for the administrator: what they would receive. */
  app.post<{ Body: Draft }>(
    "/api/admin/emails/preview",
    { schema: { body: obj({ template: templateSchema, content: contentSchema }, ["template", "content"]) } },
    async (request) => {
      const { subject, preheader, html, sample, emptyClassics } = await previewCampaign(request.body.template, request.body.content, request.user);
      return { subject, preheader, html, sample, emptyClassics };
    },
  );

  /** Sends the email to the administrator only. */
  app.post<{ Body: Draft }>(
    "/api/admin/emails/test",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { body: obj({ template: templateSchema, content: contentSchema }, ["template", "content"]) },
    },
    async (request, reply) => {
      if (refuseWithoutMail(reply)) return;
      await sendTest(request.body.template, request.body.content, request.user);
      return reply.code(204).send();
    },
  );

  /** Starts sending to the audience (one campaign at a time); 202 with the number of recipients. */
  app.post<{ Body: Draft & { audience: Audience } }>(
    "/api/admin/emails/send",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { body: obj({ template: templateSchema, content: contentSchema, audience: audienceSchema }, ["template", "content", "audience"]) },
    },
    async (request, reply) => {
      if (refuseWithoutMail(reply)) return;
      if (campaignRunning()) return reply.code(409).send({ error: "campaign_running" });
      const started = await startCampaign(request.body.template, request.body.content, request.body.audience, request.user.id);
      if (!started) return reply.code(400).send({ error: "no_recipients" });
      return reply.code(202).send(started);
    },
  );

  /** The latest campaigns, newest first, with their progress. */
  app.get("/api/admin/emails/campaigns", async () => {
    const { rows } = await query<{
      id: string;
      template: string;
      subject: string;
      audience: Audience;
      status: string;
      recipients: number;
      sent: number;
      failed: number;
      created_by: string | null;
      created_at: Date;
      finished_at: Date | null;
    }>(
      `SELECT c.id, c.template, c.subject, c.audience, c.status, c.recipients, c.sent, c.failed, u.email AS created_by, c.created_at, c.finished_at
         FROM email_campaign c LEFT JOIN "user" u ON u.id = c.created_by
        ORDER BY c.created_at DESC LIMIT 30`,
    );
    return rows.map((r) => ({
      id: r.id,
      template: r.template,
      subject: r.subject,
      audience: r.audience,
      status: r.status,
      recipients: r.recipients,
      sent: r.sent,
      failed: r.failed,
      createdBy: r.created_by,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    }));
  });
}

/** In production without SMTP nothing would be delivered: say so instead of pretending. */
function refuseWithoutMail(reply: FastifyReply) {
  if (mailEnabled || !config.isProd) return false;
  void reply.code(400).send({ error: "mail_disabled" });
  return true;
}

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} · BookRaven</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#071521;font:16px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#eee3d0;">
<main style="max-width:440px;margin:24px;padding:36px 32px;background:#0e2236;border:1px solid rgba(201,164,116,.35);border-radius:6px;text-align:center;">
<h1 style="margin:0 0 12px;font:600 30px/1.2 'Cormorant Garamond',Georgia,serif;color:#f5eedf;">${title}</h1>
${body}
<p style="margin:24px 0 0;"><a href="${config.publicUrl}" style="color:#c9a474;">Open BookRaven</a></p>
</main></body></html>`;

/**
 * The unsubscribe link of promotional emails (no sign-in: the link carries a signature of the
 * account id). GET asks to confirm with a button, because mail scanners open links on their own;
 * POST unsubscribes, from that button or from the mail client's one-click unsubscribe
 * (List-Unsubscribe-Post, RFC 8058).
 */
export async function unsubscribeRoutes(app: FastifyInstance) {
  // The one-click POST and the HTML form send a form body; it carries nothing the route needs.
  app.addContentTypeParser("application/x-www-form-urlencoded", (_request, _body, done) => done(null, {}));

  // The signature is named `token` so the request log redacts it (lib/log.ts).
  type Q = { Querystring: { u?: string; token?: string } };
  const invalid = page("Link not valid", `<p style="margin:0;color:#a7b5c3;">This unsubscribe link is incomplete. Open BookRaven and turn promotional emails off in your profile.</p>`);

  app.get<Q>("/api/email/unsubscribe", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { u, token } = request.query;
    reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store");
    if (!validUnsubscribe(u, token)) return reply.code(400).send(invalid);
    const action = `/api/email/unsubscribe?u=${encodeURIComponent(u)}&token=${encodeURIComponent(token!)}`;
    return page(
      "Unsubscribe?",
      `<p style="margin:0 0 22px;color:#a7b5c3;">You will no longer receive news and reading reminders from BookRaven. Emails about your account (like password resets) still arrive.</p>
<form method="post" action="${action.replace(/&/g, "&amp;")}"><button type="submit" style="min-height:46px;padding:0 26px;border:0;border-radius:3px;background:#f5eedf;color:#151b23;font:600 15px/1 inherit;cursor:pointer;box-shadow:0 0 0 1px rgba(201,164,116,.55);">Unsubscribe</button></form>`,
    );
  });

  app.post<Q>("/api/email/unsubscribe", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { u, token } = request.query;
    reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store");
    if (!validUnsubscribe(u, token)) return reply.code(400).send(invalid);
    // The account may be gone since the email was sent: nothing to do then.
    const { rowCount } = await query(`SELECT 1 FROM "user" WHERE id = $1`, [u]);
    if (rowCount) {
      await setPromotionalEmails(u, false);
      audit("email_unsubscribed", { user: u });
    }
    return page(
      "You're unsubscribed",
      `<p style="margin:0;color:#a7b5c3;">You won't receive promotional emails from BookRaven anymore. Changed your mind? Turn them back on in your profile.</p>`,
    );
  });
}
