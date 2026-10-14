import { BookOpen, Folder, FolderPlus, HardDrive } from "lucide-react";
import { useMemo } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { collectionColor } from "../../lib/bookStats";
import { fileSize } from "../../lib/format";
import { useLibrary } from "../../lib/libraryStore";
import { DESTINATIONS } from "./navigation";
import { StorageMeter } from "./StorageMeter";

/**
 * App navigation: the four destinations, then the user's collections. Reading, Favorites,
 * Uploads… are tabs inside Library; Profile, Admin and Download are in the account menu.
 * `compact` shows icons only (collapsed by the user, or on tablets).
 */
export function LeftSidebar({ compact, onNavigate }: { compact: boolean; onNavigate?: () => void }) {
  const { books, folders, addFolder, me } = useLibrary();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const byFolder = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of books ?? []) if (b.folderId) m.set(b.folderId, (m.get(b.folderId) ?? 0) + 1);
    return m;
  }, [books]);

  // Labels are hidden when compact; `hide` is the class for that.
  const hide = compact ? "sr-only" : "";

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
      compact ? "justify-center" : ""
    } ${isActive ? "bg-accent/10 text-fg ring-1 ring-inset ring-accent/20" : "text-muted hover:bg-fg/5 hover:text-fg"}`;

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto overflow-x-hidden px-3 pb-6 pt-5" aria-label="Main">
      <NavLink to="/" onClick={onNavigate} className={`flex items-center gap-3 px-2 ${compact ? "justify-center px-0" : ""}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/25">
          <BookOpen className="h-5 w-5" strokeWidth={2} />
        </span>
        <span className={`font-display text-xl font-medium tracking-tight ${hide}`}>BookRaven</span>
      </NavLink>

      <ul className="space-y-1">
        {DESTINATIONS.map((d) => {
          const isActive = d.isActive(pathname);
          return (
            <li key={d.to}>
              <Link
                to={d.to}
                aria-current={isActive ? "page" : undefined}
                className={linkClass({ isActive })}
                onClick={onNavigate}
                title={compact ? d.label : undefined}
              >
                <span className={`[&>svg]:h-[18px] [&>svg]:w-[18px] ${isActive ? "text-accent" : ""}`}>{d.icon}</span>
                <span className={`flex-1 truncate ${hide}`}>{d.label}</span>
              </Link>
            </li>
          );
        })}
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
                  {!compact && <span className="text-[11px] tabular-nums text-muted">{byFolder.get(f.id) ?? 0}</span>}
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
