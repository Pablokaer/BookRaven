import { describe, expect, it } from "vitest";
import { query } from "../src/db.js";
import { campaignDone, TEMPLATES, unsubscribeUrl } from "../src/lib/campaigns.js";
import { outbox } from "../src/lib/mailer.js";
import { adminSession, api, fakePdf, getApp, signUp, upload, type TestUser } from "./helpers.js";

let adminUser: TestUser | null = null;
const admin = async () => (adminUser ??= await adminSession());

const draft = (template: keyof typeof TEMPLATES, changes: Partial<(typeof TEMPLATES)["comeback"]["defaults"]> = {}) => ({
  template,
  content: { ...TEMPLATES[template].defaults, ...changes },
});

/** Path and query of an absolute link, for app.inject. */
const local = (url: string) => {
  const u = new URL(url);
  return u.pathname + u.search;
};

describe("promotional emails", () => {
  it("are for administrators only", async () => {
    const u = await signUp();
    expect((await api(u, "GET", "/api/admin/emails/templates")).statusCode).toBe(403);
    expect((await api(u, "POST", "/api/admin/emails/send", { ...draft("comeback"), audience: { segment: "all", days: 30 } })).statusCode).toBe(403);
    const res = await api(await admin(), "GET", "/api/admin/emails/templates");
    expect(res.statusCode).toBe(200);
    expect(res.json().templates.map((t: { id: string }) => t.id)).toEqual(["missyou", "comeback", "continue", "classics", "share", "recap", "announcement"]);
  });

  it("previews the email personalised for the administrator", async () => {
    const a = await admin();
    const res = await api(a, "POST", "/api/admin/emails/preview", draft("comeback", { subject: "Hello {name}", message: "Line **bold**\n\n- one\n- two" }));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subject).toBe("Hello Admin");
    expect(body.html).toContain("<strong");
    expect(body.html).toContain("<li");
    expect(body.html).toContain("/email/hero-door.jpg");
    expect(body.html).toContain("/api/email/unsubscribe?u=");
    // nothing in progress: the bookmark shows sample data, and says so
    const share = (await api(a, "POST", "/api/admin/emails/preview", draft("share"))).json();
    expect(share.html).toContain("Read together");
    expect(share.html).toContain("CBZ");
    const miss = (await api(a, "POST", "/api/admin/emails/preview", draft("missyou"))).json();
    expect(miss.subject).toBe("We miss you, Admin");
    expect(miss.html).toContain("Your shelf, as you left it");
    const cont = (await api(a, "POST", "/api/admin/emails/preview", draft("continue"))).json();
    expect(cont.sample).toBe(true);
    expect(cont.html).toContain("Currently reading");
  });

  it("previews the account emails in the same look", async () => {
    const res = await api(await admin(), "GET", "/api/admin/emails/account");
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.map((e: { id: string }) => e.id)).toEqual(["welcome", "reset", "verify", "book-request"]);
    for (const e of list) {
      expect(e.html).toContain("/email/brand.png");
      expect(e.preheader).toBeTruthy();
    }
    expect(list[1].html).toContain("If the button does not work");
  });

  it("refuses links to other sites and unknown templates", async () => {
    const a = await admin();
    expect((await api(a, "POST", "/api/admin/emails/preview", draft("comeback", { buttonPath: "https://evil.example.com" }))).statusCode).toBe(400);
    expect((await api(a, "POST", "/api/admin/emails/preview", draft("comeback", { buttonPath: "javascript:alert(1)" }))).statusCode).toBe(400);
    expect((await api(a, "POST", "/api/admin/emails/preview", { ...draft("comeback"), template: "nope" })).statusCode).toBe(400);
  });

  it("sends a test to the administrator only", async () => {
    const a = await admin();
    const before = outbox.length;
    expect((await api(a, "POST", "/api/admin/emails/test", draft("announcement"))).statusCode).toBe(204);
    const sent = outbox.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(a.email);
    expect(sent[0]!.subject).toMatch(/^\[Test\] /);
  });

  it("sends to the audience with each reader's own book, and skips who unsubscribed", async () => {
    const a = await admin();
    const reader = await signUp(undefined, "Ada Lovelace");
    const quitter = await signUp();
    const book = (await upload(reader, "c.pdf", fakePdf(), { title: "Middlemarch" })).json();
    // Started a month ago: in the "book in progress, nothing read for 14 days" audience.
    await query(
      `INSERT INTO reading_progress (user_id, book_id, locator, percentage, device_id, updated_at) VALUES ($1, $2, 'page:10', 0.4, 'd1', now() - interval '30 days')`,
      [reader.id, book.id],
    );

    // The quitter uses the link from an email (GET asks, POST unsubscribes).
    const link = local(unsubscribeUrl(quitter.id));
    expect((await api(null, "GET", link)).body).toContain("<form");
    expect((await api(null, "POST", link.replace(/token=[^&]+/, "token=wrong"))).statusCode).toBe(400);
    const done = await (await getApp()).inject({ method: "POST", url: link, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "List-Unsubscribe=One-Click" });
    expect(done.statusCode).toBe(200);
    expect((await api(quitter, "GET", "/api/me/email-preferences")).json()).toEqual({ promotional: false });

    const audience = { segment: "in_progress", days: 14 };
    const count = (await api(a, "POST", "/api/admin/emails/audience", audience)).json().count;
    expect(count).toBeGreaterThanOrEqual(1);

    const before = outbox.length;
    const res = await api(a, "POST", "/api/admin/emails/send", { ...draft("continue"), audience });
    expect(res.statusCode).toBe(202);
    await campaignDone();
    const sent = outbox.slice(before);
    const mine = sent.find((m) => m.to === reader.email)!;
    expect(mine.subject).toBe("Ada, your bookmark is waiting");
    expect(mine.html).toContain("Middlemarch");
    expect(mine.html).toContain(`/read/${book.id}`);
    expect(mine.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent.some((m) => m.to === quitter.email)).toBe(false);

    const campaigns = (await api(a, "GET", "/api/admin/emails/campaigns")).json();
    expect(campaigns[0]).toMatchObject({ id: res.json().id, status: "sent", sent: sent.length, failed: 0, template: "continue" });

    // "all" still leaves the quitter out; turning emails back on in the profile brings them back.
    const all = { segment: "all", days: 30 };
    const withoutQuitter = (await api(a, "POST", "/api/admin/emails/audience", all)).json().count;
    expect((await api(quitter, "PUT", "/api/me/email-preferences", { promotional: true })).statusCode).toBe(204);
    expect((await api(a, "POST", "/api/admin/emails/audience", all)).json().count).toBe(withoutQuitter + 1);
  });
});
