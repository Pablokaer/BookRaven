import { BookOpen, Compass, Heart, Share2, Sparkles, UploadCloud } from "lucide-react";
import { useMemo } from "react";
import { BookBrowser, EmptyState } from "../components/books/BookBrowser";
import { FeaturedBookCard } from "../components/books/FeaturedBookCard";
import { StorageMeter } from "../components/shell/StorageMeter";
import { WelcomePanel } from "../components/dashboard/WelcomePanel";
import { byLastRead, isInProgress } from "../lib/bookStats";
import { useLibrary } from "../lib/libraryStore";

function UploadEmpty() {
  const { pickFiles } = useLibrary();
  return (
    <EmptyState icon={<UploadCloud />} title="Your library is empty">
      Drop PDF, EPUB, MOBI, AZW3, FB2 and comics (CBZ, CBR, CB7, CBT) files anywhere on this page, or{" "}
      <button className="text-accent hover:underline" onClick={() => pickFiles()}>
        choose files
      </button>
      .
    </EmptyState>
  );
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
    </header>
  );
}

/** "/" — welcome, continue reading and the whole library. */
export function DashboardPage({ userName }: { userName: string }) {
  const { books, query } = useLibrary();
  const current = useMemo(() => (books ?? []).filter(isInProgress).sort(byLastRead).slice(0, 2), [books]);
  const searching = query.trim() !== "";

  return (
    <div className="space-y-12">
      {!searching && (
        <>
          <WelcomePanel name={userName} />

          <section aria-labelledby="continue-heading" className="@container">
            <h2 id="continue-heading" className="mb-5 font-display text-2xl font-semibold">
              Continue Reading
            </h2>
            {books === null ? (
              <div className="grid gap-5 @3xl:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="surface h-48 animate-pulse" />
                ))}
              </div>
            ) : current.length === 0 ? (
              <EmptyState icon={<BookOpen />} title="Nothing in progress">
                {books.length ? "Open any book below and your place will be saved here, on every device." : "Upload a book to start reading."}
              </EmptyState>
            ) : (
              <div className="grid gap-5 @3xl:grid-cols-2">
                {current.map((b) => (
                  <FeaturedBookCard key={b.id} book={b} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <BookBrowser books={books} title={searching ? "Search results" : "My Library"} empty={<UploadEmpty />} />
    </div>
  );
}

export function ReadingNowPage() {
  const { books } = useLibrary();
  const reading = useMemo(() => books && books.filter(isInProgress), [books]);
  return (
    <>
      <PageHeader title="Reading Now" subtitle="Books you have started and not finished yet." />
      <BookBrowser
        books={reading}
        title="In progress"
        empty={
          <EmptyState icon={<BookOpen />} title="No books in progress">
            Start reading any book and it will appear here.
          </EmptyState>
        }
      />
    </>
  );
}

export function UploadsPage() {
  const { books, pickFiles } = useLibrary();
  return (
    <>
      <PageHeader title="Uploads" subtitle="Everything you have added, newest first." />
      <div className="surface mb-5 p-4">
        <StorageMeter />
      </div>
      <button
        onClick={() => pickFiles()}
        className="group mb-10 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line bg-card/40 px-6 py-10 text-center transition hover:border-accent/50 hover:bg-card/70"
      >
        <UploadCloud className="h-8 w-8 text-accent transition group-hover:-translate-y-0.5" />
        <span className="font-medium">Drop files here or click to upload</span>
        <span className="text-sm text-muted">PDF, EPUB, MOBI, AZW3, FB2 and comics (CBZ, CBR, CB7, CBT) · duplicates are detected automatically</span>
      </button>
      <BookBrowser books={books} title="All uploads" defaultSort="added" empty={<UploadEmpty />} />
    </>
  );
}

export function SharedPage() {
  const { books } = useLibrary();
  const withMe = useMemo(() => books && books.filter((b) => b.sharedBy), [books]);
  const byMe = useMemo(() => books && books.filter((b) => b.isShared), [books]);
  return (
    <div className="space-y-14">
      <PageHeader title="Shared" subtitle="Books others shared with you, and books you are sharing." />
      <BookBrowser
        books={withMe}
        title="Shared with you"
        empty={
          <EmptyState icon={<Share2 />} title="Nothing shared with you yet">
            When someone sends you a BookRaven share link, open it and choose “Add to my library”.
          </EmptyState>
        }
      />
      <BookBrowser
        books={byMe}
        title="Shared by you"
        empty={
          <EmptyState icon={<Share2 />} title="You are not sharing any books">
            Use the share button on a book to create a link for someone else.
          </EmptyState>
        }
      />
    </div>
  );
}

export function FavoritesPage() {
  const { books } = useLibrary();
  const favorites = useMemo(() => books && books.filter((b) => b.favorite), [books]);
  return (
    <>
      <PageHeader title="Favorites" />
      <BookBrowser
        books={favorites}
        title="Your favorites"
        empty={
          <EmptyState icon={<Heart />} title="No favorites yet">
            Tap the heart on any book to keep it here.
          </EmptyState>
        }
      />
    </>
  );
}

/**
 * There is no recommendation service, so Discover shows unread books from the
 * user's own shelf and says so.
 */
export function DiscoverPage() {
  const { books } = useLibrary();
  const unread = useMemo(() => books && books.filter((b) => !b.progress), [books]);
  return (
    <>
      <PageHeader title="Discover" subtitle="Books waiting on your shelf that you have not opened yet." />
      <div className="surface mb-10 flex items-start gap-4 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent">
          <Sparkles className="h-[18px] w-[18px]" />
        </div>
        <div className="text-sm">
          <div className="font-medium">Personal recommendations are not available yet</div>
          <p className="mt-1 text-muted">BookRaven only knows the books in your own library, so for now Discover suggests the ones you haven’t started.</p>
        </div>
      </div>
      <BookBrowser
        books={unread}
        title="Not started"
        defaultSort="added"
        empty={
          <EmptyState icon={<Compass />} title="You have opened every book">
            Upload new books and they will show up here.
          </EmptyState>
        }
      />
    </>
  );
}

