import { config } from "../config.js";

/**
 * Dictionary and translation lookups for selected text. They go through the server
 * (not straight from the browser) so providers can be swapped or turned off in one
 * place, and API keys never reach clients.
 */

export class LookupUnavailableError extends Error {}

const UA = "BookRaven/1.0 (self-hosted ebook reader)"; // header values must be ASCII
const TIMEOUT = 8000;

/** Small in-memory cache: the same words get looked up again and again. */
const cache = new Map<string, unknown>();
function remember<T>(key: string, value: T): T {
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

export type Definition = { partOfSpeech: string; definitions: string[] };
export type DictionaryResult = { word: string; language: string | null; entries: Definition[]; source: string; url: string };

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

type WiktionaryResponse = Record<string, { partOfSpeech: string; language: string; definitions: { definition: string }[] }[]>;

/** Picks the entries for the book's language (falls back to English, then anything). */
export function parseWiktionary(word: string, data: WiktionaryResponse, lang: string | null): DictionaryResult | null {
  const code = lang?.toLowerCase().split(/[-_]/)[0] ?? null;
  const key = (code && data[code] ? code : null) ?? (data.en ? "en" : Object.keys(data).find((k) => k !== "other"));
  const list = key ? data[key] : undefined;
  if (!list?.length) return null;
  const entries = list
    .map((e) => ({ partOfSpeech: e.partOfSpeech, definitions: e.definitions.map((d) => stripHtml(d.definition)).filter(Boolean).slice(0, 5) }))
    .filter((e) => e.definitions.length)
    .slice(0, 4);
  if (!entries.length) return null;
  return {
    word,
    language: list[0]!.language ?? null,
    entries,
    source: "Wiktionary (CC BY-SA)",
    url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
  };
}

export async function define(word: string, lang: string | null): Promise<DictionaryResult | null> {
  if (config.dictionaryProvider === "none") throw new LookupUnavailableError();
  const key = `dict:${lang}:${word.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key) as DictionaryResult | null;
  // Try the word as written, then lower-case (sentence-initial capitals).
  for (const w of [...new Set([word, word.toLowerCase()])]) {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new LookupUnavailableError();
    const parsed = parseWiktionary(w, (await res.json()) as WiktionaryResponse, lang);
    if (parsed) return remember(key, parsed);
  }
  return remember(key, null);
}

/** `sameLanguage`: the text already is in the target language (nothing to translate). */
export type Translation = { text: string; from: string | null; to: string; source: string; sameLanguage?: boolean };

export async function translate(text: string, from: string | null, to: string): Promise<Translation> {
  const provider = config.translateProvider;
  if (provider === "none") throw new LookupUnavailableError();
  const src = from?.split(/[-_]/)[0]?.toLowerCase() || null;
  const key = `tr:${provider}:${src}:${to}:${text}`;
  if (cache.has(key)) return cache.get(key) as Translation;

  if (provider === "libretranslate") {
    const res = await fetch(`${config.libreTranslate.url.replace(/\/$/, "")}/translate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: text, source: src ?? "auto", target: to.split("-")[0], format: "text", api_key: config.libreTranslate.apiKey || undefined }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new LookupUnavailableError();
    const body = (await res.json()) as { translatedText: string; detectedLanguage?: { language: string } };
    return remember(key, { text: body.translatedText, from: src ?? body.detectedLanguage?.language ?? null, to, source: "LibreTranslate" });
  }

  // MyMemory: free, no key (an email raises the daily limit); detects the source when unknown.
  const params = new URLSearchParams({ q: text, langpair: `${src ?? "autodetect"}|${to}` });
  if (config.myMemoryEmail) params.set("de", config.myMemoryEmail);
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new LookupUnavailableError();
  const body = (await res.json()) as {
    responseStatus: number | string;
    responseDetails?: string;
    responseData: { translatedText: string; detectedLanguage?: string };
  };
  if (/DISTINCT LANGUAGES/i.test(body.responseDetails ?? "")) return { text, from: src, to, source: "MyMemory", sameLanguage: true };
  if (Number(body.responseStatus) !== 200) throw new LookupUnavailableError();
  return remember(key, { text: body.responseData.translatedText, from: src ?? body.responseData.detectedLanguage ?? null, to, source: "MyMemory" });
}
