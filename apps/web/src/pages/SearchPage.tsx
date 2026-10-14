import { Globe, HandHelping, Library, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { BookGridSkeleton, EmptyState } from "../components/books/BookBrowser";
import { BookCard } from "../components/books/BookCard";
import type { PublicBook } from "../lib/api";
import { byLastRead } from "../lib/bookStats";
import { matchesQuery, useLibrary } from "../lib/libraryStore";
import { listPublicBooks } from "../lib/publicLibrary";
import { matchesText } from "../lib/search";
import { PublicBookCard } from "./PublicLibraryPage";

const GRID = "grid grid-cols-2 gap-x-5 gap-y-8 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5 @6xl:grid-cols-6";
const PUBLIC_STEP = 12;

/** One block of results, labelled with where the books come from. */
function ResultSection({
  id,
  icon,
  title,
  note,
  count,
  tone,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  note: string;
  count: number | null;
  tone: "personal" | "public";
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="@container scroll-mt-24">
      <header className="mb-5 flex items-center gap-3 border-b border-line pb-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset [&>svg]:h-[18px] [&>svg]:w-[18px] ${
            tone === "personal" ? "bg-accent/12 text-accent ring-accent/25" : "bg-sky-400/10 text-sky-300 ring-sky-400/25"
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-heading`} className="font-display text-xl font-semibold">
            {title}
            {count !== null && <span className="ml-2 font-sans text-sm font-normal tabular-nums text-muted">{count}</span>}
          </h2>
          <p className="text-xs text-muted">{note}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/**
 * "/search" — the top-bar search always looks in both places: the user's own books and the
 * Public Library, each in its own clearly labelled section.
 */
export function SearchPage() {
  const { books, folders, query, publicVersion } = useLibrary();
  const [pub, setPub] = useState<PublicBook[] | null>(null);
  const [pubError, setPubError] = useState(false);
  const [shown, setShown] = useState(PUBLIC_STEP);
  const q = query.trim();

  const load = useCallback(() => {
    setPubError(false);
    listPublicBooks()
      .then(setPub)
      .catch(() => setPubError(true));
  }, []);
  useEffect(load, [load, publicVersion]);
  useEffect(() => setShown(PUBLIC_STEP), [q]);

  const personal = useMemo(() => (books ?? []).filter((b) => matchesQuery(b, q, folders)).sort(byLastRead), [books, folders, q]);
  const publicHits = useMemo(
    () => (pub ?? []).filter((b) => matchesText(`${b.title} ${b.author ?? ""} ${b.publishedBy ?? ""}`, q)),
    [pub, q],
  );

  if (!q) {
    return (
      <EmptyState icon={<Search />} title="Search all books">
        Type in the search bar to look in your Personal Library and the Public Library at the same time.
      </EmptyState>
    );
  }

  const nothing = books !== null && pub !== null && personal.length === 0 && publicHits.length === 0;

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Results for “{q}”</h1>
        <p className="mt-1.5 text-sm text-muted">
          <a href="#personal-results" className="text-fg hover:text-accent">
            {books === null ? "…" : personal.length} in your Personal Library
          </a>
          {" · "}
          <a href="#public-results" className="text-fg hover:text-accent">
            {pub === null ? (pubError ? "?" : "…") : publicHits.length} in the Public Library
          </a>
        </p>
      </header>

      {nothing ? (
        <EmptyState icon={<Search />} title="No books found">
          Nothing in your library or the Public Library matches “{q}”.{" "}
          <Link to="/public?tab=requests" className="text-accent hover:underline">
            Request it
          </Link>{" "}
          and someone who has it can add it.
        </EmptyState>
      ) : (
        <>
          <ResultSection
            id="personal-results"
            tone="personal"
            icon={<Library />}
            title="Personal Library"
            note="Books you uploaded or added. Your reading progress syncs."
            count={books === null ? null : personal.length}
          >
            {books === null ? (
              <BookGridSkeleton count={4} />
            ) : personal.length === 0 ? (
              <p className="text-sm text-muted">None of your books match.</p>
            ) : (
              <div className={GRID}>
                {personal.map((b) => (
                  <BookCard key={b.id} book={b} />
                ))}
              </div>
            )}
          </ResultSection>

          <ResultSection
            id="public-results"
            tone="public"
            icon={<Globe />}
            title="Public Library"
            note="Shared with everyone on this server. Add a copy to read it with synced progress."
            count={pub === null ? null : publicHits.length}
          >
            {pubError ? (
              <p className="text-sm text-muted">
                Could not search the Public Library.{" "}
                <button className="text-accent hover:underline" onClick={load}>
                  Try again
                </button>
              </p>
            ) : pub === null ? (
              <BookGridSkeleton count={4} />
            ) : publicHits.length === 0 ? (
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                No public books match.
                <Link to="/public?tab=requests" className="inline-flex items-center gap-1 text-accent hover:underline">
                  <HandHelping className="h-4 w-4" /> Request it
                </Link>
              </p>
            ) : (
              <>
                <div className={GRID}>
                  {publicHits.slice(0, shown).map((b) => (
                    <PublicBookCard key={b.id} book={b} onChanged={load} focused={false} />
                  ))}
                </div>
                {publicHits.length > shown && (
                  <div className="mt-8 text-center">
                    <button className="btn-outline" onClick={() => setShown((n) => n + PUBLIC_STEP * 2)}>
                      Show more ({publicHits.length - shown} left)
                    </button>
                  </div>
                )}
              </>
            )}
          </ResultSection>
        </>
      )}
    </div>
  );
}
