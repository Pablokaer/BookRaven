import { Globe, Layers, Library, UsersRound } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { isInProgress } from "../../lib/bookStats";
import { useLibrary } from "../../lib/libraryStore";

/** The library's views: one destination in the navigation, shown as tabs on its pages. */
export const LIBRARY_PATHS = /^\/($|reading|favorites|shared|uploads|discover)$/;

export type Destination = { to: string; label: string; short?: string; icon: ReactNode; isActive: (path: string) => boolean };

/** The four places of the app, shared by the sidebar (desktop) and the bottom bar (phones). */
export const DESTINATIONS: Destination[] = [
  { to: "/", label: "Library", icon: <Library />, isActive: (p) => LIBRARY_PATHS.test(p) },
  { to: "/collections", label: "Collections", icon: <Layers />, isActive: (p) => p.startsWith("/collections") },
  { to: "/public", label: "Public Library", short: "Public", icon: <Globe />, isActive: (p) => p.startsWith("/public") },
  { to: "/clubs", label: "Book Clubs", short: "Clubs", icon: <UsersRound />, isActive: (p) => p.startsWith("/clubs") },
];

/** Overview, Reading, Favorites… across the top of every library page. */
export function LibraryTabs() {
  const { books } = useLibrary();
  const counts = useMemo(
    () => ({
      reading: books?.filter(isInProgress).length,
      favorites: books?.filter((b) => b.favorite).length,
      shared: books?.filter((b) => b.sharedBy).length,
    }),
    [books],
  );
  const tabs: { to: string; label: string; count?: number }[] = [
    { to: "/", label: "Overview" },
    { to: "/reading", label: "Reading", count: counts.reading },
    { to: "/favorites", label: "Favorites", count: counts.favorites },
    { to: "/shared", label: "Shared", count: counts.shared },
    { to: "/uploads", label: "Uploads" },
    { to: "/discover", label: "Discover" },
  ];

  return (
    <nav aria-label="Library" className="-mx-4 mb-8 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      <ul className="flex gap-6">
        {tabs.map((t) => (
          <li key={t.to} className="shrink-0">
            <NavLink
              to={t.to}
              end
              className={({ isActive }) =>
                `-mb-px flex items-center gap-2 border-b-2 py-3 text-sm transition ${
                  isActive ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg"
                }`
              }
            >
              {t.label}
              {t.count ? <span className="rounded-full bg-fg/6 px-1.5 text-xs tabular-nums text-muted">{t.count}</span> : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Phones: the four destinations at the bottom of the screen, within thumb reach. */
export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-app/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="grid grid-cols-4">
        {DESTINATIONS.map((d) => {
          const active = d.isActive(pathname);
          return (
            <li key={d.to}>
              <Link
                to={d.to}
                aria-current={active ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${active ? "text-accent" : "text-muted"}`}
              >
                <span className="[&>svg]:h-5 [&>svg]:w-5">{d.icon}</span>
                {d.short ?? d.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
