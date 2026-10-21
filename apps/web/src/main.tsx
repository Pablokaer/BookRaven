import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App, prerenderedLanding } from "./App";
import { isNative, loadToken } from "./lib/api";
import "@fontsource-variable/inter";
import "./displayFont.css";
import "./index.css";

// Offline support on the web (the Android app already ships its assets).
if (import.meta.env.PROD && !isNative && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// The native app keeps its bearer token in secure preferences; load it before rendering.
loadToken().finally(() => {
  const root = document.getElementById("root")!;
  const app = (
    <StrictMode>
      <App />
    </StrictMode>
  );
  // The landing page already in the HTML (landing.html) is taken over rather than drawn again.
  if (prerenderedLanding) hydrateRoot(root, app);
  else createRoot(root).render(app);
});
