import { config } from "../config.js";
import { log } from "./log.js";
import { detectWordLanguage, isWordLanguage, type WordLanguage } from "./wordLanguage.js";

/**
 * Dictionary and translation lookups for selected text. They go through the server
 * (not straight from the browser) so providers can be swapped or turned off in one
 * place, and API keys never reach clients.
 */

export class LookupUnavailableError extends Error {}

const UA = "BookRaven/1.0 (self-hosted ebook reader)"; // header values must be ASCII
const TIMEOUT = 8000;

/**
 * Small in-memory cache, most recently used last: the same words get looked up again and again.
 * Only kept in memory (passages to translate come from people's own books).
 */
const cache = new Map<string, unknown>();
const MAX_CACHED = 2000;
function remember<T>(key: string, value: T): T {
  cache.delete(key); // moves it last
  cache.set(key, value);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return value;
}
/** The cached answer for `key`, or undefined. */
const recall = <T>(key: string) => (cache.has(key) ? remember(key, cache.get(key) as T) : undefined);

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

const wikiUrl = (word: string) => `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`;

type WiktionaryResponse = Record<string, { partOfSpeech: string; language: string; definitions: { definition: string }[] }[]>;
/** Per language code: its name and the definitions shown (a few per part of speech, without markup). */
type WiktionaryEntries = Record<string, { language: string | null; entries: Definition[] }>;

/** What is kept of Wiktionary's answer: every language it knows the word in, with only the entries shown. */
function trimWiktionary(data: WiktionaryResponse): WiktionaryEntries {
  const trim = (list: WiktionaryResponse[string]) => ({
    language: list[0]?.language ?? null,
    entries: list
      .map((e) => ({ partOfSpeech: e.partOfSpeech, definitions: (e.definitions ?? []).map((d) => stripHtml(d.definition)).filter(Boolean).slice(0, 5) }))
      .filter((e) => e.definitions.length)
      .slice(0, 4),
  });
  return Object.fromEntries(Object.entries(data).map(([code, list]) => [code, trim(Array.isArray(list) ? list : [])]));
}

/** Picks the entries for the book's language (falls back to English, then anything). */
function pickEntries(word: string, data: WiktionaryEntries, lang: string | null): DictionaryResult | null {
  const code = lang?.toLowerCase().split(/[-_]/)[0] ?? null;
  const key = (code && data[code] ? code : null) ?? (data.en ? "en" : Object.keys(data).find((k) => k !== "other"));
  const found = key ? data[key] : undefined;
  if (!found?.entries.length) return null;
  return {
    word,
    language: found.language,
    entries: found.entries,
    source: "Wiktionary (CC BY-SA)",
    url: wikiUrl(word),
  };
}

export const parseWiktionary = (word: string, data: WiktionaryResponse, lang: string | null) => pickEntries(word, trimWiktionary(data), lang);

/** Wiktionary's entries for `word` as written, else lower-case (sentence-initial capitals); null when it has none. */
async function wiktionary(word: string): Promise<{ word: string; data: WiktionaryEntries } | null> {
  const key = `wikt:${word}`;
  const cached = recall<{ word: string; data: WiktionaryEntries } | null>(key);
  if (cached !== undefined) return cached;
  for (const w of [...new Set([word, word.toLowerCase()])]) {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new LookupUnavailableError(`Wiktionary answered ${res.status}`);
    return remember(key, { word: w, data: trimWiktionary((await res.json()) as WiktionaryResponse) });
  }
  return remember(key, null);
}

export async function define(word: string, lang: string | null): Promise<DictionaryResult | null> {
  if (config.dictionaryProvider === "none") throw new LookupUnavailableError();
  const page = await wiktionary(word);
  return page ? pickEntries(page.word, page.data, lang) : null;
}

/** `sameLanguage`: the text already is in the target language (nothing to translate). */
export type Translation = { text: string; from: string | null; to: string; source: string; sameLanguage?: boolean };

export async function translate(text: string, from: string | null, to: string): Promise<Translation> {
  const provider = config.translateProvider;
  if (provider === "none") throw new LookupUnavailableError();
  const src = from?.split(/[-_]/)[0]?.toLowerCase() || null;
  const key = `tr:${provider}:${src}:${to}:${text}`;
  const cached = recall<Translation>(key);
  if (cached) return cached;

  if (provider === "libretranslate") {
    const res = await fetch(`${config.libreTranslate.url.replace(/\/$/, "")}/translate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: text, source: src ?? "auto", target: to.split("-")[0], format: "text", api_key: config.libreTranslate.apiKey || undefined }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new LookupUnavailableError(`LibreTranslate answered ${res.status}`);
    const body = (await res.json()) as { translatedText: string; detectedLanguage?: { language: string } };
    return remember(key, detected({ text: body.translatedText, from: src ?? body.detectedLanguage?.language ?? null, to, source: "LibreTranslate" }, text));
  }

  // MyMemory: free, no key (an email raises the daily limit); detects the source when unknown.
  const params = new URLSearchParams({ q: text, langpair: `${src ?? "autodetect"}|${to}` });
  if (config.myMemoryEmail) params.set("de", config.myMemoryEmail);
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new LookupUnavailableError(`MyMemory answered ${res.status}`);
  const body = (await res.json()) as {
    responseStatus: number | string;
    responseDetails?: string;
    responseData: { translatedText: string; detectedLanguage?: string };
  };
  if (/DISTINCT LANGUAGES/i.test(body.responseDetails ?? "")) return remember(key, { text, from: src, to, source: "MyMemory", sameLanguage: true });
  if (Number(body.responseStatus) !== 200) throw new LookupUnavailableError(`MyMemory answered ${body.responseStatus}: ${body.responseDetails ?? ""}`);
  return remember(key, detected({ text: body.responseData.translatedText, from: src ?? body.responseData.detectedLanguage ?? null, to, source: "MyMemory" }, text));
}

/** A passage detected to be in the target language already comes back as it was. */
function detected(tr: Translation, original: string): Translation {
  const lang = (code: string | null) => code?.split(/[-_]/)[0]?.toLowerCase();
  return lang(tr.from) === lang(tr.to) ? { ...tr, text: original, sameLanguage: true } : tr;
}

/** A selected word: the language it is in, its translation into `to` and its definitions. */
export type WordLookup = {
  word: string;
  /** null when no supported language could be told. */
  from: WordLanguage | null;
  /** Other languages the word exists in, for the reader to pick instead. */
  alternatives: WordLanguage[];
  to: WordLanguage;
  /** null when it is already in `to`, or the translation failed. */
  translation: string | null;
  sameLanguage?: boolean;
  entries: Definition[];
  source: string;
  url: string | null;
};

/**
 * `book`: the book's language (a tiebreaker); `from`: the language the reader chose. `complete` is
 * false when the dictionary or the translation failed, so the answer is worth asking for again.
 */
export async function lookupWord(
  word: string,
  { to, book, from: chosen }: { to: WordLanguage; book: string | null; from?: WordLanguage },
): Promise<{ lookup: WordLookup; complete: boolean }> {
  const canDefine = config.dictionaryProvider !== "none";
  const canTranslate = config.translateProvider !== "none";
  if (!canDefine && !canTranslate) throw new LookupUnavailableError();

  let complete = true;
  const page = canDefine
    ? await wiktionary(word).catch((err) => {
        log.warn({ err }, "dictionary lookup failed");
        complete = false;
        return null;
      })
    : null;
  const detected = detectWordLanguage(word, { dictionary: page ? Object.keys(page.data) : [], book });
  let from = chosen ?? detected.language;
  const alternatives = chosen ? [detected.language, ...detected.alternatives].filter((l): l is WordLanguage => !!l && l !== chosen) : detected.alternatives;
  const found = page?.word ?? word;
  // Only the chosen language's entries (define would fall back to English).
  const entries = (from && page?.data[from]?.entries) || [];
  const sources = entries.length ? ["Wiktionary (CC BY-SA)"] : [];

  let translation: string | null = null;
  let sameLanguage = from === to;
  if (!sameLanguage && canTranslate) {
    try {
      const tr = await translate(found, from, to);
      sameLanguage = !!tr.sameLanguage;
      if (sameLanguage) from = to;
      else {
        translation = tr.text;
        if (!from && isWordLanguage(tr.from)) from = tr.from;
        sources.push(tr.source);
      }
    } catch (err) {
      // The definitions are still worth showing.
      log.warn({ err }, "translation failed");
      complete = false;
    }
  }
  const lookup = {
    word: found,
    from,
    alternatives,
    to,
    translation,
    ...(sameLanguage ? { sameLanguage } : {}),
    entries,
    source: sources.join(" · "),
    url: entries.length ? wikiUrl(found) : null,
  };
  return { lookup, complete };
}
