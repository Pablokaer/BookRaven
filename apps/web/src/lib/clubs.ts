import { apiFetch, apiJson, ApiError } from "./api";

export type ClubSummary = {
  id: string;
  name: string;
  description: string | null;
  book: { title: string; author: string | null; hasCover: boolean };
  isOwner: boolean;
  members?: number;
  /** The viewer's copy of the club's book. */
  myBookId: string | null;
  createdAt: string;
};

export type ClubMember = {
  id: string;
  name: string;
  isOwner: boolean;
  isMe: boolean;
  joinedAt: string;
  progress: number | null;
  progressLabel: string | null;
  progressAt: string | null;
};

export type ClubMessage = {
  id: string;
  author: string;
  isMine: boolean;
  canDelete: boolean;
  text: string;
  quote: string | null;
  locator: string | null;
  createdAt: string;
};

export type ClubDetail = Omit<ClubSummary, "members"> & { inviteToken: string; members: ClubMember[]; messages: ClubMessage[] };
export type ClubInvite = ClubSummary & { ownerName: string; isMember: boolean };

async function ok(res: Response) {
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
}

export const listClubs = (bookId?: string) => apiJson<ClubSummary[]>(`/api/clubs${bookId ? `?bookId=${bookId}` : ""}`);
export const getClub = (id: string) => apiJson<ClubDetail>(`/api/clubs/${id}`);
export const createClub = (c: { bookId: string; name: string; description?: string }) =>
  apiJson<ClubSummary & { inviteToken: string }>("/api/clubs", { method: "POST", body: JSON.stringify(c) });
export const postMessage = (id: string, m: { text: string; quote?: string; locator?: string }) =>
  apiFetch(`/api/clubs/${id}/messages`, { method: "POST", body: JSON.stringify(m) }).then(ok);
export const deleteMessage = (id: string, messageId: string) => apiFetch(`/api/clubs/${id}/messages/${messageId}`, { method: "DELETE" }).then(ok);
export const getInvite = (token: string) => apiJson<ClubInvite>(`/api/clubs/invite/${token}`);
export const joinClub = (token: string) => apiJson<{ clubId: string; bookId: string }>(`/api/clubs/invite/${token}/join`, { method: "POST" });
export const resetInvite = (id: string) => apiJson<{ inviteToken: string }>(`/api/clubs/${id}/invite/reset`, { method: "POST" });
export const removeMember = (id: string, userId: "me" | string) => apiFetch(`/api/clubs/${id}/members/${userId}`, { method: "DELETE" }).then(ok);
export const deleteClub = (id: string) => apiFetch(`/api/clubs/${id}`, { method: "DELETE" }).then(ok);

export const inviteUrl = (token: string) => `${window.location.origin}/clubs/join/${token}`;
