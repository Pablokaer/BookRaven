import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import { define, LookupUnavailableError, translate } from "../lib/lookup.js";

const LANG = { type: "string", pattern: "^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$" } as const;

export async function lookupRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Querystring: { word: string; lang?: string } }>(
    "/api/dictionary",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: { querystring: { type: "object", required: ["word"], properties: { word: { type: "string", minLength: 1, maxLength: 60 }, lang: LANG } } },
    },
    async (request, reply) => {
      const word = request.query.word.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!word) return reply.code(400).send({ error: "invalid_word" });
      try {
        const result = await define(word, request.query.lang ?? null);
        return result ?? reply.code(404).send({ error: "not_found" });
      } catch (err) {
        if (err instanceof LookupUnavailableError || (err as Error).name === "TimeoutError") return reply.code(503).send({ error: "unavailable" });
        throw err;
      }
    },
  );

  app.post<{ Body: { text: string; from?: string; to: string } }>(
    "/api/translate",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["text", "to"],
          additionalProperties: false,
          properties: { text: { type: "string", minLength: 1, maxLength: 1000 }, from: LANG, to: LANG },
        },
      },
    },
    async (request, reply) => {
      try {
        return await translate(request.body.text.trim(), request.body.from ?? null, request.body.to);
      } catch (err) {
        if (err instanceof LookupUnavailableError || (err as Error).name === "TimeoutError") return reply.code(503).send({ error: "unavailable" });
        throw err;
      }
    },
  );
}
