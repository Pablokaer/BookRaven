import { apiJson, apiOk } from "./api";

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

export const listRequests = () => apiJson<BookRequest[]>("/api/requests");
export const createRequest = (r: { title: string; author?: string; note?: string }) =>
  apiJson<BookRequest>("/api/requests", { method: "POST", body: JSON.stringify(r) });
export const vote = (id: string, on: boolean) => apiOk(`/api/requests/${id}/vote`, { method: on ? "POST" : "DELETE" });
export const fulfillRequest = (id: string, bookId: string) =>
  apiOk(`/api/requests/${id}/fulfill`, { method: "POST", body: JSON.stringify({ bookId }) });
export const closeRequest = (id: string) => apiOk(`/api/requests/${id}`, { method: "DELETE" });
