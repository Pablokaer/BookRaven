import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { query } from "../src/db.js";
import { isDisposableEmail, purgeUnverifiedAccounts } from "../src/lib/signups.js";
import { api, fakePdf, signUp, upload } from "./helpers.js";

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
