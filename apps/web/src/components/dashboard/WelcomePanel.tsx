import { BookOpen, Heart, Library, Share2 } from "lucide-react";
import { useMemo } from "react";
import { isInProgress } from "../../lib/bookStats";
import { useLibrary } from "../../lib/libraryStore";
import { Landscape } from "./Landscape";
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
    <section className="@container relative overflow-hidden rounded-3xl border border-line/70 shadow-card">
      <Landscape className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-r from-app/90 via-app/45 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-app/75 via-app/10 to-transparent" />

      <div className="relative px-5 pb-5 pt-8 sm:px-8 sm:pb-7 sm:pt-10">
        <p className="eyebrow text-accent/90">
          {greeting()}
          {first ? `, ${first}` : ""}
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-[2.6rem] sm:leading-[1.1]">Welcome back!</h1>
        <p className="mt-2 max-w-md text-sm text-muted sm:text-base">Good to see you again. Keep reading, keep growing.</p>

        <div className="mt-7 grid grid-cols-1 gap-3 @sm:grid-cols-2 @3xl:grid-cols-4">
          <StatCard icon={<Library />} label="Books Uploaded" value={stats?.total ?? null} hint="Books in your library" />
          <StatCard icon={<BookOpen />} label="Currently Reading" value={stats?.reading ?? null} hint="Started and not finished yet" />
          <StatCard icon={<Share2 />} label="Shared Books" value={stats?.shared ?? null} hint="Your books with an active share link" />
          <StatCard icon={<Heart />} label="Favorites" value={stats?.favorites ?? null} />
        </div>
      </div>
    </section>
  );
}

