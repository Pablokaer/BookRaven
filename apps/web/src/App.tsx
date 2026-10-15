import { App as CapApp } from "@capacitor/app";
import { lazy, Suspense, useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { isNative } from "./lib/api";
import { startAppUpdates } from "./lib/appUpdate";
import { authClient } from "./lib/auth";
import { installBookmarkFlushers } from "./lib/bookmarks";
import { installInkFlushers } from "./lib/ink";
import { startEvents, stopEvents } from "./lib/events";
import { installProgressFlushers } from "./lib/progress";
import { AppLoading } from "./components/AppLoading";
import { AppShell } from "./components/shell/AppShell";
import { LibraryProvider } from "./lib/libraryStore";
import { SettingsProvider } from "./lib/settings";
import { AdminPage } from "./pages/AdminPage";
import { ClubInvitePage, ClubPage, ClubsPage } from "./pages/ClubPages";
import { CollectionPage, CollectionsPage } from "./pages/CollectionPages";
import { DownloadPage } from "./pages/DownloadPage";
import { DashboardPage, DiscoverPage, FavoritesPage, ReadingNowPage, SharedPage, UploadsPage } from "./pages/LibraryViews";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { PublicLibraryPage } from "./pages/PublicLibraryPage";
import { SearchPage } from "./pages/SearchPage";
import { ImportPage } from "./pages/ImportPage";
import { BookPage, PublicBookPage } from "./pages/BookPages";
import { StatsPage } from "./pages/StatsPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SharedCollectionPage, SharePage } from "./pages/SharePage";

// The reader (pdf.js, foliate-js) is loaded only when a book is opened.
const ReaderPage = lazy(() => import("./pages/ReaderPage").then((m) => ({ default: m.ReaderPage })));

/** Android hardware back button: go back inside the app, exit from the library. */
function NativeBackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!isNative) return;
    const sub = CapApp.addListener("backButton", () => {
      if (location.pathname === "/") void CapApp.exitApp();
      else navigate("/");
    });
    return () => {
      void sub.then((s) => s.remove());
    };
  }, [location.pathname, navigate]);
  return null;
}

export function App() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const signedIn = Boolean(session?.user);
  const sessionChecked = useRef(false);

  // Android app: this bundle rendered, so the live-update plugin needn't roll it back.
  useEffect(startAppUpdates, []);

  useEffect(() => {
    const onUnauthorized = () => void refetch();
    window.addEventListener("readsync:unauthorized", onUnauthorized);
    return () => window.removeEventListener("readsync:unauthorized", onUnauthorized);
  }, [refetch]);

  useEffect(() => {
    if (!signedIn) return;
    startEvents();
    installProgressFlushers();
    installBookmarkFlushers();
    installInkFlushers();
    return () => stopEvents();
  }, [signedIn]);

  // The password-reset link works whether or not someone is signed in on this browser.
  if (window.location.pathname === "/reset-password") {
    return <ResetPasswordPage onDone={() => void refetch()} />;
  }

  // Better Auth refetches the session whenever the tab regains focus, and while signed out each
  // refetch sets isPending again. Show the loading screen only for the first check: replacing the
  // login page with it would unmount the form and lose what was typed.
  if (!isPending) sessionChecked.current = true;
  if (isPending && !sessionChecked.current) {
    return <AppLoading />;
  }

  if (!signedIn) {
    return <LoginPage onSignedIn={() => void refetch()} />;
  }

  const user = { name: session!.user.name, email: session!.user.email };

  return (
    <SettingsProvider enabled={signedIn}>
      <LibraryProvider userId={session!.user.id}>
        <BrowserRouter>
          <NativeBackButton />
          <Routes>
            {/* The reader is full screen, outside the library layout. */}
            <Route
              path="/read/:id"
              element={
                <Suspense fallback={<AppLoading />}>
                  <ReaderPage />
                </Suspense>
              }
            />
            <Route element={<AppShell user={user} />}>
              <Route index element={<DashboardPage userName={user.name || user.email} />} />
              <Route path="public" element={<PublicLibraryPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="books/:id" element={<BookPage />} />
              <Route path="public/books/:id" element={<PublicBookPage />} />
              <Route path="discover" element={<DiscoverPage />} />
              <Route path="shared" element={<SharedPage />} />
              <Route path="reading" element={<ReadingNowPage />} />
              <Route path="uploads" element={<UploadsPage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="collections/:id" element={<CollectionPage />} />
              <Route path="favorites" element={<FavoritesPage />} />
              <Route path="profile" element={<ProfilePage user={user} />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="download" element={<DownloadPage />} />
              <Route path="clubs" element={<ClubsPage />} />
              <Route path="clubs/join/:token" element={<ClubInvitePage />} />
              <Route path="clubs/:id" element={<ClubPage />} />
              <Route path="share/:token" element={<SharePage />} />
              <Route path="share/collection/:token" element={<SharedCollectionPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </LibraryProvider>
    </SettingsProvider>
  );
}
