import { BookOpen, Heart, Library, Share2 } from "lucide-react";
import { useMemo } from "react";
import { isInProgress } from "../../lib/bookStats";
import { useLibrary } from "../../lib/libraryStore";
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
    <section className="@container surface rounded-3xl">
      <div className="px-5 pb-5 pt-7 sm:px-8 sm:pb-7 sm:pt-9">
        <p className="eyebrow">
          {greeting()}
          {first ? `, ${first}` : ""}
        </p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">Welcome back!</h1>
        <p className="mt-2 max-w-md text-sm text-muted sm:text-base">Good to see you again. Keep reading, keep growing.</p>

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

