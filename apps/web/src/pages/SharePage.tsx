import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AuthImage } from "../components/AuthImage";
import { ApiError } from "../lib/api";
import { fileSize } from "../lib/format";
import { acceptCollectionShare, acceptShare, getSharedBook, getSharedCollection } from "../lib/shares";
import { useApi } from "../lib/useApi";

const linkError = (err: unknown) =>
  err instanceof ApiError && err.status === 404 ? "This share link is invalid or was revoked." : "Could not load this link.";

/** Landing page for a share link: preview the book and add it to your library. */
export function SharePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { data: book, error: loadError } = useApi(() => getSharedBook(token), [token]);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const error = loadError ? linkError(loadError) : addError;

  const add = async () => {
    setBusy(true);
    try {
      const added = await acceptShare(token);
      navigate(`/read/${added.id}`, { replace: true });
    } catch {
      setAddError("Could not add the book, try again.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[70dvh] items-center justify-center">
      <div className="surface w-full max-w-sm animate-rise space-y-6 p-8 text-center">
        {error ? (
          <p className="text-sm">{error}</p>
        ) : !book ? (
          <div className="mx-auto aspect-[2/3] w-36 animate-pulse rounded-lg bg-elevated" />
        ) : (
          <>
            <div className="relative mx-auto aspect-[2/3] w-36 overflow-hidden rounded-lg bg-elevated shadow-pop">
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/60 to-card p-3 font-display text-sm font-semibold">
                {book.title}
              </div>
              {book.hasCover && <AuthImage path={`/api/shares/${token}/cover`} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            </div>
            <div>
              <p className="eyebrow text-accent/90">{book.sharedBy ? `${book.sharedBy} shared a book with you` : "Shared book"}</p>
              <h1 className="mt-2 font-display text-xl font-semibold leading-snug">{book.title}</h1>
              <p className="mt-1 text-sm text-muted">
                {book.author ?? "Unknown author"} · {book.format.toUpperCase()}
              </p>
            </div>
            {book.ownBookId ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">This book is already in your library.</p>
                <Link to={`/read/${book.ownBookId}`} className="btn w-full">
                  Open it
                </Link>
              </div>
            ) : (
              <button className="btn w-full" disabled={busy} onClick={() => void add()}>
                {busy ? "Adding…" : "Add to my library"}
              </button>
            )}
          </>
        )}
        {/* The only way on when the link is broken, so it looks like a button there. */}
        <Link to="/" className={error ? "btn-outline" : "btn-ghost"}>
          Back to library
        </Link>
      </div>
    </div>
  );
}

/** Landing page for a collection link: preview its books and add them all to your library. */
export function SharedCollectionPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { data: collection, error: loadError } = useApi(() => getSharedCollection(token), [token]);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const error = loadError ? linkError(loadError) : addError;

  const missing = collection?.books.filter((b) => !b.ownBookId) ?? [];
  const missingBytes = missing.reduce((n, b) => n + b.sizeBytes, 0);

  const add = async () => {
    setBusy(true);
    try {
      const res = await acceptCollectionShare(token);
      navigate(`/collections/${res.folderId}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 413 && err.body?.folderId) {
        // Some books fit before the storage limit: show what was added.
        window.alert(`Your storage is full: ${err.body.added} book${err.body.added === 1 ? " was" : "s were"} added.`);
        navigate(`/collections/${err.body.folderId}`, { replace: true });
        return;
      }
      setAddError(err instanceof ApiError && err.status === 413 ? "Your storage is full." : "Could not add the books, try again.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      {error ? (
        <div className="surface p-8 text-center text-sm">{error}</div>
      ) : !collection ? (
        <div className="h-40 animate-pulse rounded-2xl bg-elevated" />
      ) : (
        <>
          <header className="mb-8 flex flex-wrap items-end gap-4">
            <div className="mr-auto min-w-0">
              <p className="eyebrow text-accent/90">{collection.sharedBy ? `${collection.sharedBy} shared a collection with you` : "Shared collection"}</p>
              <h1 className="mt-2 truncate font-display text-3xl font-bold tracking-tight">{collection.name}</h1>
              <p className="mt-1.5 text-sm text-muted">
                {collection.books.length} book{collection.books.length === 1 ? "" : "s"}
                {!collection.isOwner && collection.books.length > 0 &&
                  (missing.length ? ` · ${missing.length} not in your library (${fileSize(missingBytes)})` : " · all already in your library")}
              </p>
            </div>
            {collection.isOwner ? (
              <p className="text-sm text-muted">This is your collection.</p>
            ) : (
              missing.length > 0 && (
                <button className="btn" disabled={busy} onClick={() => void add()}>
                  {busy ? "Adding…" : missing.length === collection.books.length ? "Add all to my library" : `Add ${missing.length} missing`}
                </button>
              )
            )}
          </header>
          <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5">
            {collection.books.map((b) => (
              <li key={b.id} className="min-w-0">
                <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-elevated shadow-pop">
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/60 to-card p-2 text-center font-display text-xs font-semibold">
                    {b.title}
                  </div>
                  {b.hasCover && (
                    <AuthImage path={`/api/collection-shares/${token}/books/${b.id}/cover`} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-medium">{b.ownBookId ? <Link to={`/read/${b.ownBookId}`}>{b.title}</Link> : b.title}</p>
                <p className="truncate text-xs text-muted">{b.author ?? "Unknown author"}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-8 text-center">
        <Link to="/" className="btn-ghost">
          Back to library
        </Link>
      </div>
    </div>
  );
}
