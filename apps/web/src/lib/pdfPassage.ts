/**
 * Finds a passage in a PDF page's text layer: where KOReader's PDF highlights go (their locator
 * is `pdfsearch:<page>:0:<first words>`, see apps/api/src/lib/koreaderAnnotations.ts). KOReader
 * and pdf.js break the same text differently (line breaks, spaces between text runs, hyphens at
 * line ends), so whitespace and hyphens are left out of the comparison, and case and accents too.
 */

const SKIP = /[\s­‐‑-]/u;

/** Each kept character folded (lowercase, no accents), with its offset in `text`. */
function letters(text: string) {
  const chars: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (SKIP.test(ch)) continue;
    const folded = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (!folded) continue;
    chars.push(folded);
    at.push(i);
  }
  return { chars: chars.join(""), at, lengths: chars.map((c) => c.length) };
}

/**
 * The [start, end) character offsets of `passage` in `text` (the first match), or null when it
 * isn't there.
 */
export function findPassage(text: string, passage: string): [number, number] | null {
  const q = letters(passage).chars;
  if (!q) return null;
  const t = letters(text);
  const found = t.chars.indexOf(q);
  if (found < 0) return null;
  // Folded characters may be longer than one (rare ligatures): walk to the ones the match spans.
  let pos = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < t.at.length; i++) {
    if (pos >= found && first < 0) first = i;
    pos += t.lengths[i]!;
    if (pos >= found + q.length) {
      last = i;
      break;
    }
  }
  if (first < 0 || last < 0) return null;
  return [t.at[first]!, t.at[last]! + 1];
}
