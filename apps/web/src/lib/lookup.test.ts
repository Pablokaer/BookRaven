import { afterEach, describe, expect, it, vi } from "vitest";
import { dictionaryTarget, lookupWord, translate, WORD_LANGUAGES } from "./lookup";

describe("word dictionary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers English, Spanish, Portuguese, French and Italian", () => {
    expect(WORD_LANGUAGES.map(([code]) => code)).toEqual(["en", "es", "pt", "fr", "it"]);
  });

  it("translates into the reader's translation language when the dictionary has it", () => {
    expect(dictionaryTarget("pt-BR")).toBe("pt");
    expect(dictionaryTarget("es-419")).toBe("es");
    expect(dictionaryTarget("fr")).toBe("fr");
    expect(dictionaryTarget("de")).toBe("en");
    expect(dictionaryTarget("")).toBe("en");
  });

  it("asks the server about the word, with the book's language as a hint", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return Response.json({ word: "chaton", from: "fr", alternatives: [], to: "pt", translation: "gatinho", entries: [], source: "MyMemory", url: null });
    });
    expect((await lookupWord("Chaton", { to: "pt", book: "en-GB" })).translation).toBe("gatinho");
    await lookupWord("burro", { to: "en", book: "not a language", from: "es" });
    expect(urls).toEqual(["/api/dictionary/word?word=Chaton&to=pt&lang=en-GB", "/api/dictionary/word?word=burro&to=en&from=es"]);
  });
});

describe("passage translation", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Records what is sent to the server, which answers with `reply`. */
  function server(reply: unknown) {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json(reply);
    });
    return bodies;
  }

  /** Chrome's on-device language detector and translator. */
  function onDevice(detected: { detectedLanguage: string; confidence: number }[]) {
    const pairs: string[] = [];
    vi.stubGlobal("LanguageDetector", {
      availability: async () => "available",
      create: async () => ({ detect: async () => detected }),
    });
    vi.stubGlobal("Translator", {
      availability: async () => "available",
      create: async ({ sourceLanguage, targetLanguage }: { sourceLanguage: string; targetLanguage: string }) => {
        pairs.push(`${sourceLanguage}|${targetLanguage}`);
        return { translate: async () => "the boy ate an apple" };
      },
    });
    return pairs;
  }

  const spanish = "el niño comió una manzana junto a la ventana";

  it("lets the server detect the passage's language instead of assuming the book's", async () => {
    const bodies = server({ text: "o menino comeu uma maçã na janela", from: "es", to: "pt-BR", source: "MyMemory" });
    expect(await translate(spanish, "pt-BR")).toMatchObject({ text: "o menino comeu uma maçã na janela", from: "es" });
    expect(bodies).toEqual([{ text: spanish, to: "pt-BR" }]);
  });

  it("translates on the device, from the language the device detects", async () => {
    const bodies = server({});
    const pairs = onDevice([{ detectedLanguage: "es", confidence: 0.97 }]);
    expect(await translate(spanish, "en")).toMatchObject({ text: "the boy ate an apple", from: "es", to: "en", source: "On-device (Chrome)" });
    expect(pairs).toEqual(["es|en"]);
    expect(bodies).toEqual([]);
  });

  it("says on the device when the passage already is in the target language", async () => {
    const bodies = server({});
    onDevice([{ detectedLanguage: "pt", confidence: 0.9 }]);
    expect(await translate("o menino comeu uma maçã", "pt-BR")).toMatchObject({ sameLanguage: true, from: "pt" });
    expect(bodies).toEqual([]);
  });

  it("asks the server when the device isn't sure of the language", async () => {
    const bodies = server({ text: "the boy ate an apple", from: "es", to: "en", source: "MyMemory" });
    const pairs = onDevice([{ detectedLanguage: "es", confidence: 0.3 }]);
    expect((await translate(spanish, "en")).source).toBe("MyMemory");
    expect(pairs).toEqual([]);
    expect(bodies).toEqual([{ text: spanish, to: "en" }]);
  });
});
