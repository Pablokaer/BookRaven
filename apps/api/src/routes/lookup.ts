import type { FastifyInstance, FastifyReply } from "fastify";
import { requireUser } from "../auth.js";
import { obj } from "../lib/http.js";
import { define, LookupUnavailableError, lookupWord, translate } from "../lib/lookup.js";
import { WORD_LANGUAGES, type WordLanguage } from "../lib/wordLanguage.js";

const LANG = { type: "string", pattern: "^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$" } as const;
const WORD_LANG = { type: "string", enum: [...WORD_LANGUAGES] } as const;

/** The word without surrounding punctuation ("Chaton," → "Chaton"). */
const cleanWord = (word: string) => word.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Runs a lookup, answering 503 when the dictionary or translation service can't be reached. */
async function orUnavailable<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LookupUnavailableError || (err as Error).name === "TimeoutError") {
      // Without a message the provider is simply turned off: nothing went wrong.
      if ((err as Error).message) reply.log.warn({ err }, "lookup service unavailable");
      return reply.code(503).send({ error: "unavailable" });
    }
    throw err;
  }
}

export async function lookupRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Querystring: { word: string; lang?: string } }>(
    "/api/dictionary",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: { querystring: { type: "object", required: ["word"], properties: { word: { type: "string", minLength: 1, maxLength: 60 }, lang: LANG } } },
    },
    async (request, reply) => {
      const word = cleanWord(request.query.word);
      if (!word) return reply.code(400).send({ error: "invalid_word" });
      return orUnavailable(reply, async () => (await define(word, request.query.lang ?? null)) ?? reply.code(404).send({ error: "not_found" }));
    },
  );

  // A single word: the language it is in, its translation and its definitions.
  app.get<{ Querystring: { word: string; to: WordLanguage; from?: WordLanguage; lang?: string } }>(
    "/api/dictionary/word",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        querystring: {
          type: "object",
          required: ["word", "to"],
          properties: { word: { type: "string", minLength: 1, maxLength: 60 }, to: WORD_LANG, from: WORD_LANG, lang: LANG },
        },
      },
    },
    async (request, reply) => {
      const word = cleanWord(request.query.word);
      if (!word || /\s/.test(word)) return reply.code(400).send({ error: "invalid_word" });
      return orUnavailable(reply, () => lookupWord(word, { to: request.query.to, from: request.query.from, book: request.query.lang ?? null }));
    },
  );

  app.post<{ Body: { text: string; from?: string; to: string } }>(
    "/api/translate",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: obj({ text: { type: "string", minLength: 1, maxLength: 1000 }, from: LANG, to: LANG }, ["text", "to"]),
      },
    },
    async (request, reply) => {
      return orUnavailable(reply, () => translate(request.body.text.trim(), request.body.from ?? null, request.body.to));
    },
  );
}
