import { createAuthClient } from "better-auth/react";
import { forgetAccount, openAccount, sendAccountChanges } from "./accountData";
import { API_BASE, getToken, isNative, setToken } from "./api";

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

/** Sends the changes made on this device that wait for the server (positions, bookmarks, handwriting). */
export const flushChanges = sendAccountChanges;

export async function signOut() {
  // Changes made on this device still get a moment to reach the server while the session works.
  await Promise.race([flushChanges(), new Promise((r) => setTimeout(r, 3000))]);
  let signedOut = false;
  try {
    signedOut = !(await authClient.signOut()).error;
  } catch {
    /* offline */
  } finally {
    await setToken(null);
    // Everything this device keeps for the account (lib/accountData.ts), so the next account on
    // a shared device never sees or sends it.
    await forgetAccount();
  }
  if (signedOut) return;
  // The server didn't end the session (offline, server error). Still signed in (the web's cookie
  // still works): the library stays open and keeps its snapshots again. Otherwise (the Android
  // app's token is gone, or the server can't be reached) the app checks the session and closes it.
  const user = await authClient.getSession().then(
    (r) => r.data?.user,
    () => null,
  );
  if (user) openAccount();
  else authClient.$store.notify("$sessionSignal");
}
