import { Check, Copy, KeyRound, Plus, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useCopy } from "./ui/CopyField";

/** A value to type into KOReader, in large monospace, with a copy button; without a value, `hint` says what goes there. */
function TypeValue({ label, value, hint, big = false }: { label: string; value: string | null; hint?: string; big?: boolean }) {
  const { copied, copy } = useCopy(value ?? "");
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-app/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="eyebrow">{label}</div>
        {value === null ? (
          <div className="mt-0.5 text-sm italic text-muted">{hint}</div>
        ) : (
          <div className={`mt-0.5 break-words font-mono ${big ? "text-xl tracking-wide text-accent" : "text-base text-fg"}`}>{value}</div>
        )}
      </div>
      {value !== null && (
        <button type="button" className="btn-outline shrink-0 px-3" aria-label={`Copy ${label}`} title="Copy" onClick={copy}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/40 font-display text-base font-semibold text-accent">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <h3 className="font-display text-lg font-semibold leading-tight">{title}</h3>
        {children}
      </div>
    </li>
  );
}

/**
 * Step-by-step KOReader setup (Kindle, Kobo, PocketBook…): every value to type on the e-reader's
 * keyboard, for this server and account. `created` is the app password just made, shown here once.
 */
export function KoreaderSetup({
  origin,
  email,
  created,
  onCreate,
  onHide,
}: {
  origin: string;
  email: string;
  created: { name: string; password: string } | null;
  onCreate: () => void;
  onHide: () => void;
}) {
  const passwordRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (created) passwordRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [created]);

  return (
    <div className="rounded-xl border border-gold/25 bg-gold/[0.03] p-5">
      <span className="eyebrow">Set up KOReader on a Kindle or Kobo</span>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        KOReader runs on Kobo, PocketBook and jailbroken Kindles. Have this page open next to your e-reader and type each value as shown.
      </p>

      <ol className="mt-5 space-y-6">
        <Step n={1} title="Make an app password">
          {created ? (
            <div ref={passwordRef} className="space-y-2">
              <TypeValue label="App password" value={created.password} big />
              <p className="flex items-start gap-2 text-xs text-muted">
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">
                  For “{created.name}”. It is shown only once: keep this page open until KOReader has signed in. Small letters, with a dash between
                  the words.
                </span>
                <button type="button" className="icon-btn h-6 w-6" aria-label="Hide the password" title="Hide" onClick={onHide}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-muted">One per device, so you can revoke it alone. It is a few short words, easy to type on an e-ink keyboard.</p>
              <button type="button" className="btn-outline py-1.5 text-xs" onClick={onCreate}>
                <Plus className="h-3.5 w-3.5" /> Create an app password
              </button>
            </>
          )}
        </Step>

        <Step n={2} title="Add your library as a catalog">
          <p className="text-xs leading-relaxed text-muted">
            In KOReader’s file browser: <b className="text-fg/90">Search</b> (magnifying glass) → <b className="text-fg/90">OPDS catalog</b> → <b className="text-fg/90">+</b>. Name it
            BookRaven and enter:
          </p>
          <TypeValue label="Catalog URL" value={`${origin}/opds`} />
          <div className="grid gap-2 sm:grid-cols-2">
            <TypeValue label="Username" value={email} />
            <TypeValue label="Password" value={created?.password ?? null} hint="Your app password" />
          </div>
        </Step>

        <Step n={3} title="Turn on progress sync">
          <p className="text-xs leading-relaxed text-muted">
            With a book open: <b className="text-fg/90">Tools</b> (wrench) → <b className="text-fg/90">Progress sync</b> → <b className="text-fg/90">Custom sync server</b>:
          </p>
          <TypeValue label="Sync server" value={`${origin}/kosync`} />
          <p className="text-xs leading-relaxed text-muted">
            Then <b className="text-fg/90">Login</b> with the same username and password, and set <b className="text-fg/90">Document matching method</b> to{" "}
            <b className="text-fg/90">Binary</b>. Turn on <b className="text-fg/90">Auto sync</b> to sync each time you open or close a book.
          </p>
        </Step>
      </ol>

      <p className="mt-5 text-xs leading-relaxed text-muted">
        PDFs and comics sync page by page both ways, and EPUBs to the exact spot. For other ebooks, BookRaven offers to jump to KOReader’s percentage.
      </p>
    </div>
  );
}
