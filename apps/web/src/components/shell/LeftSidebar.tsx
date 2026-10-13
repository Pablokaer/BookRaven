import { BookOpen, Compass, Folder, FolderPlus, Globe, HardDrive, Heart, Layers, Library, Share2, ShieldCheck, Upload, User } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { collectionColor, isInProgress } from "../../lib/bookStats";
import { fileSize } from "../../lib/format";
import { useLibrary } from "../../lib/libraryStore";
import { StorageMeter } from "./StorageMeter";

type NavItem = { to: string; label: string; icon: ReactNode; count?: number; end?: boolean };

/** App navigation. `compact` shows icons only (collapsed by the user, or on tablets). */
export function LeftSidebar({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const { books, folders, addFolder, me } = useLibrary();
  const navigate = useNavigate();

  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    for (const b of books ?? []) if (b.folderId) byFolder.set(b.folderId, (byFolder.get(b.folderId) ?? 0) + 1);
    return {
      byFolder,
      reading: books?.filter(isInProgress).length,
      favorites: books?.filter((b) => b.favorite).length,
      sharedWithMe: books?.filter((b) => b.sharedBy).length,
    };
  }, [books]);

  const nav: NavItem[] = [
    { to: "/", label: "Library", icon: <Library />, end: true },
    { to: "/public", label: "Public Library", icon: <Globe /> },
    { to: "/discover", label: "Discover", icon: <Compass /> },
    { to: "/shared", label: "Shared", icon: <Share2 />, count: counts.sharedWithMe },
    { to: "/reading", label: "Reading Now", icon: <BookOpen />, count: counts.reading },
    { to: "/uploads", label: "Uploads", icon: <Upload /> },
    { to: "/collections", label: "Collections", icon: <Layers />, end: true },
    { to: "/favorites", label: "Favorites", icon: <Heart />, count: counts.favorites },
    { to: "/profile", label: "Profile", icon: <User /> },
    ...(me?.isAdmin ? [{ to: "/admin", label: "Admin", icon: <ShieldCheck /> }] : []),
  ];

  // Labels are hidden when compact; `hide` is the class for that.
  const hide = compact ? "sr-only" : "";

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
      compact ? "justify-center" : ""
    } ${isActive ? "bg-primary/25 text-fg" : "text-muted hover:bg-white/5 hover:text-fg"}`;

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto overflow-x-hidden px-3 pb-6 pt-5" aria-label="Main">
      <NavLink to="/" onClick={onNavigate} className={`flex items-center gap-3 px-2 ${compact ? "justify-center px-0" : ""}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-primary text-app shadow-[0_6px_20px_-6px_rgb(22_201_178/0.6)]">
          <BookOpen className="h-5 w-5" strokeWidth={2.4} />
        </span>
        <span className={`font-display text-xl font-bold tracking-tight ${hide}`}>ReadSync</span>
      </NavLink>

      <ul className="space-y-1">
        {nav.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className={linkClass} onClick={onNavigate} title={compact ? item.label : undefined}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-accent" aria-hidden="true" />}
                  <span className={`[&>svg]:h-[18px] [&>svg]:w-[18px] ${isActive ? "text-accent" : ""}`}>{item.icon}</span>
                  <span className={`flex-1 truncate ${hide}`}>{item.label}</span>
                  {!compact && item.count ? (
                    <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] tabular-nums text-muted">{item.count}</span>
                  ) : null}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div>
        <div className={`mb-2 flex items-center px-3 ${compact ? "justify-center px-0" : "justify-between"}`}>
          <span className={`eyebrow ${hide}`}>My Collections</span>
          <button
            className="icon-btn h-7 w-7"
            aria-label="New collection"
            title="New collection"
            onClick={async () => {
              const folder = await addFolder();
              if (folder) {
                navigate(`/collections/${folder.id}`);
                onNavigate?.();
              }
            }}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
        {folders.length === 0 ? (
          !compact && <p className="px-3 text-xs leading-relaxed text-muted/80">Group books into collections. Create one with +.</p>
        ) : (
          <ul className="space-y-0.5">
            {folders.map((f) => (
              <li key={f.id}>
                <NavLink to={`/collections/${f.id}`} className={linkClass} onClick={onNavigate} title={compact ? f.name : undefined}>
                  <Folder className="h-4 w-4 shrink-0" style={{ color: collectionColor(f), fill: `${collectionColor(f)}33` }} />
                  <span className={`flex-1 truncate font-normal ${hide}`}>{f.name}</span>
                  {!compact && <span className="text-[11px] tabular-nums text-muted">{counts.byFolder.get(f.id) ?? 0}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Storage use, pinned to the bottom */}
      <NavLink
        to="/profile"
        onClick={onNavigate}
        className={`mt-auto block rounded-xl border border-line/70 bg-card/50 transition hover:border-accent/30 ${compact ? "p-2" : "p-3"}`}
        title={me ? (me.quotaBytes === null ? `${fileSize(me.usedBytes)} used · unlimited` : `${fileSize(me.usedBytes)} of ${fileSize(me.quotaBytes)} used`) : "Storage"}
      >
        {compact ? <HardDrive className="mx-auto h-4 w-4 text-muted" /> : <StorageMeter />}
      </NavLink>
    </nav>
  );
}
