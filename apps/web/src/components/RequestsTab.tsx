import { BookOpen, CheckCircle2, ChevronUp, HandHelping, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useLibrary } from "../lib/libraryStore";
import { closeRequest, createRequest, fulfillRequest, listRequests, vote, type BookRequest } from "../lib/requests";
import { EmptyState } from "./books/BookBrowser";
import { Modal } from "./ui/Modal";

function NewRequest({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await createRequest({ title: title.trim(), author: author.trim() || undefined, note: note.trim() || undefined });
      setTitle("");
      setAuthor("");
      setNote("");
      onCreated();
    } catch {
      window.alert("Could not send the request, try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="surface mb-8 grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto]">
      <div className="sm:col-span-3">
        <h2 className="text-sm font-medium">Request a book</h2>
        <p className="text-xs text-muted">Ask for a book you would like in the Public Library. Others can vote, and anyone who has it can add it.</p>
      </div>
      <input className="input" placeholder="Title" aria-label="Title" required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="input" placeholder="Author (optional)" aria-label="Author" maxLength={300} value={author} onChange={(e) => setAuthor(e.target.value)} />
      <button className="btn" disabled={busy || !title.trim()}>
        <Plus className="h-4 w-4" /> Request
      </button>
      <input
        className="input sm:col-span-3"
        placeholder="Note (optional): edition, language…"
        aria-label="Note"
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </form>
  );
}

/** Picks one of the user's books to answer a request (it gets published). */
function FulfillDialog({ request, onClose, onDone }: { request: BookRequest; onClose: () => void; onDone: () => void }) {
  const { books } = useLibrary();
  const [bookId, setBookId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => {
    const words = request.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const score = (t: string) => words.filter((w) => t.toLowerCase().includes(w)).length;
    return [...(books ?? [])].sort((a, b) => score(b.title) - score(a.title) || a.title.localeCompare(b.title));
  }, [books, request.title]);

  const submit = async () => {
    try {
      await fulfillRequest(request.id, bookId);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 451 ? "This file was taken down by an administrator." : "Could not do that, try again.");
    }
  };
  return (
    <Modal
      title={<>Add “{request.title}”</>}
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={!bookId} onClick={() => void submit()}>
            Publish and answer
          </button>
        </>
      }
    >
      <p className="-mt-2 text-sm text-muted">Choose the book from your library. It will be published to the Public Library for everyone.</p>
      <select className="input w-full" value={bookId} onChange={(e) => setBookId(e.target.value)} aria-label="Your book">
        <option value="">Choose a book…</option>
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}
            {b.author ? ` — ${b.author}` : ""}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-rose-300">{error}</p>}
    </Modal>
  );
}

/** Book requests in the public library. */
export function RequestsTab() {
  const { requestsVersion, query } = useLibrary();
  const [list, setList] = useState<BookRequest[] | null>(null);
  const [fulfilling, setFulfilling] = useState<BookRequest | null>(null);
  const load = useCallback(() => {
    listRequests()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(load, [load, requestsVersion]);

  const q = query.trim().toLowerCase();
  const visible = list?.filter((r) => !q || `${r.title} ${r.author ?? ""}`.toLowerCase().includes(q));

  const toggleVote = async (r: BookRequest) => {
    setList((cur) => cur?.map((x) => (x.id === r.id ? { ...x, voted: !r.voted, votes: x.votes + (r.voted ? -1 : 1) } : x)) ?? cur);
    await vote(r.id, !r.voted).catch(load);
  };

  return (
    <>
      <NewRequest onCreated={load} />
      {visible === undefined ? (
        <div className="h-40 animate-pulse rounded-2xl bg-elevated/50" />
      ) : visible.length === 0 ? (
        <EmptyState icon={<HandHelping />} title={q ? "No matching requests" : "No requests yet"}>
          {q ? "Try another search." : "Ask for the first book above."}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => (
            <li key={r.id} className="surface flex animate-rise items-start gap-4 p-4">
              <button
                className={`flex w-12 shrink-0 flex-col items-center rounded-xl border py-1.5 text-sm transition ${
                  r.voted ? "border-accent/50 bg-accent/12 text-accent" : "border-line text-muted hover:border-accent/40 hover:text-fg"
                } ${r.status !== "open" ? "pointer-events-none opacity-60" : ""}`}
                aria-pressed={r.voted}
                aria-label={r.voted ? `Remove your vote for ${r.title}` : `Vote for ${r.title}`}
                onClick={() => void toggleVote(r)}
              >
                <ChevronUp className="h-4 w-4" />
                <span className="font-semibold tabular-nums">{r.votes}</span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{r.title}</h3>
                  {r.status === "fulfilled" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[11px] text-accent">
                      <CheckCircle2 className="h-3 w-3" /> Added by {r.fulfilledBy ?? "someone"}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted">{r.author ?? "Unknown author"}</p>
                {r.note && <p className="mt-1.5 text-sm text-fg/85">{r.note}</p>}
                <p className="mt-1.5 text-xs text-muted">
                  Requested by {r.isMine ? "you" : (r.requestedBy ?? "someone")} {timeAgo(r.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                {r.status === "open" ? (
                  <button className="btn-outline py-2 text-xs" onClick={() => setFulfilling(r)}>
                    <HandHelping className="h-3.5 w-3.5" /> I have it
                  </button>
                ) : (
                  r.fulfilledBookId && (
                    <Link to={`/public?book=${r.fulfilledBookId}`} className="btn py-2 text-xs">
                      <BookOpen className="h-3.5 w-3.5" /> View
                    </Link>
                  )
                )}
                {r.canClose && (
                  <button
                    className="icon-btn h-8 w-8"
                    aria-label={`Close request ${r.title}`}
                    title="Close request"
                    onClick={async () => {
                      if (!window.confirm(`Close the request for “${r.title}”?`)) return;
                      await closeRequest(r.id).catch(() => {});
                      load();
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {fulfilling && (
        <FulfillDialog
          request={fulfilling}
          onClose={() => setFulfilling(null)}
          onDone={() => {
            setFulfilling(null);
            load();
          }}
        />
      )}
    </>
  );
}
