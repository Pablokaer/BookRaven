import { BookOpen, Globe } from "lucide-react";
import { Link } from "react-router";
import type { Book } from "../../lib/api";
import { isFinished, readingStatus } from "../../lib/bookStats";
import { timeAgo } from "../../lib/format";
import { BookMenu, FavoriteButton, ShareButton } from "./BookActions";
import { BookCover, FormatBadge } from "./BookCover";
import { ProgressBar } from "./ProgressBar";

/** Grid card: cover, title, author, progress and actions. */
export function BookCard({ book }: { book: Book }) {
  const p = book.progress;
  return (
    <article className="group flex animate-rise flex-col">
      <Link
        to={`/read/${book.id}`}
        className="relative block rounded-lg transition duration-300 group-hover:-translate-y-1 focus-visible:-translate-y-1"
        aria-label={`Read ${book.title}`}
      >
        <BookCover
          book={book}
          badge
          // Next to the format badge: at the bottom it covered the author on generated covers.
          extraBadge={
            book.isPublic && (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-[#5fd3b9] ring-1 ring-[#5fd3b9]/30 backdrop-blur-sm"
                title="In the Public Library"
              >
                <Globe className="h-3 w-3" /> Public
              </span>
            )
          }
          className="w-full"
        />
        <FavoriteButton
          book={book}
          className={`absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 ${
            book.favorite ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          }`}
        />
      </Link>

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-fg" title={book.title}>
          {book.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-muted">{book.author ?? (book.sharedBy ? `Shared by ${book.sharedBy}` : "Unknown author")}</p>
        {/* Progress and buttons sit at the bottom, so they line up across a row of cards
            whatever the title's length. */}
        <div className="mt-auto flex items-center justify-between pt-2.5 text-xs text-muted">
          <span className={p && !isFinished(book) ? "text-accent" : ""}>{readingStatus(book)}</span>
          {p && <span title={new Date(p.updatedAt).toLocaleString()}>{timeAgo(p.updatedAt)}</span>}
        </div>
        <ProgressBar value={p?.percentage ?? 0} className={`mt-1.5 ${p ? "" : "opacity-40"}`} />

        <div className="mt-3 flex items-center gap-1">
          <Link to={`/read/${book.id}`} className="btn mr-auto px-3 py-1.5 text-xs">
            <BookOpen className="h-3.5 w-3.5" /> Read
          </Link>
          {/* On phones sharing stays in the ⋯ menu: four controls don't fit a half-width card. */}
          <ShareButton book={book} className="icon-btn hidden h-8 w-8 sm:inline-flex" />
          <BookMenu book={book} className="icon-btn h-8 w-8" />
        </div>
      </div>
    </article>
  );
}

/** List row: same information, laid out horizontally. */
export function BookRow({ book }: { book: Book }) {
  const p = book.progress;
  return (
    <article className="group flex animate-rise items-center gap-4 rounded-xl border border-transparent px-3 py-2.5 transition hover:border-line hover:bg-card/70">
      <Link to={`/read/${book.id}`} aria-label={`Read ${book.title}`} className="shrink-0">
        <BookCover book={book} size="sm" className="w-11" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-medium" title={book.title}>
            {book.title}
          </h3>
          <FormatBadge format={book.format} className="shrink-0 !bg-fg/8 !text-fg !ring-line" />
        </div>
        <p className="truncate text-xs text-muted">{book.author ?? (book.sharedBy ? `Shared by ${book.sharedBy}` : "Unknown author")}</p>
      </div>
      <div className="hidden w-44 shrink-0 sm:block">
        <div className="mb-1 text-xs text-muted">{readingStatus(book)}</div>
        <ProgressBar value={p?.percentage ?? 0} className={p ? "" : "opacity-40"} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <FavoriteButton book={book} className="icon-btn h-8 w-8" />
        <ShareButton book={book} className="icon-btn hidden h-8 w-8 sm:inline-flex" />
        <Link to={`/read/${book.id}`} className="btn hidden px-3 py-1.5 text-xs md:inline-flex">
          Read
        </Link>
        <BookMenu book={book} className="icon-btn h-8 w-8" />
      </div>
    </article>
  );
}
