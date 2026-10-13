import { CheckCircle2, CircleAlert, CloudOff, Loader2, UploadCloud, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { useLibrary } from "../../lib/libraryStore";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { OrganizeDialog } from "../OrganizeDialog";
import { ShareDialog } from "../ShareDialog";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebarWidgets } from "./RightSidebar";
import { TopBar } from "./TopBar";

const LAYOUT_KEY = "readsync.layout";

function loadLayout(): { leftCollapsed: boolean; rightOpen: boolean } {
  try {
    return { leftCollapsed: false, rightOpen: true, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") };
  } catch {
    return { leftCollapsed: false, rightOpen: true };
  }
}

function UploadToasts() {
  const { uploads } = useLibrary();
  if (!uploads.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] space-y-2" aria-live="polite">
      {uploads.map((u) => (
        <div key={u.key} className="flex animate-rise items-center gap-3 rounded-xl border border-line bg-elevated px-4 py-3 text-sm shadow-pop">
          {u.status === "uploading" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
          ) : u.status === "done" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
          ) : (
            <CircleAlert className="h-4 w-4 shrink-0 text-rose-300" />
          )}
          <span className="min-w-0 flex-1 truncate">{u.name}</span>
          <span className={`shrink-0 text-xs ${u.status === "error" ? "text-rose-300" : "text-muted"}`}>
            {u.status === "uploading" ? "Uploading…" : u.status === "done" ? "Added" : u.message}
          </span>
        </div>
      ))}
    </div>
  );
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Library layout: left navigation, top bar, page content and the contextual right sidebar. */
export function AppShell({ user }: { user: { name: string; email: string } }) {
  const lib = useLibrary();
  const [layout, setLayout] = useState(loadLayout);
  const [mobileNav, setMobileNav] = useState(false);
  const [dragging, setDragging] = useState(false);
  const location = useLocation();

  const online = useOnline();
  const isDesktop = useMediaQuery("(min-width: 1024px)"); // lg: full sidebar possible
  const isWide = useMediaQuery("(min-width: 1280px)"); // xl: room for the right column

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* ignore */
    }
  }, [layout]);

  // Close the mobile drawer whenever the page changes.
  useEffect(() => setMobileNav(false), [location.pathname]);

  const compact = !isDesktop || layout.leftCollapsed;
  const showRightColumn = isWide && layout.rightOpen;
  // Profile and collection overview pages do not need the widgets repeated under them.
  const widgetsBelow = !isWide && /^\/($|reading|uploads|shared|favorites|discover)/.test(location.pathname);

  return (
    <div
      className="flex min-h-dvh"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void lib.upload(e.dataTransfer.files);
      }}
    >
      {/* Left sidebar (tablet: icons only; phone: drawer) */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 border-r border-line/60 bg-sidebar pt-[env(safe-area-inset-top)] transition-[width] duration-300 ease-out md:block ${
          compact ? "w-[76px]" : "w-64"
        }`}
      >
        <LeftSidebar compact={compact} />
      </aside>

      {mobileNav && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 animate-fade bg-black/60 backdrop-blur-sm" onClick={() => setMobileNav(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in border-r border-line bg-sidebar pt-[env(safe-area-inset-top)] shadow-pop">
            <button className="icon-btn absolute right-3 top-[calc(env(safe-area-inset-top)+18px)]" aria-label="Close navigation" onClick={() => setMobileNav(false)}>
              <X className="h-4 w-4" />
            </button>
            <LeftSidebar compact={false} onNavigate={() => setMobileNav(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          user={user}
          onOpenMobileNav={() => setMobileNav(true)}
          onToggleLeft={() => setLayout((l) => ({ ...l, leftCollapsed: !l.leftCollapsed }))}
          onToggleRight={() => setLayout((l) => ({ ...l, rightOpen: !l.rightOpen }))}
          showLeftToggle={isDesktop}
          showRightToggle={isWide}
          rightOpen={layout.rightOpen}
        />

        {!online && (
          <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-6 py-2 text-xs text-amber-200" role="status">
            <CloudOff className="h-4 w-4 shrink-0" />
            You are offline. Your saved library is shown; books you opened before (or saved for offline) can still be read, and your progress
            syncs when you are back online.
          </div>
        )}

        <div className="flex flex-1">
          <main className="min-w-0 flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-[1400px]">
              <Outlet />
              {widgetsBelow && (
                <div className="mt-12">
                  <RightSidebarWidgets layout="grid" />
                </div>
              )}
            </div>
          </main>

          {showRightColumn && (
            <aside className="sticky top-16 h-[calc(100dvh-4rem)] w-80 shrink-0 animate-fade overflow-y-auto border-l border-line/60 px-5 py-6" aria-label="Reading overview">
              <RightSidebarWidgets />
            </aside>
          )}
        </div>
      </div>

      <UploadToasts />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex animate-fade items-center justify-center bg-app/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent/60 bg-card/80 px-16 py-12 text-center">
            <UploadCloud className="h-10 w-10 text-accent" />
            <div className="font-display text-xl font-semibold">Drop to add to your library</div>
            <div className="text-sm text-muted">PDF, EPUB, MOBI, AZW3, FB2 and comics (CBZ, CBR, CB7, CBT)</div>
          </div>
        </div>
      )}

      {/* Dialogs get the live copy of the book, so changes made inside them show up. */}
      {lib.sharing && (
        <ShareDialog book={lib.books?.find((b) => b.id === lib.sharing!.id) ?? lib.sharing} onClose={() => lib.openShare(null)} />
      )}
      {lib.organizing && (
        <OrganizeDialog
          book={lib.organizing}
          folders={lib.folders}
          allTags={[...new Set((lib.books ?? []).flatMap((b) => b.tags))].sort()}
          onSaved={lib.replaceBook}
          onClose={() => lib.openOrganize(null)}
        />
      )}
    </div>
  );
}
