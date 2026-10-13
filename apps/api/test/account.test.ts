import { describe, expect, it } from "vitest";
import { outbox } from "../src/lib/mailer.js";
import { api, getApp, ORIGIN, signUp } from "./helpers.js";

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

    const mail = outbox.findLast((m) => m.to === u.email)!;
    expect(mail.subject).toMatch(/reset/i);
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

  it("does not reveal whether an email has an account", async () => {
    const res = await api(null, "POST", "/api/auth/request-password-reset", { email: "nobody@test.local", redirectTo: `${ORIGIN}/reset-password` });
    expect(res.statusCode).toBe(200);
  });
});
