import { Check, CheckCircle2, Copy, Download, Loader2, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { ApkUpdateButton } from "../components/AppUpdate";
import { isNative } from "../lib/api";
import { APK_URL, checkForUpdates, fetchRelease, restartWithUpdate, useAppUpdate, type AndroidRelease } from "../lib/appUpdate";
import { fileSize, timeAgo } from "../lib/format";

function CopyLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} className="input min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Link to this page" />
      <button
        type="button"
        className="btn-outline px-3"
        aria-label="Copy link"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/25 text-sm font-semibold text-accent">{n}</span>
      <div className="pt-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  );
}

function releaseLine(release: AndroidRelease) {
  return `Version ${release.versionName} · ${fileSize(release.apkSize)} · updated ${timeAgo(release.publishedAt)}`;
}

/** Inside the Android app: installed version and updates. */
function InstalledApp() {
  const { release, apkUpdate, bundleReady, checking, installedVersion } = useAppUpdate();
  return (
    <section className="surface space-y-4 p-6">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/25">
          <Smartphone className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-medium">You are using the Android app</h2>
          <p className="mt-1 text-sm text-muted">Installed version {installedVersion || "…"}</p>
        </div>
      </div>

      {apkUpdate && release ? (
        <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
          <p className="text-sm">
            Version {release.versionName} needs a new install. Download it, then tap <b>Install</b> when Android asks. Your books and progress stay as they are.
          </p>
          <ApkUpdateButton release={release} />
        </div>
      ) : bundleReady ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4">
          <p className="flex-1 text-sm">An update is downloaded and is used the next time the app starts.</p>
          <button className="btn" onClick={restartWithUpdate}>
            <RefreshCw className="h-4 w-4" /> Restart now
          </button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <CheckCircle2 className="h-4 w-4 text-accent" /> {checking ? "Checking for updates…" : "The app is up to date."}
        </p>
      )}

      <button className="btn-outline" disabled={checking} onClick={() => void checkForUpdates()}>
        {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check for updates
      </button>
    </section>
  );
}

/** On the website: the APK download and how to install it. */
function GetTheApp() {
  const [release, setRelease] = useState<AndroidRelease | null | undefined>(undefined);
  useEffect(() => {
    void fetchRelease().then(setRelease);
  }, []);
  const onAndroid = /android/i.test(navigator.userAgent);
  const pageUrl = `${window.location.origin}/download`;

  return (
    <div className="space-y-8">
      <section className="surface flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/25">
          <Smartphone className="h-8 w-8" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-medium">BookRaven for Android</h2>
          <p className="mt-1 text-sm text-muted">
            {release === undefined ? "Checking the latest version…" : release ? releaseLine(release) : "The Android app has not been published on this server yet."}
          </p>
        </div>
        {release && (
          <a className="btn px-6 py-3" href={APK_URL} download={`bookraven-${release.versionName}.apk`}>
            <Download className="h-4 w-4" /> Download for Android
          </a>
        )}
      </section>

      {!onAndroid && release && (
        <section className="surface space-y-3 p-6">
          <h2 className="text-sm font-medium">On a computer? Open this page on your phone</h2>
          <p className="text-xs text-muted">Sign in to BookRaven in your phone’s browser and open Download in the menu, or send yourself this link:</p>
          <CopyLink value={pageUrl} />
        </section>
      )}

      <section className="surface p-6">
        <h2 className="mb-5 font-display text-xl font-medium">How to install</h2>
        <ol className="space-y-5">
          <Step n={1} title="Download the APK on your phone">
            Tap <b>Download for Android</b>. The app comes straight from this server, not from the Play Store, so Chrome may warn that the file
            could be harmful: tap <b>Download anyway</b>.
          </Step>
          <Step n={2} title="Open the downloaded file">
            Tap the download notification, or find <i>bookraven.apk</i> in <b>Files → Downloads</b>.
          </Step>
          <Step n={3} title="Allow installing from your browser (first time only)">
            Android says your browser isn’t allowed to install unknown apps. Tap <b>Settings</b>, turn on <b>Allow from this source</b> and go
            back.
          </Step>
          <Step n={4} title="Install and open">
            Tap <b>Install</b>. If Google Play Protect says it doesn’t recognise the app, tap <b>More details → Install anyway</b>. Then open
            BookRaven and sign in with your email and password.
          </Step>
        </ol>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="surface p-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <RefreshCw className="h-4 w-4 text-accent" /> Updates
          </h2>
          <p className="text-sm leading-relaxed text-muted">
            Most updates arrive by themselves: the app downloads them in the background and uses them the next time it starts. When an update
            needs a new version of the app, it shows a message: tap <b>Update</b>, then <b>Install</b>. Your books and reading progress are kept.
          </p>
        </section>
        <section className="surface p-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-accent" /> Good to know
          </h2>
          <ul className="list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-muted">
            <li>Needs Android 7 or newer.</li>
            <li>
              Google sign-in isn’t available in the app yet. If you signed up with Google, set a password with <b>Forgot password</b> on the
              sign-in screen.
            </li>
            <li>Books you open or save for offline can be read without a connection; your progress syncs when you are back online.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

/** "/download" — the Android app: download and install it, or update it from inside the app. */
export function DownloadPage() {
  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-medium tracking-tight">Android app</h1>
        <p className="mt-1.5 text-sm text-muted">Read on your phone and tablet, with your library and reading progress in sync.</p>
      </header>
      {isNative ? <InstalledApp /> : <GetTheApp />}
    </>
  );
}
