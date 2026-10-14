import { Download, Loader2, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { installApkUpdate, useAppUpdate, type AndroidRelease } from "../lib/appUpdate";

/** Downloads the new APK with a progress bar, then hands it to Android's installer. */
export function ApkUpdateButton({ release, className = "btn" }: { release: AndroidRelease; className?: string }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  const update = async () => {
    setError("");
    setProgress(0);
    try {
      await installApkUpdate(release, setProgress);
    } catch {
      setError("The download failed. Check your connection and try again.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-2">
      <button className={className} disabled={progress !== null} onClick={() => void update()}>
        {progress === null ? <Download className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        {progress === null ? `Update to ${release.versionName}` : `Downloading… ${Math.round(progress * 100)}%`}
      </button>
      {error && <p className="text-xs text-rose-300">{error}</p>}
    </div>
  );
}

/** In the Android app: asks to install a new APK when the native layer changed. */
export function AppUpdateBanner() {
  const { apkUpdate, release } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);
  if (!apkUpdate || !release || dismissed) return null;
  return (
    <section
      className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 mx-auto max-w-md animate-rise rounded-2xl border border-line bg-elevated p-4 shadow-pop"
      aria-label="App update"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-semibold">A new version of BookRaven is available</p>
            <p className="text-xs text-muted">Download it, then tap Install when Android asks. Your books and progress stay as they are.</p>
          </div>
          <ApkUpdateButton release={release} className="btn w-full" />
        </div>
        <button className="icon-btn h-8 w-8" aria-label="Later" title="Later" onClick={() => setDismissed(true)}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
