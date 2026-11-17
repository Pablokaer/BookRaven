import { ArrowRight, ChevronLeft, ListTree, Smartphone, Type } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Link } from "react-router";
import clouds1600 from "../assets/landing/raven-clouds-1600.webp";
import clouds900 from "../assets/landing/raven-clouds-900.webp";
import scholar560 from "../assets/landing/scholar-560.webp";
import scholar880 from "../assets/landing/scholar-880.webp";
import logoIcon from "../assets/logo.webp";
import wordmark from "../assets/wordmark.webp";
import { Edge, Feather } from "../components/ui/LandingOrnaments";
import { ArchedPlate, Fleuron, Medallion, type Vignette } from "../components/ui/Ornaments";
import { apiJson, type ServerConfig } from "../lib/api";
import { structuredDataJson } from "../lib/structuredData";
import { THEME_INFO, THEME_ORDER } from "../lib/themes";
import { LANDING_COPY, type LandingCopy, type LandingLang } from "./landingCopy";

/** The page's words, in the language of its address ("/" English, "/pt" Portuguese). */
const Copy = createContext<LandingCopy>(LANDING_COPY.en);
const useCopy = () => useContext(Copy);

/**
 * What a signed-out visitor sees at "/" on the web: what BookRaven does, and the way in (sign in,
 * create an account). Static apart from /api/config, which says whether this server takes sign-ups.
 *
 * Laid out like an illustrated edition: the plates are Gustave Doré's engravings for Poe's
 * "The Raven" (1884, public domain), toned to the midnight and parchment palette.
 *
 * `signupDefault`: whether to offer sign-up until /api/config answers. The prerendered page was
 * drawn with the server's ALLOW_SIGNUP, and the browser starts from the same answer to hydrate it.
 */
export function LandingPage({ signupDefault = true, lang = "en" }: { signupDefault?: boolean; lang?: LandingLang }) {
  const c = LANDING_COPY[lang];
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);

  useEffect(() => {
    apiJson<ServerConfig>("/api/config")
      .then(setCfg)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = c.title;
    // Structured data for search engines: the site's name, and what BookRaven is. The prerendered
    // page has it in <head> already; otherwise it is added here (Google reads it after running the
    // page's scripts). It isn't a script that runs, so the CSP doesn't apply.
    const data =
      document.head.querySelector("script[data-landing-ld]") ??
      document.head.appendChild(
        Object.assign(document.createElement("script"), { type: "application/ld+json", textContent: structuredDataJson(window.location.origin, lang) }),
      );
    const htmlLang = document.documentElement.lang;
    document.documentElement.lang = c.htmlLang;
    return () => {
      document.title = previous;
      document.documentElement.lang = htmlLang;
      data.remove();
    };
  }, [c, lang]);

  // Like the sign-in form: offer sign-up unless the server says it is closed.
  const signupOpen = cfg ? cfg.allowSignup !== false : signupDefault;

  return (
    <Copy.Provider value={c}>
    <div ref={root} className="lit min-h-dvh overflow-x-clip">
      <a
        href="#main"
        className="sr-only z-50 rounded-[3px] bg-ivory px-4 py-2 text-sm text-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {c.skip}
      </a>

      <Header signupOpen={signupOpen} />

      <main id="main">
        <Hero signupOpen={signupOpen} />
        <LibraryChapter />
        <Journey />
        <Shelves />
        <Finale signupOpen={signupOpen} />
      </main>

      <Colophon signupOpen={signupOpen} />
    </div>
    </Copy.Provider>
  );
}

/** Marks each `.lit-reveal` element once it scrolls into view, so it fades up (see literary.css). */
function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const items = root.current?.querySelectorAll<HTMLElement>(".lit-reveal");
    if (!items?.length) return;
    if (typeof IntersectionObserver === "undefined") {
      items.forEach((el) => el.setAttribute("data-shown", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-shown", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
}

/** A reveal delay, for staggering the items of a group. */
const delay = (ms: number) => ({ "--lit-delay": `${ms}ms` }) as CSSProperties;

function Header({ signupOpen }: { signupOpen: boolean }) {
  const c = useCopy();
  // Clear over the hero; once the page scrolls, a midnight band keeps the links readable.
  // The scroll handler only sets state when the answer changes (React bails out on equal values).
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrolled(window.scrollY > 24);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow] duration-500 ${
        scrolled ? "bg-midnight/95 shadow-[0_1px_0_rgb(201_164_116/0.16)]" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-[72px] max-w-[1240px] items-center justify-between gap-4 px-5 sm:h-20 sm:px-8">
        <Link to={c.home} className="flex items-center gap-3 rounded-[3px]" aria-label={c.homeLabel}>
          <img src={logoIcon} alt="" width={40} height={40} className="h-10 w-10 rounded-[11px] shadow-[0_6px_18px_-6px_rgb(0_0_0/0.8)] sm:h-11 sm:w-11" />
          <img src={wordmark} alt="" width={111} height={18} className="h-[17px] w-auto sm:h-[19px]" />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          <ul className="mr-3 hidden items-center gap-7 text-[14px] text-silver lg:flex">
            {c.nav.map(([href, label]) => (
              <li key={href}>
                <a href={href} className="rounded-[2px] py-2 transition-colors hover:text-ivory">
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <a href={c.otherHome} hrefLang={c.otherLang} lang={c.otherLang} className="lit-link min-h-10 whitespace-nowrap px-2 text-[13px] text-silver">
            {c.otherLabel}
          </a>
          <Link to="/login" className="lit-link min-h-10 whitespace-nowrap px-3 text-[14px] text-ivory">
            {c.signIn}
          </Link>
          {signupOpen && (
            <Link to="/signup" className="lit-btn lit-btn-sm hidden sm:inline-flex">
              {c.createAccount}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Primary and secondary way in. When the server takes no sign-ups, signing in is all there is. */
function Actions({ signupOpen, className = "" }: { signupOpen: boolean; className?: string }) {
  const c = useCopy();
  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 ${className}`}>
      {signupOpen ? (
        <>
          <Link to="/signup" className="lit-btn group">
            {c.createAnAccount}
            <ArrowRight className="h-4 w-4 transition-transform duration-300 motion-safe:group-hover:translate-x-1" aria-hidden="true" />
          </Link>
          <Link to="/login" className="lit-link text-ivory">
            {c.signIn}
          </Link>
        </>
      ) : (
        <>
          <Link to="/login" className="lit-btn group">
            {c.signIn}
            <ArrowRight className="h-4 w-4 transition-transform duration-300 motion-safe:group-hover:translate-x-1" aria-hidden="true" />
          </Link>
          <p className="text-sm text-silver">{c.invitationOnly}</p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */

// The hero is above the fold: it fades in with CSS as soon as it is drawn (.lit-intro), not after
// the scripts run like the .lit-reveal sections below, so it is never blank while the page loads.
function Hero({ signupOpen }: { signupOpen: boolean }) {
  const c = useCopy();
  return (
    <section aria-labelledby="hero-title" className="lit-grain lit-grain-night relative">
      {/* Moonlight from the upper right, a candle's warmth low on the left. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(55% 45% at 80% 6%, rgb(170 184 198 / 0.16), transparent 70%), radial-gradient(42% 38% at 6% 96%, rgb(201 164 116 / 0.13), transparent 70%), linear-gradient(180deg, #0b1d2e 0%, #071521 55%)",
        }}
      />
      <div className="mx-auto grid max-w-[1240px] px-5 pb-28 pt-24 sm:px-8 sm:pt-28 lg:min-h-[min(100svh,1000px)] lg:grid-cols-12 lg:items-center lg:gap-8 lg:pb-32 lg:pt-28">
        <div className="relative lg:order-2 lg:col-span-5 lg:col-start-8">
          <figure className="lit-intro relative mx-auto w-[min(76vw,340px)] sm:w-[380px] lg:mr-0 lg:w-full lg:max-w-[460px]">
            <ArchedPlate sizes="(min-width: 1024px) 460px, (min-width: 640px) 380px, 340px" priority />
            <figcaption className="-mt-6 hidden text-center font-literary text-[15px] italic leading-snug text-silver lg:block">
              &ldquo;Perched upon a bust of Pallas just above my chamber door.&rdquo;
              <span className="mt-1.5 block font-sans text-[10.5px] not-italic uppercase tracking-[0.2em] text-silver/70">
                {c.heroPlate}
              </span>
            </figcaption>
          </figure>
          <ReaderCard className="absolute -left-20 bottom-28 hidden lg:block xl:-left-28" />
        </div>

        <div className="relative z-10 -mt-20 text-center sm:-mt-24 lg:order-1 lg:col-span-7 lg:mt-0 lg:text-left">
          <p className="lit-eyebrow lit-intro text-gold" style={delay(60)}>
            {c.heroEyebrow[0]}
            <span className="hidden sm:inline"> · {c.heroEyebrow[1]}</span>
          </p>
          <h1
            id="hero-title"
            className="lit-title lit-intro mt-6 text-[3.5rem] text-ivory sm:text-[5rem] lg:text-[5.9rem] xl:text-[6.6rem]"
          >
            {c.heroTitle[0]} <br className="hidden sm:block" />
            {c.heroTitle[1]} <em className="italic text-gold">{c.heroTitle[2]}</em>
          </h1>
          <p
            className="lit-intro mx-auto mt-7 max-w-[33rem] text-[16.5px] leading-[1.75] text-silver text-pretty sm:text-[17.5px] lg:mx-0"
            style={delay(120)}
          >
            {c.heroText}
          </p>
          <div className="lit-intro" style={delay(180)}>
            <Actions signupOpen={signupOpen} className="mt-10 justify-center lg:justify-start" />
          </div>
          <div className="lit-intro mt-12 flex items-center justify-center gap-4 lg:justify-start" style={delay(240)}>
            <Fleuron className="hidden w-16 text-gold/60 sm:block" />
            <p className="text-[11.5px] uppercase tracking-[0.2em] text-silver/80">EPUB · MOBI · AZW3 · FB2 · PDF · CBZ · CBR · CB7 · CBT</p>
          </div>
          <ReaderCard className="lit-intro mx-auto mt-14 w-fit lg:hidden" style={delay(240)} />
        </div>
      </div>
    </section>
  );
}

/**
 * The product, quietly: a page of the reader in its paper theme, with a highlight, a bookmark and
 * the note the reader shows when another device read further.
 */
function ReaderCard({ className = "", style }: { className?: string; style?: CSSProperties }) {
  const c = useCopy();
  return (
    <figure className={className} style={style}>
      <figcaption className="sr-only">{c.readerCaption}</figcaption>
      <div aria-hidden="true" className="select-none">
        <div className="w-[272px] rotate-[-2.5deg] rounded-[3px] bg-ivory text-ink shadow-[0_30px_60px_-24px_rgb(0_0_0/0.9),0_0_0_1px_rgb(201_164_116/0.35)]">
          <div className="flex items-center gap-2 border-b border-ink/10 px-3.5 py-2.5 text-[11px] text-sepia">
            <ChevronLeft className="h-3.5 w-3.5" />
            <span className="truncate font-semibold text-ink">The Raven</span>
            <span className="truncate">· Edgar Allan Poe</span>
            <span className="ml-auto flex items-center gap-2.5">
              <ListTree className="h-3.5 w-3.5" />
              <Type className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="relative px-5 pb-3 pt-4 text-left font-literary text-[14.5px] leading-[1.5]">
            <span className="absolute -top-px right-4 h-8 w-3.5 bg-gold [clip-path:polygon(0_0,100%_0,100%_100%,50%_76%,0_100%)]" />
            <p className="text-center font-sans text-[9px] uppercase tracking-[0.28em] text-sepia">Stanza I</p>
            <p className="mt-2.5">
              Once upon a midnight dreary, while I pondered, weak and weary,{" "}
              <mark className="rounded-[1px] bg-gold/40 px-0.5 text-inherit">Over many a quaint and curious volume of forgotten lore</mark>
              &mdash; While I nodded, nearly napping, suddenly there came a tapping&hellip;
            </p>
          </div>
          <div className="flex items-center gap-2.5 px-4 pb-3 text-[10px] text-sepia">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full w-[38%] bg-gold-deep" />
            </div>
            38%
          </div>
        </div>
        <div className="relative z-10 -mt-3 ml-10 inline-flex items-center gap-2 rounded-full bg-navy px-3.5 py-2 text-[11.5px] text-parchment shadow-[0_12px_30px_-12px_rgb(0_0_0/0.9)] ring-1 ring-gold/30">
          <Smartphone className="h-3.5 w-3.5 text-gold" />
          {c.readerSynced}
        </div>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------------------------------------ */

const ROMAN = ["I", "II", "III", "IV"];

function LibraryChapter() {
  const c = useCopy();
  return (
    <section id="library" aria-labelledby="library-title" className="lit-parchment lit-grain relative scroll-mt-16">
      <Edge className="text-parchment" />
      <div className="mx-auto grid max-w-[1240px] gap-20 px-5 pb-28 pt-24 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pb-40 lg:pt-36">
        <Collage className="lg:col-span-5" />

        <div className="lg:col-span-6 lg:col-start-7">
          <p className="lit-eyebrow lit-reveal text-gold-deep">{c.libraryEyebrow}</p>
          <h2 id="library-title" className="lit-title lit-reveal mt-5 text-[2.9rem] sm:text-[3.8rem] lg:text-[4.3rem]" style={delay(80)}>
            {c.libraryTitle[0]} <em className="italic text-gold-deep">{c.libraryTitle[1]}</em>
          </h2>
          <p className="lit-dropcap lit-reveal mt-9 max-w-[36rem] text-[17px] leading-[1.8] text-ink/85 text-pretty" style={delay(160)}>
            {c.libraryText}
          </p>

          <ol className="mt-16 grid gap-x-12 gap-y-12 sm:grid-cols-2">
            {c.articles.map((a, i) => (
              <li key={a.title} className={`lit-reveal ${i % 2 === 1 ? "sm:translate-y-14" : ""}`} style={delay(i * 90)}>
                <div className="flex items-baseline gap-3 border-t border-ink/20 pt-4">
                  <span className="font-literary text-[1.7rem] italic leading-none text-gold-deep" aria-hidden="true">
                    {ROMAN[i]}.
                  </span>
                  <h3 className="font-literary text-[1.65rem] font-semibold leading-tight">{a.title}</h3>
                </div>
                <p className="mt-3 text-[15px] leading-[1.75] text-sepia">{a.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** A plate, a loose manuscript page and a quill, laid on the parchment together. */
function Collage({ className = "" }: { className?: string }) {
  const c = useCopy();
  return (
    <div className={`relative mx-auto w-full max-w-[470px] lg:sticky lg:top-28 lg:mt-6 lg:self-start ${className}`}>
      <figure className="lit-reveal relative ml-[10%] w-[90%]">
        <div className="bg-[#e6d8bf] p-2.5 shadow-[0_30px_50px_-30px_rgb(21_27_35/0.7)] ring-1 ring-ink/20">
          <div className="overflow-hidden ring-1 ring-ink/30">
            <img
              src={scholar560}
              srcSet={`${scholar560} 560w, ${scholar880} 880w`}
              sizes="(min-width: 1024px) 420px, 90vw"
              width={880}
              height={1251}
              loading="lazy"
              decoding="async"
              alt={c.scholarAlt}
              className="lit-parallax h-auto w-full"
            />
          </div>
        </div>
        <figcaption className="mt-3 pl-1 font-literary text-[14px] italic text-sepia">
          {c.plateII} · &ldquo;Over many a quaint and curious volume of forgotten lore&rdquo;
        </figcaption>
      </figure>

      <div
        aria-hidden="true"
        className="lit-reveal absolute -left-1 bottom-20 w-[56%] max-w-[250px] rotate-[-5deg] bg-ivory px-5 py-5 font-literary text-[14px] italic leading-[1.9] text-ink/75 shadow-[0_24px_40px_-22px_rgb(21_27_35/0.7)] sm:-left-6"
        style={{
          ...delay(240),
          backgroundImage: "repeating-linear-gradient(180deg, transparent 0 25.5px, rgb(36 63 90 / 0.14) 25.5px 26.6px)",
        }}
      >
        <p>Deep into that darkness peering, long I stood there wondering, fearing, doubting, dreaming dreams no mortal ever dared to dream before&hellip;</p>
        <p className="mt-2 text-right not-italic text-[11px] uppercase tracking-[0.25em] text-gold-deep">— E. A. Poe</p>
      </div>

      <Feather className="lit-feather absolute -right-2 -top-14 h-60 w-auto text-gold-deep/70 sm:-right-10" style={{ transform: "rotate(-24deg)" }} />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** The engraving of each step of the journey (the words are in landingCopy.ts). */
const JOURNEY_PLATES: Vignette[] = ["arrival", "shelves", "lamp", "flight"];

function Journey() {
  const c = useCopy();
  return (
    <section id="journey" aria-labelledby="journey-title" className="lit-grain lit-grain-night relative scroll-mt-16 bg-navy text-parchment">
      <Edge className="text-navy" mirror />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(50% 60% at 85% 0%, rgb(36 63 90 / 0.65), transparent 70%), radial-gradient(40% 50% at 0% 100%, rgb(7 21 33 / 0.9), transparent 70%)" }}
      />
      <div className="mx-auto max-w-[1240px] px-5 pb-32 pt-24 sm:px-8 lg:pb-44 lg:pt-36">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="text-center lg:col-span-7 lg:text-left">
            <p className="lit-eyebrow lit-reveal text-gold">{c.journeyEyebrow}</p>
            <h2 id="journey-title" className="lit-title lit-reveal mt-5 text-[2.9rem] text-ivory sm:text-[3.8rem] lg:text-[4.3rem]" style={delay(80)}>
              {c.journeyTitle[0]} <em className="italic text-gold">{c.journeyTitle[1]}</em>
            </h2>
          </div>
          <p className="lit-reveal mx-auto max-w-md text-center text-[16px] leading-[1.75] text-silver lg:col-span-4 lg:col-start-9 lg:mx-0 lg:text-left" style={delay(160)}>
            {c.journeyText}
          </p>
        </div>

        <ol className="relative mt-20 grid gap-12 md:mt-24 md:grid-cols-4 md:gap-6">
          {/* The path between the plates, from the second row of medallions down to the first and back. */}
          <svg
            className="pointer-events-none absolute inset-x-0 top-0 hidden h-[224px] w-full md:block"
            viewBox="0 0 1000 224"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M-20 120 C 40 70, 90 80, 125 80 S 300 144, 375 144 S 560 80, 625 80 S 800 144, 875 144 S 980 110, 1020 96"
              stroke="rgb(201 164 116 / 0.55)"
              strokeWidth="1"
              strokeDasharray="1 7"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span aria-hidden="true" className="absolute bottom-6 left-[2.75rem] top-6 w-px bg-gradient-to-b from-gold/0 via-gold/35 to-gold/0 md:hidden" />

          {c.journey.map((step, i) => (
            <li
              key={step.title}
              className={`lit-reveal relative grid grid-cols-[5.5rem_1fr] items-start gap-5 md:block md:text-center ${i % 2 === 1 ? "md:mt-16" : ""}`}
              style={delay(i * 140)}
            >
              <Medallion
                plate={JOURNEY_PLATES[i]!}
                alt={step.alt}
                seal={<span className="font-literary text-[15px] italic">{ROMAN[i]}</span>}
                className="mx-auto h-[5.5rem] w-[5.5rem] md:h-40 md:w-40 md:p-[7px]"
              />
              <div className="md:mt-7">
                <h3 className="font-literary text-[2rem] font-medium leading-none text-ivory md:text-[2.3rem]">{step.title}</h3>
                <p className="mt-3 text-[15px] leading-[1.7] text-silver md:mx-auto md:max-w-[15rem]">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ */

/** Spine sizes and bindings, so the shelf looks gathered over the years rather than bought in a set. */
const SPINES: { h: number; w: number; bg: string; fg: string; lean?: boolean }[] = [
  { h: 250, w: 50, bg: "#0c2033", fg: "#c9a474" },
  { h: 278, w: 58, bg: "#5b4428", fg: "#eee3d0" },
  { h: 232, w: 44, bg: "#243f5a", fg: "#eee3d0" },
  { h: 266, w: 62, bg: "#151b23", fg: "#c9a474" },
  { h: 244, w: 48, bg: "#d9c9ab", fg: "#151b23" },
  { h: 286, w: 56, bg: "#1b3047", fg: "#c9a474" },
  { h: 238, w: 52, bg: "#7a5c34", fg: "#f5eedf" },
  { h: 270, w: 46, bg: "#0c2033", fg: "#aab8c6" },
  { h: 256, w: 60, bg: "#2e3a48", fg: "#c9a474" },
  { h: 228, w: 44, bg: "#151b23", fg: "#eee3d0" },
  { h: 262, w: 54, bg: "#243f5a", fg: "#c9a474", lean: true },
];

function Shelves() {
  const c = useCopy();
  const [hover, setHover] = useState<string | null>(null);
  const theme = (key: string) => c.themes?.[key] ?? THEME_INFO[key]!;
  const info = hover ? theme(hover) : null;
  const caption = info ? `${info.label} — ${info.blurb}` : c.shelvesPick;
  // Phones get two shorter shelves; wider screens, one long one.
  const rows: [string, string[]][] = [
    ["md:hidden", THEME_ORDER.slice(0, 6)],
    ["md:hidden", THEME_ORDER.slice(6)],
    ["hidden md:flex", THEME_ORDER],
  ];

  return (
    <section id="shelves" aria-labelledby="shelves-title" className="lit-grain relative scroll-mt-16 bg-ivory text-ink">
      <Edge className="text-ivory" />
      <div className="mx-auto grid max-w-[1240px] gap-16 px-5 pb-32 pt-24 sm:px-8 lg:grid-cols-12 lg:gap-10 lg:pb-44 lg:pt-36">
        <div className="text-center lg:col-span-4 lg:text-left">
          <p className="lit-eyebrow lit-reveal text-gold-deep">{c.shelvesEyebrow}</p>
          <h2 id="shelves-title" className="lit-title lit-reveal mt-5 text-[2.9rem] sm:text-[3.6rem] lg:text-[3.7rem]" style={delay(80)}>
            {c.shelvesTitle[0]} <em className="italic text-gold-deep">{c.shelvesTitle[1]}</em>
          </h2>
          <p className="lit-reveal mx-auto mt-7 max-w-md text-[16px] leading-[1.75] text-sepia lg:mx-0" style={delay(160)}>
            {c.shelvesText}
          </p>
          <dl className="lit-reveal mx-auto mt-9 grid max-w-md gap-3 text-left text-[14px] lg:mx-0" style={delay(220)}>
            {c.shelvesFacts.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-3 border-t border-ink/15 pt-3">
                <dt className="font-literary text-[15px] italic text-gold-deep">{k}</dt>
                <dd className="text-sepia">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="lit-reveal mx-auto mt-8 max-w-md lg:mx-0" style={delay(260)}>
            <a href={c.classicsLink} className="lit-link font-medium text-gold-deep">
              {c.classicsCta} &rarr;
            </a>
          </p>
        </div>

        <div className="lit-reveal lg:col-span-8 lg:col-start-5 lg:pt-8" style={delay(120)}>
          <nav aria-label={c.shelvesNav}>
            {rows.map(([visibility, keys], r) => (
              <div key={r} className={`${visibility} ${r === 1 ? "mt-10" : ""} flex-col`}>
                <ul className="flex items-end justify-center gap-[3px] px-2">
                  {keys.map((key) => {
                    const s = SPINES[THEME_ORDER.indexOf(key)];
                    const t = theme(key);
                    return (
                      <li key={key} className="flex">
                        <Link
                          to={`/public?theme=${key}`}
                          className={`lit-spine relative flex items-center justify-center overflow-hidden rounded-t-[3px] rounded-b-[1px] font-literary text-[15px] font-semibold uppercase tracking-[0.16em] shadow-[inset_-6px_0_10px_-6px_rgb(0_0_0/0.45),inset_5px_0_8px_-6px_rgb(255_255_255/0.25)] max-md:h-[var(--h-sm)] max-md:w-[var(--w-sm)] max-md:text-[13px] md:h-[var(--h)] md:w-[var(--w)] ${s.lean ? "lit-spine-lean" : ""}`}
                          style={
                            {
                              "--h": `${s.h}px`,
                              "--w": `${s.w}px`,
                              "--h-sm": `${Math.round(s.h * 0.72)}px`,
                              "--w-sm": `${Math.round(s.w * 0.88)}px`,
                              background: s.bg,
                              color: s.fg,
                            } as CSSProperties
                          }
                          onMouseEnter={() => setHover(key)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(key)}
                          onBlur={() => setHover(null)}
                        >
                          <span aria-hidden="true" className="lit-band top-3" />
                          <span aria-hidden="true" className="lit-band bottom-3" />
                          {t.label}
                          <span className="sr-only">: {t.blurb}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <div
                  aria-hidden="true"
                  className="h-3.5 rounded-[1px] bg-[#3a2c1c] shadow-[0_14px_22px_-10px_rgb(21_27_35/0.6),inset_0_1px_0_rgb(201_164_116/0.45)]"
                  style={{ backgroundImage: "linear-gradient(180deg, #5b4428, #2f2416)" }}
                />
              </div>
            ))}
          </nav>
          <p aria-hidden="true" className="mt-6 min-h-[1.6em] text-center font-literary text-[17px] italic text-sepia transition-opacity">
            {caption}
          </p>
          <p className="mt-2 text-center text-[13px] text-sepia/90">
            {c.shelvesNote}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function Finale({ signupOpen }: { signupOpen: boolean }) {
  const c = useCopy();
  return (
    <section aria-labelledby="closing-title" className="relative isolate bg-midnight">
      <Edge className="text-midnight" mirror />
      <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
        <img
          src={clouds900}
          srcSet={`${clouds900} 900w, ${clouds1600} 1600w`}
          sizes="100vw"
          width={1600}
          height={814}
          loading="lazy"
          decoding="async"
          alt=""
          className="lit-parallax h-full w-full object-cover object-[50%_18%]"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #071521 0%, rgb(7 21 33 / 0.1) 20%, rgb(7 21 33 / 0.55) 45%, rgb(7 21 33 / 0.6) 70%, #071521 100%), radial-gradient(55% 40% at 50% 62%, rgb(7 21 33 / 0.55), transparent 100%)",
          }}
        />
      </div>
      <div className="mx-auto flex max-w-[1240px] flex-col items-center px-5 pb-36 pt-36 text-center sm:px-8 lg:pb-48 lg:pt-52">
        <Fleuron className="lit-reveal w-28 text-gold/70" />
        <h2 id="closing-title" className="lit-title lit-reveal mt-7 max-w-4xl text-[3.1rem] text-ivory sm:text-[4.5rem] lg:text-[5.6rem]" style={delay(100)}>
          {c.finaleTitle[0]} <em className="italic text-gold">{c.finaleTitle[1]}</em>
        </h2>
        <p className="lit-reveal mt-7 max-w-xl text-[17px] leading-[1.75] text-parchment/85" style={delay(180)}>
          {signupOpen ? c.finaleOpen : c.finaleClosed}
        </p>
        <div className="lit-reveal" style={delay(260)}>
          <Actions signupOpen={signupOpen} className="mt-10 justify-center" />
        </div>
      </div>
    </section>
  );
}

function Colophon({ signupOpen }: { signupOpen: boolean }) {
  const c = useCopy();
  return (
    <footer className="border-t border-gold/15 bg-midnight">
      <div className="mx-auto max-w-[1240px] px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-16 sm:px-8 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="text-center lg:col-span-4 lg:text-left">
            <p className="flex items-center justify-center gap-3 lg:justify-start">
              <img src={logoIcon} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 rounded-[9px]" />
              <img src={wordmark} alt="BookRaven" width={98} height={16} loading="lazy" className="h-4 w-auto" />
            </p>
            <p className="mx-auto mt-5 max-w-xs font-literary text-[18px] italic leading-snug text-silver lg:mx-0">
              {c.tagline}
            </p>
          </div>
          <div className="lg:col-span-8">
            <h2 className="lit-eyebrow text-center text-gold lg:text-left">{c.colophonTitle}</h2>
            <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {c.colophon.map((item) => (
                <div key={item.title} className="border-t border-gold/15 pt-4">
                  <dt className="font-literary text-[19px] font-semibold text-ivory">{item.title}</dt>
                  <dd className="mt-1.5 text-[14px] leading-relaxed text-silver">{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-center gap-6 border-t border-gold/15 pt-8 text-[13px] text-silver lg:flex-row lg:justify-between">
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-7 gap-y-2">
            <Link to="/login" className="hover:text-ivory">
              {c.signIn}
            </Link>
            {signupOpen && (
              <Link to="/signup" className="hover:text-ivory">
                {c.createAccount}
              </Link>
            )}
            <a href={c.classicsLink} className="hover:text-ivory">
              {c.classicsShort}
            </a>
            <a href={c.otherHome} hrefLang={c.otherLang} lang={c.otherLang} className="hover:text-ivory">
              {c.otherLabel}
            </a>
            <a href="https://github.com/Pablokaer/BookRaven" className="hover:text-ivory" rel="noopener noreferrer" target="_blank">
              {c.sourceCode}
              <span className="sr-only"> {c.newTab}</span>
            </a>
          </nav>
          <p className="max-w-xl text-center text-[12px] leading-relaxed text-silver/75 lg:text-right">
            {c.credits[0]} <i>The Raven</i> {c.credits[1]}
          </p>
        </div>
      </div>
    </footer>
  );
}
