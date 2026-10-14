import { HardDrive, ShieldCheck } from "lucide-react";
import { fileSize } from "../../lib/format";
import { useLibrary } from "../../lib/libraryStore";
import { ProgressBar } from "../books/ProgressBar";

/** Storage used by the account against its limit (administrators are unlimited). */
export function StorageMeter() {
  const { me } = useLibrary();
  if (!me) return <div className="skeleton h-9 rounded-lg" aria-busy="true" />;

  if (me.quotaBytes === null) {
    return (
      <div className="flex items-center gap-2.5 text-xs text-muted">
        <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
        <span>
          <span className="text-fg">{fileSize(me.usedBytes)}</span> used · unlimited storage (administrator)
        </span>
      </div>
    );
  }

  const ratio = me.usedBytes / me.quotaBytes;
  const full = ratio >= 0.95;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <HardDrive className="h-3.5 w-3.5" /> Storage
        </span>
        <span className={full ? "text-rose-300" : ""}>
          <span className={full ? "" : "text-fg"}>{fileSize(me.usedBytes)}</span> of {fileSize(me.quotaBytes)}
        </span>
      </div>
      <ProgressBar value={ratio} className={full ? "[&>div]:from-rose-500 [&>div]:to-rose-300" : ""} />
      {full && <p className="text-xs text-rose-300">Almost full. Delete books to free up space.</p>}
    </div>
  );
}
