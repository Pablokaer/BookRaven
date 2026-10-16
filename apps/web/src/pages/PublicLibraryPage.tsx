import { ArrowRight, BookOpen, Download, ExternalLink, Flag, Flame, Globe, HandHelping, Library, Loader2, MoreHorizontal, Plus, ShieldCheck, Sparkles, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { EmptyState, BookGridSkeleton, GRID } from "../components/books/BookBrowser";
import { BookCover } from "../components/books/BookCover";
import { ReportDialog } from "../components/ReportDialog";
import { RequestsTab } from "../components/RequestsTab";
import { Avatar } from "../components/ui/Avatar";
import { Menu } from "../components/ui/Menu";
import { PageHeader } from "../components/ui/PageHeader";
import { ApiError, type PublicBook } from "../lib/api";
import { isComicFormat } from "../lib/comicFormats";
import { recommend } from "../lib/recommend";
import { fileSize } from "../lib/format";
import { useLibrary } from "../lib/libraryStore";
import { addPublicBook, downloadPublicBook, listPublicBooks, removePublicBook } from "../lib/publicLibrary";
import { byPopularity, byText, shortDate } from "../lib/bookStats";
import { THEME_INFO, THEME_ORDER } from "../lib/themes";
import { useApi } from "../lib/useApi";

type Sort = "popular" | "newest" | "title" | "author";

const SHELF_SIZE = 18;
const PAGE_SIZE = 60;

/** "pt" → "Português", in the language itself. */
export function languageName(code: string) {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code.toUpperCase();
  }
}

/** Who put the book in the public library, shown in full on the book's page. `viewerName` is the current user's display name, for their own books. */
export function PublisherInfo({ book, viewerName }: { book: PublicBook; viewerName?: string | null }) {
  // An account's name can be empty: "Someone", with a silhouette, rather than a blank line.
  const publisher = book.isMine ? viewerName?.trim() : book.publishedBy?.trim();
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-elevated/40 p-3">
      <Avatar name={publisher} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{book.isMine ? "Published by" : "Shared by"}</p>
        <p className="break-words text-sm font-medium">{book.isMine ? "You" : publisher || "Someone"}</p>
      </div>
      <span className="shrink-0 text-xs text-muted">{shortDate(book.publishedAt)}</span>
    </div>
  );
}

/** Add, download, report and remove for a public book; shared by its card and its page. */
export function usePublicBookActions(book: PublicBook, onChanged: () => void) {
  const { replaceBook, refreshMe, me } = useLibrary();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"add" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

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

  /** Resolves to true once the book is out of the public library. */
  const remove = async () => {
    const who = book.isMine ? "your" : `${book.publishedBy ?? "this user"}’s`;
    if (!window.confirm(`Remove ${who} “${book.title}” from the public library? Copies people already added stay in their libraries.`)) return false;
    try {
      await removePublicBook(book.id);
    } catch {
      setError("Could not remove it, try again.");
      return false;
    }
    onChanged();
    return true;
  };

  return { busy, error, add, download, remove, reporting, setReporting };
}

export function PublicBookCard({
  book,
  onChanged,
  focused,
  showPublisher = true,
}: {
  book: PublicBook;
  onChanged: () => void;
  focused: boolean;
  showPublisher?: boolean;
}) {
  const { busy, error, add, download, remove, reporting, setReporting } = usePublicBookActions(book, onChanged);

  const cover = <BookCover book={book} badge coverPath={`/api/public/${book.id}/cover`} className="w-full transition duration-300 group-hover:-translate-y-1" />;

  return (
    <article
      id={`pub-${book.id}`}
      className={`group flex animate-rise flex-col rounded-xl transition ${focused ? "ring-2 ring-accent ring-offset-8 ring-offset-app" : ""}`}
    >
      <Link to={`/public/books/${book.id}`} aria-label={`About ${book.title}`} className="rounded-lg">
        {cover}
      </Link>
      <div className="mt-3 flex flex-1 flex-col">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug" title={book.title}>
          {book.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted">{book.author ?? "Unknown author"}</p>
        <p className="mt-2 truncate text-xs text-muted" title={`Published ${shortDate(book.publishedAt)}`}>
          {showPublisher && <>{book.isMine ? "Published by you" : `Shared by ${book.publishedBy ?? "someone"}`} · </>}
          {fileSize(book.sizeBytes)}
        </p>
        {book.source && (
          <a
            href={book.source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent ring-1 ring-accent/25 hover:bg-accent/20"
            title={`Public domain, from ${book.source.name}`}
          >
            Public domain · {book.source.name} <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
        {error && <p className="mt-1.5 text-xs text-rose-300">{error}</p>}
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
          <Menu
            label={`More actions for ${book.title}`}
            triggerClassName="icon-btn h-8 w-8"
            trigger={<MoreHorizontal className="h-4 w-4" />}
            items={[
              ...(!book.isMine ? [{ label: "Report…", icon: <Flag />, onSelect: () => setReporting(true) }] : []),
              ...(book.canRemove ? [{ label: "Remove from public library", icon: <Trash2 />, danger: true, onSelect: () => void remove() }] : []),
            ]}
          />
        </div>
      </div>
      {reporting && <ReportDialog book={book} onClose={() => setReporting(false)} />}
    </article>
  );
}

/** A horizontal row of covers; a click opens the book's page. */
export function Shelf({
  title,
  icon,
  blurb,
  books,
  total,
  onSeeAll,
}: {
  title: string;
  icon: React.ReactNode;
  blurb?: string;
  books: PublicBook[];
  total: number;
  onSeeAll?: () => void;
}) {
  return (
    <section className="animate-rise" aria-label={title}>
      <div className="mb-3 flex items-end gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            <span className="text-accent [&>svg]:h-5 [&>svg]:w-5">{icon}</span> {title}
            <span className="font-sans text-sm font-normal text-muted">{total}</span>
          </h2>
          {blurb && <p className="text-xs text-muted">{blurb}</p>}
        </div>
        {onSeeAll && total > books.length && (
          <button className="btn-ghost ml-auto shrink-0 py-1.5 text-xs" onClick={onSeeAll}>
            See all <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <ul className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-3 [scrollbar-width:thin]">
        {books.map((b) => (
          <li key={b.id} className="w-28 shrink-0 snap-start sm:w-32">
            <Link to={`/public/books/${b.id}`} className="group block w-full text-left" title={b.title}>
              <BookCover book={b} coverPath={`/api/public/${b.id}/cover`} className="w-full transition duration-300 group-hover:-translate-y-1" />
              <span className="mt-2 line-clamp-2 block text-xs font-medium leading-snug">{b.title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">{b.author ?? "Unknown author"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "/public" — books shared with every account on this server, by theme. */
export function PublicLibraryPage() {
  const { publicVersion, me, books: library } = useLibrary();
  const { data: books, error, reload: load } = useApi(listPublicBooks, [], { reloadOn: [publicVersion] });
  const [format, setFormat] = useState<string>("all");
  const [language, setLanguage] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("popular");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "requests" ? "requests" : "books";
  const theme = params.get("theme") ?? "all";
  const showAll = params.get("all") === "1";
  // "?book=<id>" (from an answered request) scrolls to that book and outlines it.
  const focusId = params.get("book");

  useEffect(() => setShown(PAGE_SIZE), [theme, format, language, sort]);

  useEffect(() => {
    if (focusId && books) document.getElementById(`pub-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, books]);

  const formats = useMemo(() => [...new Set(books?.map((b) => b.format))].sort(), [books]);
  const languages = useMemo(() => [...new Set(books?.map((b) => b.language).filter((l): l is string => !!l))].sort(), [books]);

  /** Books after the language/format filters (themes and search come on top). */
  const pool = useMemo(
    () =>
      books?.filter(
        (b) => (format === "all" || (format === "comics" ? isComicFormat(b.format) : b.format === format)) && (language === "all" || b.language === language),
      ) ?? null,
    [books, format, language],
  );

  const themeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of pool ?? []) for (const t of b.themes) counts.set(t, (counts.get(t) ?? 0) + 1);
    return counts;
  }, [pool]);

  const visible = useMemo(() => {
    if (!pool) return null;
    const list = pool.filter((b) => theme === "all" || b.themes.includes(theme));
    if (sort === "popular") list.sort(byPopularity);
    else if (sort === "title") list.sort((a, b) => byText(a.title, b.title));
    else if (sort === "author") list.sort((a, b) => byText(a.author, b.author) || byText(a.title, b.title));
    return list;
  }, [pool, theme, sort]);

  // Without a theme or "see everything", the library is shown as shelves (searching has its own page).
  const browsing = theme === "all" && !showAll && !focusId;
  const shelves = useMemo(() => {
    if (!pool) return [];
    const popular = [...pool].filter((b) => b.popularity !== null).sort(byPopularity);
    const readers = pool.filter((b) => b.popularity === null);
    // Suggestions from the reader's own library come first (see lib/recommend.ts).
    const rec = recommend(library ?? [], pool);
    return [
      ...(rec.forYou.length
        ? [{ id: "for-you", title: "Recommended for you", blurb: "From the authors and sections of the books you read and like", icon: <Sparkles />, books: rec.forYou }]
        : []),
      ...rec.because.map((r) => ({ id: `because-${r.seed.id}`, title: `Because you read ${r.seed.title}`, icon: <BookOpen />, books: r.books })),
      ...(popular.length ? [{ id: "popular", title: "Most popular", icon: <Flame />, books: popular }] : []),
      ...THEME_ORDER.filter((t) => themeCounts.get(t)).map((t) => {
        const info = THEME_INFO[t]!;
        const Icon = info.icon;
        return { id: t, title: info.label, blurb: info.blurb, icon: <Icon />, books: pool.filter((b) => b.themes.includes(t)).sort(byPopularity) };
      }),
      ...(readers.length ? [{ id: "readers", title: "Shared by readers", icon: <Users />, books: readers }] : []),
    ];
  }, [pool, themeCounts, library]);

  return (
    <>
      <PageHeader
        title="Public Library"
        icon={Globe}
        className="mb-8 max-w-2xl"
        subtitle={
          <>
            {books ? `${books.length} books` : "Books"} shared with everyone on this server, including public-domain classics in English and Portuguese.
            Add a copy to your library to read it with synced progress, or download the file. Publish your own books from a book’s ⋯ menu.
          </>
        }
      >
        {me?.isAdmin && (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs text-accent">
            <ShieldCheck className="h-3.5 w-3.5" /> Administrator: you can remove any book
          </span>
        )}
      </PageHeader>

      <div className="mb-8 flex flex-wrap items-center gap-2" role="tablist">
        {(
          [
            ["books", "Books", <Library key="i" className="h-4 w-4" />],
            ["requests", "Requests", <HandHelping key="i" className="h-4 w-4" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`pill ${tab === id ? "pill-on" : ""}`} onClick={() => setParams(id === "requests" ? { tab: "requests" } : {})}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === "requests" ? (
        <RequestsTab />
      ) : (
        <>
          {books && books.length > 0 && (
            <div className="mb-6 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {languages.length > 0 && (
                  <select className="input py-1.5" aria-label="Language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                    <option value="all">All languages</option>
                    {languages.map((l) => (
                      <option key={l} value={l}>
                        {languageName(l)}
                      </option>
                    ))}
                  </select>
                )}
                {formats.length > 1 &&
                  ["all", ...formats, ...(formats.some(isComicFormat) ? ["comics"] : [])].map((f) => (
                    <button key={f} className={`pill py-1 ${format === f ? "pill-on" : ""}`} aria-pressed={format === f} onClick={() => setFormat(f)}>
                      {f === "all" ? "All formats" : f === "comics" ? "Comics" : f.toUpperCase()}
                    </button>
                  ))}
                {!browsing && (
                  <label className="ml-auto flex items-center gap-2 text-sm text-muted">
                    <span className="hidden sm:inline">Sort by</span>
                    <select className="input py-1.5" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                      <option value="popular">Most popular</option>
                      <option value="newest">Newest</option>
                      <option value="title">Title</option>
                      <option value="author">Author</option>
                    </select>
                  </label>
                )}
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Themes">
                <button className={`pill py-1 ${theme === "all" && !showAll ? "pill-on" : ""}`} onClick={() => setParams({})}>
                  Browse
                </button>
                <button className={`pill py-1 ${theme === "all" && showAll ? "pill-on" : ""}`} onClick={() => setParams({ all: "1" })}>
                  All books <span className="opacity-60">{pool?.length}</span>
                </button>
                {THEME_ORDER.filter((t) => themeCounts.get(t)).map((t) => {
                  const Icon = THEME_INFO[t]!.icon;
                  return (
                    <button key={t} className={`pill py-1 ${theme === t ? "pill-on" : ""}`} aria-pressed={theme === t} onClick={() => setParams({ theme: t })}>
                      <Icon className="h-3.5 w-3.5" /> {THEME_INFO[t]!.label} <span className="opacity-60">{themeCounts.get(t)}</span>
                    </button>
                  );
                })}
              </div>
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
            ) : browsing ? (
              <div className="space-y-10">
                {shelves.map((s) => (
                  <Shelf
                    key={s.id}
                    title={s.title}
                    icon={s.icon}
                    blurb={"blurb" in s ? s.blurb : undefined}
                    books={s.books.slice(0, SHELF_SIZE)}
                    total={s.books.length}
                    onSeeAll={
                      // Suggestion rows show everything they have; there is no page to see more.
                      s.id === "for-you" || s.id.startsWith("because-")
                        ? undefined
                        : s.id === "popular" || s.id === "readers"
                          ? () => setParams({ all: "1" })
                          : () => setParams({ theme: s.id })
                    }
                  />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="py-14 text-center text-sm text-muted">No public books match this filter.</p>
            ) : (
              <>
                {theme !== "all" && THEME_INFO[theme] && <p className="-mt-2 mb-6 text-sm text-muted">{THEME_INFO[theme]!.blurb}.</p>}
                <div className={GRID}>
                  {visible.slice(0, Math.max(shown, focusId ? visible.length : 0)).map((b) => (
                    <PublicBookCard key={b.id} book={b} onChanged={load} focused={b.id === focusId} />
                  ))}
                </div>
                {visible.length > shown && !focusId && (
                  <div className="mt-10 text-center">
                    <button className="btn-outline" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                      Show more <span className="text-muted">({visible.length - shown} left)</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
