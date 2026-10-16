import {
  ArrowRight,
  Bookmark,
  ChartColumn,
  ChevronLeft,
  FileText,
  Highlighter,
  Images,
  Library,
  ListTree,
  PenLine,
  Server,
  Share2,
  Smartphone,
  Type,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import logoIcon from "../assets/logo.webp";
import wordmark from "../assets/wordmark.webp";
import { Landscape } from "../components/dashboard/Landscape";
import { apiJson, type ServerConfig } from "../lib/api";
import { THEMES } from "../lib/settings";

/**
 * What a signed-out visitor sees at "/" on the web: what BookRaven does, and the way in (sign in,
 * create an account). Static apart from /api/config, which says whether this server takes sign-ups.
 */
export function LandingPage() {
  const [cfg, setCfg] = useState<ServerConfig | null>(null);

  useEffect(() => {
    apiJson<ServerConfig>("/api/config")
      .then(setCfg)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = "BookRaven · Your books, on every device";
    return () => {
      document.title = previous;
    };
  }, []);

  // Like the sign-in form: offer sign-up unless the server says it is closed.
  const signupOpen = cfg?.allowSignup !== false;

  return (
    <div className="min-h-dvh overflow-x-clip bg-app">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-card px-4 py-2 text-sm text-fg shadow-pop focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 pt-[env(safe-area-inset-top)] sm:h-20 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5 rounded-lg" aria-label="BookRaven home">
          <img src={logoIcon} alt="" width={36} height={36} className="h-9 w-9 rounded-[10px]" />
          <img src={wordmark} alt="" width={110} height={26} className="h-[26px] w-auto" />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-1.5 sm:gap-2">
          <Link to="/login" className="btn-ghost h-10 px-3.5 font-medium text-fg">
            Sign in
          </Link>
          {signupOpen && (
            <Link to="/signup" className="btn hidden h-10 sm:inline-flex">
              Create account
            </Link>
          )}
        </nav>
      </header>

      <main id="main">
        <Hero signupOpen={signupOpen} />
        <Formats />
        <HowItWorks />
        <Features />
        <OnYourServer />
        <Closing signupOpen={signupOpen} />
      </main>

      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-sm text-muted sm:flex-row sm:justify-between sm:px-8 sm:text-left">
          <p className="flex flex-col items-center gap-2.5 sm:flex-row">
            <img src={logoIcon} alt="" width={24} height={24} className="h-6 w-6 rounded-md" />
            <span>
              <span className="font-medium text-fg">BookRaven</span> · a self-hosted reader for ebooks, PDFs and comics
            </span>
          </p>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link to="/login" className="hover:text-fg">
              Sign in
            </Link>
            {signupOpen && (
              <Link to="/signup" className="hover:text-fg">
                Create account
              </Link>
            )}
            <a href="https://github.com/Pablokaer/BookRaven" className="hover:text-fg" rel="noopener noreferrer" target="_blank">
              Source code<span className="sr-only"> (opens GitHub in a new tab)</span>
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** Primary and secondary way in. When the server takes no sign-ups, signing in is all there is. */
function Actions({ signupOpen, className = "" }: { signupOpen: boolean; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {signupOpen ? (
        <>
          <Link to="/signup" className="btn group h-12 px-5 text-[15px]">
            Create an account
            <ArrowRight className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <Link to="/login" className="btn-outline h-12 px-5 text-[15px]">
            Sign in
          </Link>
        </>
      ) : (
        <>
          <Link to="/login" className="btn group h-12 px-5 text-[15px]">
            Sign in
            <ArrowRight className="h-4 w-4 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <p className="text-sm text-muted">New accounts are by invitation on this server.</p>
        </>
      )}
    </div>
  );
}

/** A section's eyebrow, title and lead: centered over the content on narrow screens, left-aligned from `lg`. */
function SectionIntro({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="text-center lg:text-left">
      <p className="eyebrow text-accent">{eyebrow}</p>
      <h2 id={id} className="mt-3 font-display text-[2rem] font-bold leading-[1.1] tracking-[-0.01em] text-balance sm:text-[2.5rem]">
        {title}
      </h2>
      {children && <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-muted text-pretty lg:mx-0">{children}</p>}
    </div>
  );
}

function Hero({ signupOpen }: { signupOpen: boolean }) {
  return (
    <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-10 sm:px-8 sm:pt-16 lg:grid-cols-12 lg:gap-10 lg:pb-28 lg:pt-20">
      {/* Centered while the hero is one column (phones, tablets); beside the preview it reads from the left. */}
      <div className="text-center motion-safe:animate-rise lg:col-span-5 lg:text-left">
        <p className="eyebrow text-accent text-balance">Self-hosted reader · ebooks, PDFs &amp; comics</p>
        <h1
          id="hero-title"
          className="mt-5 font-display text-[2.75rem] font-bold leading-[1.02] tracking-[-0.02em] text-balance sm:text-6xl lg:text-[4.1rem]"
        >
          Pick up where you left off. <span className="text-accent">On any device.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-[34rem] text-[17px] leading-relaxed text-muted text-pretty lg:mx-0">
          Read in the browser or the Android app, and your place, highlights and bookmarks follow you, down to the sentence. E-ink readers keep up
          through KOReader.
        </p>
        <Actions signupOpen={signupOpen} className="mt-9 justify-center lg:justify-start" />
      </div>
      <div className="lg:col-span-7">
        <ReaderPreview />
      </div>
    </section>
  );
}

/**
 * The core feature, drawn with the app's own pieces: the web reader (sepia theme) and, on a
 * phone in the dark theme, the prompt the reader shows when another device read further.
 */
function ReaderPreview() {
  const sepia = THEMES.sepia;
  const dark = THEMES.dark;
  return (
    <figure className="relative mr-3 pb-12 sm:mr-8 sm:pb-16">
      <figcaption className="sr-only">
        The same book open in the web reader and on a phone. The phone offers to jump to the page reached on the computer.
      </figcaption>
      <div aria-hidden="true" className="select-none">
        <div className="overflow-hidden rounded-2xl shadow-pop" style={{ background: sepia.bg, color: sepia.fg }}>
          <div className="flex h-11 items-center gap-3 border-b px-4 text-[13px]" style={{ borderColor: sepia.surround }}>
            <ChevronLeft className="h-4 w-4 opacity-70" />
            <span className="truncate font-medium">Moby-Dick; or, The Whale</span>
            <span className="ml-auto flex items-center gap-3.5 opacity-70">
              <ListTree className="h-4 w-4" />
              <Type className="h-4 w-4" />
              <Bookmark className="h-4 w-4" />
            </span>
          </div>
          <div className="relative h-[300px] overflow-hidden px-6 pt-7 font-serif text-[13.5px] leading-[1.75] sm:h-[400px] sm:px-12 sm:pt-10 sm:text-[15px]">
            <p className="text-center text-[10px] uppercase tracking-[0.25em] [font-variant-numeric:lining-nums]">Chapter 1</p>
            <p className="mb-6 mt-1 text-center font-display text-2xl">Loomings</p>
            <p className="text-justify hyphens-auto">
              Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, and nothing particular to
              interest me on shore, I thought I would sail about a little and see the watery part of the world.{" "}
              <mark className="rounded-[2px] px-0.5 text-inherit" style={{ background: "rgb(250 204 21 / 0.45)" }}>
                It is a way I have of driving off the spleen and regulating the circulation.
              </mark>{" "}
              Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever I find myself
              involuntarily pausing before coffin warehouses, then, I account it high time to get to sea as soon as I can.
            </p>
            <p className="mt-3 indent-6 text-justify hyphens-auto">
              There now is your insular city of the Manhattoes, belted round by wharves as Indian isles by coral reefs; commerce surrounds it with
              her surf.
            </p>
            <p className="mt-3 indent-6 text-justify hyphens-auto">
              Circumambulate the city of a dreamy Sabbath afternoon. Go from Corlears Hook to Coenties Slip, and from thence, by Whitehall,
              northward. What do you see? Posted like silent sentinels all around the town, stand thousands upon thousands of mortal men fixed in
              ocean reveries.
            </p>
            <div className="absolute inset-x-0 bottom-0 h-20" style={{ background: `linear-gradient(transparent, ${sepia.bg})` }} />
          </div>
          <div className="flex items-center gap-3 px-4 pb-3 text-[11px] opacity-70">
            <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: sepia.surround }}>
              <div className="h-full w-[4%] rounded-full bg-primary" />
            </div>
            4%
          </div>
        </div>

        {/* The phone: same book, a little behind, offered the newer position. */}
        <div className="absolute -right-3 bottom-0 w-[56%] max-w-[250px] rounded-[2rem] bg-[#0b0b0b] p-[7px] shadow-pop ring-1 ring-white/10 motion-safe:animate-rise motion-safe:[animation-delay:250ms] motion-safe:[animation-fill-mode:both] sm:-right-8 sm:w-[46%]">
          <div className="relative h-[250px] overflow-hidden rounded-[1.6rem] px-2.5 pt-3 sm:h-[300px]" style={{ background: dark.bg, color: dark.fg }}>
            <div className="rounded-xl bg-neutral-900 p-3 text-[10.5px] leading-snug text-white shadow-2xl ring-1 ring-white/10 motion-safe:animate-pop motion-safe:[animation-delay:650ms] motion-safe:[animation-fill-mode:both] sm:text-[11.5px]">
              You reached <b>4%</b> on <b>Windows PC</b> just now.
              <div className="mt-2.5 flex justify-end gap-1 whitespace-nowrap">
                <span className="rounded-md px-1.5 py-1 text-neutral-300">Stay here</span>
                <span className="rounded-md bg-teal-600 px-1.5 py-1 font-medium">Jump there</span>
              </div>
            </div>
            <p className="mt-4 px-1.5 text-justify font-serif text-[10.5px] leading-[1.65] sm:text-[11.5px]">
              Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, and nothing particular to
              interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off
              the spleen and regulating the circulation.
            </p>
            <div className="absolute inset-x-0 bottom-0 h-14" style={{ background: `linear-gradient(transparent, ${dark.bg})` }} />
          </div>
        </div>
      </div>
    </figure>
  );
}

const FORMATS: [string, string[]][] = [
  ["Ebooks", ["EPUB", "MOBI", "AZW3", "FB2"]],
  ["Documents", ["PDF"]],
  ["Comics", ["CBZ", "CBR", "CB7", "CBT"]],
];

function Formats() {
  return (
    <section aria-labelledby="formats-title" className="border-y border-line/70 bg-sidebar/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-6 sm:px-8 md:flex-row md:gap-10">
        <h2 id="formats-title" className="eyebrow shrink-0">
          Opens
        </h2>
        <dl className="flex flex-wrap justify-center gap-x-10 gap-y-3 md:justify-start">
          {FORMATS.map(([group, list]) => (
            <div key={group} className="flex items-baseline gap-3">
              <dt className="text-sm text-muted">{group}</dt>
              <dd className="text-sm font-semibold tracking-wide text-fg">{list.join(" · ")}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

const STEPS: { title: string; text: string }[] = [
  {
    title: "Add your books",
    text: "Drop in EPUB, PDF and comic files, or bring a whole Calibre library. Title, author and cover are read from each file, and duplicates are skipped.",
  },
  {
    title: "Read on whatever is closest",
    text: "The web reader, the Android app, or KOReader on an e-ink device. Books stream in pieces, so a large PDF opens without downloading the whole file.",
  },
  {
    title: "Continue where you stopped",
    text: "Your position is saved as you read, even offline, and the newest one always wins. Open the book anywhere else and you are on the same sentence.",
  },
];

function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-12 lg:py-28">
      <div className="lg:col-span-4">
        <SectionIntro id="how-title" eyebrow="How it works" title="Bring your books. Read anywhere." />
      </div>
      <ol className="lg:col-span-7 lg:col-start-6">
        {STEPS.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[3rem_1fr] gap-x-4 border-t border-line/80 py-7 first:border-t-0 first:pt-0 sm:grid-cols-[4rem_1fr] lg:first:pt-2">
            <span className="font-display text-2xl font-semibold tabular-nums text-accent" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 max-w-xl leading-relaxed text-muted">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

type Feature = { icon: ReactNode; title: string; text: string };

const FEATURE_GROUPS: { label: string; items: Feature[] }[] = [
  {
    label: "Read",
    items: [
      {
        icon: <Type />,
        title: "Ebooks set the way you like",
        text: "Eight bundled fonts, spacing, margins, one or two pages, light, sepia and dark themes, contents and full-text search.",
      },
      {
        icon: <FileText />,
        title: "PDFs that zoom",
        text: "Pinch or Ctrl + scroll up to 4×, crop white margins, and select text to highlight or search.",
      },
      {
        icon: <Images />,
        title: "Comics and manga",
        text: "Two-page spreads, right-to-left manga and a vertical scroll for webtoons, with pinch-to-zoom.",
      },
    ],
  },
  {
    label: "Annotate",
    items: [
      {
        icon: <Highlighter />,
        title: "Highlights and notes",
        text: "Four colors, notes, export to Markdown, and dictionary or translation for any selected word.",
      },
      {
        icon: <PenLine />,
        title: "Handwriting on PDFs",
        text: "Pen, highlighter and eraser, pressure-sensitive with a stylus, ignoring a palm resting on the screen.",
      },
      {
        icon: <Bookmark />,
        title: "Bookmarks",
        text: "Mark a page with one tap or the B key. Bookmarks sync to your other devices and work offline.",
      },
    ],
  },
  {
    label: "Beyond the page",
    items: [
      {
        icon: <Share2 />,
        title: "Share and publish",
        text: "Send a book or a collection by link, or publish it to the server's Public Library for everyone on it.",
      },
      {
        icon: <UsersRound />,
        title: "Book clubs",
        text: "Read together: members see each other's progress and discuss passages.",
      },
      {
        icon: <ChartColumn />,
        title: "Reading stats",
        text: "Time read, streaks, a yearly goal and a heatmap of the last 26 weeks.",
      },
    ],
  },
];

function Features() {
  return (
    <section aria-labelledby="features-title" className="border-t border-line/70">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <SectionIntro id="features-title" eyebrow="Features" title="One library for everything you read.">
          Each format gets a reader made for it, and what you do inside a book goes with you to every device.
        </SectionIntro>
        <div className="mt-14 grid gap-x-10 gap-y-12 md:grid-cols-3">
          {FEATURE_GROUPS.map((group) => (
            <div key={group.label}>
              <h3 className="border-b border-line pb-3 font-display text-xl font-semibold">{group.label}</h3>
              <ul>
                {group.items.map((f) => (
                  <li key={f.title} className="flex gap-3.5 border-b border-line/60 py-5">
                    <span className="mt-0.5 shrink-0 text-accent [&>svg]:h-[18px] [&>svg]:w-[18px]" aria-hidden="true">
                      {f.icon}
                    </span>
                    <div>
                      <h4 className="font-medium">{f.title}</h4>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SERVER_FACTS: Feature[] = [
  {
    icon: <Server />,
    title: "Your files, your server",
    text: "Books, notes and reading history are kept by this server, on its disk or in its own storage bucket.",
  },
  {
    icon: <WifiOff />,
    title: "Works offline",
    text: "The library opens without a connection, and books you have opened keep working.",
  },
  {
    icon: <Smartphone />,
    title: "An Android app, no store needed",
    text: "Installed straight from the server, and it keeps itself up to date.",
  },
  {
    icon: <Library />,
    title: "Fits in with your other apps",
    text: "An OPDS catalog, KOReader progress sync, and imports from Goodreads and Calibre.",
  },
];

function OnYourServer() {
  return (
    <section aria-labelledby="server-title" className="border-t border-line/70 bg-sidebar/60">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-12 lg:py-24">
        <div className="lg:col-span-4">
          <SectionIntro id="server-title" eyebrow="Self-hosted" title="Your library stays yours.">
            BookRaven runs on a server of its own instead of a store's cloud. It reads DRM-free files, so the books you bring are the books you
            keep.
          </SectionIntro>
        </div>
        <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:col-span-7 lg:col-start-6">
          {SERVER_FACTS.map((f) => (
            <div key={f.title} className="border-t border-line pt-5">
              <dt className="flex items-center gap-2.5 font-medium">
                <span className="text-accent [&>svg]:h-[18px] [&>svg]:w-[18px]" aria-hidden="true">
                  {f.icon}
                </span>
                {f.title}
              </dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted">{f.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Closing({ signupOpen }: { signupOpen: boolean }) {
  return (
    <section aria-labelledby="closing-title" className="relative isolate overflow-hidden border-t border-line/70">
      <Landscape className="absolute inset-0 -z-10 h-full w-full opacity-60" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-app via-app/80 to-app/40" />
      <div className="mx-auto flex max-w-6xl flex-col items-center px-5 py-24 text-center sm:px-8 lg:py-32">
        <img src={logoIcon} alt="" width={56} height={56} className="h-14 w-14 rounded-2xl" />
        <h2 id="closing-title" className="mt-7 max-w-2xl font-display text-[2.25rem] font-bold leading-[1.08] tracking-[-0.01em] text-balance sm:text-5xl">
          Open a book. We&rsquo;ll keep your place.
        </h2>
        <Actions signupOpen={signupOpen} className="mt-9 justify-center" />
      </div>
    </section>
  );
}
