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
};

export default config;
