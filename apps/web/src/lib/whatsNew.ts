/**
 * Release notes shown once after an update ("What's new"). They ship with the code, so the window
 * appears the first time the new code runs: on the web after a deploy, in the Android app after
 * its silent live update.
 *
 * Every user-visible change adds a note at the TOP (newest first) with a new, unique id. Write for
 * readers, not developers: what they can do now, in a few short items.
 */

export type ReleaseNote = {
  /** Unique and never reused (e.g. "2026-10-15-bookmarks"). */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  items: string[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: "2026-10-16-range-loading",
    date: "2026-10-16",
    title: "Books open much faster",
    items: [
      "Books are downloaded the way videos stream: only the pages around the one you are reading, with the next ones loading in the background.",
      "A big PDF, EPUB or comic opens after downloading a small part of it, and pages you already read open again without downloading anything.",
      "CBR, CB7 and CBT comics no longer download and unpack the whole archive before the first page.",
      "Books you've opened before start right away from your library, even with a slow connection.",
    ],
  },
  {
    id: "2026-10-15-whats-new",
    date: "2026-10-15",
    title: "What's new, right in the app",
    items: [
      "After each update, this window tells you what changed.",
      "In the Android app, Download (in the menu) now shows the version you are running, including silent updates.",
    ],
  },
  {
    id: "2026-10-15-faster-pdfs",
    date: "2026-10-15",
    title: "Faster PDFs and handwriting",
    items: [
      "Turning pages is instant: the next and previous pages are prepared while you read.",
      "Zooming uses much less memory on phones: only the part on screen is drawn sharp.",
      "Books with lots of handwriting open with a fraction of the data; it loads around the page you read.",
      "Searching again is immediate, and very common words no longer slow the reader (results come 200 at a time).",
      "The eraser stays smooth on pages with hundreds of strokes.",
    ],
  },
  {
    id: "2026-10-15-sync-fixes",
    date: "2026-10-15",
    title: "More reliable syncing",
    items: [
      "Bookmarks and handwriting made offline are kept and sent when you are back online, even when the server is busy.",
      "Opening a book offline shows the bookmarks and handwriting saved on the device.",
      "Changes from your other devices arrive in order.",
      "If a page is too full to save more handwriting, the reader tells you.",
    ],
  },
  {
    id: "2026-10-15-handwriting",
    date: "2026-10-15",
    title: "Write on your PDFs",
    items: [
      "Tap the pen in a PDF's top bar to write with a stylus, a mouse or a finger: pen, highlighter, eraser, undo and redo.",
      "With a stylus the line follows your pressure and a resting palm is ignored; fingers keep scrolling and zooming.",
      "Handwriting syncs to your other devices, and the Notebook shows the pages you wrote on.",
    ],
  },
  {
    id: "2026-10-15-bookmarks",
    date: "2026-10-15",
    title: "Bookmarks",
    items: [
      "Save the page you are on with the bookmark button (or the B key), in PDFs, ebooks and comics.",
      "Find, rename and remove them in the reader's Notebook and on the book's page.",
    ],
  },
  {
    id: "2026-10-15-pdf-zoom",
    date: "2026-10-15",
    title: "Zoom and margins in PDFs",
    items: [
      "Pinch, double-tap or Ctrl + scroll to zoom up to 4×.",
      "Set the space around the page, or crop white margins, in the reader's display settings (Aa).",
    ],
  },
];

/** On a first visit (nothing seen yet), notes this many days older than the newest are left out. */
const FIRST_VISIT_DAYS = 14;
/** The window shows at most this many notes. */
export const MAX_SHOWN = 6;

/** The notes to show, newest first, given the id of the newest one already seen (null: none yet). */
export function unseenNotes(notes: ReleaseNote[], lastSeen: string | null): ReleaseNote[] {
  if (!notes.length || lastSeen === notes[0]!.id) return [];
  const seenAt = lastSeen ? notes.findIndex((n) => n.id === lastSeen) : -1;
  if (seenAt > 0) return notes.slice(0, Math.min(seenAt, MAX_SHOWN));
  // First visit (or the seen note was removed): only the recent ones.
  const newest = Date.parse(notes[0]!.date);
  return notes.filter((n) => newest - Date.parse(n.date) <= FIRST_VISIT_DAYS * 86_400_000).slice(0, MAX_SHOWN);
}

const KEY = "readsync.whatsNewSeen";

export function lastSeenNote(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Remembers that everything up to the newest note was shown. */
export function markNotesSeen(notes: ReleaseNote[] = RELEASE_NOTES) {
  try {
    if (notes[0]) localStorage.setItem(KEY, notes[0].id);
  } catch {
    /* storage blocked: the window may show again next time */
  }
}
