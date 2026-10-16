import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "../lib/settings";
import { LookupCard } from "./LookupCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Reply = { status?: number; body: unknown };

describe("dictionary card", () => {
  let container: HTMLDivElement;
  let root: Root;
  let requests: URL[];

  /** Answers /api/dictionary/word with `reply(url)`; other requests (settings) succeed empty. */
  function server(reply: (url: URL) => Reply) {
    requests = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname !== "/api/dictionary/word") return Response.json({});
      requests.push(url);
      const r = reply(url);
      return Response.json(r.body, { status: r.status ?? 200 });
    });
  }

  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

  async function open(word: string, bookLanguage: string | null = "en") {
    await act(async () =>
      root.render(
        <SettingsProvider enabled={false}>
          <LookupCard mode="dictionary" text={word} bookLanguage={bookLanguage} rect={new DOMRect(100, 100, 40, 20)} onClose={() => {}} />
        </SettingsProvider>,
      ),
    );
    await flush();
  }

  const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;

  beforeEach(() => {
    localStorage.setItem("readsync.settings", JSON.stringify({ dictionaryTo: "pt" }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  const word = (over: Record<string, unknown> = {}) => ({
    word: "burro",
    from: "it",
    alternatives: ["es", "pt"],
    to: "pt",
    translation: "manteiga",
    entries: [{ partOfSpeech: "Noun", definitions: ["butter"] }],
    source: "Wiktionary (CC BY-SA) · MyMemory",
    url: "https://en.wiktionary.org/wiki/burro",
    ...over,
  });

  it("shows the word's language, its translation and its definitions", async () => {
    server(() => ({ body: word() }));
    await open("burro", "it");
    expect(requests[0]!.search).toBe("?word=burro&to=pt&lang=it");
    const text = container.textContent!;
    expect(text).toContain("burro");
    expect(text).toContain("Italiano");
    expect(text).toContain("manteiga");
    expect(text).toContain("butter");
    expect(container.querySelector("a")!.href).toBe("https://en.wiktionary.org/wiki/burro");
  });

  it("looks the word up again in another of its languages", async () => {
    server((url) => ({ body: url.searchParams.get("from") === "es" ? word({ from: "es", alternatives: ["it", "pt"], translation: "burro (animal)" }) : word() }));
    await open("burro", "it");
    await act(async () => button("Español").click());
    await flush();
    expect(requests.at(-1)!.searchParams.get("from")).toBe("es");
    expect(container.textContent).toContain("burro (animal)");
  });

  it("translates into the language the reader picks, and remembers it", async () => {
    server((url) => ({ body: word({ to: url.searchParams.get("to"), translation: url.searchParams.get("to") === "fr" ? "beurre" : "manteiga" }) }));
    await open("burro", "it");
    const select = container.querySelector<HTMLSelectElement>("select[aria-label='Translate into']")!;
    expect([...select.options].map((o) => o.value)).toEqual(["en", "es", "pt", "fr", "it"]);
    await act(async () => {
      select.value = "fr";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(requests.at(-1)!.searchParams.get("to")).toBe("fr");
    expect(container.textContent).toContain("beurre");
    expect(JSON.parse(localStorage.getItem("readsync.settings")!).dictionaryTo).toBe("fr");
  });

  it("says when the word already is in the chosen language", async () => {
    server(() => ({ body: word({ word: "casa", from: "pt", alternatives: [], translation: null, sameLanguage: true }) }));
    await open("casa", "pt");
    expect(container.textContent).toContain("already in Português");
  });

  it("says when the language could not be told and nothing was found", async () => {
    server(() => ({ body: word({ word: "xyzzy", from: null, alternatives: [], translation: null, entries: [], source: "", url: null }) }));
    await open("xyzzy");
    expect(container.textContent).toContain("No entry found for “xyzzy”");
  });

  it("explains when the dictionary is unavailable", async () => {
    server(() => ({ status: 503, body: { error: "unavailable" } }));
    await open("burro");
    expect(container.textContent).toContain("The dictionary is not available right now.");
  });
});
