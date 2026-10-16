import { ArrowRight, BookOpen, Heart, Library, Share2 } from "lucide-react";
import { Link } from "react-router";
import { useMemo } from "react";
import { isInProgress } from "../../lib/bookStats";
import { useLibrary } from "../../lib/libraryStore";
import clouds1600 from "../../assets/landing/raven-clouds-1600.webp";
import clouds900 from "../../assets/landing/raven-clouds-900.webp";
import { StatCard } from "./StatCard";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function WelcomePanel({ name }: { name: string }) {
  const { books } = useLibrary();
  const stats = useMemo(() => {
    if (!books) return null;
    return {
      total: books.length,
      reading: books.filter(isInProgress).length,
      shared: books.filter((b) => b.isShared).length,
      favorites: books.filter((b) => b.favorite).length,
    };
  }, [books]);
  const first = name.split(/[\s@]/)[0];

  return (
    <section className="@container relative overflow-hidden rounded-xl border border-gold/15 shadow-card">
      {/* Doré's raven over the clouds (1884), toned to the palette. */}
      <img
        src={clouds900}
        srcSet={`${clouds900} 900w, ${clouds1600} 1600w`}
        sizes="(min-width: 1024px) 70vw, 100vw"
        alt=""
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-[70%_20%]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-app/95 via-app/70 to-app/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-app/85 via-app/20 to-transparent" />

      <div className="relative px-5 pb-5 pt-8 sm:px-8 sm:pb-7 sm:pt-10">
        <p className="eyebrow text-accent/90">
          {greeting()}
          {first ? `, ${first}` : ""}
        </p>
        <h1 className="mt-2 font-display text-[2.3rem] font-semibold leading-[1.05] text-ivory sm:text-[3rem]">Welcome back.</h1>
        <p className="mt-2 max-w-md text-sm text-muted sm:text-base">Good to see you again. Keep reading, keep growing.</p>
        <Link to="/stats" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          See your reading stats <ArrowRight className="h-4 w-4" />
        </Link>

        {/* Two columns even on phones, so the stats don't fill the first screen. */}
        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-7 sm:gap-3 @3xl:grid-cols-4">
          <StatCard icon={<Library />} label="Books" value={stats?.total ?? null} hint="Books in your library" />
          <StatCard icon={<BookOpen />} label="Reading" value={stats?.reading ?? null} hint="Started and not finished yet" />
          <StatCard icon={<Share2 />} label="Shared" value={stats?.shared ?? null} hint="Your books with an active share link" />
          <StatCard icon={<Heart />} label="Favorites" value={stats?.favorites ?? null} />
        </div>
      </div>
    </section>
  );
}

