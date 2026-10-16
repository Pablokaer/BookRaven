import { KeyRound, MonitorSmartphone, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { API_BASE, apiDelete, apiJson } from "../lib/api";
import { confirmThen } from "../lib/confirm";
import { timeAgo } from "../lib/format";
import { useApi } from "../lib/useApi";
import { CopyField } from "./ui/CopyField";
import { Modal } from "./ui/Modal";

type AppPassword = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

/** One of the values to type into the other app. */
const Copyable = ({ label, value }: { label: string; value: string }) => <CopyField label={label} value={value} showLabel inputClassName="font-mono text-xs" />;

/** Profile section: OPDS catalog and KOReader sync addresses, and app passwords for them. */
export function OtherApps({ email }: { email: string }) {
  const { data: list, reload } = useApi(() => apiJson<AppPassword[]>("/api/app-passwords"), [], { fallback: [] });
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  const origin = API_BASE || window.location.origin;

  const create = async () => {
    const name = window.prompt("Name this device or app (e.g. “Kobo Libra”, “KOReader on phone”):")?.trim();
    if (!name) return;
    try {
      const res = await apiJson<{ name: string; password: string }>("/api/app-passwords", { method: "POST", body: JSON.stringify({ name }) });
      setCreated(res);
      reload();
    } catch {
      window.alert("Could not create it, try again.");
    }
  };

  const revoke = (p: AppPassword) =>
    confirmThen(`Revoke “${p.name}”? That app will stop syncing until you give it a new password.`, () => apiDelete(`/api/app-passwords/${p.id}`), reload);

  return (
    <section className="surface space-y-5 p-6">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <MonitorSmartphone className="h-4 w-4 text-accent" /> Other apps
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Use your library from other reading apps. <b className="text-fg/90">OPDS</b> (KOReader, Moon+ Reader, Thorium, Calibre…) lets them browse
          and download your books. <b className="text-fg/90">KOReader progress sync</b> keeps your place in sync with e-ink readers (Kobo,
          PocketBook, Kindle). Sign in there with your email and an app password, never your account password.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Copyable label="OPDS catalog" value={`${origin}/opds`} />
        <Copyable label="KOReader sync server" value={`${origin}/kosync`} />
        <Copyable label="Username" value={email} />
      </div>
      <p className="text-xs text-muted">
        In KOReader: Tools → Progress sync → Custom sync server, then Login. Choose “Binary” document matching. PDFs and comics sync page by
        page in both directions; for ebooks BookRaven offers to jump to KOReader’s percentage.
      </p>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">App passwords</span>
          <button className="btn-ghost py-1.5 text-xs" onClick={() => void create()}>
            <Plus className="h-3.5 w-3.5" /> New app password
          </button>
        </div>
        {list === null ? (
          <div className="h-12 animate-pulse rounded-xl bg-elevated/50" />
        ) : list.length === 0 ? (
          <p className="text-xs text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line/70 rounded-xl border border-line">
            {list.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <KeyRound className="h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="hidden text-xs text-muted sm:inline">{p.lastUsedAt ? `used ${timeAgo(p.lastUsedAt)}` : "never used"}</span>
                <button className="icon-btn h-8 w-8" aria-label={`Revoke ${p.name}`} title="Revoke" onClick={() => void revoke(p)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {created && (
        <Modal title={<>App password for “{created.name}”</>} onClose={() => setCreated(null)} footer={<button className="btn" onClick={() => setCreated(null)}>Done</button>}>
          <p className="-mt-2 text-sm text-muted">Type it in the app as the password, with your email as the username. It is shown only once.</p>
          <Copyable label="Password" value={created.password} />
        </Modal>
      )}
    </section>
  );
}
