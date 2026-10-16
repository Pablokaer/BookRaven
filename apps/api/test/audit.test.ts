import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog } from "../src/lib/log.js";
import { adminSession, api, getApp, signUp } from "./helpers.js";

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

  it("records password changes", async () => {
    const u = await signUp();
    const res = await api(u, "POST", "/api/auth/change-password", { currentPassword: "password123", newPassword: "password456" });
    expect(res.statusCode).toBe(200);
    expect(find("auth.password_changed")).toMatchObject({ level: "info" });
  });

  it("records administrators' actions with who did them", async () => {
    const admin = await adminSession();
    const u = await signUp();
    expect((await api(admin, "PATCH", `/api/admin/users/${u.id}`, { blocked: true })).statusCode).toBe(204);
    expect(find("admin.user_updated")).toMatchObject({ adminId: admin.id, userId: u.id, blocked: true });

    const blocked = await api(null, "POST", "/api/auth/sign-in/email", { email: u.email, password: "password123" });
    expect(blocked.statusCode).toBe(403);
    expect(find("auth.blocked_sign_in")).toMatchObject({ level: "warn", userId: u.id });

    expect((await api(admin, "POST", `/api/admin/users/${u.id}/reset-password`)).statusCode).toBe(200);
    expect(find("admin.password_reset")).toMatchObject({ adminId: admin.id, userId: u.id });
    expect((await api(admin, "DELETE", `/api/admin/users/${u.id}`)).statusCode).toBe(204);
    expect(find("admin.user_deleted")).toMatchObject({ adminId: admin.id, userId: u.id, books: 0 });
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
});
