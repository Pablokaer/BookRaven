import { createAuthClient } from "better-auth/react";
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

export async function signOut() {
  try {
    await authClient.signOut();
  } finally {
    await setToken(null);
  }
}
