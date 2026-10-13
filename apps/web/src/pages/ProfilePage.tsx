import { LogOut, ShieldCheck, Target } from "lucide-react";
import { StorageMeter } from "../components/shell/StorageMeter";
import { useMemo, useState } from "react";
import { initials } from "../components/shell/TopBar";
import { signOut } from "../lib/auth";
import { finishedThisYear, isFinished, isInProgress } from "../lib/bookStats";
import { fileSize } from "../lib/format";
import { useLibrary } from "../lib/libraryStore";
import { useSettings } from "../lib/settings";

export function ProfilePage({ user }: { user: { name: string; email: string } }) {
  const { books, folders, me } = useLibrary();
  const { settings, update } = useSettings();
  const [goal, setGoal] = useState(String(settings.readingGoal));

  const stats = useMemo(() => {
    const list = books ?? [];
    return [
      { label: "Books", value: list.length },
      { label: "In progress", value: list.filter(isInProgress).length },
      { label: "Finished", value: list.filter(isFinished).length },
      { label: `Finished in ${new Date().getFullYear()}`, value: finishedThisYear(list) },
      { label: "Collections", value: folders.length },
      { label: "Library size", value: fileSize(list.reduce((n, b) => n + b.sizeBytes, 0)) },
    ];
  }, [books, folders]);

  const saveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Math.round(Number(goal));
    if (Number.isFinite(n) && n >= 1 && n <= 1000) update({ readingGoal: n });
    else setGoal(String(settings.readingGoal));
  };

  return (
    <div className="max-w-3xl space-y-8">
      <section className="surface flex flex-wrap items-center gap-5 p-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-accent/80 to-primary text-xl font-semibold text-app">
          {initials(user.name || user.email)}
        </div>
        <div className="mr-auto min-w-0">
          <h1 className="truncate font-display text-2xl font-bold">{user.name || "Reader"}</h1>
          <p className="truncate text-sm text-muted">{user.email}</p>
          {me?.isAdmin && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs text-accent">
              <ShieldCheck className="h-3.5 w-3.5" /> Administrator
            </span>
          )}
        </div>
        <button className="btn-outline" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </section>

      <section>
        <h2 className="mb-4 font-display text-xl font-semibold">Your reading</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="surface p-4">
              <div className="text-2xl font-semibold tabular-nums">{books ? s.value : "–"}</div>
              <div className="mt-0.5 text-xs text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="surface p-6">
        <StorageMeter />
      </section>

      <section className="surface p-6">
        <form onSubmit={saveGoal} className="flex flex-wrap items-end gap-4">
          <label className="mr-auto block">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Target className="h-4 w-4 text-accent" /> Yearly reading goal
            </span>
            <span className="mt-1 block text-xs text-muted">Books you want to finish in {new Date().getFullYear()}. Synced to all your devices.</span>
          </label>
          <input
            type="number"
            min={1}
            max={1000}
            className="input w-24"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            aria-label="Books per year"
          />
          <button className="btn" disabled={Number(goal) === settings.readingGoal}>
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
