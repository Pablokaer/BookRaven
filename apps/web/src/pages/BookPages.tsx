import {
  ArrowLeft,
  Bookmark as BookmarkIcon,
  BookOpen,
  Download,
  ExternalLink,
  Flag,
  FolderInput,
  Globe,
  Highlighter,
  Loader2,
  Plus,
  Share2,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { BookMenu, FavoriteButton } from "../components/books/BookActions";
import { EmptyState } from "../components/books/BookBrowser";
import { BookCover } from "../components/books/BookCover";
import { ProgressBar } from "../components/books/ProgressBar";
import { ReportDialog } from "../components/ReportDialog";
import type { Book, BookAbout, Bookmark, Highlight, PublicBook, PublicBookDetails } from "../lib/api";
import { loadBookmarks } from "../lib/bookmarks";
import { isFinished, readingStatus, shortDate } from "../lib/bookStats";
import { getBook, getBookAbout } from "../lib/books";
import { listClubs, type ClubSummary } from "../lib/clubs";
import { fileSize, timeAgo } from "../lib/format";
import { HIGHLIGHT_COLORS, highlightsToMarkdown, downloadText, listHighlights } from "../lib/highlights";
import { authClient } from "../lib/auth";
import { useLibrary } from "../lib/libraryStore";
import { getPublicBook, listPublicBooks } from "../lib/publicLibrary";
import { THEME_INFO } from "../lib/themes";
import { languageName, PublisherInfo, Shelf, usePublicBookActions } from "./PublicLibraryPage";

/** The blurb, clamped to a few lines with a toggle when it is long. */
function Description({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return <p className="text-sm text-muted">No description in this file.</p>;
  const long = text.length > 420;
  return (
    <div>
      <p className={`whitespace-pre-line text-[15px] leading-relaxed text-fg/90 ${long && !open ? "line-clamp-6" : ""}`}>{text}</p>
      {long && (
        <button className="mt-2 text-sm font-medium text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/** Label and value, in the facts list beside the description. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line/60 py-2.5 text-sm last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** Cover on the left, everything else on the right; stacked and centered on phones. */
function BookLayout({ back, cover, children }: { back: ReactNode; cover: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">{back}</div>
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
        <div className="mx-auto w-44 shrink-0 sm:mx-0 sm:w-52">{cover}</div>
        <div className="min-w-0 flex-1 space-y-8">{children}</div>
      </div>
    </div>
  );
}

function BackLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button
      className="btn-ghost -ml-3"
      // Back to wherever the book was opened from; a direct link falls back to `to`.
      onClick={() => (window.history.state?.idx ? navigate(-1) : navigate(to))}
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  );
}

function Title({ book, children }: { book: { title: string; author: string | null }; children?: ReactNode }) {
  return (
    <header className="text-center sm:text-left">
      <h1 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{book.title}</h1>
      <p className="mt-2 text-lg text-muted">{book.author ?? "Unknown author"}</p>
      {children}
    </header>
  );
}

function ThemeChips({ themes }: { themes: string[] }) {
  const known = themes.filter((t) => THEME_INFO[t]);
  if (!known.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {known.map((t) => {
        const Icon = THEME_INFO[t]!.icon;
        return (
          <Link key={t} to={`/public?theme=${t}`} className="pill py-1">
            <Icon className="h-3.5 w-3.5" /> {THEME_INFO[t]!.label}
          </Link>
        );
      })}
    </div>
  );
}

/** "/books/:id" — one of the user's own books: progress, description, details, highlights, clubs. */
export function BookPage() {
  const { id } = useParams<{ id: string }>();
  const { books, folders, openShare, openOrganize } = useLibrary();
  const [fetched, setFetched] = useState<Book | null | "missing">(null);
  const [about, setAbout] = useState<BookAbout | null>(null);
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [clubs, setClubs] = useState<ClubSummary[]>([]);

  // The library list is the live copy (favorites, tags… update it); fetch only if it isn't loaded.
  const book = books?.find((b) => b.id === id) ?? (fetched !== "missing" ? fetched : null);
  useEffect(() => {
    if (!id || books?.some((b) => b.id === id)) return;
    if (books) return setFetched("missing"); // loaded and not there: deleted or not ours
    getBook(id).then(setFetched, () => setFetched("missing"));
  }, [id, books]);
  useEffect(() => {
    if (!id) return;
    setAbout(null);
    setHighlights(null);
    getBookAbout(id).then(setAbout, () => {});
    listHighlights(id).then(setHighlights, () => setHighlights([]));
    setBookmarks([]);
    loadBookmarks(id).then(setBookmarks, () => {});
    listClubs(id).then(setClubs, () => {});
  }, [id]);

  if (fetched === "missing" && !book) {
    return (
      <EmptyState icon={<BookOpen />} title="Book not found">
        It was deleted, or it is not in your library. <Link to="/" className="text-accent hover:underline">Your library</Link>
      </EmptyState>
    );
  }
  if (!book) return <div className="mx-auto h-80 max-w-5xl animate-pulse rounded-2xl bg-card/60" />;

  const p = book.progress;
  const folder = folders.find((f) => f.id === book.folderId);

  return (
    <BookLayout back={<BackLink to="/" label="Library" />} cover={<BookCover book={book} size="lg" badge className="w-full" />}>
      <Title book={book} />

      <section className="surface space-y-4 p-5" aria-label="Your reading">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className={p && !isFinished(book) ? "font-medium text-accent" : "font-medium"}>{readingStatus(book)}</span>
          {p && (
            <span className="truncate text-xs text-muted" title={new Date(p.updatedAt).toLocaleString()}>
              {[p.label, `${timeAgo(p.updatedAt)}${p.deviceName ? ` on ${p.deviceName}` : ""}`].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
        <ProgressBar value={p?.percentage ?? 0} className={p ? "" : "opacity-40"} />
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/read/${book.id}`} className="btn">
            <BookOpen className="h-4 w-4" /> {p ? (isFinished(book) ? "Read again" : "Continue reading") : "Start reading"}
          </Link>
          <button className="btn-outline" onClick={() => openShare(book)}>
            <Share2 className="h-4 w-4" /> Share
          </button>
          <button className="btn-outline" onClick={() => openOrganize(book)}>
            <FolderInput className="h-4 w-4" /> Collection & tags
          </button>
          <FavoriteButton book={book} className="icon-btn h-10 w-10" />
          <BookMenu book={book} className="icon-btn h-10 w-10" />
        </div>
      </section>

      <section aria-labelledby="about-heading" className="grid gap-8 lg:grid-cols-[1fr_16rem]">
        <div>
          <h2 id="about-heading" className="mb-3 font-display text-xl font-semibold">
            About this book
          </h2>
          <Description text={book.description} />
          {about?.subjects.length ? <p className="mt-4 text-xs text-muted">{about.subjects.slice(0, 6).join(" · ")}</p> : null}
        </div>
        <dl className="surface self-start px-4 py-1">
          <Fact label="Format">{book.format.toUpperCase()}</Fact>
          <Fact label="Size">{fileSize(book.sizeBytes)}</Fact>
          {book.language && <Fact label="Language">{languageName(book.language)}</Fact>}
          <Fact label="Added">{shortDate(book.createdAt)}</Fact>
          {book.sharedBy && <Fact label="Shared by">{book.sharedBy}</Fact>}
          <Fact label="Collection">
            {folder ? (
              <Link to={`/collections/${folder.id}`} className="text-accent hover:underline">
                {folder.name}
              </Link>
            ) : (
              <span className="text-muted">None</span>
            )}
          </Fact>
          {book.tags.length > 0 && <Fact label="Tags">{book.tags.join(", ")}</Fact>}
          {about && about.readers > 0 && (
            <Fact label="Readers">
              {about.readers} other {about.readers === 1 ? "reader" : "readers"}
            </Fact>
          )}
          {about?.publicBookId && (
            <Fact label="Public Library">
              <Link to={`/public/books/${about.publicBookId}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                <Globe className="h-3.5 w-3.5" /> {book.isPublic ? "Published" : "Available"}
              </Link>
            </Fact>
          )}
          {about?.source && (
            <Fact label="Source">
              <a href={about.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                {about.source.name} <ExternalLink className="h-3 w-3" />
              </a>
            </Fact>
          )}
        </dl>
      </section>

      <section aria-labelledby="highlights-heading">
        <div className="mb-3 flex items-center gap-3">
          <h2 id="highlights-heading" className="mr-auto flex items-center gap-2 font-display text-xl font-semibold">
            <Highlighter className="h-5 w-5 text-accent" /> Highlights
            {highlights?.length ? <span className="font-sans text-sm font-normal text-muted">{highlights.length}</span> : null}
          </h2>
          {highlights && highlights.length > 0 && (
            <button
              className="btn-ghost py-1.5 text-xs"
              onClick={() => downloadText(`${book.title} - highlights.md`, highlightsToMarkdown(book, highlights))}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          )}
        </div>
        {highlights === null ? (
          <div className="h-16 animate-pulse rounded-xl bg-card/60" />
        ) : highlights.length === 0 ? (
          <p className="text-sm text-muted">Select text while reading to highlight it or add a note.</p>
        ) : (
          <ul className="space-y-3">
            {highlights.map((h) => (
              <li key={h.id}>
                <Link
                  to={`/read/${book.id}?at=${encodeURIComponent(h.cfi)}`}
                  className="surface block border-l-4 p-4 transition hover:border-accent/40"
                  style={{ borderLeftColor: HIGHLIGHT_COLORS[h.color].fill }}
                >
                  <p className="font-display text-[15px] leading-relaxed">“{h.text}”</p>
                  {h.note && <p className="mt-2 text-sm text-muted">{h.note}</p>}
                  {h.label && <p className="mt-2 text-xs text-muted">{h.label}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {bookmarks.length > 0 && (
        <section aria-labelledby="bookmarks-heading">
          <h2 id="bookmarks-heading" className="mb-3 flex items-center gap-2 font-display text-xl font-semibold">
            <BookmarkIcon className="h-5 w-5 text-accent" /> Bookmarks
            <span className="font-sans text-sm font-normal text-muted">{bookmarks.length}</span>
          </h2>
          <ul className="space-y-2">
            {bookmarks.map((b) => (
              <li key={b.locator}>
                <Link
                  to={`/read/${book.id}?at=${encodeURIComponent(b.locator)}`}
                  className="surface flex items-center gap-3 px-4 py-3 text-sm transition hover:border-accent/40"
                >
                  <BookmarkIcon className="h-4 w-4 shrink-0 fill-red-500 text-red-500" />
                  <span className="min-w-0 flex-1 truncate font-medium">{b.title || b.label || "Bookmark"}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {b.title && b.label ? `${b.label} · ` : ""}
                    {Math.round(b.percentage * 100)}%
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {clubs.length > 0 && (
        <section aria-labelledby="clubs-heading">
          <h2 id="clubs-heading" className="mb-3 flex items-center gap-2 font-display text-xl font-semibold">
            <UsersRound className="h-5 w-5 text-accent" /> Book clubs reading it
          </h2>
          <ul className="space-y-2">
            {clubs.map((c) => (
              <li key={c.id}>
                <Link to={`/clubs/${c.id}`} className="surface flex items-center justify-between gap-3 px-4 py-3 text-sm transition hover:border-accent/40">
                  <span className="font-medium">{c.name}</span>
                  {c.members ? (
                    <span className="text-xs text-muted">
                      {c.members} {c.members === 1 ? "member" : "members"}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </BookLayout>
  );
}

/** "/public/books/:id" — a book of the public library: who shared it, description, actions, more like it. */
export function PublicBookPage() {
  const { id } = useParams<{ id: string }>();
  const { publicVersion } = useLibrary();
  const me = authClient.useSession().data?.user;
  const [book, setBook] = useState<PublicBookDetails | null | "missing">(null);
  const [all, setAll] = useState<PublicBook[] | null>(null);

  useEffect(() => {
    if (id) getPublicBook(id).then(setBook, () => setBook("missing"));
  }, [id, publicVersion]);
  useEffect(() => {
    listPublicBooks().then(setAll, () => {});
  }, [publicVersion]);

  // More by the same author, then more from the same sections, most popular first.
  const related = useMemo(() => {
    if (!all || !book || book === "missing") return { byAuthor: [], similar: [] };
    const others = all.filter((b) => b.id !== book.id);
    const byPop = (a: PublicBook, b: PublicBook) => (b.popularity ?? -1) - (a.popularity ?? -1);
    const byAuthor = book.author ? others.filter((b) => b.author === book.author).sort(byPop).slice(0, 12) : [];
    const seen = new Set(byAuthor.map((b) => b.id));
    const similar = others
      .filter((b) => !seen.has(b.id) && b.themes.some((t) => book.themes.includes(t)))
      .sort((a, b) => b.themes.filter((t) => book.themes.includes(t)).length - a.themes.filter((t) => book.themes.includes(t)).length || byPop(a, b))
      .slice(0, 12);
    return { byAuthor, similar };
  }, [all, book]);

  if (book === "missing") {
    return (
      <EmptyState icon={<Globe />} title="Not in the Public Library">
        It was removed, or the link is wrong. <Link to="/public" className="text-accent hover:underline">Browse the Public Library</Link>
      </EmptyState>
    );
  }
  if (!book) return <div className="mx-auto h-80 max-w-5xl animate-pulse rounded-2xl bg-card/60" />;
  return <PublicBookView book={book} related={related} viewerName={me?.name || me?.email} />;
}

function PublicBookView({ book, related, viewerName }: { book: PublicBookDetails; related: { byAuthor: PublicBook[]; similar: PublicBook[] }; viewerName?: string | null }) {
  const navigate = useNavigate();
  // After removing, the page leaves (below) instead of reloading a book that is gone.
  const { busy, error, add, download, remove, reporting, setReporting } = usePublicBookActions(book, () => {});

  return (
    <BookLayout
      back={<BackLink to="/public" label="Public Library" />}
      cover={<BookCover book={book} size="lg" badge coverPath={`/api/public/${book.id}/cover`} className="w-full" />}
    >
      <Title book={book}>
        {book.source && (
          <a
            href={book.source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent ring-1 ring-accent/25 hover:bg-accent/20"
          >
            Public domain · {book.source.name} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </Title>

      <section className="surface space-y-4 p-5" aria-label="Get this book">
        <div className="flex flex-wrap items-center gap-2">
          {book.ownBookId ? (
            <>
              <Link to={`/read/${book.ownBookId}`} className="btn">
                <BookOpen className="h-4 w-4" /> Read
              </Link>
              <Link to={`/books/${book.ownBookId}`} className="btn-outline">
                In your library
              </Link>
            </>
          ) : (
            <button className="btn" disabled={busy !== null} onClick={() => void add()}>
              {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add to my library
            </button>
          )}
          <button className="btn-outline" disabled={busy !== null} onClick={() => void download()}>
            {busy === "download" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download
          </button>
          {!book.isMine && (
            <button className="btn-ghost" onClick={() => setReporting(true)}>
              <Flag className="h-4 w-4" /> Report
            </button>
          )}
          {book.canRemove && (
            <button
              className="btn-ghost text-rose-300"
              onClick={() =>
                void remove().then((removed) => {
                  // Gone from the public library: nothing left to show here.
                  if (removed) navigate("/public");
                })
              }
            >
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          )}
        </div>
        {!book.ownBookId && <p className="text-xs text-muted">Adding a copy lets you read it with synced progress, highlights and notes.</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </section>

      <PublisherInfo book={book} viewerName={viewerName} />

      <section aria-labelledby="about-heading" className="grid gap-8 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          <h2 id="about-heading" className="font-display text-xl font-semibold">
            About this book
          </h2>
          <Description text={book.description} />
          <ThemeChips themes={book.themes} />
          {book.subjects.length ? <p className="text-xs text-muted">{book.subjects.slice(0, 6).join(" · ")}</p> : null}
        </div>
        <dl className="surface self-start px-4 py-1">
          <Fact label="Format">{book.format.toUpperCase()}</Fact>
          <Fact label="Size">{fileSize(book.sizeBytes)}</Fact>
          {book.language && <Fact label="Language">{languageName(book.language)}</Fact>}
          <Fact label="Published">{shortDate(book.publishedAt)}</Fact>
          <Fact label="Readers">
            {book.readers} {book.readers === 1 ? "reader" : "readers"}
          </Fact>
        </dl>
      </section>

      {related.byAuthor.length > 0 && <Shelf title={`More by ${book.author}`} icon={<BookOpen />} books={related.byAuthor} total={related.byAuthor.length} />}
      {related.similar.length > 0 && <Shelf title="You might also like" icon={<Globe />} books={related.similar} total={related.similar.length} />}

      {reporting && <ReportDialog book={book} onClose={() => setReporting(false)} />}
    </BookLayout>
  );
}
