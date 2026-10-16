/**
 * Which language a single selected word is written in, among the languages the word
 * dictionary supports. Books mix languages (quotes, names, foreign expressions), so the
 * book's own language is only a tiebreaker.
 */

export const WORD_LANGUAGES = ["en", "es", "pt", "fr", "it"] as const;
export type WordLanguage = (typeof WORD_LANGUAGES)[number];

export const isWordLanguage = (code: string | null | undefined): code is WordLanguage =>
  !!code && (WORD_LANGUAGES as readonly string[]).includes(code);

/** Letters beyond a–z that each language's spelling uses. */
const ACCENTED: Record<WordLanguage, string> = {
  en: "",
  es: "áéíóúüñ",
  pt: "áàâãéêíóôõúüç",
  fr: "àâæçéèêëîïôœùûüÿ",
  it: "àèéìíîòóù",
};

/** The languages whose alphabet has every letter of `word` (all of them for plain a–z). */
export function spellingLanguages(word: string): WordLanguage[] {
  const letters = [...word.toLowerCase().normalize("NFC")].filter((c) => /\p{L}/u.test(c));
  return WORD_LANGUAGES.filter((lang) => letters.every((c) => (c >= "a" && c <= "z") || ACCENTED[lang].includes(c)));
}

const base = (lang: string | null) => lang?.toLowerCase().split(/[-_]/)[0] ?? null;

/**
 * `dictionary`: the languages the dictionary has the word in (Wiktionary's order: English
 * first). `language` is the best guess, `alternatives` the other plausible ones.
 */
export function detectWordLanguage(
  word: string,
  { dictionary, book }: { dictionary: string[]; book: string | null },
): { language: WordLanguage | null; alternatives: WordLanguage[] } {
  const spelled = spellingLanguages(word);
  const known = [...new Set(dictionary.filter(isWordLanguage))];
  const fitting = known.filter((l) => spelled.includes(l));
  const bookLang = base(book);

  let candidates: WordLanguage[] = fitting.length ? fitting : known;
  if (!candidates.length) {
    // No dictionary data: accented letters can still tell; plain words fall back to the book.
    candidates = spelled.length < WORD_LANGUAGES.length ? spelled : isWordLanguage(bookLang) ? [bookLang] : [];
  }
  const ranked = isWordLanguage(bookLang) && candidates.includes(bookLang) ? [bookLang, ...candidates.filter((l) => l !== bookLang)] : candidates;
  return { language: ranked[0] ?? null, alternatives: ranked.slice(1) };
}
