import { LayoutGrid, List, Tag, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { Book } from "../../lib/api";
import { byAdded } from "../../lib/bookStats";
import { isComicFormat } from "../../lib/comics";
import { matchesQuery, useLibrary } from "../../lib/libraryStore";
import { Menu } from "../ui/Menu";
import { BookCard, BookRow } from "./BookCard";

type Filter = "all" | "shared" | "recent" | "comics" | Book["format"];
type Sort = "activity" | "added" | "title" | "author" | "progress";
type View = "grid" | "list";

const SORTS: Record<Sort, string> = {
  activity: "Recently read",
  added: "Recently added",
  title: "Title",
  author: "Author",
  progress: "Progress",
};

/** "Recent" = added in the last 30 days. */
const RECENT_MS = 30 * 24 * 3600 * 1000;

const VIEW_KEY = "readsync.libraryView";

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

const text = (a: string | null, b: string | null) =>
  (a ?? "￿").localeCompare(b ?? "￿", undefined, { sensitivity: "base", numeric: true });

const SORTERS: Record<Sort, ((a: Book, b: Book) => number) | null> = {
  activity: null, // the store already keeps this order
  added: byAdded,
  title: (a, b) => text(a.title, b.title),
  author: (a, b) => text(a.author, b.author) || text(a.title, b.title),
  progress: (a, b) => (b.progress?.percentage ?? -1) - (a.progress?.percentage ?? -1),
};

export function BookGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5 @6xl:grid-cols-6" aria-busy="true" aria-label="Loading books">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="skeleton aspect-[2/3] rounded-lg" />
          <div className="skeleton mt-3 h-3 w-4/5" />
          <div className="skeleton mt-2 h-2.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {children && <div className="mt-2 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/**
 * Filterable, sortable grid/list of books. `books` is whatever the page shows
 * (whole library, a collection, favorites…); the top-bar search applies on top.
 */
export function BookBrowser({
  books,
  title,
  empty,
  defaultSort = "activity",
  actions,
}: {
  books: Book[] | null;
  title: string;
  /** Shown when the page has no books at all (before filters). */
  empty: ReactNode;
  defaultSort?: Sort;
  actions?: ReactNode;
}) {
  const { query, setQuery, folders } = useLibrary();
  const [filter, setFilter] = useState<Filter>("all");
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>(defaultSort);
  const [view, setViewState] = useState<View>(loadView);

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const formats = useMemo(() => [...new Set(books?.map((b) => b.format))].sort(), [books]);
  const allTags = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const b of books ?? []) for (const t of b.tags) if (!byKey.has(t.toLowerCase())) byKey.set(t.toLowerCase(), t);
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [books]);

  const visible = useMemo(() => {
    if (!books) return null;
    const now = Date.now();
    const tagKeys = [...tags].map((t) => t.toLowerCase());
    const list = books.filter((b) => {
      const hidden =
        filter === "shared"
          ? !(b.isShared || b.sharedBy)
          : filter === "recent"
            ? now - new Date(b.createdAt).getTime() > RECENT_MS
            : filter === "comics"
              ? !isComicFormat(b.format)
              : filter !== "all" && b.format !== filter;
      if (hidden) return false;
      const bookTags = b.tags.map((t) => t.toLowerCase());
      if (!tagKeys.every((t) => bookTags.includes(t))) return false;
      return matchesQuery(b, query, folders);
    });
    const sorter = SORTERS[sort];
    return sorter ? [...list].sort(sorter) : list;
  }, [books, filter, tags, sort, query, folders]);

  const filtered = filter !== "all" || tags.size > 0 || query.trim() !== "";
  const clear = () => {
    setFilter("all");
    setTags(new Set());
    setQuery("");
  };

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "All Books" },
    ...formats.map((f) => ({ id: f as Filter, label: f.toUpperCase() })),
    // One chip for every comic archive type, next to the individual formats.
    ...(formats.some(isComicFormat) ? [{ id: "comics" as Filter, label: "Comics" }] : []),
    { id: "shared", label: "Shared" },
    { id: "recent", label: "Recent" },
  ];

  return (
    <section aria-label={title} className="@container">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-display text-2xl font-semibold">{title}</h2>
        {actions}
        {/* Sort and view stay together when the header wraps, and wrap themselves on very narrow screens. */}
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-3">
          <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
            <span className="hidden sm:inline">Sort by</span>
            <select className="input min-w-0 max-w-full py-1.5" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {(Object.keys(SORTS) as Sort[]).map((s) => (
                <option key={s} value={s}>
                  {SORTS[s]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-xl border border-line p-0.5" role="group" aria-label="View">
            {(["grid", "list"] as const).map((v) => (
              <button
                key={v}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${view === v ? "bg-elevated text-accent" : "text-muted hover:text-fg"}`}
                aria-label={v === "grid" ? "Grid view" : "List view"}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {v === "grid" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {books && books.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {/* On phones the filters scroll sideways in one row instead of wrapping onto two.
              The tag menu stays outside: a scrolling box would clip its dropdown. */}
          <div className="-mx-4 flex max-w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:max-w-none sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {chips.map((c) => (
              <button
                key={c.id}
                className={`pill shrink-0 ${filter === c.id ? "pill-on" : ""}`}
                aria-pressed={filter === c.id}
                onClick={() => setFilter(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {allTags.length > 0 && (
            <Menu
              label="Filter by tag"
              align="left"
              triggerClassName={`pill ${tags.size ? "pill-on" : ""}`}
              trigger={
                <>
                  <Tag className="h-3.5 w-3.5" /> {tags.size ? `Tags · ${tags.size}` : "Tags"}
                </>
              }
              items={allTags.map((t) => ({
                label: `${tags.has(t) ? "✓ " : ""}${t}`,
                onSelect: () =>
                  setTags((cur) => {
                    const next = new Set(cur);
                    if (next.has(t)) next.delete(t);
                    else next.add(t);
                    return next;
                  }),
              }))}
            />
          )}
          {[...tags].map((t) => (
            <button key={t} className="pill pill-on" onClick={() => setTags((cur) => new Set([...cur].filter((x) => x !== t)))} aria-label={`Remove tag filter ${t}`}>
              {t} <X className="h-3 w-3" />
            </button>
          ))}
          {filtered && (
            <button className="btn-ghost ml-auto py-1.5" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {visible === null ? (
        <BookGridSkeleton />
      ) : books!.length === 0 ? (
        empty
      ) : visible.length === 0 ? (
        <div className="py-14 text-center text-sm text-muted">
          No books match {query.trim() ? `“${query.trim()}”` : "these filters"}.{" "}
          <button className="text-accent underline-offset-2 hover:underline" onClick={clear}>
            Clear filters
          </button>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-8 @lg:grid-cols-3 @2xl:grid-cols-4 @4xl:grid-cols-5 @6xl:grid-cols-6">
          {visible.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((b) => (
            <BookRow key={b.id} book={b} />
          ))}
        </div>
      )}
    </section>
  );
}
