import { apiFetch, apiJson, ApiError, type Highlight, type HighlightColor } from "./api";

export const HIGHLIGHT_COLORS: Record<HighlightColor, { label: string; fill: string }> = {
  yellow: { label: "Yellow", fill: "#facc15" },
  green: { label: "Green", fill: "#4ade80" },
  blue: { label: "Blue", fill: "#60a5fa" },
  pink: { label: "Pink", fill: "#f472b6" },
};

export function listHighlights(bookId: string) {
  return apiJson<Highlight[]>(`/api/books/${bookId}/highlights`);
}

export function createHighlight(
  bookId: string,
  h: { cfi: string; text: string; color: HighlightColor; label: string | null; note?: string | null },
) {
  return apiJson<Highlight>(`/api/books/${bookId}/highlights`, { method: "POST", body: JSON.stringify(h) });
}

/** Changes the color and/or the note (an empty note removes it). */
export function updateHighlight(id: string, patch: { color?: HighlightColor; note?: string | null }) {
  return apiJson<Highlight>(`/api/highlights/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** Highlights and notes of a book as Markdown (for Obsidian, Notion, a blog...). */
export function highlightsToMarkdown(book: { title: string; author: string | null }, highlights: Highlight[]) {
  const lines = [`# ${book.title}`, ...(book.author ? [`*${book.author}*`] : []), ""];
  let chapter: string | null = null;
  for (const h of highlights) {
    if (h.label && h.label !== chapter) {
      chapter = h.label;
      lines.push(`## ${chapter}`, "");
    }
    lines.push(...h.text.trim().split(/\n+/).map((l) => `> ${l}`), "");
    if (h.note) lines.push(h.note.trim(), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function downloadText(filename: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function deleteHighlight(id: string) {
  const res = await apiFetch(`/api/highlights/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, null);
}
