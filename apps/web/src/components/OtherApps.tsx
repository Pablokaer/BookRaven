import { Check, Copy, KeyRound, MonitorSmartphone, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, apiFetch, apiJson } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Modal } from "./ui/Modal";

type AppPassword = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <div className="mt-1.5 flex gap-2">
        <input readOnly value={value} className="input min-w-0 flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="btn-outline px-3"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

/** Profile section: OPDS catalog and KOReader sync addresses, and app passwords for them. */
export function OtherApps({ email }: { email: string }) {
  const [list, setList] = useState<AppPassword[] | null>(null);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  const origin = API_BASE || window.location.origin;

  const load = useCallback(() => {
    apiJson<AppPassword[]>("/api/app-passwords")
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    const name = window.prompt("Name this device or app (e.g. “Kobo Libra”, “KOReader on phone”):")?.trim();
    if (!name) return;
    try {
      const res = await apiJson<{ name: string; password: string }>("/api/app-passwords", { method: "POST", body: JSON.stringify({ name }) });
      setCreated(res);
      load();
    } catch {
      window.alert("Could not create it, try again.");
    }
  };

  const revoke = async (p: AppPassword) => {
    if (!window.confirm(`Revoke “${p.name}”? That app will stop syncing until you give it a new password.`)) return;
    await apiFetch(`/api/app-passwords/${p.id}`, { method: "DELETE" });
    load();
  };

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
        <CopyField label="OPDS catalog" value={`${origin}/opds`} />
        <CopyField label="KOReader sync server" value={`${origin}/kosync`} />
        <CopyField label="Username" value={email} />
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
          <CopyField label="Password" value={created.password} />
        </Modal>
      )}
    </section>
  );
}
