import { Ban, BookOpen, Flag, HardDrive, KeyRound, Mail, MoreHorizontal, Search, Send, ShieldCheck, ShieldOff, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { EmailsTab } from "../components/admin/EmailsTab";
import { EmptyState } from "../components/books/BookBrowser";
import { ProgressBar } from "../components/books/ProgressBar";
import { CopyField } from "../components/ui/CopyField";
import { Menu } from "../components/ui/Menu";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import {
  deleteUser,
  getStats,
  listBlockedFiles,
  listReports,
  listUsers,
  resetUserPassword,
  resolveReport,
  unblockFile,
  updateUser,
  type AdminUser,
  type UserFilters,
  type ContentReport,
  type ReportAction,
} from "../lib/admin";
import { shortDate } from "../lib/bookStats";
import { confirmThen } from "../lib/confirm";
import { fileSize, timeAgo } from "../lib/format";
import { useLibrary } from "../lib/libraryStore";
import { useApi } from "../lib/useApi";

const TABS = ["users", "reports", "blocked", "emails"] as const;
type Tab = (typeof TABS)[number];

const REASONS: Record<string, string> = {
  copyright: "Copyright",
  illegal: "Illegal content",
  offensive: "Offensive",
  spam: "Spam",
  other: "Other",
};

function Stat({ label, value, to }: { label: string; value: string | number | undefined; to?: string }) {
  const body = (
    <>
      <div className="text-xl font-semibold tabular-nums">{value ?? "–"}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </>
  );
  return to ? (
    <Link to={to} className="surface block p-4 text-center transition hover:border-accent/40">
      {body}
    </Link>
  ) : (
    <div className="surface p-4 text-center">{body}</div>
  );
}

type Choice = { label: string; filter: Partial<UserFilters> };

const BOOK_FILTERS = {
  any: { label: "Any number", filter: {} },
  none: { label: "No books", filter: { maxBooks: 0 } },
  some: { label: "1 to 9", filter: { minBooks: 1, maxBooks: 9 } },
  many: { label: "10 to 49", filter: { minBooks: 10, maxBooks: 49 } },
  lots: { label: "50 or more", filter: { minBooks: 50 } },
} satisfies Record<string, Choice>;

const ACTIVITY_FILTERS = {
  any: { label: "Everyone", filter: {} },
  active: { label: "Has been active", filter: { activity: "active" } },
  never: { label: "Never active", filter: { activity: "never" } },
} satisfies Record<string, Choice>;

const LAST_ACTIVE_FILTERS = {
  any: { label: "Any time", filter: {} },
  d1: { label: "In the last 24 hours", filter: { activeWithin: 1 } },
  d7: { label: "In the last 7 days", filter: { activeWithin: 7 } },
  d30: { label: "In the last 30 days", filter: { activeWithin: 30 } },
  i30: { label: "Not in the last 30 days", filter: { inactiveFor: 30 } },
  i90: { label: "Not in the last 90 days", filter: { inactiveFor: 90 } },
  i180: { label: "Not in the last 6 months", filter: { inactiveFor: 180 } },
} satisfies Record<string, Choice>;

const SORTS = {
  newest: { label: "Newest accounts" },
  oldest: { label: "Oldest accounts" },
  lastActive: { label: "Most recently active" },
  books: { label: "Most books" },
} satisfies Record<NonNullable<UserFilters["sort"]>, { label: string }>;

function FilterSelect<K extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: K;
  options: Record<K, { label: string }>;
  onChange: (value: K) => void;
}) {
  return (
    <label className="block space-y-1 text-left">
      <span className="text-xs font-medium text-muted">{label}</span>
      <select className="input block w-full min-w-40 py-1.5" value={value} onChange={(e) => onChange(e.target.value as K)}>
        {(Object.keys(options) as K[]).map((k) => (
          <option key={k} value={k}>
            {options[k].label}
          </option>
        ))}
      </select>
    </label>
  );
}

function UsersTab({ onChanged }: { onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [books, setBooks] = useState<keyof typeof BOOK_FILTERS>("any");
  const [activity, setActivity] = useState<keyof typeof ACTIVITY_FILTERS>("any");
  const [lastActive, setLastActive] = useState<keyof typeof LAST_ACTIVE_FILTERS>("any");
  const [sort, setSort] = useState<NonNullable<UserFilters["sort"]>>("newest");
  const filtered = books !== "any" || activity !== "any" || lastActive !== "any";
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [password, setPassword] = useState<{ email: string; value: string } | null>(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    listUsers({ q, ...BOOK_FILTERS[books].filter, ...ACTIVITY_FILTERS[activity].filter, ...LAST_ACTIVE_FILTERS[lastActive].filter, sort })
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [q, books, activity, lastActive, sort]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      window.alert("That did not work, try again.");
    }
    load();
    onChanged();
  };

  const setQuota = (u: AdminUser) => {
    const current = u.quotaOverride !== null ? String(Math.round(u.quotaOverride / 1024 / 1024)) : "";
    const raw = window.prompt(`Storage limit for ${u.email} in MB (leave empty for the default):`, current);
    if (raw === null) return;
    const mb = raw.trim() === "" ? null : Number(raw);
    if (mb !== null && (!Number.isFinite(mb) || mb < 0)) return window.alert("Enter a number of megabytes.");
    void act(() => updateUser(u.id, { quotaMb: mb }));
  };

  const block = (u: AdminUser) => {
    if (u.blocked) return void act(() => updateUser(u.id, { blocked: false }));
    const reason = window.prompt(`Block ${u.email}? They are signed out and cannot sign in until you unblock them.\n\nReason (optional):`, "");
    if (reason === null) return;
    void act(() => updateUser(u.id, { blocked: true, blockedReason: reason.trim() || null }));
  };

  const reset = async (u: AdminUser) => {
    if (!window.confirm(`Set a new temporary password for ${u.email}? They will be signed out everywhere.`)) return;
    try {
      const { password: value } = await resetUserPassword(u.id);
      setPassword({ email: u.email, value });
    } catch {
      window.alert("This account has no password (it signs in with Google).");
    }
  };

  const remove = (u: AdminUser) => {
    const typed = window.prompt(`Delete ${u.email}, their ${u.books} books and progress? This cannot be undone.\n\nType the email to confirm:`);
    if (typed?.trim().toLowerCase() !== u.email.toLowerCase()) return;
    void act(() => deleteUser(u.id));
  };

  return (
    <>
      <label className="relative mb-3 flex max-w-md items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
        <input className="input w-full pl-9" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
      </label>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <FilterSelect label="Books" value={books} options={BOOK_FILTERS} onChange={setBooks} />
        <FilterSelect label="Activity" value={activity} options={ACTIVITY_FILTERS} onChange={setActivity} />
        <FilterSelect label="Last active" value={lastActive} options={LAST_ACTIVE_FILTERS} onChange={setLastActive} />
        <FilterSelect label="Sort by" value={sort} options={SORTS} onChange={setSort} />
        <div className="flex items-center gap-3 pb-2 text-xs text-muted">
          {users && (
            <span>
              {users.length >= 500 ? "500+ accounts (first 500 shown)" : `${users.length} ${users.length === 1 ? "account" : "accounts"}`}
            </span>
          )}
          {filtered && (
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => {
                setBooks("any");
                setActivity("any");
                setLastActive("any");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
      {users === null ? (
        <div className="h-40 animate-pulse rounded-2xl bg-elevated/50" />
      ) : users.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No accounts found.</p>
      ) : (
        <div className="surface divide-y divide-line/70 overflow-hidden">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex items-center gap-2">
                  <Link to={`/admin/users/${encodeURIComponent(u.id)}`} className="truncate font-medium hover:text-accent hover:underline">
                    {u.name || u.email}
                  </Link>
                  {u.isAdmin && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-xs text-accent">
                      <ShieldCheck className="h-3 w-3" /> Admin
                    </span>
                  )}
                  {u.blocked && (
                    <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300" title={u.blockedReason ?? undefined}>
                      Blocked
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted">
                  {u.email} · joined {shortDate(u.createdAt)} ·{" "}
                  <span title={u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : undefined}>
                    {u.lastSeenAt ? `last active ${timeAgo(u.lastSeenAt)}` : "no activity yet"}
                  </span>
                </div>
              </div>
              {/* On phones these move to a second line so the actions button stays next to the name. */}
              <div className="w-24 text-xs text-muted max-sm:order-last">
                <BookOpen className="mr-1 inline h-3.5 w-3.5" />
                {u.books} books
              </div>
              <div className="w-48 text-xs max-sm:order-last max-sm:flex-1">
                <div className="mb-1 flex justify-between text-muted">
                  <span>{fileSize(u.usedBytes)}</span>
                  <span>{u.quotaBytes === null ? "unlimited" : `of ${fileSize(u.quotaBytes)}${u.quotaOverride !== null ? " (custom)" : ""}`}</span>
                </div>
                <ProgressBar value={u.quotaBytes ? u.usedBytes / u.quotaBytes : 0} />
              </div>
              <Menu
                label={`Actions for ${u.email}`}
                trigger={<MoreHorizontal className="h-4 w-4" />}
                items={[
                  { label: "Usage and details", icon: <BookOpen />, onSelect: () => navigate(`/admin/users/${encodeURIComponent(u.id)}`) },
                  { label: "Send email…", icon: <Send />, onSelect: () => navigate(`/admin?tab=emails&to=${encodeURIComponent(u.id)}`) },
                  ...(!u.isAdmin ? [{ label: "Storage limit…", icon: <HardDrive />, onSelect: () => setQuota(u) }] : []),
                  { label: "Reset password…", icon: <KeyRound />, onSelect: () => void reset(u) },
                  ...(!u.isAdmin
                    ? [
                        { label: u.blocked ? "Unblock" : "Block…", icon: u.blocked ? <ShieldOff /> : <Ban />, onSelect: () => block(u) },
                        { separator: true as const },
                        { label: "Delete account…", icon: <Trash2 />, danger: true, onSelect: () => remove(u) },
                      ]
                    : []),
                ]}
              />
            </div>
          ))}
        </div>
      )}

      {password && (
        <Modal title="Temporary password" onClose={() => setPassword(null)} footer={<button className="btn" onClick={() => setPassword(null)}>Done</button>}>
          <p className="-mt-2 text-sm text-muted">
            Give this password to <span className="text-fg">{password.email}</span>. It is shown only once; they can change it in their profile.
          </p>
          <CopyField label="Temporary password" value={password.value} inputClassName="font-mono" withText />
        </Modal>
      )}
    </>
  );
}

function ReportsTab({ onChanged }: { onChanged: () => void }) {
  const [all, setAll] = useState(false);
  // The list shown stays while the other one (with or without resolved reports) loads.
  const { data: reports, reload } = useApi(() => listReports(all), [], { fallback: [], reloadOn: [all] });

  const resolve = async (r: ContentReport, action: ReportAction) => {
    const questions: Record<ReportAction, string> = {
      dismiss: `Dismiss the report about “${r.title}”? It stays public.`,
      unpublish: `Take “${r.title}” out of the public library? Copies people already added stay.`,
      block: `Block “${r.title}”? It leaves the public library and can never be uploaded or published again. Copies people already have stay.`,
      purge: `Delete “${r.title}” from EVERY library on this server and block the file? This cannot be undone.`,
    };
    if (!window.confirm(questions[action])) return;
    const note = action === "dismiss" ? undefined : (window.prompt("Note for the record (optional):", REASONS[r.reason]) ?? undefined);
    try {
      const res = await resolveReport(r.id, action, note);
      if (action === "purge") window.alert(`Removed ${res.removedCopies} cop${res.removedCopies === 1 ? "y" : "ies"}.`);
    } catch {
      window.alert("That did not work, try again.");
    }
    reload();
    onChanged();
  };

  return (
    <>
      <label className="mb-5 flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show resolved reports
      </label>
      {reports === null ? (
        <div className="h-40 animate-pulse rounded-2xl bg-elevated/50" />
      ) : reports.length === 0 ? (
        <EmptyState icon={<Flag />} title="No reports">
          People can report public books from the Public Library.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="surface p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{r.title}</h3>
                    <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-300">{REASONS[r.reason]}</span>
                    {r.status !== "open" && <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-muted">{r.status}: {r.resolution}</span>}
                    {r.blocked && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300">File blocked</span>}
                    {r.stillPublic && <span className="rounded-full bg-accent/12 px-2 py-0.5 text-xs text-accent">Still public</span>}
                  </div>
                  {r.details && <p className="mt-2 whitespace-pre-wrap text-sm text-fg/90">“{r.details}”</p>}
                  <p className="mt-2 text-xs text-muted">
                    Reported by {r.reporter ?? "a deleted account"} {timeAgo(r.createdAt)} · published by {r.publisher ?? "—"}
                  </p>
                </div>
                {r.status === "open" && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-ghost" onClick={() => void resolve(r, "dismiss")}>
                      Dismiss
                    </button>
                    <button className="btn-outline py-2" onClick={() => void resolve(r, "unpublish")}>
                      Unpublish
                    </button>
                    <button className="btn-outline py-2" onClick={() => void resolve(r, "block")}>
                      Block file
                    </button>
                    <button className="btn-outline border-rose-500/40 py-2 text-rose-300 hover:border-rose-400" onClick={() => void resolve(r, "purge")}>
                      Delete everywhere
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BlockedTab() {
  const { data: files, reload } = useApi(listBlockedFiles, [], { fallback: [] });
  return files === null ? (
    <div className="h-40 animate-pulse rounded-2xl bg-elevated/50" />
  ) : files.length === 0 ? (
    <EmptyState icon={<Ban />} title="No blocked files">
      Files you block from a report cannot be uploaded or published again.
    </EmptyState>
  ) : (
    <div className="surface divide-y divide-line/70">
      {files.map((f) => (
        <div key={f.sha256} className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{f.title}</div>
            <div className="text-xs text-muted">
              {f.reason} · by {f.blockedBy ?? "—"} · {shortDate(f.createdAt)} · <span className="font-mono">{f.sha256.slice(0, 12)}…</span>
            </div>
          </div>
          <button
            className="btn-ghost"
            onClick={() => void confirmThen(`Unblock “${f.title}”? It could be uploaded and published again.`, () => unblockFile(f.sha256), reload)}
          >
            Unblock
          </button>
        </div>
      ))}
    </div>
  );
}

/** "/admin" — accounts, reports and blocked files (administrators only). */
export function AdminPage() {
  const { me } = useLibrary();
  // ?tab=emails&to=<account id>: "Send email" on an account opens the composer for that account.
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const [tab, setTabState] = useState<Tab>(TABS.includes(asked as Tab) ? (asked as Tab) : "users");
  const sendTo = params.get("to");
  const setTab = (t: Tab) => {
    setTabState(t);
    setParams(t === "users" ? {} : { tab: t }, { replace: true });
  };
  // Only administrators may ask; for anyone else the page says so below.
  const { data: stats, reload: loadStats } = useApi(() => (me?.isAdmin ? getStats() : Promise.resolve(null)), [], { reloadOn: [me?.isAdmin] });

  if (me && !me.isAdmin) {
    return (
      <EmptyState icon={<ShieldCheck />} title="Administrators only">
        This page is for the server’s administrators.
      </EmptyState>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "users", label: "Accounts", icon: <Users className="h-4 w-4" /> },
    { id: "reports", label: "Reports", icon: <Flag className="h-4 w-4" />, count: stats?.openReports },
    { id: "blocked", label: "Blocked files", icon: <Ban className="h-4 w-4" /> },
    { id: "emails", label: "Emails", icon: <Mail className="h-4 w-4" /> },
  ];

  return (
    <>
      <PageHeader title="Admin" icon={ShieldCheck} subtitle="Accounts, storage limits, reports, book requests, content removal and emails to readers." />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Accounts" value={stats?.users} />
        <Stat label="Books (copies)" value={stats?.books} />
        <Stat label="Stored on disk" value={stats ? fileSize(stats.storedBytes) : undefined} />
        <Stat label="Public books" value={stats?.publicBooks} />
        <Stat label="Open book requests" value={stats?.openRequests} to="/public?tab=requests" />
      </div>

      <div className="mb-6 flex flex-wrap gap-2" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`pill ${tab === t.id ? "pill-on" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon} {t.label}
            {t.count ? <span className="rounded-full bg-rose-500/80 px-1.5 text-xs text-white">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab onChanged={loadStats} />}
      {tab === "reports" && <ReportsTab onChanged={loadStats} />}
      {tab === "blocked" && <BlockedTab />}
      {tab === "emails" && <EmailsTab key={sendTo ?? ""} sendTo={sendTo} />}
    </>
  );
}
