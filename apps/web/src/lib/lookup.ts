import { apiJson } from "./api";

/** Languages the word dictionary tells apart and translates between. */
export const WORD_LANGUAGES = [
  ["en", "English"],
  ["es", "Español"],
  ["pt", "Português"],
  ["fr", "Français"],
  ["it", "Italiano"],
] as const;
export type WordLanguage = (typeof WORD_LANGUAGES)[number][0];

export const wordLanguageName = (code: WordLanguage) => WORD_LANGUAGES.find(([c]) => c === code)![1];

/** A selected word: the language it is in, its translation and its definitions. */
export type WordLookup = {
  word: string;
  /** null when no supported language could be told. */
  from: WordLanguage | null;
  /** Other languages the word exists in, to look it up in instead. */
  alternatives: WordLanguage[];
  to: WordLanguage;
  /** null when it already is in `to`, or there is no translation. */
  translation: string | null;
  sameLanguage?: boolean;
  entries: { partOfSpeech: string; definitions: string[] }[];
  source: string;
  url: string | null;
};

export type Translation = { text: string; from: string | null; to: string; source: string; sameLanguage?: boolean };

const base = (lang: string) => lang.split(/[-_]/)[0]!.toLowerCase();

/** Rejects when `p` takes longer than `ms` (browser AI APIs can hang without a model). */
function within<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

const LANG_CODE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/;

/** The dictionary's target for a translation language ("pt-BR" → "pt"); English when it has none. */
export function dictionaryTarget(translateTo: string): WordLanguage {
  const code = base(translateTo || "en");
  return WORD_LANGUAGES.some(([c]) => c === code) ? (code as WordLanguage) : "en";
}

/** `book`: the book's language, a hint for words that exist in several; `from`: the reader's pick. */
export function lookupWord(word: string, { to, book, from }: { to: WordLanguage; book: string | null; from?: WordLanguage }) {
  const params = new URLSearchParams({ word, to });
  if (from) params.set("from", from);
  else if (book && LANG_CODE.test(book)) params.set("lang", book);
  return apiJson<WordLookup>(`/api/dictionary/word?${params}`);
}

/** Chrome's built-in, on-device language detector and translator (no text leaves the device), when available. */
type OnDeviceDetector = {
  availability(): Promise<string>;
  create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]> }>;
};
type OnDeviceTranslator = {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(text: string): Promise<string> }>;
};

/** Below this the detector is guessing; the server's provider is asked instead. */
const MIN_CONFIDENCE = 0.7;

async function translateOnDevice(text: string, to: string): Promise<Translation | null> {
  const g = globalThis as unknown as { LanguageDetector?: OnDeviceDetector; Translator?: OnDeviceTranslator };
  if (!g.LanguageDetector || !g.Translator) return null;
  try {
    // Only use the models already on the device (never start a download here).
    if ((await within(g.LanguageDetector.availability(), 1500)) !== "available") return null;
    const detector = await within(g.LanguageDetector.create(), 3000);
    const best = (await within(detector.detect(text), 3000))[0];
    if (!best || best.confidence < MIN_CONFIDENCE || best.detectedLanguage === "und") return null;
    const from = base(best.detectedLanguage);
    if (from === base(to)) return { text, from, to, source: "", sameLanguage: true };
    const pair = { sourceLanguage: from, targetLanguage: base(to) };
    if ((await within(g.Translator.availability(pair), 1500)) !== "available") return null;
    const translator = await within(g.Translator.create(pair), 3000);
    return { text: await within(translator.translate(text), 8000), from, to, source: "On-device (Chrome)" };
  } catch {
    return null;
  }
}

/**
 * Translates on the device when possible, otherwise through the server's provider. The
 * passage's language is detected, not taken from the book: books quote other languages.
 */
export async function translate(text: string, to: string): Promise<Translation> {
  return (await translateOnDevice(text, to)) ?? apiJson<Translation>("/api/translate", { method: "POST", body: JSON.stringify({ text, to }) });
}

export const LANGUAGES: [string, string][] = [
  ["pt-BR", "Português (Brasil)"],
  ["pt-PT", "Português (Portugal)"],
  ["en", "English"],
  ["es", "Español"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["it", "Italiano"],
  ["nl", "Nederlands"],
  ["pl", "Polski"],
  ["ru", "Русский"],
  ["uk", "Українська"],
  ["tr", "Türkçe"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
  ["zh", "中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
];
