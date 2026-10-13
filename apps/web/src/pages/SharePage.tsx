import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AuthImage } from "../components/AuthImage";
import { ApiError } from "../lib/api";
import { acceptShare, getSharedBook, type SharedBook } from "../lib/shares";

/** Landing page for a share link: preview the book and add it to your library. */
export function SharePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState<SharedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSharedBook(token)
      .then(setBook)
      .catch((err) =>
        setError(err instanceof ApiError && err.status === 404 ? "This share link is invalid or was revoked." : "Could not load this link."),
      );
  }, [token]);

  const add = async () => {
    setBusy(true);
    try {
      const added = await acceptShare(token);
      navigate(`/read/${added.id}`, { replace: true });
    } catch {
      setError("Could not add the book, try again.");
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
        <Link to="/" className="btn-ghost">
          Back to library
        </Link>
      </div>
    </div>
  );
}
