import { beforeEach, describe, expect, it } from "vitest";
import { query } from "../src/db.js";
import { inSendingHours, runAutomations } from "../src/lib/automations.js";
import { outbox } from "../src/lib/mailer.js";
import { adminSession, api, fakePdf, signUp, upload, type TestUser } from "./helpers.js";

let adminUser: TestUser | null = null;
const admin = async () => (adminUser ??= await adminSession());

/** A reader with a book left at 40%, last opened `daysAgo` days ago. */
async function readerWithBook(daysAgo: number) {
  const u = await signUp(undefined, "Lia Reader");
  const book = (await upload(u, "b.pdf", fakePdf(), { title: "Persuasion" })).json();
  await query(
    `INSERT INTO reading_progress (user_id, book_id, locator, percentage, device_id, updated_at)
     VALUES ($1, $2, 'page:9', 0.4, 'd1', now() - make_interval(days => $3))`,
    [u.id, book.id, daysAgo],
  );
  await query(`INSERT INTO reading_activity (user_id, book_id, hour, seconds) VALUES ($1, $2, date_trunc('hour', now() - make_interval(days => $3)), 600)`, [
    u.id,
    book.id,
    daysAgo,
  ]);
  return { u, book };
}

const mailsTo = (email: string, from: number) => outbox.slice(from).filter((m) => m.to === email);

describe("automatic emails", () => {
  beforeEach(async () => {
    // Every automation off, so each test turns on only the one it checks.
    await query(`UPDATE email_automation SET enabled = false`);
  });

  it("are administered by administrators only, and start off", async () => {
    const u = await signUp();
    expect((await api(u, "GET", "/api/admin/emails/automations")).statusCode).toBe(403);
    const res = (await api(await admin(), "GET", "/api/admin/emails/automations")).json();
    expect(res.automations.map((a: { id: string }) => a.id)).toEqual(["recap", "continue", "missyou", "comeback", "onboarding", "classics"]);
    expect(res.automations.every((a: { enabled: boolean }) => !a.enabled)).toBe(true);
    expect((await api(await admin(), "PUT", "/api/admin/emails/automations/nope", { enabled: true })).statusCode).toBe(404);
    expect((await api(await admin(), "PUT", "/api/admin/emails/automations/recap", { days: 5 })).statusCode).toBe(400);
  });

  it("send nothing while off", async () => {
    const { u } = await readerWithBook(20);
    const before = outbox.length;
    await runAutomations({ anyHour: true });
    expect(mailsTo(u.email, before)).toHaveLength(0);
  });

  it("send 'Continue reading' once per book, with the edited text", async () => {
    const a = await admin();
    const { u, book } = await readerWithBook(20);
    const fresh = await readerWithBook(3); // read 3 days ago: not yet
    const content = (await api(a, "GET", "/api/admin/emails/automations")).json().automations.find((x: { id: string }) => x.id === "continue").content;
    expect(
      (await api(a, "PUT", "/api/admin/emails/automations/continue", { enabled: true, days: 14, content: { ...content, subject: "Back to it, {name}?" } })).statusCode,
    ).toBe(204);

    const before = outbox.length;
    const sent = await runAutomations({ anyHour: true });
    expect(sent.continue).toBeGreaterThanOrEqual(1);
    const mine = mailsTo(u.email, before);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toBe("Back to it, Lia?");
    expect(mine[0]!.html).toContain(`/read/${book.id}`);
    expect(mailsTo(fresh.u.email, before)).toHaveLength(0);

    // The next hour: already sent for this book.
    const again = outbox.length;
    await runAutomations({ anyHour: true });
    expect(mailsTo(u.email, again)).toHaveLength(0);
  });

  it("space promotional emails a week apart and skip unsubscribed readers", async () => {
    const a = await admin();
    const { u } = await readerWithBook(100); // fits "We miss you" (75 days)...
    await query(`INSERT INTO email_send_log (user_id, kind, ref, sent_at) VALUES ($1, 'campaign', 'x', now() - interval '2 days')`, [u.id]); // ...but got a campaign 2 days ago
    const quiet = await readerWithBook(100);
    await api(quiet.u, "PUT", "/api/me/email-preferences", { promotional: false });
    const other = await readerWithBook(100);
    await api(a, "PUT", "/api/admin/emails/automations/missyou", { enabled: true });

    const before = outbox.length;
    await runAutomations({ anyHour: true });
    expect(mailsTo(u.email, before)).toHaveLength(0);
    expect(mailsTo(quiet.u.email, before)).toHaveLength(0);
    const got = mailsTo(other.u.email, before);
    expect(got).toHaveLength(1);
    expect(got[0]!.html).toContain("Your shelf, as you left it");
  });

  it("send one email per reader per pass, the first automation winning", async () => {
    const a = await admin();
    const { u } = await readerWithBook(100); // fits both: a book left 100 days ago, and 100 days without reading
    await api(a, "PUT", "/api/admin/emails/automations/continue", { enabled: true, content: null });
    await api(a, "PUT", "/api/admin/emails/automations/missyou", { enabled: true });
    const before = outbox.length;
    await runAutomations({ anyHour: true });
    const got = mailsTo(u.email, before);
    expect(got).toHaveLength(1);
    expect(got[0]!.subject).toMatch(/bookmark/); // "Continue reading" comes before "We miss you"
  });

  it("only send inside the sending hours", () => {
    expect(inSendingHours(new Date("2026-11-16T13:00:00Z"))).toBe(true);
    expect(inSendingHours(new Date("2026-11-16T03:00:00Z"))).toBe(false);
  });
});
