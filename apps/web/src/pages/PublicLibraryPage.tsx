import { BookOpen, Download, Globe, Loader2, MoreHorizontal, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { EmptyState, BookGridSkeleton } from "../components/books/BookBrowser";
import { BookCover } from "../components/books/BookCover";
import { StorageMeter } from "../components/shell/StorageMeter";
import { Menu } from "../components/ui/Menu";
import { ApiError, type PublicBook } from "../lib/api";
import { isComicFormat } from "../lib/comics";
import { fileSize } from "../lib/format";
import { useLibrary } from "../lib/libraryStore";
import { addPublicBook, downloadPublicBook, listPublicBooks, removePublicBook } from "../lib/publicLibrary";
import { shortDate } from "../lib/bookStats";

type Sort = "newest" | "title" | "author";

function PublicBookCard({ book, onChanged }: { book: PublicBook; onChanged: () => void }) {
  const { replaceBook, refreshMe, me } = useLibrary();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"add" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy("add");
    setError(null);
    try {
      const copy = await addPublicBook(book.id);
      replaceBook(copy);
      refreshMe();
      navigate(`/read/${copy.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 413
          ? `Not enough space in your library${me?.quotaBytes ? ` (limit ${fileSize(me.quotaBytes)})` : ""}.`
          : "Could not add this book, try again.",
      );
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    setError(null);
    try {
      await downloadPublicBook(book);
    } catch {
      setError("Download failed, try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const who = book.isMine ? "your" : `${book.publishedBy ?? "this user"}’s`;
    if (!window.confirm(`Remove ${who} “${book.title}” from the public library? Copies people already added stay in their libraries.`)) return;
    await removePublicBook(book.id).catch(() => setError("Could not remove it, try again."));
    onChanged();
  };

  const cover = <BookCover book={book} badge coverPath={`/api/public/${book.id}/cover`} className="w-full transition duration-300 group-hover:-translate-y-1" />;

  return (
    <article className="group flex animate-rise flex-col">
      {book.ownBookId ? (
        <Link to={`/read/${book.ownBookId}`} aria-label={`Read ${book.title}`} className="rounded-lg">
          {cover}
        </Link>
      ) : (
        cover
      )}
      <div className="mt-3 flex flex-1 flex-col">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug" title={book.title}>
          {book.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted">{book.author ?? "Unknown author"}</p>
        <p className="mt-2 truncate text-[11px] text-muted" title={`Published ${shortDate(book.publishedAt)}`}>
          {book.isMine ? "Published by you" : `Shared by ${book.publishedBy ?? "someone"}`} · {fileSize(book.sizeBytes)}
        </p>
        {error && <p className="mt-1.5 text-[11px] text-rose-300">{error}</p>}
        <div className="mt-3 flex items-center gap-1">
          {book.ownBookId ? (
            <Link to={`/read/${book.ownBookId}`} className="btn mr-auto px-3 py-1.5 text-xs">
              <BookOpen className="h-3.5 w-3.5" /> Read
            </Link>
          ) : (
            <button className="btn mr-auto px-3 py-1.5 text-xs" disabled={busy !== null} onClick={() => void add()}>
              {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
            </button>
          )}
          <button
            className="icon-btn h-8 w-8"
            aria-label={`Download ${book.title}`}
            title="Download a copy"
            disabled={busy !== null}
            onClick={() => void download()}
          >
            {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </button>
          {book.canRemove && (
            <Menu
              label={`More actions for ${book.title}`}
              triggerClassName="icon-btn h-8 w-8"
              trigger={<MoreHorizontal className="h-4 w-4" />}
              items={[{ label: "Remove from public library", icon: <Trash2 />, danger: true, onSelect: () => void remove() }]}
            />
          )}
        </div>
      </div>
    </article>
  );
}

/** "/public" — books shared with every account on this server. */
export function PublicLibraryPage() {
  const { query, publicVersion, me } = useLibrary();
  const [books, setBooks] = useState<PublicBook[] | null>(null);
  const [error, setError] = useState(false);
  const [format, setFormat] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const load = useCallback(() => {
    listPublicBooks()
      .then((list) => {
        setBooks(list);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load, publicVersion]);

  const formats = useMemo(() => [...new Set(books?.map((b) => b.format))].sort(), [books]);
  const visible = useMemo(() => {
    if (!books) return null;
    const q = query.trim().toLowerCase();
    const list = books.filter(
      (b) =>
        (format === "all" || (format === "comics" ? isComicFormat(b.format) : b.format === format)) &&
        (!q || `${b.title} ${b.author ?? ""} ${b.publishedBy ?? ""}`.toLowerCase().includes(q)),
    );
    const text = (a: string | null, b: string | null) => (a ?? "￿").localeCompare(b ?? "￿", undefined, { sensitivity: "base", numeric: true });
    if (sort === "title") list.sort((a, b) => text(a.title, b.title));
    else if (sort === "author") list.sort((a, b) => text(a.author, b.author) || text(a.title, b.title));
    return list;
  }, [books, format, sort, query]);

  return (
    <>
      <header className="mb-8 flex flex-wrap items-end gap-4">
        <div className="mr-auto max-w-2xl">
          <h1 className="flex items-center gap-3 font-display text-3xl font-bold tracking-tight">
            <Globe className="h-7 w-7 text-accent" /> Public Library
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Books shared with everyone on this server. Add a copy to your library to read it with synced progress, or download the file.
            Publish your own books from a book’s ⋯ menu.
          </p>
        </div>
        {me?.isAdmin && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">
            <ShieldCheck className="h-3.5 w-3.5" /> Administrator: you can remove any book
          </span>
        )}
      </header>

      <div className="surface mb-8 max-w-md p-4">
        <StorageMeter />
      </div>

      {books && books.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {["all", ...formats, ...(formats.some(isComicFormat) ? ["comics"] : [])].map((f) => (
            <button key={f} className={`pill ${format === f ? "pill-on" : ""}`} aria-pressed={format === f} onClick={() => setFormat(f)}>
              {f === "all" ? "All Books" : f === "comics" ? "Comics" : f.toUpperCase()}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            <span className="hidden sm:inline">Sort by</span>
            <select className="input py-1.5" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">Newest</option>
              <option value="title">Title</option>
              <option value="author">Author</option>
            </select>
          </label>
        </div>
      )}

      <section className="@container" aria-label="Public books">
        {error && !books ? (
          <EmptyState icon={<Globe />} title="Could not load the public library">
            <button className="text-accent hover:underline" onClick={load}>
              Try again
            </button>
          </EmptyState>
        ) : visible === null ? (
          <BookGridSkeleton />
        ) : books!.length === 0 ? (
          <EmptyState icon={<Globe />} title="Nothing here yet">
            Be the first: open a book’s ⋯ menu in your library and choose “Publish to Public Library”.
          </EmptyState>
        ) : visible.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted">No public books match {query.trim() ? `“${query.trim()}”` : "this filter"}.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-8 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5 @6xl:grid-cols-6">
            {visible.map((b) => (
              <PublicBookCard key={b.id} book={b} onChanged={load} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
