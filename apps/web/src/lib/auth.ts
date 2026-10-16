import { createAuthClient } from "better-auth/react";
import { API_BASE, getToken, isNative, setToken } from "./api";
import { clearBookmarks, flushBookmarks } from "./bookmarks";
import { clearInk, flushInk } from "./ink";
import { clearProgress, flushProgress } from "./progress";
import { BOOK_CACHE, forgetOpenedFile } from "./rangeFile";

export const authClient = createAuthClient({
  baseURL: API_BASE || window.location.origin,
  basePath: "/api/auth",
  fetchOptions: {
    credentials: "include",
    // Native app: send the bearer token and capture new ones from the response header.
    ...(isNative
      ? {
          auth: { type: "Bearer", token: () => getToken() ?? "" },
          onSuccess: async (ctx) => {
            const t = ctx.response.headers.get("set-auth-token");
            if (t) await setToken(t);
          },
        }
      : {}),
  },
});

export async function signOut() {
  // Changes made on this device still get a moment to reach the server while the session works.
  await Promise.race([Promise.allSettled([flushProgress(), flushBookmarks(), flushInk()]), new Promise((r) => setTimeout(r, 3000))]);
  try {
    await authClient.signOut();
  } finally {
    await setToken(null);
    await forgetAccountData();
  }
}

/**
 * Forgets what this device keeps for the signed-out account: the library data kept for offline
 * use, the downloaded books, and changes not yet sent (positions, bookmarks, handwriting), so
 * the next account on this device never sees or sends them.
 */
export async function forgetAccountData() {
  navigator.serviceWorker?.controller?.postMessage("signed-out");
  forgetOpenedFile();
  clearProgress();
  await Promise.allSettled([clearBookmarks(), clearInk(), "caches" in window ? caches.delete(BOOK_CACHE) : null]);
}
