import type { ReactNode } from "react";
import type { Book } from "../../lib/api";
import { AuthImage } from "../AuthImage";

/** Deep, muted tones for generated covers (pairs of gradient stops). */
const PALETTES: [string, string, string][] = [
  ["#0f3b3a", "#082322", "#5eead4"],
  ["#2a2140", "#15111f", "#c4b5fd"],
  ["#3b2a17", "#1d140a", "#fcd34d"],
  ["#13304a", "#0a1928", "#93c5fd"],
  ["#3d1d2b", "#1f0e16", "#f9a8d4"],
  ["#1f3a24", "#0f1d12", "#86efac"],
  ["#3a1f1a", "#1d0f0c", "#fdba74"],
  ["#22303a", "#11181d", "#cbd5e1"],
];

function palette(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length]!;
}

export function FormatBadge({ format, className = "" }: { format: Book["format"]; className?: string }) {
  return (
    <span
      className={`rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white ring-1 ring-white/10 backdrop-blur-sm ${className}`}
    >
      {format}
    </span>
  );
}

/**
 * The book's own cover when it has one, otherwise a typographic cover generated
 * from its title and author. Always 2:3.
 */
/** What a cover needs; public-library books pass their own cover URL via `coverPath`. */
type CoverSource = Pick<Book, "id" | "title" | "author" | "format" | "hasCover">;

export function BookCover({
  book,
  size = "md",
  badge = false,
  className = "",
  coverPath,
  extraBadge,
}: {
  book: CoverSource;
  coverPath?: string;
  /** Shown beside the format badge (with `badge`), e.g. "Public". */
  extraBadge?: ReactNode;
  size?: "xs" | "sm" | "md" | "lg";
  badge?: boolean;
  className?: string;
}) {
  const [from, to, ink] = palette(book.title);
  const titleSize = { xs: "text-[6px]", sm: "text-[9px]", md: "text-sm", lg: "text-base" }[size];
  const pad = { xs: "p-1", sm: "p-1.5", md: "p-3.5", lg: "p-4" }[size];

  return (
    <div
      className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-lg bg-elevated shadow-[0_8px_24px_-10px_rgb(0_0_0/0.8)] ring-1 ring-white/5 ${className}`}
    >
      <div
        className={`absolute inset-0 flex flex-col ${pad} ${badge && (size === "md" || size === "lg") ? "pt-10" : ""}`}
        style={{ background: `linear-gradient(155deg, ${from}, ${to})` }}
        aria-hidden={book.hasCover}
      >
        <div className="h-px w-1/3" style={{ background: ink, opacity: 0.6 }} />
        <div className={`mt-[12%] line-clamp-5 font-display font-semibold leading-snug text-white/95 ${titleSize}`}>{book.title}</div>
        {size !== "xs" && book.author && (
          <div className="mt-auto line-clamp-2 text-[0.6rem] uppercase tracking-[0.15em]" style={{ color: ink, opacity: 0.85 }}>
            {book.author}
          </div>
        )}
        {/* spine shadow */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/30 to-transparent" />
      </div>
      {book.hasCover && (
        <AuthImage path={coverPath ?? `/api/books/${book.id}/cover`} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {badge && (
        <div className="absolute left-2 top-2 flex items-center gap-1">
          <FormatBadge format={book.format} />
          {extraBadge}
        </div>
      )}
    </div>
  );
}
