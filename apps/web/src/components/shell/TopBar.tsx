import { Bell, LogOut, Menu as MenuIcon, PanelLeft, PanelRight, Plus, Search, User, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { signOut } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { useLibrary } from "../../lib/libraryStore";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { Avatar } from "../ui/Avatar";
import { Menu } from "../ui/Menu";

export function TopBar({
  user,
  onToggleLeft,
  onToggleRight,
  onOpenMobileNav,
  showLeftToggle,
  showRightToggle,
  rightOpen,
}: {
  user: { name: string; email: string };
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpenMobileNav: () => void;
  showLeftToggle: boolean;
  showRightToggle: boolean;
  rightOpen: boolean;
}) {
  const { query, setQuery, pickFiles, activity, unreadActivity, markActivityRead } = useLibrary();
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search box, like most web apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const wide = useMediaQuery("(min-width: 640px)");
  const onSearchPage = location.pathname === "/search";

  // The search always looks in the personal and the public library at once, on its own page.
  const onSearch = (q: string) => {
    setQuery(q);
    if (q && !onSearchPage) navigate("/search");
    // Cleared: back to where the search started.
    else if (!q && onSearchPage) {
      if (location.key === "default") navigate("/");
      else navigate(-1);
    }
  };

  // Leaving the results (a link, the back button) ends the search, so no other page is filtered.
  useEffect(() => {
    if (!onSearchPage && query) setQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-app/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <button className="icon-btn md:hidden" aria-label="Open navigation" onClick={onOpenMobileNav}>
          <MenuIcon className="h-5 w-5" />
        </button>
        {showLeftToggle && (
          <button className="icon-btn hidden md:inline-flex" aria-label="Toggle sidebar" title="Toggle sidebar" onClick={onToggleLeft}>
            <PanelLeft className="h-[18px] w-[18px]" />
          </button>
        )}

        <label className="relative flex min-w-0 max-w-xl flex-1 items-center">
          <span className="sr-only">Search your library and the Public Library</span>
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-muted" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onSearch("")}
            placeholder={wide ? "Search your library and the Public Library…" : "Search all books"}
            className="h-11 w-full rounded-xl border border-line bg-card/80 pl-10 pr-10 text-sm text-fg outline-none transition placeholder:text-muted/70 focus:border-accent/60 focus:bg-card focus:ring-2 focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button className="absolute right-2 icon-btn h-7 w-7" aria-label="Clear search" onClick={() => onSearch("")}>
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 hidden rounded-md border border-line px-1.5 text-[11px] text-muted sm:block">/</kbd>
          )}
        </label>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button className="btn h-11 px-3 sm:px-4" onClick={() => pickFiles()}>
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            <span className="hidden sm:inline">Upload Book</span>
          </button>

          <div onClickCapture={markActivityRead}>
            <Menu
              label={unreadActivity ? `Notifications, ${unreadActivity} new` : "Notifications"}
              menuClassName="w-80"
              triggerClassName="icon-btn relative h-10 w-10"
              trigger={
                <>
                  <Bell className="h-[18px] w-[18px]" />
                  {unreadActivity > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-app" />}
                </>
              }
              header={
                <div className="px-3 pb-2 pt-1.5">
                  <div className="text-sm font-semibold">Activity</div>
                  {activity.length === 0 && <p className="mt-1 max-w-64 text-xs text-muted">Uploads and progress from your other devices will show up here.</p>}
                </div>
              }
              items={activity.slice(0, 8).map((a) => ({
                label: `${a.text} · ${timeAgo(new Date(a.at).toISOString())}`,
                onSelect: () => a.bookId && navigate(`/read/${a.bookId}`),
              }))}
            />
          </div>

          <Menu
            label="Account menu"
            triggerClassName="ml-1 rounded-full ring-2 ring-line transition hover:ring-accent/50"
            trigger={<Avatar name={user.name || user.email} size="sm" />}
            header={
              <div className="border-b border-line px-3 pb-2.5 pt-1.5 mb-1">
                <div className="truncate text-sm font-semibold">{user.name || "Reader"}</div>
                <div className="truncate text-xs text-muted">{user.email}</div>
              </div>
            }
            items={[
              { label: "Profile", icon: <User />, onSelect: () => navigate("/profile") },
              { label: "Sign out", icon: <LogOut />, onSelect: () => void signOut() },
            ]}
          />

          {showRightToggle && (
            <button
              className={`icon-btn hidden xl:inline-flex ${rightOpen ? "" : "text-accent"}`}
              aria-label={rightOpen ? "Hide side panel" : "Show side panel"}
              aria-pressed={rightOpen}
              title={rightOpen ? "Hide side panel" : "Show side panel"}
              onClick={onToggleRight}
            >
              <PanelRight className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
