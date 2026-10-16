import { apiJson, apiOk } from "./api";

export type AdminStats = {
  users: number;
  books: number;
  files: number;
  storedBytes: number;
  publicBooks: number;
  openReports: number;
  openRequests: number;
  blockedUsers: number;
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  books: number;
  usedBytes: number;
  isAdmin: boolean;
  /** Effective limit (null = unlimited). */
  quotaBytes: number | null;
  /** Set when an administrator changed this account's limit. */
  quotaOverride: number | null;
  blocked: boolean;
  blockedReason: string | null;
};

export type ReportReason = "copyright" | "illegal" | "offensive" | "spam" | "other";

export type ContentReport = {
  id: string;
  bookId: string | null;
  sha256: string;
  title: string;
  reason: ReportReason;
  details: string | null;
  status: "open" | "dismissed" | "actioned";
  resolution: string | null;
  reporter: string | null;
  publisher: string | null;
  stillPublic: boolean;
  blocked: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

export type BlockedFile = { sha256: string; title: string; reason: string; blockedBy: string | null; createdAt: string };

export type ReportAction = "dismiss" | "unpublish" | "block" | "purge";

export const getStats = () => apiJson<AdminStats>("/api/admin/stats");
export const listUsers = (q = "") => apiJson<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(q)}`);
export const updateUser = (id: string, patch: { quotaMb?: number | null; blocked?: boolean; blockedReason?: string | null }) =>
  apiOk(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const resetUserPassword = (id: string) => apiJson<{ password: string }>(`/api/admin/users/${id}/reset-password`, { method: "POST" });
export const deleteUser = (id: string) => apiOk(`/api/admin/users/${id}`, { method: "DELETE" });
export const listReports = (all = false) => apiJson<ContentReport[]>(`/api/admin/reports${all ? "?status=all" : ""}`);
export const resolveReport = (id: string, action: ReportAction, note?: string) =>
  apiJson<{ action: ReportAction; removedCopies: number }>(`/api/admin/reports/${id}/resolve`, {
    method: "POST",
    body: JSON.stringify(note ? { action, note } : { action }),
  });
export const listBlockedFiles = () => apiJson<BlockedFile[]>("/api/admin/blocked-files");
export const unblockFile = (sha: string) => apiOk(`/api/admin/blocked-files/${sha}`, { method: "DELETE" });

/** Anyone: report a public book. */
export const reportPublicBook = (id: string, reason: ReportReason, details?: string) =>
  apiOk(`/api/public/${id}/report`, { method: "POST", body: JSON.stringify(details ? { reason, details } : { reason }) });
