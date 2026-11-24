import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { query } from "../src/db.js";
import { isDisposableEmail, purgeUnverifiedAccounts } from "../src/lib/signups.js";
import { adminSession, api, fakePdf, getApp, ORIGIN, signUp, upload } from "./helpers.js";

const id = () => randomBytes(6).toString("hex");

describe("throwaway email addresses", () => {
  it("knows the throwaway services and their subdomains, not ordinary providers", () => {
    expect(isDisposableEmail("someone@mailinator.com")).toBe(true);
    expect(isDisposableEmail("someone@MAILINATOR.com")).toBe(true);
    expect(isDisposableEmail("someone@inbox.mailinator.com")).toBe(true);
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
    expect(isDisposableEmail("someone@example.com")).toBe(false);
  });

  it("refuses a sign-up from a throwaway address", async () => {
    const res = await api(null, "POST", "/api/auth/sign-up/email", { email: `bot${id()}@mailinator.com`, password: "password123", name: "Bot" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("DISPOSABLE_EMAIL");
  });

  it("takes them when BLOCK_DISPOSABLE_EMAILS is false", async () => {
    config.blockDisposableEmails = false;
    try {
      await expect(signUp(`ok${id()}@mailinator.com`)).resolves.toBeTruthy();
    } finally {
      config.blockDisposableEmails = true;
    }
  });
});

describe("accounts that never confirmed their email", () => {
  afterEach(() => {
    config.requireEmailVerification = false;
  });

  /** An account as Better Auth makes it, created `daysAgo` days ago, without a session. */
  async function account(daysAgo: number, verified = false) {
    const uid = id();
    await query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Pending', $2, $3, now() - make_interval(days => $4), now())`,
      [uid, `pending${uid}@test.local`, verified, daysAgo],
    );
    return uid;
  }
  const exists = async (uid: string) => (await query(`SELECT 1 FROM "user" WHERE id = $1`, [uid])).rowCount === 1;

  it("deletes the old ones that never signed in, with verification required", async () => {
    const old = await account(8);
    const recent = await account(2);
    const verified = await account(30, true);
    // Never verified but used: it signed in before verification was required, and has a book.
    const used = await signUp();
    expect((await upload(used, "kept.pdf", fakePdf())).statusCode).toBe(201);
    await query(`UPDATE "user" SET "emailVerified" = false, "createdAt" = now() - interval '30 days' WHERE id = $1`, [used.id]);
    await query(`DELETE FROM session WHERE "userId" = $1`, [used.id]);

    expect(await purgeUnverifiedAccounts()).toBe(0); // verification not required: nothing goes
    expect(await exists(old)).toBe(true);

    config.requireEmailVerification = true;
    expect(await purgeUnverifiedAccounts()).toBeGreaterThanOrEqual(1);
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(verified)).toBe(true);
    expect(await exists(used.id)).toBe(true);
  });

  it("keeps an account with a session", async () => {
    const u = await signUp();
    await query(`UPDATE "user" SET "emailVerified" = false, "createdAt" = now() - interval '30 days' WHERE id = $1`, [u.id]);
    config.requireEmailVerification = true;
    await purgeUnverifiedAccounts();
    expect(await exists(u.id)).toBe(true);
  });
});

/** A sign-up from `ip` (as the client's address Fastify sees). */
async function signUpFrom(ip: string, email = `n${id()}@test.local`) {
  const a = await getApp();
  return a.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    remoteAddress: ip,
    headers: { origin: ORIGIN, "content-type": "application/json" },
    payload: { email, password: "password123", name: "Net" },
  });
}
const someIp = () => `198.18.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

describe("one person, many accounts", () => {
  afterEach(() => {
    config.signupsPerIpPerDay = 0;
    config.blockEmailAliases = true;
  });

  it("knows which addresses reach the same inbox", async () => {
    const key = async (e: string) => (await query<{ k: string }>(`SELECT email_key($1) AS k`, [e])).rows[0]!.k;
    expect(await key("F.U.Lano+books@GoogleMail.com")).toBe("fulano@gmail.com");
    expect(await key("fulano+x@outlook.com")).toBe("fulano@outlook.com");
    expect(await key("ful.ano+x@example.com")).toBe("ful.ano+x@example.com");
  });

  it("refuses another address of an existing account's inbox, not of a domain of its own", async () => {
    const name = `reader${id()}`;
    await signUp(`${name}@gmail.com`);
    const alias = await api(null, "POST", "/api/auth/sign-up/email", { email: `${name.slice(0, 3)}.${name.slice(3)}+2@gmail.com`, password: "password123", name: "Again" });
    expect(alias.statusCode).toBe(400);
    expect(alias.json().code).toBe("EMAIL_ALIAS");

    await signUp(`${name}@outlook.com`);
    const tagged = await api(null, "POST", "/api/auth/sign-up/email", { email: `${name}+books@outlook.com`, password: "password123", name: "Again" });
    expect(tagged.json().code).toBe("EMAIL_ALIAS");

    await signUp(`${name}@example.com`);
    await expect(signUp(`${name}+books@example.com`)).resolves.toBeTruthy();

    config.blockEmailAliases = false;
    await expect(signUp(`${name}+3@gmail.com`)).resolves.toBeTruthy();
  });

  it("limits the accounts made from one network in a day, an IPv6 /64 counting as one", async () => {
    config.signupsPerIpPerDay = 2;
    const ip = someIp();
    expect((await signUpFrom(ip)).statusCode).toBe(200);
    expect((await signUpFrom(ip)).statusCode).toBe(200);
    const third = await signUpFrom(ip);
    expect(third.statusCode).toBe(429);
    expect(third.json().code).toBe("SIGNUP_LIMIT");
    expect((await signUpFrom(someIp())).statusCode).toBe(200);

    const net = `2001:db8:${Math.floor(Math.random() * 65535).toString(16)}:1`;
    expect((await signUpFrom(`${net}::1`)).statusCode).toBe(200);
    expect((await signUpFrom(`${net}::abcd`)).statusCode).toBe(200);
    expect((await signUpFrom(`${net}:ffff::9`)).statusCode).toBe(429);

    config.signupsPerIpPerDay = 0;
    expect((await signUpFrom(ip)).statusCode).toBe(200);
  });

  it("shows administrators the accounts of the same network or inbox", async () => {
    const admin = await adminSession();
    const ip = someIp();
    const first = (await signUpFrom(ip)).json().user.id as string;
    const second = (await signUpFrom(ip)).json().user.id as string;
    // An address of the same inbox, made before the check existed.
    const name = `twin${id()}`;
    const original = await signUp(`${name}@gmail.com`);
    const twin = id();
    await query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, 'Twin', $2, false, now(), now())`, [twin, `${name}+old@gmail.com`]);

    const overview = (await api(admin, "GET", `/api/admin/users/${first}/overview`)).json();
    expect(overview.linkedAccounts).toEqual([expect.objectContaining({ id: second, sameNetwork: true, sameInbox: false })]);
    expect(overview.account.linkedAccounts).toBe(1);
    const inbox = (await api(admin, "GET", `/api/admin/users/${original.id}/overview`)).json();
    // (Test accounts all sign up from 127.0.0.1, so the network finds others too.)
    expect(inbox.linkedAccounts).toContainEqual(expect.objectContaining({ id: twin, sameInbox: true }));
  });
});
