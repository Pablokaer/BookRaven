import { ArrowRight, Pencil } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router";
import { byAdded, finishedThisYear, shortDate } from "../../lib/bookStats";
import { useLibrary } from "../../lib/libraryStore";
import { useSettings } from "../../lib/settings";
import { BookCover } from "../books/BookCover";
import { ProgressRing } from "../dashboard/ProgressRing";

const QUOTES: [string, string][] = [
  ["A reader lives a thousand lives before he dies. The man who never reads lives only one.", "George R. R. Martin"],
  ["There is no friend as loyal as a book.", "Ernest Hemingway"],
  ["Once you learn to read, you will be forever free.", "Frederick Douglass"],
  ["Reading is to the mind what exercise is to the body.", "Joseph Addison"],
  ["Books are a uniquely portable magic.", "Stephen King"],
  ["I have always imagined that Paradise will be a kind of library.", "Jorge Luis Borges"],
  ["Today a reader, tomorrow a leader.", "Margaret Fuller"],
];

export function Widget({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="surface p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ViewAll({ to, label = "View all" }: { to: string; label?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-accent transition hover:text-accent-hover">
      {label} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function ReadingGoal() {
  const { books } = useLibrary();
  const { settings, update } = useSettings();
  const goal = Math.max(1, settings.readingGoal || 12);
  const done = books ? finishedThisYear(books) : 0;
  const ratio = Math.min(1, done / goal);
  // One quote per day.
  const [quote, author] = QUOTES[Math.floor(Date.now() / 86_400_000) % QUOTES.length]!;

  const editGoal = () => {
    const raw = window.prompt(`How many books do you want to finish in ${new Date().getFullYear()}?`, String(goal));
    const n = Math.round(Number(raw));
    if (raw !== null && Number.isFinite(n) && n >= 1 && n <= 1000) update({ readingGoal: n });
  };

  return (
    <Widget
      title={`${new Date().getFullYear()} Reading Goal`}
      action={
        <button className="icon-btn h-7 w-7" aria-label="Change reading goal" title="Change goal" onClick={editGoal}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="flex items-center gap-5">
        <ProgressRing value={books ? ratio : 0} size={112} stroke={9}>
          <span className="text-2xl font-semibold tabular-nums">{Math.round(ratio * 100)}%</span>
          <span className="text-[10px] uppercase tracking-wider text-muted">complete</span>
        </ProgressRing>
        <div className="min-w-0">
          <div className="text-3xl font-semibold tabular-nums">
            {done}
            <span className="text-lg text-muted"> / {goal}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">books finished this year</p>
        </div>
      </div>
      <figure className="mt-5 border-t border-line pt-4">
        <blockquote className="font-display text-sm italic leading-relaxed text-fg/90">“{quote}”</blockquote>
        <figcaption className="mt-1.5 text-xs text-muted">— {author}</figcaption>
      </figure>
    </Widget>
  );
}

function RecentUploads() {
  const { books } = useLibrary();
  const recent = useMemo(() => [...(books ?? [])].sort(byAdded).slice(0, 4), [books]);
  return (
    <Widget title="Recent Uploads" action={<ViewAll to="/uploads" />}>
      {books === null ? (
        <ListSkeleton />
      ) : recent.length === 0 ? (
        <p className="text-xs text-muted">Books you upload will appear here.</p>
      ) : (
        <ul className="space-y-3">
          {recent.map((b) => (
            <li key={b.id}>
              <Link to={`/read/${b.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-white/5">
                <BookCover book={b} size="xs" className="w-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{b.title}</div>
                  <div className="truncate text-xs text-muted">{b.author ?? b.format.toUpperCase()}</div>
                </div>
                <time className="shrink-0 text-[11px] text-muted" dateTime={b.createdAt}>
                  {shortDate(b.createdAt)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

function SharedWithYou() {
  const { books } = useLibrary();
  const shared = useMemo(
    () =>
      (books ?? [])
        .filter((b) => b.sharedBy)
        .sort((a, b) => (b.sharedAt ?? "").localeCompare(a.sharedAt ?? ""))
        .slice(0, 3),
    [books],
  );
  return (
    <Widget title="Shared With You" action={shared.length > 0 ? <ViewAll to="/shared" /> : undefined}>
      {books === null ? (
        <ListSkeleton />
      ) : shared.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted">When someone sends you a share link and you add the book, it shows up here.</p>
      ) : (
        <ul className="space-y-3">
          {shared.map((b) => (
            <li key={b.id}>
              <Link to={`/read/${b.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition hover:bg-white/5">
                <BookCover book={b} size="xs" className="w-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{b.title}</div>
                  <div className="truncate text-xs text-muted">
                    from <span className="text-fg/80">{b.sharedBy}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

/** No recommendation service exists, so this surfaces unread books already on the user's shelf. */
function DiscoverBooks() {
  const { books } = useLibrary();
  const unread = useMemo(() => [...(books ?? [])].filter((b) => !b.progress).sort(byAdded).slice(0, 4), [books]);
  return (
    <Widget title="Discover Books" action={unread.length > 0 ? <ViewAll to="/discover" label="Explore" /> : undefined}>
      {books === null ? (
        <ListSkeleton />
      ) : unread.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted">You have started every book on your shelf. Upload something new to discover.</p>
      ) : (
        <>
          <p className="-mt-2 mb-3 text-xs text-muted">Waiting on your shelf</p>
          <ul className="grid grid-cols-4 gap-2.5">
            {unread.map((b) => (
              <li key={b.id}>
                <Link to={`/read/${b.id}`} title={b.title} className="block transition hover:-translate-y-0.5">
                  <BookCover book={b} size="xs" className="w-full" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Widget>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex animate-pulse items-center gap-3">
          <div className="h-12 w-8 rounded bg-elevated" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-3/4 rounded bg-elevated" />
            <div className="h-2 w-1/2 rounded bg-elevated/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Reading goal, recent uploads, shared books and discovery. */
export function RightSidebarWidgets({ layout = "column" }: { layout?: "column" | "grid" }) {
  return (
    <div className={layout === "grid" ? "grid grid-cols-1 gap-5 md:grid-cols-2" : "space-y-5"}>
      <ReadingGoal />
      <RecentUploads />
      <SharedWithYou />
      <DiscoverBooks />
    </div>
  );
}
