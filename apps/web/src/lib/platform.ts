import { Capacitor } from "@capacitor/core";

/** Running inside the Android app (Capacitor) rather than a browser. */
export const isNative = Capacitor.isNativePlatform();
