import type { ReactNode } from "react";
import type { Book } from "../../lib/api";
import { AuthImage } from "../AuthImage";

/** Cloth bindings for generated covers: two gradient stops and the gilt or silver of the lettering. */
const PALETTES: [string, string, string][] = [
  ["#16324f", "#0a1a2b", "#c9a474"], // midnight blue
  ["#4a1f24", "#28100f", "#d8b88a"], // oxblood
  ["#26382a", "#121c14", "#d9cba8"], // forest
  ["#5b4428", "#2f2212", "#efe1c6"], // leather
  ["#2e3a48", "#161e27", "#aab8c6"], // slate
  ["#3a2d45", "#1d1524", "#d6c3a0"], // plum
  ["#1d3b3f", "#0d1f22", "#c9a474"], // deep green
  ["#243f5a", "#122335", "#eee3d0"], // raven blue
];

function palette(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length]!;
}

export function FormatBadge({ format, className = "" }: { format: Book["format"]; className?: string }) {
  return (
    <span
      className={`rounded-[3px] bg-midnight/75 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-parchment ring-1 ring-gold/25 backdrop-blur-sm ${className}`}
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
      className={`relative aspect-[2/3] shrink-0 overflow-hidden rounded-[3px] bg-elevated shadow-[0_8px_24px_-10px_rgb(0_0_0/0.8)] ring-1 ring-parchment/5 ${className}`}
    >
      <div
        className={`absolute inset-0 flex flex-col ${pad} ${badge && (size === "md" || size === "lg") ? "pt-10" : ""}`}
        style={{ background: `linear-gradient(155deg, ${from}, ${to})` }}
        aria-hidden={book.hasCover}
      >
        {/* A blind-stamped frame, as on a cloth binding. */}
        {size !== "xs" && <div className="pointer-events-none absolute inset-[6%] rounded-[2px] border" style={{ borderColor: ink, opacity: 0.28 }} />}
        <div className="h-px w-1/3" style={{ background: ink, opacity: 0.6 }} />
        <div className={`mt-[12%] line-clamp-5 font-display font-semibold leading-snug text-ivory ${titleSize}`}>{book.title}</div>
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
