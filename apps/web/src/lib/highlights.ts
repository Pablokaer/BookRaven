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
  h: { cfi: string; text: string; color: HighlightColor; label: string | null },
) {
  return apiJson<Highlight>(`/api/books/${bookId}/highlights`, { method: "POST", body: JSON.stringify(h) });
}

export function recolorHighlight(id: string, color: HighlightColor) {
  return apiJson<Highlight>(`/api/highlights/${id}`, { method: "PATCH", body: JSON.stringify({ color }) });
}

export async function deleteHighlight(id: string) {
  const res = await apiFetch(`/api/highlights/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new ApiError(res.status, null);
}
