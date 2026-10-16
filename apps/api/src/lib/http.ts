import type { FastifyReply } from "fastify";
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

/** JSON schema of an object that refuses unknown properties. */
export const obj = (properties: Record<string, unknown>, required?: string[], extra: Record<string, unknown> = {}) => ({
  type: "object",
  additionalProperties: false,
  ...(required && { required }),
  properties,
  ...extra,
});
