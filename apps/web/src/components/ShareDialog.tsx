import { useEffect, useState } from "react";
import type { Book } from "../lib/api";
import { Check, Copy, Globe, Link2, Send } from "lucide-react";
import { updateBook } from "../lib/library";
import { useLibrary } from "../lib/libraryStore";
import { createShareToken, getShareToken, revokeShare, shareUrl } from "../lib/shares";
import { Modal } from "./ui/Modal";

/** Creates/shows a book's share link. Anyone signed in with the link can add the book to their library. */
export function ShareDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { replaceBook } = useLibrary();

  useEffect(() => {
    getShareToken(book.id)
      .then(setToken)
      .catch(() => setError("Could not load the share link"));
  }, [book.id]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError("Something went wrong, try again");
    } finally {
      setBusy(false);
    }
  };

  const url = token ? shareUrl(token) : null;

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title={<>Share “{book.title}”</>} onClose={onClose} footer={<button className="btn-ghost" onClick={onClose}>Close</button>}>
      <p className="-mt-2 text-sm text-muted">
        Anyone with the link who signs in can add a copy of this book to their own library. Your reading progress is not shared.
      </p>

      {token === undefined && !error && <div className="h-11 animate-pulse rounded-xl bg-elevated" />}

      {token === null && (
        <button
          className="btn w-full"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setToken(await createShareToken(book.id));
              replaceBook({ ...book, isShared: true });
            })
          }
        >
          <Link2 className="h-4 w-4" /> Create share link
        </button>
      )}

      {url && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input readOnly value={url} aria-label="Share link" className="input min-w-0 flex-1" onFocus={(e) => e.target.select()} />
            <button className="btn" onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex justify-between gap-2">
            {"share" in navigator ? (
              <button className="btn-outline" onClick={() => void navigator.share({ title: book.title, url }).catch(() => {})}>
                <Send className="h-4 w-4" /> Send…
              </button>
            ) : (
              <span />
            )}
            <button
              className="btn-ghost text-rose-300 hover:text-rose-200"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await revokeShare(book.id);
                  setToken(null);
                  replaceBook({ ...book, isShared: false });
                })
              }
            >
              Stop sharing
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3 border-t border-line pt-5">
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <label className="min-w-0 flex-1 cursor-pointer">
          <span className="block text-sm font-medium">Public Library</span>
          <span className="block text-xs text-muted">Every account on this server can find, read and download it.</span>
        </label>
        <input
          type="checkbox"
          role="switch"
          aria-label="Publish to the Public Library"
          className="mt-1 h-5 w-5 accent-[var(--color-primary)]"
          checked={book.isPublic}
          disabled={busy}
          onChange={(e) => {
            const isPublic = e.target.checked;
            void run(async () => replaceBook(await updateBook(book.id, { isPublic })));
          }}
        />
      </div>

      {error && <p className="text-sm text-rose-300">{error}</p>}
    </Modal>
  );
}
