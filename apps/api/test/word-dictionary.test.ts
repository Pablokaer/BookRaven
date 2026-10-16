import { afterEach, describe, expect, it, vi } from "vitest";
import { detectWordLanguage, spellingLanguages } from "../src/lib/wordLanguage.js";
import { api, signUp } from "./helpers.js";

describe("spelling hints", () => {
  it("allows every language for plain letters", () => {
    expect(spellingLanguages("book")).toEqual(["en", "es", "pt", "fr", "it"]);
    expect(spellingLanguages("Don't")).toEqual(["en", "es", "pt", "fr", "it"]);
  });

  it("keeps only the languages whose alphabet has the word's accented letters", () => {
    expect(spellingLanguages("niño")).toEqual(["es"]);
    expect(spellingLanguages("coração")).toEqual(["pt"]);
    expect(spellingLanguages("maçã")).toEqual(["pt"]);
    expect(spellingLanguages("garçon")).toEqual(["pt", "fr"]);
    expect(spellingLanguages("cœur")).toEqual(["fr"]);
    expect(spellingLanguages("perché")).toEqual(["es", "pt", "fr", "it"]);
    expect(spellingLanguages("città")).toEqual(["pt", "fr", "it"]);
    expect(spellingLanguages("però")).toEqual(["it"]);
    expect(spellingLanguages("ÉTÉ")).toEqual(["es", "pt", "fr", "it"]);
  });

  it("returns nothing for letters none of them use", () => {
    expect(spellingLanguages("straße")).toEqual([]);
    expect(spellingLanguages("книга")).toEqual([]);
  });
});

describe("word language detection", () => {
  it("uses the only supported language the dictionary knows the word in", () => {
    expect(detectWordLanguage("livre", { dictionary: ["fr", "other"], book: "en" })).toEqual({ language: "fr", alternatives: [] });
    expect(detectWordLanguage("Buch", { dictionary: ["de", "en"], book: null })).toEqual({ language: "en", alternatives: [] });
  });

  it("prefers the book's language when the word exists in several", () => {
    expect(detectWordLanguage("casa", { dictionary: ["en", "es", "it", "pt"], book: "pt-BR" })).toEqual({
      language: "pt",
      alternatives: ["en", "es", "it"],
    });
  });

  it("otherwise keeps the dictionary's order (English first)", () => {
    expect(detectWordLanguage("son", { dictionary: ["en", "fr", "es"], book: "de" })).toEqual({ language: "en", alternatives: ["fr", "es"] });
  });

  it("drops dictionary languages the spelling rules out", () => {
    expect(detectWordLanguage("café", { dictionary: ["en", "fr", "pt", "es"], book: "en" })).toEqual({
      language: "fr",
      alternatives: ["pt", "es"],
    });
    expect(detectWordLanguage("niño", { dictionary: ["en", "es"], book: null })).toEqual({ language: "es", alternatives: [] });
  });

  it("falls back to spelling, then to the book's language, without dictionary data", () => {
    expect(detectWordLanguage("coração", { dictionary: [], book: "en" })).toEqual({ language: "pt", alternatives: [] });
    expect(detectWordLanguage("città", { dictionary: [], book: "it" })).toEqual({ language: "it", alternatives: ["pt", "fr"] });
    expect(detectWordLanguage("libro", { dictionary: [], book: "es-ES" })).toEqual({ language: "es", alternatives: [] });
  });

  it("gives up when nothing points to a supported language", () => {
    expect(detectWordLanguage("libro", { dictionary: [], book: "de" })).toEqual({ language: null, alternatives: [] });
    expect(detectWordLanguage("Haus", { dictionary: ["de"], book: null })).toEqual({ language: null, alternatives: [] });
  });
});

const realFetch = globalThis.fetch;

/**
 * Fakes Wiktionary and MyMemory. `pages` maps a word to its Wiktionary response;
 * `translations` maps "langpair:text" to the translation (and the language MyMemory detected).
 */
function fakeProviders(pages: Record<string, unknown>, translations: Record<string, string | { text: string; detected: string }>) {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.hostname === "en.wiktionary.org") {
      const word = decodeURIComponent(url.pathname.split("/").pop()!);
      return pages[word] ? Response.json(pages[word]) : new Response("{}", { status: 404 });
    }
    if (url.hostname === "api.mymemory.translated.net") {
      const found = translations[`${url.searchParams.get("langpair")}:${url.searchParams.get("q")}`];
      const t = typeof found === "string" ? { text: found } : found;
      return Response.json(
        t
          ? { responseStatus: 200, responseDetails: "", responseData: { translatedText: t.text, ...("detected" in t ? { detectedLanguage: t.detected } : {}) } }
          : { responseStatus: 403, responseData: { translatedText: "" } },
      );
    }
    return realFetch(input, init);
  });
  return calls;
}

describe("passage translation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("detects the passage's language", async () => {
    const u = await signUp();
    const text = "el niño comió una manzana";
    fakeProviders({}, { [`autodetect|en:${text}`]: { text: "the boy ate an apple", detected: "es" } });
    expect((await api(u, "POST", "/api/translate", { text, to: "en" })).json()).toEqual({ text: "the boy ate an apple", from: "es", to: "en", source: "MyMemory" });
  });

  it("says when the passage already is in the target language", async () => {
    const u = await signUp();
    const text = "a saudade mora no coração";
    fakeProviders({}, { [`autodetect|pt-BR:${text}`]: { text, detected: "pt" } });
    expect((await api(u, "POST", "/api/translate", { text, to: "pt-BR" })).json()).toMatchObject({ text, from: "pt", to: "pt-BR", sameLanguage: true });
  });
});

describe("word dictionary endpoint", () => {
  afterEach(() => vi.restoreAllMocks());

  const entry = (language: string, definition: string) => [{ partOfSpeech: "Noun", language, definitions: [{ definition }] }];

  it("detects the word's language and translates it into the chosen one", async () => {
    const u = await signUp();
    fakeProviders({ chaton: { fr: entry("French", "<i>kitten</i>") } }, { "fr|pt:chaton": "gatinho" });
    const res = await api(u, "GET", "/api/dictionary/word?word=Chaton%2C&to=pt&lang=en");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      word: "chaton",
      from: "fr",
      alternatives: [],
      to: "pt",
      translation: "gatinho",
      entries: [{ partOfSpeech: "Noun", definitions: ["kitten"] }],
      url: "https://en.wiktionary.org/wiki/chaton",
    });
  });

  it("lets the reader pick another of the word's languages", async () => {
    const u = await signUp();
    fakeProviders(
      { burro: { es: entry("Spanish", "donkey"), it: entry("Italian", "butter"), pt: entry("Portuguese", "donkey") } },
      { "it|en:burro": "butter", "es|en:burro": "donkey" },
    );
    const auto = (await api(u, "GET", "/api/dictionary/word?word=burro&to=en&lang=it")).json();
    expect(auto).toMatchObject({ from: "it", alternatives: ["es", "pt"], translation: "butter", entries: [{ definitions: ["butter"] }] });
    const chosen = (await api(u, "GET", "/api/dictionary/word?word=burro&to=en&lang=it&from=es")).json();
    expect(chosen).toMatchObject({ from: "es", alternatives: ["it", "pt"], translation: "donkey", entries: [{ definitions: ["donkey"] }] });
  });

  it("does not translate a word that already is in the chosen language", async () => {
    const u = await signUp();
    const calls = fakeProviders({ window: { en: entry("English", "an opening in a wall") } }, {});
    const res = (await api(u, "GET", "/api/dictionary/word?word=window&to=en")).json();
    expect(res).toMatchObject({ from: "en", to: "en", translation: null, sameLanguage: true });
    expect(calls.some((c) => c.includes("mymemory"))).toBe(false);
  });

  it("still detects and translates words the dictionary doesn't know", async () => {
    const u = await signUp();
    fakeProviders({}, { "pt|es:saudação": "saludo" });
    const res = (await api(u, "GET", "/api/dictionary/word?word=sauda%C3%A7%C3%A3o&to=es")).json();
    expect(res).toMatchObject({ from: "pt", translation: "saludo", entries: [] });
  });

  it("keeps the definitions when the translation fails", async () => {
    const u = await signUp();
    fakeProviders({ gatto: { it: entry("Italian", "cat") } }, {});
    const res = await api(u, "GET", "/api/dictionary/word?word=gatto&to=fr");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ from: "it", translation: null, entries: [{ definitions: ["cat"] }] });
  });

  it("validates its input", async () => {
    const u = await signUp();
    expect((await api(null, "GET", "/api/dictionary/word?word=book&to=pt")).statusCode).toBe(401);
    expect((await api(u, "GET", "/api/dictionary/word?word=book")).statusCode).toBe(400);
    expect((await api(u, "GET", "/api/dictionary/word?word=book&to=de")).statusCode).toBe(400);
    expect((await api(u, "GET", "/api/dictionary/word?word=book&to=pt&from=de")).statusCode).toBe(400);
    expect((await api(u, "GET", "/api/dictionary/word?word=%21%21&to=pt")).statusCode).toBe(400);
    expect((await api(u, "GET", "/api/dictionary/word?word=two%20words&to=pt")).statusCode).toBe(400);
  });
});
