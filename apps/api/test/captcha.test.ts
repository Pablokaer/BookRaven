import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Turnstile on, for this file only (config.ts reads the keys once, when it is first imported).
vi.hoisted(() => {
  process.env.TURNSTILE_SITE_KEY = "test-site-key";
  process.env.TURNSTILE_SECRET_KEY = "test-secret-key";
});

const { api, getApp, ORIGIN } = await import("./helpers.js");

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const realFetch = globalThis.fetch;
const verified: string[] = [];

beforeAll(() => {
  // Cloudflare's answer: the token "good" passes, any other fails.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input) !== SITEVERIFY) return realFetch(input, init);
    const body = JSON.parse(String(init?.body));
    verified.push(body.response);
    return Response.json({ success: body.secret === "test-secret-key" && body.response === "good", hostname: "localhost" });
  });
});
afterAll(() => vi.restoreAllMocks());

async function signUpWith(token: string | null) {
  const a = await getApp();
  return a.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN, "content-type": "application/json", ...(token ? { "x-captcha-response": token } : {}) },
    payload: { email: `c${randomBytes(4).toString("hex")}@test.local`, password: "password123", name: "Captcha" },
  });
}

describe("Cloudflare Turnstile", () => {
  it("gives the app the site key, never the secret", async () => {
    const cfg = (await api(null, "GET", "/api/config")).json();
    expect(cfg.turnstileSiteKey).toBe("test-site-key");
    expect(JSON.stringify(cfg)).not.toContain("test-secret-key");
  });

  it("refuses a sign-up without a token or with a bad one", async () => {
    expect((await signUpWith(null)).statusCode).toBe(400);
    expect((await signUpWith("bad")).statusCode).toBe(403);
  });

  it("takes a sign-up whose token Cloudflare accepts", async () => {
    expect((await signUpWith("good")).statusCode).toBe(200);
    expect(verified).toContain("good");
  });

  it("guards the password reset too, not signing in", async () => {
    const reset = await api(null, "POST", "/api/auth/request-password-reset", { email: "nobody@test.local", redirectTo: `${ORIGIN}/reset-password` });
    expect(reset.statusCode).toBe(400);
    const signIn = await api(null, "POST", "/api/auth/sign-in/email", { email: "nobody@test.local", password: "password123" });
    expect(signIn.statusCode).toBe(401);
  });
});
