import { App as CapApp } from "@capacitor/app";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { isNative } from "./lib/api";
import { authClient } from "./lib/auth";
import { startEvents, stopEvents } from "./lib/events";
import { installProgressFlushers } from "./lib/progress";
import { AppShell } from "./components/shell/AppShell";
import { LibraryProvider } from "./lib/libraryStore";
import { SettingsProvider } from "./lib/settings";
import { CollectionPage, CollectionsPage } from "./pages/CollectionPages";
import { DashboardPage, DiscoverPage, FavoritesPage, ReadingNowPage, SharedPage, UploadsPage } from "./pages/LibraryViews";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { PublicLibraryPage } from "./pages/PublicLibraryPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SharePage } from "./pages/SharePage";

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

  useEffect(() => {
    const onUnauthorized = () => void refetch();
    window.addEventListener("readsync:unauthorized", onUnauthorized);
    return () => window.removeEventListener("readsync:unauthorized", onUnauthorized);
  }, [refetch]);

  useEffect(() => {
    if (!signedIn) return;
    startEvents();
    installProgressFlushers();
    return () => stopEvents();
  }, [signedIn]);

  // The password-reset link works whether or not someone is signed in on this browser.
  if (window.location.pathname === "/reset-password") {
    return <ResetPasswordPage onDone={() => void refetch()} />;
  }

  if (isPending) {
    return <div className="flex h-dvh items-center justify-center text-muted">Loading…</div>;
  }

  if (!signedIn) {
    return <LoginPage onSignedIn={() => void refetch()} />;
  }

  const user = { name: session!.user.name, email: session!.user.email };

  return (
    <SettingsProvider enabled={signedIn}>
      <LibraryProvider>
        <BrowserRouter>
          <NativeBackButton />
          <Routes>
            {/* The reader is full screen, outside the library layout. */}
            <Route
              path="/read/:id"
              element={
                <Suspense fallback={<div className="flex h-dvh items-center justify-center text-muted">Loading…</div>}>
                  <ReaderPage />
                </Suspense>
              }
            />
            <Route element={<AppShell user={user} />}>
              <Route index element={<DashboardPage userName={user.name || user.email} />} />
              <Route path="public" element={<PublicLibraryPage />} />
              <Route path="discover" element={<DiscoverPage />} />
              <Route path="shared" element={<SharedPage />} />
              <Route path="reading" element={<ReadingNowPage />} />
              <Route path="uploads" element={<UploadsPage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="collections/:id" element={<CollectionPage />} />
              <Route path="favorites" element={<FavoritesPage />} />
              <Route path="profile" element={<ProfilePage user={user} />} />
              <Route path="share/:token" element={<SharePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </LibraryProvider>
    </SettingsProvider>
  );
}
