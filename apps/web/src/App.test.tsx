import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Who is signed in, and what the server allows: changed by each test, read by the mocks below.
const env = vi.hoisted(() => {
  type User = { id: string; name: string; email: string };
  type Session = { data: { user: User } | null; isPending: boolean; error?: unknown };
  let session: Session = { data: null, isPending: true };
  const listeners = new Set<() => void>();
  return {
    native: false,
    config: { allowSignup: true } as Record<string, unknown>,
    /** The Android app's copy of the last account signed in with the saved token. */
    offlineUser: null as User | null,
    getSession: () => session,
    setSession(next: Session) {
      session = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
});

vi.mock("./lib/auth", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    authClient: {
      useSession: () => ({ ...useSyncExternalStore(env.subscribe, env.getSession), refetch: () => {} }),
    },
    signOut: async () => env.setSession({ data: null, isPending: false }),
    flushChanges: async () => [],
  };
});

vi.mock("./lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/api")>()),
  get isNative() {
    return env.native;
  },
  apiJson: async (path: string) => (path === "/api/config" ? env.config : null),
  offlineUser: () => env.offlineUser,
}));

// The signed-in app, reduced to what routing needs.
vi.mock("./lib/libraryStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/libraryStore")>()),
  LibraryProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/settings")>()),
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./components/shell/AppShell", async () => {
  const { Outlet } = await import("react-router");
  return { AppShell: () => <Outlet /> };
});
vi.mock("./pages/LibraryViews", () => {
  const Empty = () => null;
  return {
    DashboardPage: () => <h1>Dashboard</h1>,
    DiscoverPage: Empty,
    FavoritesPage: Empty,
    ReadingNowPage: Empty,
    SharedPage: Empty,
    UploadsPage: Empty,
  };
});
vi.mock("./components/WhatsNew", () => ({ WhatsNew: () => null }));
vi.mock("./lib/appUpdate", () => ({ startAppUpdates: () => {} }));
vi.mock("./lib/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/events")>()),
  startEvents: () => {},
  stopEvents: () => {},
}));

const { App } = await import("./App");
// The landing page is lazy: loaded up front here, so it renders within the same act() as the rest.
await import("./pages/LandingPage");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const reader = { id: "u1", name: "Test Reader", email: "reader@example.com" };
const signedIn = { data: { user: reader }, isPending: false };
const signedOut = { data: null, isPending: false };

let root: Root;
let container: HTMLElement;

async function open(path: string, session: typeof signedIn | typeof signedOut | { data: null; isPending: boolean; error?: unknown }) {
  window.history.replaceState(null, "", path);
  env.setSession(session);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
  await act(async () => {}); // the config request and redirects
}

const text = () => container.textContent ?? "";
const link = (name: string) => [...container.querySelectorAll("a")].find((a) => a.textContent?.trim() === name);
const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const landingTitle = () => container.querySelector("h1#hero-title");

beforeEach(() => {
  env.native = false;
  env.config = { allowSignup: true };
  env.offlineUser = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("routing by sign-in state", () => {
  it("shows the loading screen, not the landing page, while the session is checked", async () => {
    await open("/", { data: null, isPending: true });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(landingTitle()).toBeNull();
  });

  it("shows a signed-out visitor the landing page at /, with the ways in", async () => {
    await open("/", signedOut);
    expect(landingTitle()?.textContent).toContain("Every book holds a world");
    expect(link("Sign in")?.getAttribute("href")).toBe("/login");
    expect(link("Create an account")?.getAttribute("href")).toBe("/signup");
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });

  it("describes the site to search engines on the landing page only", async () => {
    await open("/", signedOut);
    const ld = () => document.head.querySelector('script[type="application/ld+json"]');
    expect(document.title).toContain("Self-hosted ebook, PDF and comic reader");
    const data = JSON.parse(ld()!.textContent!);
    expect(data["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["WebSite", "WebApplication"]);
    expect(data["@graph"][0].url).toBe(`${window.location.origin}/`);

    await act(async () => link("Sign in")!.click());
    expect(ld()).toBeNull();
  });

  it("goes from the landing page to the sign-in and sign-up forms", async () => {
    await open("/", signedOut);
    await act(async () => link("Sign in")!.click());
    expect(window.location.pathname).toBe("/login");
    expect(button("Sign in")).toBeDefined();

    await act(async () => button("Create one")!.click());
    expect(window.location.pathname).toBe("/signup");
    expect(button("Create account")).toBeDefined();

    await act(async () => link("Home")!.click());
    expect(window.location.pathname).toBe("/");
    expect(landingTitle()).not.toBeNull();
  });

  it("opens /signup on the sign-up form", async () => {
    await open("/signup", signedOut);
    expect(button("Create account")).toBeDefined();
    expect(container.querySelector('input[autocomplete="name"]')).not.toBeNull();
  });

  it("asks to sign in at any other address, and keeps it for after signing in", async () => {
    await open("/share/abc123", signedOut);
    expect(button("Sign in")).toBeDefined();
    expect(landingTitle()).toBeNull();
    expect(window.location.pathname).toBe("/share/abc123");
  });

  it.each(["/", "/login", "/signup"])("takes a signed-in reader from %s to the library", async (path) => {
    await open(path, signedIn);
    expect(window.location.pathname).toBe("/");
    expect(text()).toContain("Dashboard");
    expect(landingTitle()).toBeNull();
  });

  it("shows the sign-in form after signing out or the session expiring on the home page", async () => {
    await open("/", signedIn);
    await act(async () => env.setSession(signedOut));
    expect(window.location.pathname).toBe("/login");
    expect(button("Sign in")).toBeDefined();
    expect(landingTitle()).toBeNull();
  });

  it("keeps the address when the session ends elsewhere", async () => {
    await open("/favorites", signedIn);
    await act(async () => env.setSession(signedOut));
    expect(window.location.pathname).toBe("/favorites");
    expect(button("Sign in")).toBeDefined();
  });

  it("offers only signing in when the server takes no sign-ups", async () => {
    env.config = { allowSignup: false };
    await open("/", signedOut);
    expect(link("Create an account")).toBeUndefined();
    expect(link("Create account")).toBeUndefined();
    expect(text()).toContain("New accounts are by invitation on this server.");
    act(() => root.unmount());
    container.remove();

    await open("/signup", signedOut);
    expect(window.location.pathname).toBe("/login");
    expect(button("Sign in")).toBeDefined();
    expect(container.querySelector('input[autocomplete="name"]')).toBeNull();
  });

  it("skips the landing page in the Android app", async () => {
    env.native = true;
    await open("/", signedOut);
    expect(landingTitle()).toBeNull();
    expect(button("Sign in")).toBeDefined();
    expect(link("Home")).toBeUndefined();
  });
});

describe("the Android app without a connection", () => {
  const unreachable = { data: null, isPending: false, error: new TypeError("Failed to fetch") };

  it("opens the library as the account signed in last when the server can't be reached", async () => {
    env.native = true;
    env.offlineUser = reader;
    await open("/", unreachable);
    expect(text()).toContain("Dashboard");

    // Checking again (back online) keeps the library on screen until the answer.
    await act(async () => env.setSession({ data: null, isPending: true }));
    expect(text()).toContain("Dashboard");
    await act(async () => env.setSession(signedIn));
    expect(text()).toContain("Dashboard");
  });

  it("asks to sign in when the server turns the session down, or nothing was kept", async () => {
    env.native = true;
    env.offlineUser = reader;
    await open("/", { data: null, isPending: false, error: { status: 401 } });
    expect(button("Sign in")).toBeDefined();
    act(() => root.unmount());
    container.remove();

    env.offlineUser = null;
    await open("/", unreachable);
    expect(button("Sign in")).toBeDefined();
  });

  it("is only for the Android app (the web has its service worker)", async () => {
    env.offlineUser = reader;
    await open("/favorites", unreachable);
    expect(button("Sign in")).toBeDefined();
  });
});
