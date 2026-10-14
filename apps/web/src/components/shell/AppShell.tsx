import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, Clock, CloudOff, Loader2, UploadCloud, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { fileSize } from "../../lib/format";
import { isActiveUpload, useLibrary, type UploadItem } from "../../lib/libraryStore";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { AppUpdateBanner } from "../AppUpdate";
import { OrganizeDialog } from "../OrganizeDialog";
import { ShareDialog } from "../ShareDialog";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebarWidgets } from "./RightSidebar";
import { BottomNav, LIBRARY_PATHS, LibraryTabs } from "./navigation";
import { TopBar } from "./TopBar";

const LAYOUT_KEY = "readsync.layout";

function loadLayout(): { leftCollapsed: boolean; rightOpen: boolean } {
  try {
    return { leftCollapsed: false, rightOpen: true, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") };
  } catch {
    return { leftCollapsed: false, rightOpen: true };
  }
}

function uploadLabel(u: UploadItem) {
  switch (u.status) {
    case "queued":
      return "Waiting";
    case "preparing":
      return "Reading details…";
    case "uploading":
      return `${Math.round(u.progress * 100)}%`;
    case "processing":
      return "Saving…";
    case "done":
      return "Added";
    default:
      return u.message ?? "";
  }
}

/** Every file being uploaded, with its state, until the user clears the finished ones. */
function UploadPanel() {
  const { uploads, clearUploads, folders } = useLibrary();
  const [collapsed, setCollapsed] = useState(false);
  if (!uploads.length) return null;

  const active = uploads.filter(isActiveUpload).length;
  const added = uploads.filter((u) => u.status === "done").length;
  const already = uploads.filter((u) => u.status === "duplicate").length;
  const failed = uploads.filter((u) => u.status === "error").length;
  // Overall progress by bytes; finished files (whatever the outcome) count in full.
  const total = uploads.reduce((n, u) => n + Math.max(u.size, 1), 0);
  const sent = uploads.reduce((n, u) => n + Math.max(u.size, 1) * (isActiveUpload(u) ? (u.status === "processing" ? 0.98 : u.progress * 0.95) : 1), 0);
  const folderName = (id: string | null) => (id ? folders.find((f) => f.id === id)?.name : undefined);

  return (
    <section
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-50 flex max-h-[min(28rem,calc(100dvh-10rem))] md:bottom-4 w-[min(24rem,calc(100vw-2rem))] animate-rise flex-col overflow-hidden rounded-2xl border border-line bg-elevated shadow-pop"
      aria-label="Uploads"
    >
      <header className="flex items-center gap-3 px-4 pb-2 pt-3">
        {active ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" /> : failed ? <CircleAlert className="h-4 w-4 shrink-0 text-rose-300" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />}
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-sm font-semibold">
            {active ? `Uploading · ${uploads.length - active} of ${uploads.length} done` : `Uploads finished · ${uploads.length} file${uploads.length === 1 ? "" : "s"}`}
          </p>
          <p className="truncate text-xs text-muted">
            {active
              ? "Keep this tab open until every file is done. You can keep browsing."
              : [added && `${added} added`, already && `${already} already in your library`, failed && `${failed} failed`].filter(Boolean).join(" · ") + ". You can leave this page."}
          </p>
        </div>
        <button className="icon-btn h-8 w-8" aria-label={collapsed ? "Show files" : "Hide files"} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {!active && (
          <button className="icon-btn h-8 w-8" aria-label="Clear uploads" onClick={clearUploads}>
            <X className="h-4 w-4" />
          </button>
        )}
      </header>
      <div className="mx-4 mb-3 h-1.5 overflow-hidden rounded-full bg-card" role="progressbar" aria-valuenow={Math.round((sent / total) * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-[width] duration-300 ${failed && !active ? "bg-rose-300" : "bg-accent"}`} style={{ width: `${(sent / total) * 100}%` }} />
      </div>
      {!collapsed && (
        <ul className="min-h-0 flex-1 divide-y divide-line/60 overflow-y-auto border-t border-line/60">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {u.status === "done" || u.status === "duplicate" ? (
                <CheckCircle2 className={`h-4 w-4 shrink-0 ${u.status === "done" ? "text-accent" : "text-muted"}`} />
              ) : u.status === "error" ? (
                <CircleAlert className="h-4 w-4 shrink-0 text-rose-300" />
              ) : u.status === "queued" ? (
                <Clock className="h-4 w-4 shrink-0 text-muted" />
              ) : (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate">{u.name}</p>
                <p className="truncate text-xs text-muted">
                  {fileSize(u.size)}
                  {folderName(u.folderId) && ` · into ${folderName(u.folderId)}`}
                </p>
                {(u.status === "uploading" || u.status === "processing") && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-card">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${u.progress * 100}%` }} />
                  </div>
                )}
              </div>
              <span className={`max-w-[45%] shrink-0 text-right text-xs ${u.status === "error" ? "text-rose-300" : "text-muted"}`}>{uploadLabel(u)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
  const [dragging, setDragging] = useState(false);
  const dragTimer = useRef<number | undefined>(undefined);
  const stopDragging = () => {
    window.clearTimeout(dragTimer.current);
    setDragging(false);
  };
  // While files are dragged over the page the browser keeps firing dragover (several times a
  // second, even without moving). If they stop, the drag left or was cancelled: hide the overlay.
  const keepDragging = () => {
    setDragging(true);
    window.clearTimeout(dragTimer.current);
    dragTimer.current = window.setTimeout(() => setDragging(false), 1000);
  };
  useEffect(() => () => window.clearTimeout(dragTimer.current), []);
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

  const compact = !isDesktop || layout.leftCollapsed;
  // The reading overview (goal, recent uploads, shared, discover) belongs to the dashboard only:
  // repeated on every page it takes a column on desktop and pushes content down on phones.
  const onDashboard = location.pathname === "/";
  const showRightColumn = onDashboard && isWide && layout.rightOpen;
  const widgetsBelow = onDashboard && !isWide;
  // Files dropped on a collection's page go into that collection. On the collections
  // overview, each card is its own drop target (see CollectionsPage).
  const dropFolder = lib.folders.find((f) => location.pathname === `/collections/${f.id}`) ?? null;
  const onCollectionsOverview = location.pathname === "/collections";

  return (
    <div
      className="flex min-h-dvh"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        keepDragging();
      }}
      // No element being entered: the drag left the window or was cancelled (Esc).
      onDragLeave={(e) => !e.relatedTarget && stopDragging()}
      onDrop={(e) => {
        stopDragging();
        if (e.isDefaultPrevented()) return; // already handled by a drop target inside the page (a collection card)
        e.preventDefault();
        if (e.dataTransfer.files.length) lib.upload(e.dataTransfer.files, dropFolder?.id ?? null);
      }}
    >
      {/* Left sidebar (tablet: icons only; phone: the bottom bar instead) */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 border-r border-line/60 bg-sidebar pt-[env(safe-area-inset-top)] transition-[width] duration-300 ease-out md:block ${
          compact ? "w-[76px]" : "w-64"
        }`}
      >
        <LeftSidebar compact={compact} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          user={user}
          onToggleLeft={() => setLayout((l) => ({ ...l, leftCollapsed: !l.leftCollapsed }))}
          onToggleRight={() => setLayout((l) => ({ ...l, rightOpen: !l.rightOpen }))}
          showLeftToggle={isDesktop}
          showRightToggle={isWide && onDashboard}
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
          {/* Phones: room at the bottom for the navigation bar. */}
          <main className="min-w-0 flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-6 sm:px-6 md:pb-16 lg:px-8">
            <div className="mx-auto max-w-[1400px]">
              {LIBRARY_PATHS.test(location.pathname) && <LibraryTabs />}
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

      <BottomNav />
      <UploadPanel />
      <AppUpdateBanner />

      {dragging && onCollectionsOverview && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex animate-fade justify-center px-4">
          <div className="flex items-center gap-2 rounded-full border border-accent/50 bg-card/95 px-5 py-2.5 text-sm shadow-pop">
            <UploadCloud className="h-4 w-4 text-accent" /> Drop on a collection to add the files to it, or anywhere else to add them to your library
          </div>
        </div>
      )}

      {dragging && !onCollectionsOverview && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex animate-fade items-center justify-center bg-app/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent/60 bg-card/80 px-16 py-12 text-center">
            <UploadCloud className="h-10 w-10 text-accent" />
            <div className="font-display text-xl font-medium">{dropFolder ? <>Drop to add to “{dropFolder.name}”</> : "Drop to add to your library"}</div>
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
