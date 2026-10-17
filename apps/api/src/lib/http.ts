import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { query } from "../db.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Share links and invites. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * The first row of `sql`, or null after answering 404 not_found. `valid` false (a malformed
 * id or token) answers 404 without querying.
 */
export async function findOr404<T extends pg.QueryResultRow>(reply: FastifyReply, valid: boolean, sql: string, params: unknown[]) {
  const row = valid ? (await query<T>(sql, params)).rows[0] : undefined;
  if (row) return row;
  reply.code(404).send({ error: "not_found" });
  return null;
}

/**
 * onSend hook that lets the apps revalidate API answers: a GET answered 200 with JSON gets a weak
 * ETag (a hash of the body) and, unless the route chose another, "private, no-cache" (the browser
 * keeps its copy but asks each time). When If-None-Match has that ETag, the answer is a 304 with
 * no body. Better Auth's answers and the event stream are left alone; OPDS feeds aren't JSON.
 */
export async function jsonEtag(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
  const route = request.routeOptions.url ?? "";
  if (request.method !== "GET" || reply.statusCode !== 200 || typeof payload !== "string" || reply.hasHeader("etag")) return payload;
  if (!route.startsWith("/api/") || route.startsWith("/api/auth/") || route === "/api/events") return payload;
  if (!String(reply.getHeader("content-type")).startsWith("application/json")) return payload;

  const tag = `"${createHash("sha1").update(payload).digest("base64url")}"`;
  reply.header("ETag", `W/${tag}`);
  if (!reply.hasHeader("cache-control")) reply.header("Cache-Control", "private, no-cache");
  const match = request.headers["if-none-match"]?.split(",").some((t) => t.trim().replace(/^W\//, "") === tag);
  if (!match) return payload;
  reply.code(304).removeHeader("content-type");
  return null;
}

/** JSON schema of an object that refuses unknown properties. */
export const obj = (properties: Record<string, unknown>, required?: string[], extra: Record<string, unknown> = {}) => ({
  type: "object",
  additionalProperties: false,
  ...(required && { required }),
  properties,
  ...extra,
});
