/** Lowercase and strip accents, so "memorias" finds "Memórias" and "eca" finds "Eça". */
export function foldText(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** True when every word of the query appears somewhere in the text, in any order. */
export function matchesText(text: string, query: string) {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = foldText(text);
  return words.every((w) => haystack.includes(w));
}
