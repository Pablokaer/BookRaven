/**
 * Themes are the sections of the public library. Imported books get them from the
 * Library of Congress subjects and Gutenberg bookshelves; books people publish get
 * them from their tags.
 */
export const THEMES = [
  "philosophy",
  "politics",
  "economics",
  "technology",
  "computing",
  "science",
  "history",
  "literature",
  "poetry",
  "religion",
  "children",
] as const;
export type Theme = (typeof THEMES)[number];

const RULES: [Theme, RegExp][] = [
  ["philosophy", /philosoph|ethics|metaphysic|\blogic\b|stoic|existential|epistemolog|filosof/i],
  ["politics", /politic|government|democra|socialis|communis|anarchis|liberty|constitution|\bstate\b|revolution|politic|governo/i],
  ["economics", /econom|finance|money|capital|banking|wealth|commerce|\btrade\b|labor|labour|taxation|socialism/i],
  ["technology", /technolog|engineering|invention|inventors|mechanic|machinery|electric|industr|railroad|aeronaut|tecnolog/i],
  ["computing", /computer|computing|programming|software|cybernetic|informatics/i],
  ["science", /science|physics|chemistry|biology|astronom|mathemat|natural history|evolution|geology|botany|zoology|medicine|ciência/i],
  ["history", /histor|biograph|war,|world war|antiquit|civilization/i],
  ["literature", /fiction|novel|literature|short stories|drama|plays|romance|tales|contos|romances/i],
  ["poetry", /poetry|poems|verse|sonnet|epic poetry|poesia/i],
  ["religion", /religio|bible|christian|theolog|buddh|islam|church|sermon|catholic/i],
  ["children", /juvenile|children|fairy tales|nursery/i],
];

/** Themes matching a book's subjects, bookshelves or tags. */
export function themesFor(...texts: string[][]): Theme[] {
  const all = texts.flat().join(" | ");
  return RULES.filter(([, re]) => re.test(all)).map(([t]) => t);
}

/**
 * What the importer looks for, per language: themed searches first (most popular
 * first), then the most popular books overall until the language reaches its target.
 * Gutenberg has almost nothing on programming that is public domain everywhere, so
 * "computing" stays small.
 */
export const IMPORT_PLAN: { theme: Theme; topic: string; quota: Record<string, number> }[] = [
  { theme: "philosophy", topic: "philosophy", quota: { en: 60, pt: 40 } },
  { theme: "politics", topic: "politic", quota: { en: 50, pt: 40 } },
  { theme: "economics", topic: "econom", quota: { en: 40, pt: 15 } },
  { theme: "technology", topic: "technolog", quota: { en: 30, pt: 10 } },
  { theme: "technology", topic: "engineering", quota: { en: 45, pt: 10 } },
  { theme: "computing", topic: "computer", quota: { en: 10, pt: 5 } },
  { theme: "science", topic: "science", quota: { en: 30, pt: 15 } },
];
