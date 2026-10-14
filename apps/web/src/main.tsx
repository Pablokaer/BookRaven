import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isNative, loadToken } from "./lib/api";
import { initAppTheme } from "./lib/appTheme";
import "@fontsource-variable/geist";
import "@fontsource-variable/newsreader/opsz.css";
import "./index.css";

// Offline support on the web (the Android app already ships its assets).
if (import.meta.env.PROD && !isNative && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Light or dark interface, before anything is drawn.
initAppTheme();

// The native app keeps its bearer token in secure preferences; load it before rendering.
loadToken().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
