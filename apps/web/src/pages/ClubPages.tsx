import { BookOpen, Check, Copy, LogOut, MessageSquare, MoreHorizontal, Plus, Quote, RefreshCw, Send, Trash2, UserMinus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AuthImage } from "../components/AuthImage";
import { EmptyState } from "../components/books/BookBrowser";
import { ProgressBar } from "../components/books/ProgressBar";
import { Menu } from "../components/ui/Menu";
import { Modal } from "../components/ui/Modal";
import { ApiError } from "../lib/api";
import {
  createClub,
  deleteClub,
  deleteMessage,
  getClub,
  getInvite,
  inviteUrl,
  joinClub,
  listClubs,
  postMessage,
  removeMember,
  resetInvite,
  type ClubDetail,
  type ClubInvite,
  type ClubSummary,
} from "../lib/clubs";
import { fileSize, percent, timeAgo } from "../lib/format";
import { useLibrary } from "../lib/libraryStore";

function ClubCover({ club, className = "" }: { club: Pick<ClubSummary, "id" | "book">; className?: string }) {
  return (
    <div className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-lg bg-elevated shadow-card ring-1 ring-line ${className}`}>
      <div className="absolute inset-0 flex items-center justify-center p-2 text-center font-display text-xs font-medium">{club.book.title}</div>
      {club.book.hasCover && <AuthImage path={`/api/clubs/${club.id}/cover`} alt="" className="absolute inset-0 h-full w-full object-cover" />}
    </div>
  );
}

function NewClubDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { books } = useLibrary();
  const [bookId, setBookId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const book = books?.find((b) => b.id === bookId);

  const submit = async () => {
    try {
      const club = await createClub({ bookId, name: name.trim() || `Reading ${book?.title ?? ""}`.trim(), description: description.trim() || undefined });
      onCreated(club.id);
    } catch {
      setError("Could not create the club, try again.");
    }
  };

  return (
    <Modal
      title="New book club"
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={!bookId} onClick={() => void submit()}>
            Create club
          </button>
        </>
      }
    >
      <p className="-mt-2 text-sm text-muted">Read one book together: members see each other’s progress and talk about it. Invite people with a link.</p>
      <label className="block space-y-1.5">
        <span className="eyebrow">Book</span>
        <select className="input w-full" value={bookId} onChange={(e) => setBookId(e.target.value)}>
          <option value="">Choose from your library…</option>
          {books?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="eyebrow">Name</span>
        <input className="input w-full" maxLength={100} placeholder={book ? `Reading ${book.title}` : "Club name"} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="block space-y-1.5">
        <span className="eyebrow">Description (optional)</span>
        <textarea className="input min-h-20 w-full" maxLength={1000} placeholder="Pace, meeting day, rules…" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {book && <p className="text-xs text-muted">Members who don’t have the book get a copy in their library ({fileSize(book.sizeBytes)} of their storage).</p>}
      {error && <p className="text-sm text-rose-300">{error}</p>}
    </Modal>
  );
}

/** "/clubs" */
export function ClubsPage() {
  const { clubsVersion } = useLibrary();
  const navigate = useNavigate();
  const [clubs, setClubs] = useState<ClubSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    listClubs()
      .then(setClubs)
      .catch(() => setClubs([]));
  }, [clubsVersion]);

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="flex items-center gap-3 font-display text-3xl font-medium tracking-tight">
            <UsersRound className="h-7 w-7 text-accent" /> Book Clubs
          </h1>
          <p className="mt-1.5 text-sm text-muted">Read a book together, follow each other’s progress and discuss it.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New club
        </button>
      </header>
      {clubs === null ? (
        <div className="h-40 animate-pulse rounded-2xl bg-elevated/50" />
      ) : clubs.length === 0 ? (
        <EmptyState icon={<UsersRound />} title="No clubs yet">
          Start one with a book from your library and send the invite link to friends.
        </EmptyState>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
          {clubs.map((c) => (
            <Link key={c.id} to={`/clubs/${c.id}`} className="surface flex animate-rise gap-4 p-5 transition hover:-translate-y-0.5 hover:border-accent/30">
              <ClubCover club={c} className="w-16" />
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg font-medium">{c.name}</h2>
                <p className="truncate text-sm text-muted">{c.book.title}</p>
                <p className="mt-2 text-xs text-muted">
                  {c.members} member{c.members === 1 ? "" : "s"}
                  {c.isOwner ? " · you host it" : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <NewClubDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/clubs/${id}`)} />}
    </>
  );
}

/** "/clubs/:id" */
export function ClubPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { clubsVersion } = useLibrary();
  const [club, setClub] = useState<ClubDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const feedEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    getClub(id)
      .then(setClub)
      .catch(() => setMissing(true));
  }, [id]);
  useEffect(load, [load, clubsVersion]);
  // (A block body: scrollIntoView returns a promise in newer browsers, which must not become the effect's cleanup.)
  useEffect(() => {
    feedEnd.current?.scrollIntoView({ block: "nearest" });
  }, [club?.messages.length]);

  const finished = useMemo(() => club?.members.filter((m) => (m.progress ?? 0) >= 0.98).length ?? 0, [club]);

  if (missing) {
    return (
      <EmptyState icon={<UsersRound />} title="Club not found">
        It was deleted, or you are not a member. <Link to="/clubs" className="text-accent hover:underline">Your clubs</Link>
      </EmptyState>
    );
  }
  if (!club) return <div className="h-60 animate-pulse rounded-2xl bg-elevated/50" />;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await postMessage(club.id, { text: text.trim() });
      setText("");
      load();
    } catch {
      window.alert("Could not send it, try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-8">
        <header className="flex flex-wrap gap-6">
          <ClubCover club={club} className="w-28" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h1 className="mr-auto font-display text-3xl font-medium tracking-tight">{club.name}</h1>
              <Menu
                label="Club actions"
                trigger={<MoreHorizontal className="h-4 w-4" />}
                items={
                  club.isOwner
                    ? [
                        {
                          label: "New invite link",
                          icon: <RefreshCw />,
                          onSelect: async () => {
                            if (!window.confirm("Make a new invite link? The current one stops working.")) return;
                            await resetInvite(club.id);
                            load();
                          },
                        },
                        { separator: true },
                        {
                          label: "Delete club",
                          icon: <Trash2 />,
                          danger: true,
                          onSelect: async () => {
                            if (!window.confirm(`Delete “${club.name}” and its discussion for everyone? Books stay in people’s libraries.`)) return;
                            await deleteClub(club.id);
                            navigate("/clubs");
                          },
                        },
                      ]
                    : [
                        {
                          label: "Leave club",
                          icon: <LogOut />,
                          danger: true,
                          onSelect: async () => {
                            if (!window.confirm(`Leave “${club.name}”? The book stays in your library.`)) return;
                            await removeMember(club.id, "me");
                            navigate("/clubs");
                          },
                        },
                      ]
                }
              />
            </div>
            <p className="mt-1 text-sm text-muted">
              Reading <span className="text-fg">{club.book.title}</span>
              {club.book.author ? ` by ${club.book.author}` : ""}
            </p>
            {club.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{club.description}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {club.myBookId ? (
                <Link to={`/read/${club.myBookId}`} className="btn">
                  <BookOpen className="h-4 w-4" /> Read
                </Link>
              ) : (
                <p className="text-xs text-amber-200">The book is no longer in your library. Open the invite link again to add it back.</p>
              )}
            </div>
          </div>
        </header>

        <section aria-labelledby="discussion">
          <h2 id="discussion" className="mb-4 flex items-center gap-2 font-display text-xl font-medium">
            <MessageSquare className="h-5 w-5 text-accent" /> Discussion
          </h2>
          <div className="surface space-y-4 p-5">
            {club.messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No messages yet. Say hello, or share a passage from the book (select text while reading → “Discuss in club”).</p>
            ) : (
              club.messages.map((m) => (
                <article key={m.id} className={`group flex gap-3 ${m.isMine ? "flex-row-reverse text-right" : ""}`}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-muted">
                    {m.author.slice(0, 1).toUpperCase()}
                  </div>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${m.isMine ? "bg-primary/30" : "bg-elevated/70"}`}>
                    <div className="mb-1 text-xs text-muted">
                      {m.isMine ? "You" : m.author} · {timeAgo(m.createdAt)}
                    </div>
                    {m.quote && (
                      <blockquote className="mb-2 border-l-2 border-accent/60 pl-2 text-left text-sm italic text-fg/80">
                        <Quote className="mr-1 inline h-3 w-3 opacity-60" />
                        {m.quote}
                        {m.locator && club.myBookId && (
                          <Link to={`/read/${club.myBookId}?at=${encodeURIComponent(m.locator)}`} className="ml-2 not-italic text-xs text-accent hover:underline">
                            Open in book
                          </Link>
                        )}
                      </blockquote>
                    )}
                    <p className="whitespace-pre-wrap text-left text-sm leading-relaxed">{m.text}</p>
                  </div>
                  {m.canDelete && (
                    <button
                      className="icon-btn h-7 w-7 self-center opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100"
                      aria-label="Delete message"
                      onClick={async () => {
                        if (!window.confirm("Delete this message?")) return;
                        await deleteMessage(club.id, m.id).catch(() => {});
                        load();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </article>
              ))
            )}
            <div ref={feedEnd} />
            <form onSubmit={send} className="flex gap-2 border-t border-line pt-4">
              <textarea
                className="input min-h-11 flex-1 resize-none"
                rows={1}
                placeholder="Write to the club…"
                aria-label="Message"
                maxLength={4000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(e);
                  }
                }}
              />
              <button className="btn" disabled={sending || !text.trim()} aria-label="Send">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </section>
      </div>

      <aside className="space-y-5">
        <section className="surface p-5">
          <h2 className="mb-1 text-sm font-semibold">Members</h2>
          <p className="mb-4 text-xs text-muted">
            {club.members.length} reading{finished ? ` · ${finished} finished` : ""}. Progress is shared only inside the club.
          </p>
          <ul className="space-y-3.5">
            {club.members.map((m) => (
              <li key={m.id} className="group">
                <div className="mb-1 flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {m.isMe ? "You" : m.name}
                    {m.isOwner && <span className="ml-1.5 text-xs text-accent">host</span>}
                  </span>
                  <span className="text-xs tabular-nums text-muted" title={m.progressAt ? `Updated ${timeAgo(m.progressAt)}` : undefined}>
                    {m.progress === null ? "not started" : percent(m.progress)}
                  </span>
                  {club.isOwner && !m.isMe && (
                    <button
                      className="icon-btn h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Remove ${m.name}`}
                      onClick={async () => {
                        if (!window.confirm(`Remove ${m.name} from the club?`)) return;
                        await removeMember(club.id, m.id);
                        load();
                      }}
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <ProgressBar value={m.progress ?? 0} className={m.progress === null ? "opacity-40" : ""} />
              </li>
            ))}
          </ul>
        </section>

        <section className="surface p-5">
          <h2 className="mb-1 text-sm font-semibold">Invite</h2>
          <p className="mb-3 text-xs text-muted">Anyone with an account on this server who opens the link can join. The book is added to their library.</p>
          <div className="flex gap-2">
            <input readOnly value={inviteUrl(club.inviteToken)} className="input min-w-0 flex-1 text-xs" aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <button
              className="btn-outline px-3"
              aria-label="Copy invite link"
              onClick={() => {
                void navigator.clipboard?.writeText(inviteUrl(club.inviteToken));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}

/** "/clubs/join/:token" — opened from an invite link. */
export function ClubInvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { me } = useLibrary();
  const [invite, setInvite] = useState<ClubInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getInvite(token)
      .then(setInvite)
      .catch(() => setError("This invite link is invalid or was replaced by a new one."));
  }, [token]);

  const join = async () => {
    setBusy(true);
    try {
      const { clubId } = await joinClub(token);
      navigate(`/clubs/${clubId}`, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 413
          ? `Not enough space in your library${me?.quotaBytes ? ` (limit ${fileSize(me.quotaBytes)})` : ""} for this book.`
          : "Could not join, try again.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[70dvh] items-center justify-center">
      <div className="surface w-full max-w-sm animate-rise space-y-5 p-8 text-center">
        {error ? (
          <p className="text-sm">{error}</p>
        ) : !invite ? (
          <div className="mx-auto aspect-[2/3] w-32 animate-pulse rounded-lg bg-elevated" />
        ) : (
          <>
            <ClubCover club={invite} className="mx-auto w-32" />
            <div>
              <p className="eyebrow text-accent/90">{invite.ownerName} invited you to a book club</p>
              <h1 className="mt-2 font-display text-xl font-medium">{invite.name}</h1>
              <p className="mt-1 text-sm text-muted">
                {invite.book.title} · {invite.members} member{invite.members === 1 ? "" : "s"}
              </p>
              {invite.description && <p className="mt-3 text-sm text-fg/85">{invite.description}</p>}
            </div>
            {invite.isMember ? (
              <Link to={`/clubs/${invite.id}`} className="btn w-full">
                Open the club
              </Link>
            ) : (
              <>
                <button className="btn w-full" disabled={busy} onClick={() => void join()}>
                  {busy ? "Joining…" : "Join the club"}
                </button>
                {!invite.myBookId && <p className="text-xs text-muted">The book will be added to your library.</p>}
              </>
            )}
          </>
        )}
        <Link to="/clubs" className={error ? "btn-outline" : "btn-ghost"}>
          Your clubs
        </Link>
      </div>
    </div>
  );
}
