import Fastify from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { redactUrl, RequestLogController, serializers } from "../src/lib/log.js";

describe("log redaction", () => {
  it("hides the keys of share, invite and email links", () => {
    expect(redactUrl("/api/shares/abc123/cover")).toBe("/api/shares/[redacted]/cover");
    expect(redactUrl("/api/collection-shares/abc123/books/42/cover")).toBe("/api/collection-shares/[redacted]/books/42/cover");
    expect(redactUrl("/api/clubs/invite/abc123/join")).toBe("/api/clubs/invite/[redacted]/join");
    expect(redactUrl("/api/auth/reset-password/abc123?callbackURL=%2Freset")).toBe("/api/auth/reset-password/[redacted]?callbackURL=%2Freset");
    expect(redactUrl("/api/auth/verify-email?token=abc123&callbackURL=%2F")).toBe("/api/auth/verify-email?token=[redacted]&callbackURL=%2F");
  });

  it("leaves other URLs alone", () => {
    expect(redactUrl("/api/books/42/file")).toBe("/api/books/42/file");
    expect(redactUrl("/api/shares")).toBe("/api/shares");
  });
});

describe("request log lines", () => {
  async function logsOf(inject: { url: string; headers?: Record<string, string> }) {
    const lines: { level: number; msg: string; req?: { url: string } }[] = [];
    const app = Fastify({
      loggerInstance: pino({ level: "info", serializers }, { write: (line: string) => lines.push(JSON.parse(line)) }),
      logController: new RequestLogController(),
    });
    app.get("/api/health", async () => ({ ok: true }));
    app.get("/api/shares/:token", async () => ({ ok: true }));
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

  it("keeps health checks and range requests out of the info log", async () => {
    expect(await logsOf({ url: "/api/health" })).toEqual([]);
    expect(await logsOf({ url: "/api/shares/x", headers: { range: "bytes=0-99" } })).toEqual([]);
  });

  it("still logs errors of routine requests", async () => {
    const lines = await logsOf({ url: "/api/fail", headers: { range: "bytes=0-99" } });
    expect(lines.some((l) => l.level === 50)).toBe(true);
  });
});
