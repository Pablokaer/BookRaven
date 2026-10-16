import { Play } from "lucide-react";
import { memo } from "react";
import { Link } from "react-router";
import type { Book } from "../../lib/api";
import { percent, timeAgo } from "../../lib/format";
import { BookMenu } from "./BookActions";
import { BookCover } from "./BookCover";
import { ProgressBar } from "./ProgressBar";

/** Wide "Continue reading" card. */
export const FeaturedBookCard = memo(function FeaturedBookCard({ book }: { book: Book }) {
  const p = book.progress!;
  return (
    <article className="surface group relative flex animate-rise gap-5 overflow-hidden p-4 transition hover:border-accent/30 sm:p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/10 blur-3xl transition group-hover:bg-accent/15" />
      <Link to={`/read/${book.id}`} aria-label={`Continue reading ${book.title}`} className="shrink-0">
        <BookCover book={book} badge className="w-24 sm:w-28" />
      </Link>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-display text-lg font-semibold leading-snug" title={book.title}>
              <Link to={`/books/${book.id}`} className="hover:text-accent">
                {book.title}
              </Link>
            </h3>
            <p className="mt-1 truncate text-sm text-muted">{book.author ?? "Unknown author"}</p>
          </div>
          <BookMenu book={book} className="icon-btn -mr-2 -mt-1 h-8 w-8" />
        </div>
        <div className="mt-auto pt-4">
          <div className="mb-2 flex items-baseline justify-between text-xs text-muted">
            <span>
              <span className="text-base font-semibold text-accent">{percent(p.percentage)}</span> complete
            </span>
            <span className="truncate pl-2">{p.label ?? timeAgo(p.updatedAt)}</span>
          </div>
          <ProgressBar value={p.percentage} />
          <Link to={`/read/${book.id}`} className="btn mt-4 w-full sm:w-auto">
            <Play className="h-4 w-4 fill-current" /> Continue Reading
          </Link>
        </div>
      </div>
    </article>
  );
});
