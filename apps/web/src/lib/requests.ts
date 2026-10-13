import { apiFetch, apiJson, ApiError } from "./api";

export type BookRequest = {
  id: string;
  title: string;
  author: string | null;
  note: string | null;
  status: "open" | "fulfilled" | "closed";
  requestedBy: string | null;
  isMine: boolean;
  canClose: boolean;
  votes: number;
  voted: boolean;
  fulfilledBookId: string | null;
  fulfilledBy: string | null;
  createdAt: string;
};

async function ok(res: Response) {
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
}

export const listRequests = () => apiJson<BookRequest[]>("/api/requests");
export const createRequest = (r: { title: string; author?: string; note?: string }) =>
  apiJson<BookRequest>("/api/requests", { method: "POST", body: JSON.stringify(r) });
export const vote = (id: string, on: boolean) => apiFetch(`/api/requests/${id}/vote`, { method: on ? "POST" : "DELETE" }).then(ok);
export const fulfillRequest = (id: string, bookId: string) =>
  apiFetch(`/api/requests/${id}/fulfill`, { method: "POST", body: JSON.stringify({ bookId }) }).then(ok);
export const closeRequest = (id: string) => apiFetch(`/api/requests/${id}`, { method: "DELETE" }).then(ok);
