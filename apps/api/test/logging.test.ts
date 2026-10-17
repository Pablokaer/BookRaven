import Fastify from "fastify";
import { pino } from "pino";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { learnSecretRoute, redactUrl, RequestLogController, serializers } from "../src/lib/log.js";
import { getApp } from "./helpers.js";

describe("log redaction", () => {
  // Building the app teaches redactUrl every route with a :token.
  beforeAll(async () => {
    await getApp();
  });

  it("hides the keys of share, invite and email links", () => {
    expect(redactUrl("/api/shares/abc123/cover")).toBe("/api/shares/[redacted]/cover");
    expect(redactUrl("/api/collection-shares/abc123/books/42/cover")).toBe("/api/collection-shares/[redacted]/books/42/cover");
    expect(redactUrl("/api/clubs/invite/abc123/join")).toBe("/api/clubs/invite/[redacted]/join");
    expect(redactUrl("/api/auth/reset-password/abc123?callbackURL=%2Freset")).toBe("/api/auth/reset-password/[redacted]?callbackURL=%2Freset");
    expect(redactUrl("/api/auth/verify-email?token=abc123&callbackURL=%2F")).toBe("/api/auth/verify-email?token=[redacted]&callbackURL=%2F");
  });

  it("also hides them on paths no route matches", () => {
    expect(redactUrl("/api/shares/abc123/")).toBe("/api/shares/[redacted]/");
    expect(redactUrl("/api/clubs/invite/abc123/x")).toBe("/api/clubs/invite/[redacted]/x");
  });

  it("leaves other URLs alone", () => {
    expect(redactUrl("/api/books/42/file")).toBe("/api/books/42/file");
    expect(redactUrl("/api/shares")).toBe("/api/shares");
  });
});

describe("request log lines", () => {
  type LogLine = { level: number; msg: string; req?: { url: string }; res?: { statusCode: number } };

  async function logsOf(inject: { url: string; headers?: Record<string, string> }) {
    const lines: LogLine[] = [];
    const app = Fastify({
      loggerInstance: pino({ level: "info", serializers }, { write: (line: string) => lines.push(JSON.parse(line)) }),
      logController: new RequestLogController(),
    });
    app.addHook("onRoute", learnSecretRoute);
    app.get("/api/health", async () => ({ ok: true }));
    app.get("/api/shares/:token", async () => ({ ok: true }));
    app.get<{ Params: { id: string } }>("/api/books/:id/file", async (request, reply) =>
      request.params.id === "missing" ? reply.code(404).send({ error: "file_missing" }) : "bytes",
    );
    app.get("/api/fail", async () => {
      throw new Error("boom");
    });
    await app.inject(inject);
    await app.close();
    return lines;
  }

  it("logs requests with their keys hidden", async () => {
    const lines = await logsOf({ url: "/api/shares/secret-token" });
    expect(lines.map((l) => l.msg)).toEqual(["incoming request", "request completed"]);
    expect(lines[0]!.req!.url).toBe("/api/shares/[redacted]");
    expect(JSON.stringify(lines)).not.toContain("secret-token");
  });

  it("hides keys in the line about a path no route matches", async () => {
    const lines = await logsOf({ url: "/api/shares/secret-token/" });
    expect(lines.some((l) => /not found/.test(l.msg))).toBe(true);
    expect(JSON.stringify(lines)).not.toContain("secret-token");
  });

  it("keeps health checks and range requests for book files out of the info log", async () => {
    expect(await logsOf({ url: "/api/health" })).toEqual([]);
    expect(await logsOf({ url: "/api/books/42/file", headers: { range: "bytes=0-99" } })).toEqual([]);
  });

  it("logs range requests elsewhere as usual", async () => {
    const lines = await logsOf({ url: "/api/shares/x", headers: { range: "bytes=0-0" } });
    expect(lines.map((l) => l.msg)).toEqual(["incoming request", "request completed"]);
  });

  it("still logs errors of routine requests, with the request", async () => {
    expect((await logsOf({ url: "/api/fail", headers: { range: "bytes=0-99" } })).some((l) => l.level === 50)).toBe(true);
    const missing = await logsOf({ url: "/api/books/missing/file", headers: { range: "bytes=0-99" } });
    expect(missing).toMatchObject([{ level: 30, msg: "request completed", req: { url: "/api/books/missing/file" }, res: { statusCode: 404 } }]);
  });
});

/** Runs `fn` with fresh copies of the modules it imports, loaded with these environment variables. */
async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  vi.resetModules();
  try {
    return await fn();
  } finally {
    Object.assign(process.env, saved);
    vi.resetModules();
  }
}

describe("log levels", () => {
  it("takes an empty LOG_LEVEL as the default", async () => {
    const { log } = await withEnv({ LOG_LEVEL: "" }, () => import("../src/lib/log.js"));
    expect(log.level).toBe("debug"); // not production
  });

  it("keeps the audit trail when LOG_LEVEL only asks for problems", async () => {
    const { log, auditLog } = await withEnv({ LOG_LEVEL: "warn" }, () => import("../src/lib/log.js"));
    expect(log.isLevelEnabled("info")).toBe(false);
    expect(auditLog.isLevelEnabled("info")).toBe(true);
  });
});

describe("emails without SMTP in production", () => {
  it("log their subject, never their link or recipient", async () => {
    await withEnv({ NODE_ENV: "production" }, async () => {
      const { log } = await import("../src/lib/log.js");
      const { outbox, sendMailInBackground } = await import("../src/lib/mailer.js");
      const info = vi.spyOn(log, "info");
      sendMailInBackground({ to: "reader@example.com", subject: "Reset your password", text: "https://books.example.com/reset-password?token=secret-token" });
      await vi.waitFor(() => expect(info).toHaveBeenCalled());
      expect(JSON.stringify(info.mock.calls)).toContain("Reset your password");
      expect(JSON.stringify(info.mock.calls)).not.toMatch(/secret-token|reader@example\.com/);
      expect(outbox).toEqual([]);
    });
  });
});
