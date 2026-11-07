import { Capacitor } from "@capacitor/core";

/** Running inside the Android app (Capacitor) rather than a browser. */
export const isNative = Capacitor.isNativePlatform();

/**
 * The Google Play build of the Android app (VITE_STORE=play, .github/workflows/deploy.yml). Google
 * Play updates it: it never downloads APKs or web bundles from our server.
 */
export const isPlayStore = isNative && import.meta.env.VITE_STORE === "play";

/** The app's page on Google Play (the Android app id, capacitor.config.ts). */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=app.readsync";
