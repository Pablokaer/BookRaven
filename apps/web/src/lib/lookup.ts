import { apiJson, ApiError } from "./api";

export type DictionaryResult = {
  word: string;
  language: string | null;
  entries: { partOfSpeech: string; definitions: string[] }[];
  source: string;
  url: string;
};

export type Translation = { text: string; from: string | null; to: string; source: string; sameLanguage?: boolean };

const base = (lang: string) => lang.split(/[-_]/)[0]!.toLowerCase();

/** Rejects when `p` takes longer than `ms` (browser AI APIs can hang without a model). */
function within<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/** Looks a word up (null when there is no entry). */
export async function define(word: string, lang: string | null): Promise<DictionaryResult | null> {
  const params = new URLSearchParams({ word });
  if (lang && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(lang)) params.set("lang", lang);
  try {
    return await apiJson<DictionaryResult>(`/api/dictionary?${params}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Chrome's built-in, on-device translator (no text leaves the device), when available. */
type OnDeviceTranslator = {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(text: string): Promise<string> }>;
};

async function translateOnDevice(text: string, from: string, to: string): Promise<Translation | null> {
  const T = (globalThis as unknown as { Translator?: OnDeviceTranslator }).Translator;
  if (!T) return null;
  const pair = { sourceLanguage: base(from), targetLanguage: base(to) };
  try {
    // Only use it when the language model is already on the device (never start a download here).
    if ((await within(T.availability(pair), 1500)) !== "available") return null;
    const translator = await within(T.create(pair), 3000);
    return { text: await within(translator.translate(text), 8000), from, to, source: "On-device (Chrome)" };
  } catch {
    return null;
  }
}

/** Translates on the device when possible, otherwise through the server's provider. */
export async function translate(text: string, from: string | null, to: string): Promise<Translation> {
  if (from && base(from) === base(to)) return { text, from, to, source: "", sameLanguage: true };
  if (from) {
    const local = await translateOnDevice(text, from, to);
    if (local) return local;
  }
  return apiJson<Translation>("/api/translate", { method: "POST", body: JSON.stringify(from ? { text, from, to } : { text, to }) });
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
