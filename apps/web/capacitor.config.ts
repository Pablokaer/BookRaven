import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.readsync",
  appName: "BookRaven",
  webDir: "dist",
  android: {
    // The app talks to your VPS over HTTPS only.
    allowMixedContent: false,
  },
  server: {
    // App pages are served from https://localhost inside the WebView.
    androidScheme: "https",
  },
  plugins: {
    // Live updates of the web bundle from our own server (src/lib/appUpdate.ts). If a new
    // bundle doesn't call ready() within 10 s, the app rolls back to the one in the APK.
    LiveUpdate: {
      autoUpdateStrategy: "none",
      readyTimeout: 10000,
      autoDeleteBundles: true,
      autoBlockRolledBackBundles: true,
    },
  },
};

export default config;
