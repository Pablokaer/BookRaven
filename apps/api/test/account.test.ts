import { describe, expect, it } from "vitest";
import { outbox } from "../src/lib/mailer.js";
import { query } from "../src/db.js";
import { adminSession, api, fakePdf, getApp, ORIGIN, signUp, upload } from "./helpers.js";

async function signIn(email: string, password: string) {
  const a = await getApp();
  return a.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { email, password },
  });
}

describe("passwords", () => {
  it("changes the password", async () => {
    const u = await signUp();
    const res = await api(u, "POST", "/api/auth/change-password", { currentPassword: "password123", newPassword: "newpassword456" });
    expect(res.statusCode).toBe(200);
    expect((await signIn(u.email, "password123")).statusCode).toBe(401);
    expect((await signIn(u.email, "newpassword456")).statusCode).toBe(200);
  });

  it("resets a forgotten password with the emailed link", async () => {
    const u = await signUp();
    const a = await getApp();
    const req = await api(null, "POST", "/api/auth/request-password-reset", { email: u.email, redirectTo: `${ORIGIN}/reset-password` });
    expect(req.statusCode).toBe(200);

    const mail = outbox.findLast((m) => m.to === u.email && /reset/i.test(m.subject))!;
    expect(mail).toBeTruthy();
    expect(mail.html).toContain(mail.text.match(/https?:\/\/\S+/)![0].replace(/&/g, "&amp;"));
    const link = new URL(mail.text.match(/https?:\/\/\S+/)![0]);

    // The emailed link verifies the token and redirects to the app with it.
    const verify = await a.inject({ method: "GET", url: link.pathname + link.search });
    expect(verify.statusCode).toBe(302);
    const token = new URL(verify.headers.location as string).searchParams.get("token")!;
    expect(token).toBeTruthy();

    const reset = await api(null, "POST", "/api/auth/reset-password", { newPassword: "brandnew789", token });
    expect(reset.statusCode).toBe(200);
    expect((await signIn(u.email, "brandnew789")).statusCode).toBe(200);
    // Other sessions were signed out.
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(401);
    // A token works only once.
    expect((await api(null, "POST", "/api/auth/reset-password", { newPassword: "again12345", token })).statusCode).toBe(400);
  });

  it("sends a welcome email when an account is created, with the name escaped", async () => {
    const u = await signUp(undefined, "<b>Ana</b> & co");
    const mail = outbox.findLast((m) => m.to === u.email)!;
    expect(mail.subject).toMatch(/welcome/i);
    expect(mail.text).toContain("Hi <b>Ana</b> & co,");
    expect(mail.html).toContain("Hi &lt;b&gt;Ana&lt;/b&gt; &amp; co,");
    expect(mail.html).not.toContain("<b>Ana</b>");
  });

  it("does not reveal whether an email has an account", async () => {
    const res = await api(null, "POST", "/api/auth/request-password-reset", { email: "nobody@test.local", redirectTo: `${ORIGIN}/reset-password` });
    expect(res.statusCode).toBe(200);
  });
});

describe("deleting your own account", () => {
  it("asks for the password, then deletes the account and its books", async () => {
    const u = await signUp();
    const book = (await upload(u, "mine.pdf", fakePdf())).json();
    expect((await api(u, "DELETE", "/api/me", {})).statusCode).toBe(403);
    expect((await api(u, "DELETE", "/api/me", { password: "wrong-password" })).statusCode).toBe(403);
    expect((await api(u, "DELETE", "/api/me", { password: "password123" })).statusCode).toBe(204);

    expect((await query(`SELECT 1 FROM "user" WHERE id = $1`, [u.id])).rowCount).toBe(0);
    expect((await query("SELECT 1 FROM book WHERE id = $1", [book.id])).rowCount).toBe(0);
    // Its session went with it, and the email can sign up again.
    expect((await api(u, "GET", "/api/me")).statusCode).toBe(401);
    expect((await signIn(u.email, "password123")).statusCode).toBe(401);
    await expect(signUp(u.email)).resolves.toBeTruthy();
  });

  it("has an account without a password (Google) type its email", async () => {
    const u = await signUp();
    await query(`UPDATE account SET "providerId" = 'google', password = NULL WHERE "userId" = $1`, [u.id]);
    expect((await api(u, "DELETE", "/api/me", { confirm: "someone@else.example" })).statusCode).toBe(400);
    expect((await api(u, "DELETE", "/api/me", { confirm: u.email.toUpperCase() })).statusCode).toBe(204);
    expect((await query(`SELECT 1 FROM "user" WHERE id = $1`, [u.id])).rowCount).toBe(0);
  });

  it("refuses an administrator", async () => {
    const admin = await adminSession();
    expect((await api(admin, "DELETE", "/api/me", { password: "password123" })).json()).toEqual({ error: "cannot_delete_admin" });
  });
});
