import { readString, writeString } from "./storage";

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
    id: "2026-10-22-privacy-and-positions",
    date: "2026-10-22",
    title: "Fixes",
    items: ["Signing out now also removes your library list from this device."],
  },
  {
    id: "2026-10-17-offline-and-storage",
    date: "2026-10-17",
    title: "Better offline, lighter on your device",
    items: [
      "The Android app now opens without a connection, with your library, collections, covers, highlights and book pages, and catches up when you're back online.",
      "Save for offline now downloads only the parts of a book you don't have yet, and small books you open on Wi-Fi finish downloading by themselves.",
      "Your profile shows how much space BookRaven uses on this device, with a button to clear downloaded books. When space runs short, the books you read longest ago make room; books saved for offline stay.",
      "Books you delete on another device are removed from this one too, and new covers and app updates are smaller.",
    ],
  },
  {
    id: "2026-10-17-smoother-library",
    date: "2026-10-17",
    title: "Smoother on phones",
    items: [
      "Scrolling a big library is smoother: the book cards' labels and buttons no longer blur what is behind them, and the paper texture is a light image instead of being drawn on the fly.",
      "The app starts with a little less to download, and the sign-in picture is sized for your screen.",
    ],
  },
  {
    id: "2026-10-17-lighter-look",
    date: "2026-10-17",
    title: "The new look, lighter",
    items: [
      "Scrolling the library and opening the menu are smoother on phones: the paper texture is drawn more simply, and no longer behind the reader.",
      "The front page shows its title and picture right away instead of waiting to fade in, and the titles no longer jump when their font arrives.",
      "The welcome panel downloads a much smaller picture, and the app no longer downloads the front page when you are signed in.",
    ],
  },
  {
    id: "2026-10-16-illustrated-look",
    date: "2026-10-16",
    title: "A new look",
    items: [
      "BookRaven now looks like an illustrated book: midnight blue and parchment, gold details and classic serif titles, on every page.",
      "The front page and the sign-in screen are illustrated with Gustave Doré's engravings for The Raven.",
      "Empty pages, the welcome panel and books without a cover have their own engraved and cloth-bound designs.",
      "A bookshelf on the front page opens each section of the Public Library once you sign in.",
    ],
  },
  {
    id: "2026-10-16-reader-memory",
    date: "2026-10-16",
    title: "Lighter on long books",
    items: [
      "Long comics and PDFs use less memory: pages far from the one you are reading let go of their pictures and load again when you come back, so reading stays smooth on phones.",
      "Searching a PDF reads a few pages at a time, so results come sooner.",
    ],
  },
  {
    id: "2026-10-16-faster-sync",
    date: "2026-10-16",
    title: "Quicker on bad connections",
    items: [
      "On a very slow connection the app opens from its saved copy after a few seconds instead of waiting for the network.",
      "Live sync comes back as soon as your device is online again, and catches up on anything that changed while you were offline.",
      "The library and the Public Library download less: book descriptions load on the book's page, and the public catalog is shared by the pages that show it.",
    ],
  },
  {
    id: "2026-10-16-landing-phones",
    date: "2026-10-16",
    title: "The front page on phones",
    items: ["On phones and tablets, the front page's headlines, buttons and footer are now centered, so it reads more evenly on a small screen."],
  },
  {
    id: "2026-10-16-small-fixes",
    date: "2026-10-16",
    title: "Small fixes",
    items: [
      "Exporting your highlights as Markdown now works in the Android app too: the file is saved in Documents/BookRaven.",
      "Copy buttons say “Copied” only once the text is really copied, and go back to “Copy” after two seconds.",
      "Going quickly from one book or club to another never shows the previous one by mistake.",
      "Book club actions (new invite link, delete, leave, remove a member) now tell you when they don’t work.",
    ],
  },
  {
    id: "2026-10-16-word-dictionary",
    date: "2026-10-16",
    title: "A dictionary that knows the language",
    items: [
      "Select a single word and tap Dictionary: it tells you which language the word is in and translates it into the language you choose.",
      "Works with English, Spanish, Portuguese, French and Italian, even for a foreign word in the middle of a book.",
      "If a word exists in more than one language, tap one under Also in to see its meaning there.",
      "Definitions from Wiktionary are shown below the translation.",
      "Translate now recognizes the language of the passage you select, so a quote in another language than the book's is translated too.",
    ],
  },
  {
    id: "2026-10-16-lighter-app",
    date: "2026-10-16",
    title: "A lighter, smoother library",
    items: [
      "The app downloads about a fifth less before showing your library. Other pages load quietly in the background, so they still open instantly.",
      "Uploading books, syncing your place from another device and marking favorites no longer redraw every book on the page, so big libraries stay smooth.",
      "Long libraries scroll more smoothly: books off screen aren't drawn until you get to them.",
      "On the web, updates download less: the parts of the app that rarely change stay saved in your browser.",
    ],
  },
  {
    id: "2026-10-16-landing-page",
    date: "2026-10-16",
    title: "A front page for BookRaven",
    items: [
      "People who aren't signed in now see what BookRaven does before signing in or creating an account, so it's easier to invite friends.",
      "Signing in and creating an account have their own addresses: /login and /signup.",
      "When you sign out you land on the sign-in screen, as before.",
    ],
  },
  {
    id: "2026-10-16-quick-wins",
    date: "2026-10-16",
    title: "Snappier app, safer sign-out",
    items: [
      "The app and the sign-in page start faster: the logo images are now a much smaller download.",
      "Changing the font size, contrast or other reading settings redraws an ebook's page once instead of several times, so the reader reacts more smoothly.",
      "The Public Library loads faster.",
      "Signing out on a shared device now also removes your downloaded books, handwriting and any changes not yet sent, after giving them a moment to reach the server, so the next person never sees them.",
    ],
  },
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

export const lastSeenNote = () => readString(KEY);

/** Remembers that everything up to the newest note was shown (storage blocked: it may show again next time). */
export function markNotesSeen(notes: ReleaseNote[] = RELEASE_NOTES) {
  if (notes[0]) writeString(KEY, notes[0].id);
}
