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
  /** When the account last used the app (null = not since this was tracked). */
  lastSeenAt: string | null;
  books: number;
  usedBytes: number;
  isAdmin: boolean;
  /** Effective limit (null = unlimited). */
  quotaBytes: number | null;
  /** Set when an administrator changed this account's limit. */
  quotaOverride: number | null;
  blocked: boolean;
  blockedReason: string | null;
  /** Unsubscribed from promotional emails (campaigns and automations skip the account). */
  optedOut: boolean;
  emailVerified: boolean;
};

/** One account's page in Admin → Accounts (GET /api/admin/users/:id/overview). Hours are UTC instants. */
export type AccountOverview = {
  account: AdminUser;
  /** Each hour (start) in which the account used the app, last 90 days. */
  activityHours: string[];
  /** Seconds read in each hour, last 90 days. */
  readingHours: { hour: string; seconds: number }[];
  totals: { readingSeconds: number; finished: number; readingDays: number };
  reading: { id: string; title: string; author: string | null; percentage: number; updatedAt: string; device: string | null }[];
  books: {
    uploads: number;
    added: number;
    public: number;
    recent: { id: string; title: string; author: string | null; format: string; sizeBytes: number; createdAt: string; added: boolean; isPublic: boolean }[];
  };
  devices: {
    sessions: { userAgent: string | null; createdAt: string; lastUsedAt: string }[];
    appPasswords: { name: string; createdAt: string; lastUsedAt: string | null }[];
    readers: { name: string; lastUsedAt: string }[];
  };
  emails: { kind: string; name: string; sentAt: string }[];
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
/** Filters of Admin → Accounts (see GET /api/admin/users). */
export type UserFilters = {
  q?: string;
  minBooks?: number;
  maxBooks?: number;
  activity?: "active" | "never";
  activeWithin?: number;
  inactiveFor?: number;
  sort?: "newest" | "oldest" | "lastActive" | "books";
};
export const listUsers = (filters: UserFilters | string = {}) => {
  const f = typeof filters === "string" ? { q: filters } : filters;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "") params.set(k, String(v));
  return apiJson<AdminUser[]>(`/api/admin/users?${params}`);
};
export const getAccountOverview = (id: string) => apiJson<AccountOverview>(`/api/admin/users/${encodeURIComponent(id)}/overview`);
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
