import { App as CapApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import { LiveUpdate } from "@capawesome/capacitor-live-update";
import { useSyncExternalStore } from "react";
import { API_BASE, isNative } from "./api";

/**
 * Android app updates from our own server (no Play Store). Each deploy publishes, under
 * /downloads, a signed APK, a zip of the web bundle and android.json describing both
 * (.github/workflows/deploy.yml). The app checks that file when it starts and resumes:
 * - same native layer: the web bundle is downloaded quietly and used from the next start;
 * - native layer changed: the user is asked to install the new APK.
 */

// Set by vite.config.ts in the native build ("" on the web).
declare const __NATIVE_VERSION__: string;
declare const __BUNDLE_VERSION__: string;
export const NATIVE_VERSION = __NATIVE_VERSION__;
export const BUNDLE_VERSION = __BUNDLE_VERSION__;

export type AndroidRelease = {
  versionCode: number;
  versionName: string;
  /** Fingerprint of the native layer (apps/web/scripts/native-version.mjs). */
  nativeVersion: string;
  /** This version's APK; /downloads/bookraven.apk is always the latest. */
  apk: string;
  apkSize: number;
  bundle: { id: string; url: string; sha256: string };
  publishedAt: string;
  /** Fingerprint of the sources the release was built from (.github/workflows/deploy.yml). */
  inputs?: string;
};

export const APK_URL = "/downloads/bookraven.apk";
const RELEASE_URL = "/downloads/android.json";
const CHECK_EVERY_MS = 15 * 60_000;

/** Absolute URL of a file on our server (the native app is served from https://localhost). */
export function serverUrl(path: string) {
  return new URL(path, API_BASE || window.location.origin).toString();
}

export async function fetchRelease(): Promise<AndroidRelease | null> {
  try {
    const res = await fetch(serverUrl(RELEASE_URL), { cache: "no-store" });
    return res.ok ? ((await res.json()) as AndroidRelease) : null;
  } catch {
    return null;
  }
}

export type UpdatePlan = "none" | "apk" | "bundle";

/** What an installed app should do with the published release. */
export function planUpdate(release: AndroidRelease, installed: { versionCode: number; nativeVersion: string; bundleVersion: string }): UpdatePlan {
  if (release.nativeVersion !== installed.nativeVersion) return release.versionCode > installed.versionCode ? "apk" : "none";
  return release.bundle.id !== installed.bundleVersion ? "bundle" : "none";
}

type UpdateState = {
  release: AndroidRelease | null;
  /** A new APK is needed (the native layer changed). */
  apkUpdate: boolean;
  /** A newer web bundle is downloaded and starts with the next launch. */
  bundleReady: boolean;
  checking: boolean;
  installedVersion: string;
};

let state: UpdateState = { release: null, apkUpdate: false, bundleReady: false, checking: false, installedVersion: "" };
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export function useAppUpdate() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

let lastCheck = 0;

export async function checkForUpdates() {
  if (!isNative || state.checking) return;
  set({ checking: true });
  try {
    const release = await fetchRelease();
    if (!release) return;
    const { build, version } = await CapApp.getInfo();
    const plan = planUpdate(release, { versionCode: Number(build), nativeVersion: NATIVE_VERSION, bundleVersion: BUNDLE_VERSION });
    set({ release, apkUpdate: plan === "apk", installedVersion: version });
    if (plan === "bundle") await stageBundle(release);
  } catch (err) {
    console.warn("App update check failed", err);
  } finally {
    lastCheck = Date.now();
    set({ checking: false });
  }
}

/** Downloads the published web bundle and makes it the one used from the next start. */
async function stageBundle(release: AndroidRelease) {
  const id = release.bundle.id;
  if ((await LiveUpdate.getNextBundle()).bundleId === id) return set({ bundleReady: true });
  // A bundle that failed to start (no ready() in time) was rolled back; don't retry it.
  if ((await LiveUpdate.getBlockedBundles()).bundleIds.includes(id)) return;
  if (!(await LiveUpdate.getBundles()).bundleIds.includes(id)) {
    await LiveUpdate.downloadBundle({ url: serverUrl(release.bundle.url), bundleId: id, checksum: release.bundle.sha256 });
  }
  await LiveUpdate.setNextBundle({ bundleId: id });
  set({ bundleReady: true });
}

/** Switches to the downloaded bundle right away (reloads the app). */
export function restartWithUpdate() {
  void LiveUpdate.reload();
}

let started = false;

/** Called once the app has rendered: confirms this bundle works, then looks for updates. */
export function startAppUpdates() {
  if (!isNative || started) return;
  started = true;
  void LiveUpdate.ready().catch(() => {});
  void CapApp.getInfo().then(({ version }) => set({ installedVersion: version }));
  void checkForUpdates();
  void CapApp.addListener("resume", () => {
    if (Date.now() - lastCheck > CHECK_EVERY_MS) void checkForUpdates();
  });
}

const ApkInstaller = registerPlugin<{ install(options: { path: string }): Promise<void> }>("ApkInstaller");

/** Downloads the new APK into the app's cache and opens Android's installer. */
export async function installApkUpdate(release: AndroidRelease, onProgress: (fraction: number) => void) {
  const [{ Directory, Filesystem }, { FileTransfer }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/file-transfer")]);
  const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path: "bookraven-update.apk" });
  const progress = await FileTransfer.addListener("progress", (p) => {
    const total = p.lengthComputable ? p.contentLength : release.apkSize;
    if (total > 0) onProgress(Math.min(p.bytes / total, 1));
  });
  try {
    await FileTransfer.downloadFile({ url: serverUrl(release.apk), path: uri, progress: true });
  } finally {
    await progress.remove();
  }
  await ApkInstaller.install({ path: uri });
}
