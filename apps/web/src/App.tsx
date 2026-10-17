import { App as CapApp } from "@capacitor/app";
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { isNative, offlineUser, rememberUser, sessionUnreachable } from "./lib/api";
import { startAppUpdates } from "./lib/appUpdate";
import { authClient, flushChanges } from "./lib/auth";
import { retryEvents, startEvents, stopEvents } from "./lib/events";
import { loadCachedBooks } from "./lib/libraryCache";
import { saveData } from "./lib/network";
import { flushProgress } from "./lib/progress";
import { AppLoading } from "./components/AppLoading";
import { WhatsNew } from "./components/WhatsNew";
import { AppShell } from "./components/shell/AppShell";
import { LibraryProvider } from "./lib/libraryStore";
import { SettingsProvider } from "./lib/settings";
import { DashboardPage, DiscoverPage, FavoritesPage, ReadingNowPage, SharedPage, UploadsPage } from "./pages/LibraryViews";
import { LoginPage } from "./pages/LoginPage";

/** Loaders of the pages kept out of the first download, fetched in the background once the app is idle. */
const pageLoaders: (() => Promise<unknown>)[] = [];

/** A page loaded on demand: `name` is its component's export in the module. */
function lazyPage<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K) {
  pageLoaders.push(load);
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

// The library views open the app and load with it; the other pages come when first visited
// (or when the browser is idle, see prefetchPages), so the first screen downloads less.
const AdminPage = lazyPage(() => import("./pages/AdminPage"), "AdminPage");
const ClubsPage = lazyPage(() => import("./pages/ClubPages"), "ClubsPage");
const ClubPage = lazyPage(() => import("./pages/ClubPages"), "ClubPage");
const ClubInvitePage = lazyPage(() => import("./pages/ClubPages"), "ClubInvitePage");
const CollectionsPage = lazyPage(() => import("./pages/CollectionPages"), "CollectionsPage");
const CollectionPage = lazyPage(() => import("./pages/CollectionPages"), "CollectionPage");
const DownloadPage = lazyPage(() => import("./pages/DownloadPage"), "DownloadPage");
const ProfilePage = lazyPage(() => import("./pages/ProfilePage"), "ProfilePage");
const PublicLibraryPage = lazyPage(() => import("./pages/PublicLibraryPage"), "PublicLibraryPage");
const SearchPage = lazyPage(() => import("./pages/SearchPage"), "SearchPage");
const ImportPage = lazyPage(() => import("./pages/ImportPage"), "ImportPage");
const BookPage = lazyPage(() => import("./pages/BookPages"), "BookPage");
const PublicBookPage = lazyPage(() => import("./pages/BookPages"), "PublicBookPage");
const StatsPage = lazyPage(() => import("./pages/StatsPage"), "StatsPage");
const SharePage = lazyPage(() => import("./pages/SharePage"), "SharePage");
const SharedCollectionPage = lazyPage(() => import("./pages/SharePage"), "SharedCollectionPage");
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage").then((m) => ({ default: m.ResetPasswordPage })));

/** The Android build (`vite build --mode native`), which leaves out what only the website shows. */
const NATIVE_BUILD = import.meta.env.MODE === "native";

// The front page is only for signed-out visitors on the web: the Android app and signed-in users
// never load it, and the Android build leaves it out, so its plates don't weigh on the APK and
// every live update.
const LandingPage = NATIVE_BUILD ? () => null : lazy(() => import("./pages/LandingPage").then((m) => ({ default: m.LandingPage })));

// The reader (pdf.js, foliate-js) is loaded only when a book is opened.
const ReaderPage = lazy(() => import("./pages/ReaderPage").then((m) => ({ default: m.ReaderPage })));

/** What opening a book loads (the readers, foliate-js), fetched ahead on the web like the pages. */
const readerLoaders: (() => Promise<unknown>)[] = [
  () => import("./pages/ReaderPage"),
  () => import("./reader/EpubReader"),
  () => import("./reader/ComicScroller"),
  () => import("foliate-js/view.js"),
  () => import("foliate-js/epub.js"),
  () => import("foliate-js/paginator.js"),
  () => import("foliate-js/fixed-layout.js"),
  () => import("foliate-js/vendor/zip.js"),
];
/** pdf.js and its worker (the worker loads with the first PDF, so it is fetched for the service worker to keep). */
const loadPdfEngine = () => import("./reader/PdfReader").then(() => import("./lib/pdf")).then((m) => fetch(m.workerUrl));

/**
 * Fetches the on-demand pages once the browser has nothing else to do, so visiting them stays
 * instant (and works offline: the service worker keeps what was fetched). It waits a moment
 * first, so the library and its covers don't share the connection with them. On the web the
 * readers follow, so a book kept for offline still opens after a deploy (pdf.js only for
 * libraries with PDFs, nothing more with Save-Data); the Android app ships them.
 */
function prefetchPages(userId: string) {
  const run = () => {
    const pages = pageLoaders.map((load) => load().catch(() => {}));
    if (isNative || saveData()) return;
    const readers = loadCachedBooks(userId)?.some((b) => b.format === "pdf") ? [...readerLoaders, loadPdfEngine] : readerLoaders;
    void Promise.all(pages).then(() => readers.forEach((load) => void load().catch(() => {})));
  };
  let handle: number | undefined;
  const timer = setTimeout(() => {
    if ("requestIdleCallback" in window) handle = requestIdleCallback(run, { timeout: 5000 });
    else run();
  }, 2000);
  return () => {
    clearTimeout(timer);
    if (handle !== undefined) cancelIdleCallback(handle);
  };
}

let flushersInstalled = false;
/** Changes waiting for the server go now and whenever the device is back online; positions also when the page is hidden. */
function installSyncFlushers() {
  if (flushersInstalled) return;
  flushersInstalled = true;
  window.addEventListener("online", () => void flushChanges());
  window.addEventListener("pagehide", () => flushProgress(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushProgress(true));
  // Handwriting from an earlier session too goes as soon as possible.
  void flushChanges();
}

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

/** /login and /signup: the sign-in form, keeping the address in step when it switches modes. */
function AuthRoute({ mode, onSignedIn }: { mode: "signin" | "signup"; onSignedIn: () => void }) {
  const navigate = useNavigate();
  return (
    <LoginPage
      initialMode={mode}
      homeLink={!isNative}
      onSignedIn={onSignedIn}
      onModeChange={(next) => {
        if (next !== "forgot") navigate(next === "signup" ? "/signup" : "/login", { replace: true });
      }}
    />
  );
}

/**
 * Signed out: the landing page at "/" on the web (the Android app goes straight to signing in),
 * /login and /signup, and the sign-in form at any other address, which stays put so the page
 * opens once signed in (a share link, a book). Signed in, the library's catch-all route sends
 * /login and /signup to "/".
 */
function SignedOutApp({ onSignedIn }: { onSignedIn: () => void }) {
  // The front page and sign-in titles are set in Cormorant's 500 face, which the signed-in app
  // doesn't use (index.html preloads only the 600 one): ask for it now, alongside the page's code.
  useEffect(() => {
    void document.fonts?.load('500 1em "Cormorant Garamond"').catch(() => {});
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          index
          element={
            isNative || NATIVE_BUILD ? (
              <LoginPage onSignedIn={onSignedIn} />
            ) : (
              <Suspense fallback={<AppLoading />}>
                <LandingPage />
              </Suspense>
            )
          }
        />
        <Route path="login" element={<AuthRoute mode="signin" onSignedIn={onSignedIn} />} />
        <Route path="signup" element={<AuthRoute mode="signup" onSignedIn={onSignedIn} />} />
        <Route path="*" element={<LoginPage onSignedIn={onSignedIn} homeLink={!isNative} />} />
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  const { data: session, error, isPending, refetch } = authClient.useSession();
  const sessionChecked = useRef(false);
  // Android app with the server out of reach: open as the account the saved token signed in last
  // (the service worker does this on the web), until a check gets through. Better Auth checks
  // again when the device is back online or the app back on screen.
  const offline = useRef(false);
  if (!isPending) offline.current = isNative && !session?.user && sessionUnreachable(error);
  const user = session?.user ?? (offline.current ? offlineUser() : null);
  const signedIn = Boolean(user);

  useEffect(() => {
    if (isPending) return;
    if (session?.user) void rememberUser(session.user);
    else if (!sessionUnreachable(error)) void rememberUser(null); // signed out, or turned down
  }, [session, error, isPending]);

  // Signing out (or the session expiring) on the library's home page shows the sign-in form, not
  // the landing page: "/" becomes "/login" before the signed-out router reads the address.
  const [wasSignedIn, setWasSignedIn] = useState(signedIn);
  if (signedIn !== wasSignedIn) {
    setWasSignedIn(signedIn);
    if (!signedIn && !isNative && window.location.pathname === "/") window.history.replaceState(window.history.state, "", "/login");
  }

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
    installSyncFlushers();
    return () => stopEvents();
  }, [signedIn]);
  // A refetched session that is still valid: live events stopped by a 401 can try again.
  useEffect(() => {
    if (session?.user) retryEvents();
  }, [session]);

  // The password-reset link works whether or not someone is signed in on this browser.
  if (window.location.pathname === "/reset-password") {
    return (
      <Suspense fallback={<AppLoading />}>
        <ResetPasswordPage onDone={() => void refetch()} />
      </Suspense>
    );
  }

  // Better Auth refetches the session whenever the tab regains focus, and while signed out each
  // refetch sets isPending again. Show the loading screen only for the first check: replacing the
  // login page with it would unmount the form and lose what was typed.
  if (!isPending) sessionChecked.current = true;
  if (isPending && !sessionChecked.current) {
    return <AppLoading />;
  }

  if (!user) {
    return <SignedOutApp onSignedIn={() => void refetch()} />;
  }

  return <SignedInApp userId={user.id} name={user.name} email={user.email} />;
}

/**
 * The app once signed in. It takes the user's fields one by one, so a session refetch (on every
 * return to the tab) that changes none of them doesn't re-render the app.
 */
const SignedInApp = memo(function SignedInApp({ userId, name, email }: { userId: string; name: string; email: string }) {
  const user = useMemo(() => ({ name, email }), [name, email]);
  useEffect(() => prefetchPages(userId), [userId]);

  return (
    <SettingsProvider enabled>
      <LibraryProvider userId={userId}>
        <BrowserRouter>
          <NativeBackButton />
          {/* After an update: what changed, once. */}
          <WhatsNew />
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
});
