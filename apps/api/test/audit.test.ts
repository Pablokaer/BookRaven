import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, log } from "../src/lib/log.js";
import { outbox } from "../src/lib/mailer.js";
import { adminSession, api, getApp, ORIGIN, signUp } from "./helpers.js";

type Line = { level: "info" | "warn"; event: string; [field: string]: unknown };
let lines: Line[] = [];

beforeEach(() => {
  lines = [];
  for (const level of ["info", "warn"] as const) {
    vi.spyOn(auditLog, level).mockImplementation(((obj: { event: string }) => {
      lines.push({ level, ...obj });
    }) as never);
  }
});
afterEach(() => vi.restoreAllMocks());

const find = (event: string) => lines.find((l) => l.event === event);

/** Signs in from behind a proxy chain: the client wrote 6.6.6.6 itself, 5.6.7.8 is the real address. */
async function signInVia(email: string, password: string) {
  const app = await getApp();
  return app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "6.6.6.6, 5.6.7.8" },
    payload: { email, password },
  });
}

describe("audit trail", () => {
  it("records new accounts, sign-ins and failed sign-ins", async () => {
    const u = await signUp();
    expect(find("auth.account_created")).toMatchObject({ level: "info", userId: u.id });
    expect(find("auth.signed_in")).toMatchObject({ level: "info", userId: u.id });

    const wrong = await api(null, "POST", "/api/auth/sign-in/email", { email: u.email, password: "not-the-password" });
    expect(wrong.statusCode).toBe(401);
    expect(find("auth.sign_in_failed")).toMatchObject({ level: "warn", status: 401 });
    // The trail never holds what was typed.
    expect(JSON.stringify(lines)).not.toContain("not-the-password");
  });

  it("records the client's address, not one it wrote into X-Forwarded-For", async () => {
    const u = await signUp();
    lines = [];
    expect((await signInVia(u.email, "not-the-password")).statusCode).toBe(401);
    expect((await signInVia(u.email, "password123")).statusCode).toBe(200);
    expect(find("auth.sign_in_failed")).toMatchObject({ ip: "5.6.7.8" });
    expect(find("auth.signed_in")).toMatchObject({ userId: u.id, ip: "5.6.7.8" });
  });

  it("records password changes with the account, and not as a sign-in", async () => {
    const u = await signUp();
    lines = [];
    const wrong = await api(u, "POST", "/api/auth/change-password", { currentPassword: "not-it-at-all", newPassword: "password456" });
    expect(wrong.statusCode).toBe(400);
    expect(find("auth.password_change_failed")).toMatchObject({ level: "warn", userId: u.id, status: 400 });

    // The profile page signs the other sessions out, which gives this one a new session.
    const res = await api(u, "POST", "/api/auth/change-password", { currentPassword: "password123", newPassword: "password456", revokeOtherSessions: true });
    expect(res.statusCode).toBe(200);
    expect(find("auth.password_changed")).toMatchObject({ level: "info", userId: u.id });
    expect(find("auth.signed_in")).toBeUndefined();
  });

  it("records password resets with the account", async () => {
    const u = await signUp();
    const a = await getApp();
    await api(null, "POST", "/api/auth/request-password-reset", { email: u.email, redirectTo: `${ORIGIN}/reset-password` });
    const link = new URL(outbox.findLast((m) => m.to === u.email && /reset/i.test(m.subject))!.text.match(/https?:\/\/\S+/)![0]);
    const verify = await a.inject({ method: "GET", url: link.pathname + link.search });
    const token = new URL(verify.headers.location as string).searchParams.get("token")!;

    expect((await api(null, "POST", "/api/auth/reset-password", { newPassword: "brandnew789", token })).statusCode).toBe(200);
    expect(find("auth.password_reset")).toMatchObject({ level: "info", userId: u.id });
    expect((await api(null, "POST", "/api/auth/reset-password", { newPassword: "again12345", token })).statusCode).toBe(400);
    expect(find("auth.password_reset_failed")).toMatchObject({ level: "warn", status: 400 });
  });

  it("records administrators' actions with who did them", async () => {
    const admin = await adminSession();
    const u = await signUp();
    expect((await api(admin, "PATCH", `/api/admin/users/${u.id}`, { blocked: true })).statusCode).toBe(204);
    expect(find("admin.user_updated")).toMatchObject({ adminId: admin.id, userId: u.id, blocked: true });

    // The right password of a blocked account is not a failed sign-in.
    const blocked = await api(null, "POST", "/api/auth/sign-in/email", { email: u.email, password: "password123" });
    expect(blocked.statusCode).toBe(403);
    expect(find("auth.blocked_sign_in")).toMatchObject({ level: "warn", userId: u.id });
    expect(find("auth.sign_in_failed")).toBeUndefined();

    expect((await api(admin, "POST", `/api/admin/users/${u.id}/reset-password`)).statusCode).toBe(200);
    expect(find("admin.password_reset")).toMatchObject({ adminId: admin.id, userId: u.id });
    expect((await api(admin, "DELETE", `/api/admin/users/${u.id}`)).statusCode).toBe(204);
    expect(find("admin.user_deleted")).toMatchObject({ adminId: admin.id, userId: u.id, email: u.email, books: 0 });
  });

  it("records app passwords and wrong app-password logins, not readers asking for the challenge", async () => {
    const u = await signUp();
    const { id } = (await api(u, "POST", "/api/app-passwords", { name: "Kobo" })).json();
    expect(find("app_password.created")).toMatchObject({ userId: u.id, appPasswordId: id });

    const app = await getApp();
    expect((await app.inject({ method: "GET", url: "/opds" })).statusCode).toBe(401);
    expect(find("app_password.auth_failed")).toBeUndefined();
    const basic = Buffer.from(`${u.email}:wrong`).toString("base64");
    expect((await app.inject({ method: "GET", url: "/opds", headers: { authorization: `Basic ${basic}` } })).statusCode).toBe(401);
    expect(find("app_password.auth_failed")).toMatchObject({ level: "warn", via: "opds" });

    expect((await api(u, "DELETE", `/api/app-passwords/${id}`)).statusCode).toBe(204);
    expect(find("app_password.revoked")).toMatchObject({ userId: u.id, appPasswordId: id });
  });

  it("tells a blocked account's app from a wrong app password", async () => {
    const admin = await adminSession();
    const u = await signUp();
    const { password } = (await api(u, "POST", "/api/app-passwords", { name: "Kobo" })).json();
    expect((await api(admin, "PATCH", `/api/admin/users/${u.id}`, { blocked: true })).statusCode).toBe(204);
    lines = [];

    const app = await getApp();
    const basic = Buffer.from(`${u.email}:${password}`).toString("base64");
    expect((await app.inject({ method: "GET", url: "/opds", headers: { authorization: `Basic ${basic}` } })).statusCode).toBe(401);
    expect(find("app_password.blocked_account")).toMatchObject({ level: "warn", via: "opds", userId: u.id });
    expect(find("app_password.auth_failed")).toBeUndefined();
  });
});

describe("Better Auth's messages", () => {
  it("never put the email typed at sign-up in the log", async () => {
    const spies = (["debug", "info", "warn", "error"] as const).map((level) => vi.spyOn(log, level));
    const u = await signUp();
    await api(null, "POST", "/api/auth/sign-up/email", { email: u.email, password: "password123", name: "Again" });
    // (Request lines reach the spies too, with the raw request; their serializer leaves the body out.)
    const messages = spies.flatMap((s) => s.mock.calls).map((args) => args.find((a) => typeof a === "string") ?? "");
    expect(messages.filter((m) => m.startsWith("[Better Auth]")).join("\n")).not.toContain(u.email);
  });
});
