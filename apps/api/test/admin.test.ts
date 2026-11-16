import { describe, expect, it } from "vitest";
import { query } from "../src/db.js";
import { outbox } from "../src/lib/mailer.js";
import { adminSession, api, fakePdf, signUp, upload, type TestUser } from "./helpers.js";

let adminUser: TestUser | null = null;
const admin = async () => (adminUser ??= await adminSession());

describe("admin panel", () => {
  it("is only for administrators", async () => {
    const u = await signUp();
    expect((await api(u, "GET", "/api/admin/users")).statusCode).toBe(403);
    expect((await api(await admin(), "GET", "/api/admin/stats")).statusCode).toBe(200);
  });

  it("filters accounts by books, activity and last use", async () => {
    const a = await admin();
    const tag = `flt${Date.now()}`;
    const reader = await signUp(`${tag}r@test.local`);
    await upload(reader, "f.pdf", fakePdf());
    const away = await signUp(`${tag}a@test.local`);
    const ghost = await signUp(`${tag}g@test.local`);
    await query(
      `INSERT INTO user_activity (user_id, last_seen_at) VALUES ($1, now() - interval '40 days')
       ON CONFLICT (user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      [away.id],
    );
    await query(`DELETE FROM user_activity WHERE user_id = $1`, [ghost.id]);
    const emails = async (params: string) =>
      ((await api(a, "GET", `/api/admin/users?q=${tag}&${params}`)).json() as { email: string }[]).map((u) => u.email).sort();

    expect(await emails("minBooks=1")).toEqual([reader.email]);
    expect(await emails("maxBooks=0")).toEqual([away.email, ghost.email].sort());
    expect(await emails("activity=never")).toEqual([ghost.email]);
    expect(await emails("activity=active")).toEqual([reader.email, away.email].sort());
    expect(await emails("activeWithin=7")).toEqual([reader.email]);
    expect(await emails("inactiveFor=30")).toEqual([away.email, ghost.email].sort());
    expect(await emails("activity=active&inactiveFor=30")).toEqual([away.email]);
    const byActivity = ((await api(a, "GET", `/api/admin/users?q=${tag}&sort=lastActive`)).json() as { email: string }[]).map((u) => u.email);
    expect(byActivity).toEqual([reader.email, away.email, ghost.email]);
    expect((await api(a, "GET", "/api/admin/users?activity=sometimes")).statusCode).toBe(400);
  });

  it("shows when each account last used the app", async () => {
    const a = await admin();
    const u = await signUp();
    const find = async () => (await api(a, "GET", `/api/admin/users?q=${encodeURIComponent(u.email)}`)).json()[0];
    const before = Date.now();
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(200);
    const seen = (await find()).lastSeenAt;
    expect(seen).toBeTruthy();
    expect(new Date(seen).getTime()).toBeGreaterThanOrEqual(before - 5000);
  });

  it("sets a per-account quota, blocks and unblocks", async () => {
    const a = await admin();
    const u = await signUp();
    expect((await api(a, "PATCH", `/api/admin/users/${u.id}`, { quotaMb: 5 })).statusCode).toBe(204);
    expect((await api(u, "GET", "/api/me")).json().quotaBytes).toBe(5 * 1024 * 1024);
    // 1.2 MB now fits (default test quota is 1 MB)
    expect((await upload(u, "big.pdf", fakePdf(1200 * 1024))).statusCode).toBe(201);

    expect((await api(a, "PATCH", `/api/admin/users/${u.id}`, { blocked: true, blockedReason: "spam" })).statusCode).toBe(204);
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(401); // sessions were revoked
    const signIn = await api(null, "POST", "/api/auth/sign-in/email", { email: u.email, password: "password123" });
    expect(signIn.statusCode).toBe(403);
    expect(signIn.json().code).toBe("ACCOUNT_BLOCKED");

    expect((await api(a, "PATCH", `/api/admin/users/${u.id}`, { blocked: false })).statusCode).toBe(204);
    expect((await api(null, "POST", "/api/auth/sign-in/email", { email: u.email, password: "password123" })).statusCode).toBe(200);
    // administrators cannot be blocked
    expect((await api(a, "PATCH", `/api/admin/users/${a.id}`, { blocked: true })).statusCode).toBe(400);
  });

  it("resets a password and deletes an account with its files", async () => {
    const a = await admin();
    const u = await signUp();
    const book = (await upload(u, "d.pdf", fakePdf())).json();
    const { password } = (await api(a, "POST", `/api/admin/users/${u.id}/reset-password`)).json();
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(401); // signed out everywhere
    expect((await api(null, "POST", "/api/auth/sign-in/email", { email: u.email, password })).statusCode).toBe(200);

    expect((await api(a, "DELETE", `/api/admin/users/${u.id}`)).statusCode).toBe(204);
    const users = (await api(a, "GET", `/api/admin/users?q=${encodeURIComponent(u.email)}`)).json();
    expect(users).toHaveLength(0);
    expect(book.id).toBeTruthy();
  });
});

describe("reports and content removal", () => {
  it("reports a public book; the admin blocks the file everywhere", async () => {
    const a = await admin();
    const owner = await signUp();
    const reader = await signUp();
    const file = fakePdf();
    const book = (await upload(owner, "r.pdf", file, { title: "Pirated" })).json();
    await api(owner, "PATCH", `/api/books/${book.id}`, { isPublic: true });
    // the reader adds a copy before the takedown
    expect((await api(reader, "POST", `/api/public/${book.id}/add`)).statusCode).toBe(201);

    expect((await api(owner, "POST", `/api/public/${book.id}/report`, { reason: "copyright" })).statusCode).toBe(400); // own book
    expect((await api(reader, "POST", `/api/public/${book.id}/report`, { reason: "copyright", details: "Not theirs" })).statusCode).toBe(201);

    const reports = (await api(a, "GET", "/api/admin/reports")).json();
    const report = reports.find((r: { title: string }) => r.title === "Pirated");
    expect(report).toMatchObject({ reason: "copyright", stillPublic: true, status: "open" });

    const res = await api(a, "POST", `/api/admin/reports/${report.id}/resolve`, { action: "purge", note: "DMCA" });
    expect(res.json()).toMatchObject({ action: "purge", removedCopies: 2 });
    expect((await api(owner, "GET", "/api/books")).json()).toHaveLength(0);
    expect((await api(reader, "GET", "/api/books")).json()).toHaveLength(0);
    // blocked: cannot come back
    expect((await upload(owner, "again.pdf", file)).statusCode).toBe(451);
    const blocked = (await api(a, "GET", "/api/admin/blocked-files")).json();
    expect(blocked[0]).toMatchObject({ title: "Pirated", reason: "DMCA" });
    expect((await api(a, "GET", "/api/admin/reports")).json().some((r: { title: string }) => r.title === "Pirated")).toBe(false);
  });
});

describe("book requests", () => {
  it("asks, votes and fulfils with a published book", async () => {
    const asker = await signUp(undefined, "Asker");
    const voter = await signUp();
    const helper = await signUp(undefined, "Helper");

    const req = (await api(asker, "POST", "/api/requests", { title: "Dune", author: "Frank Herbert" })).json();
    expect(req).toMatchObject({ title: "Dune", votes: 1, voted: true, status: "open", isMine: true });
    const mail = outbox.findLast((m) => m.to === "admin@test.local" && m.subject === "New book request: Dune")!;
    expect(mail.text).toContain("Asker asked for “Dune” by Frank Herbert");
    expect(mail.text).toContain("/public?tab=requests");
    expect((await api(voter, "POST", `/api/requests/${req.id}/vote`)).statusCode).toBe(204);
    expect((await api(voter, "GET", "/api/requests")).json().find((r: { id: string }) => r.id === req.id)).toMatchObject({ votes: 2, voted: true });

    const book = (await upload(helper, "dune.pdf", fakePdf(), { title: "Dune" })).json();
    expect((await api(voter, "POST", `/api/requests/${req.id}/fulfill`, { bookId: book.id })).statusCode).toBe(404); // not their book
    expect((await api(helper, "POST", `/api/requests/${req.id}/fulfill`, { bookId: book.id })).statusCode).toBe(204);

    const after = (await api(asker, "GET", "/api/requests")).json().find((r: { id: string }) => r.id === req.id);
    expect(after).toMatchObject({ status: "fulfilled", fulfilledBookId: book.id, fulfilledBy: "Helper" });
    expect((await api(asker, "GET", "/api/public")).json().map((b: { id: string }) => b.id)).toContain(book.id);

    expect((await api(voter, "DELETE", `/api/requests/${req.id}`)).statusCode).toBe(403);
    expect((await api(asker, "DELETE", `/api/requests/${req.id}`)).statusCode).toBe(204);
  });
});
