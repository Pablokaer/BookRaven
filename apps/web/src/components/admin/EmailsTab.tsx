import { AlertTriangle, Check, KeyRound, Mail, Monitor, Send, Smartphone, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  audienceSize,
  HERO_LABELS,
  listAccountEmails,
  listCampaigns,
  listTemplates,
  previewEmail,
  SEGMENT_LABELS,
  sendCampaign,
  sendTestEmail,
  type Audience,
  type Campaign,
  type CampaignContent,
  type EmailPreview,
  type EmailTemplate,
  type Hero,
  type Segment,
  type TemplateId,
} from "../../lib/campaigns";
import { timeAgo } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { useApi } from "../../lib/useApi";
import { ProgressBar } from "../books/ProgressBar";
import { Field } from "../ui/Field";
import { Modal } from "../ui/Modal";

const DAYS = [7, 14, 30, 60, 90, 180];

/**
 * Admin → Emails. Promotional: pick a template, edit it, watch the preview, test it on yourself,
 * then send. Account emails: see the emails the server sends on its own (welcome, password reset…).
 */
export function EmailsTab() {
  const { data } = useApi(listTemplates, []);
  const [view, setView] = useState<"promo" | "account">("promo");
  if (!data) return <div className="h-96 animate-pulse rounded-2xl bg-elevated/50" />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Kind of email">
        <button type="button" role="tab" aria-selected={view === "promo"} className={`pill ${view === "promo" ? "pill-on" : ""}`} onClick={() => setView("promo")}>
          <Send className="h-4 w-4" /> Promotional emails
        </button>
        <button type="button" role="tab" aria-selected={view === "account"} className={`pill ${view === "account" ? "pill-on" : ""}`} onClick={() => setView("account")}>
          <KeyRound className="h-4 w-4" /> Account emails
        </button>
      </div>
      {view === "promo" ? <Composer templates={data.templates} mailEnabled={data.mailEnabled} /> : <AccountEmails />}
    </div>
  );
}

/** The emails sent on their own (welcome, password reset, confirm email, book request), previewed for the administrator. */
function AccountEmails() {
  const { data: emails } = useApi(listAccountEmails, []);
  const [id, setId] = useState("welcome");
  if (!emails) return <div className="h-96 animate-pulse rounded-2xl bg-elevated/50" />;
  const current = emails.find((e) => e.id === id) ?? emails[0]!;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="min-w-0 space-y-3">
        <p className="text-sm text-muted">
          BookRaven sends these on its own, when something happens to an account. They share the look of the promotional emails; their text is fixed, and links in
          the preview are samples.
        </p>
        <div className="grid gap-2">
          {emails.map((e) => (
            <button
              key={e.id}
              type="button"
              aria-pressed={e.id === current.id}
              onClick={() => setId(e.id)}
              className={`rounded-xl border p-3.5 text-left transition ${e.id === current.id ? "border-accent/60 bg-accent/10" : "border-line hover:border-accent/40"}`}
            >
              <span className="flex items-center justify-between gap-2 font-display text-lg font-semibold leading-tight">
                {e.name}
                {e.id === current.id && <Check className="h-4 w-4 shrink-0 text-accent" />}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted">{e.description}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <PreviewPane preview={{ subject: current.subject, preheader: current.preheader, html: current.html, sample: false, emptyClassics: false }} error={false} />
      </div>
    </div>
  );
}

function Composer({ templates, mailEnabled }: { templates: EmailTemplate[]; mailEnabled: boolean }) {
  const [templateId, setTemplateId] = useState<TemplateId>(templates[0]!.id);
  const template = templates.find((t) => t.id === templateId)!;
  const [content, setContent] = useState<CampaignContent>(template.defaults);
  const [audience, setAudience] = useState<Audience>(template.audience);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const { data: campaigns, reload: reloadCampaigns } = useApi(listCampaigns, [], { fallback: [] });

  const edited = useMemo(() => JSON.stringify(content) !== JSON.stringify(template.defaults), [content, template]);

  const pick = (t: EmailTemplate) => {
    if (t.id === templateId) return;
    if (edited && !window.confirm("Switch template? Your edits to this one are lost.")) return;
    setTemplateId(t.id);
    setContent(t.defaults);
    setAudience(t.audience);
  };
  const set = <K extends keyof CampaignContent>(key: K, value: CampaignContent[K]) => setContent((c) => ({ ...c, [key]: value }));

  // The preview, rendered by the server for this administrator, a moment after typing stops.
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      previewEmail(templateId, content).then(
        (p) => {
          if (!live) return;
          setPreview(p);
          setPreviewError(false);
        },
        () => live && setPreviewError(true),
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [templateId, content]);

  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setCount(null);
    audienceSize(audience).then(
      (r) => live && setCount(r.count),
      () => live && setCount(null),
    );
    return () => {
      live = false;
    };
  }, [audience]);

  // While a campaign is being sent, its counts move: ask again every few seconds.
  const sending = campaigns?.some((c) => c.status === "sending");
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(reloadCampaigns, 3000);
    return () => clearInterval(t);
  }, [sending, reloadCampaigns]);

  const invalid = !content.subject.trim() || !content.headline.trim() || !content.buttonLabel.trim() || !/^\/[A-Za-z0-9/_?=&.%#-]*$/.test(content.buttonPath);

  const test = async () => {
    setBusy("test");
    try {
      await sendTestEmail(templateId, content);
      showToast("Test sent to your email address.");
    } catch (e) {
      showToast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send");
    try {
      const r = await sendCampaign(templateId, content, audience);
      showToast(`Sending to ${r.recipients} ${r.recipients === 1 ? "reader" : "readers"}…`);
      setConfirming(false);
      reloadCampaigns();
    } catch (e) {
      showToast(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      {!mailEnabled && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          This server has no SMTP_URL, so emails are not delivered (in development they are printed to the server log).
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-6">
          <section>
            <h3 className="eyebrow mb-3">1 · Template</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={t.id === templateId}
                  onClick={() => pick(t)}
                  className={`rounded-xl border p-3.5 text-left transition ${
                    t.id === templateId ? "border-accent/60 bg-accent/10" : "border-line hover:border-accent/40"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 font-display text-lg font-semibold leading-tight">
                    {t.name}
                    {t.id === templateId && <Check className="h-4 w-4 shrink-0 text-accent" />}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted">{t.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="surface space-y-4 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="eyebrow">2 · Content</h3>
              {edited && (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => setContent(template.defaults)}>
                  Restore the template's text
                </button>
              )}
            </div>
            <Field label="Subject">
              <input className="input w-full" maxLength={150} value={content.subject} onChange={(e) => set("subject", e.target.value)} />
            </Field>
            <Field label="Preview text (shown after the subject in the inbox)">
              <input className="input w-full" maxLength={200} value={content.preheader} onChange={(e) => set("preheader", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <Field label="Small title above">
                <input className="input w-full" maxLength={60} value={content.eyebrow} onChange={(e) => set("eyebrow", e.target.value)} />
              </Field>
              <Field label="Headline">
                <input className="input w-full" maxLength={150} value={content.headline} onChange={(e) => set("headline", e.target.value)} />
              </Field>
            </div>
            <Field label="Message">
              <textarea className="input min-h-40 w-full resize-y leading-relaxed" maxLength={5000} value={content.message} onChange={(e) => set("message", e.target.value)} />
            </Field>
            <p className="-mt-2 text-xs leading-relaxed text-muted">
              <code className="text-fg">{"{name}"}</code> is each reader's first name, <code className="text-fg">{"{year}"}</code> this year. A blank line starts a
              paragraph, lines starting with <code className="text-fg">-</code> make a list, <code className="text-fg">**bold**</code>.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button text">
                <input className="input w-full" maxLength={40} value={content.buttonLabel} onChange={(e) => set("buttonLabel", e.target.value)} />
              </Field>
              <Field label={templateId === "continue" ? "Button link (if they have no book open)" : "Button link (page of the app)"}>
                <input className="input w-full font-mono" maxLength={300} value={content.buttonPath} onChange={(e) => set("buttonPath", e.target.value)} placeholder="/public" />
              </Field>
            </div>
            <Field label="Picture">
              <select className="input w-full" value={content.hero} onChange={(e) => set("hero", e.target.value as Hero)}>
                {(Object.keys(HERO_LABELS) as Hero[]).map((h) => (
                  <option key={h} value={h}>
                    {HERO_LABELS[h]}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <section className="surface space-y-4 p-5">
            <h3 className="eyebrow">3 · Who receives it</h3>
            <div className="space-y-2">
              {(Object.keys(SEGMENT_LABELS) as Segment[]).map((s) => (
                <label
                  key={s}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition ${
                    audience.segment === s ? "border-accent/50 bg-accent/[0.07]" : "border-line hover:border-accent/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="segment"
                    className="mt-1 accent-[var(--color-primary)]"
                    checked={audience.segment === s}
                    onChange={() => setAudience((a) => ({ ...a, segment: s }))}
                  />
                  <span>
                    <span className="block text-sm font-medium">{SEGMENT_LABELS[s].label}</span>
                    <span className="block text-xs text-muted">{SEGMENT_LABELS[s].hint.replace("N days", `${audience.days} days`)}</span>
                  </span>
                </label>
              ))}
            </div>
            {SEGMENT_LABELS[audience.segment].usesDays && (
              <Field label="Quiet for at least">
                <select className="input w-full sm:w-48" value={audience.days} onChange={(e) => setAudience((a) => ({ ...a, days: Number(e.target.value) }))}>
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <p className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-accent" />
              {count === null ? <span className="text-muted">Counting…</span> : <span>Reaches <strong>{count}</strong> {count === 1 ? "account" : "accounts"} right now.</span>}
            </p>
            <p className="text-xs text-muted">Accounts that unsubscribed and blocked accounts are always left out. Every email has an unsubscribe link.</p>
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline" disabled={invalid || busy !== null} onClick={() => void test()}>
              <Mail className="h-4 w-4" /> {busy === "test" ? "Sending…" : "Send me a test"}
            </button>
            <button type="button" className="btn" disabled={invalid || busy !== null || !count || sending} onClick={() => setConfirming(true)}>
              <Send className="h-4 w-4" /> Send to {count ?? "…"} {count === 1 ? "reader" : "readers"}…
            </button>
          </div>
          {sending && <p className="-mt-3 text-xs text-muted">A campaign is being sent; the next one can start when it is done.</p>}
        </div>

        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <PreviewPane preview={preview} error={previewError} />
        </div>
      </div>

      <CampaignHistory campaigns={campaigns} templates={templates} />

      {confirming && (
        <Modal
          title="Send this email?"
          onClose={() => busy === null && setConfirming(false)}
          confirm={{ label: busy === "send" ? "Sending…" : `Send to ${count}`, onClick: () => void send(), disabled: busy !== null }}
        >
          <p className="-mt-2 text-sm text-muted">
            <span className="text-fg">“{preview?.subject ?? content.subject}”</span> goes to <strong className="text-fg">{count}</strong>{" "}
            {count === 1 ? "account" : "accounts"} ({SEGMENT_LABELS[audience.segment].label.toLowerCase()}
            {SEGMENT_LABELS[audience.segment].usesDays ? `, ${audience.days} days` : ""}). It can't be called back once sent.
          </p>
        </Modal>
      )}
    </div>
  );
}

/** The email as the reader will see it: the inbox line, then the message at desktop or phone width. */
function PreviewPane({ preview, error }: { preview: EmailPreview | null; error: boolean }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);

  // Fit the frame to the email so the page scrolls, not the frame.
  const fit = () => {
    const doc = frame.current?.contentDocument;
    if (doc) setHeight(Math.max(400, doc.documentElement.scrollHeight));
  };
  useEffect(() => {
    const t = setTimeout(fit, 300); // images change the height after load
    return () => clearTimeout(t);
  }, [preview?.html, device]);

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
        <h3 className="eyebrow">Preview</h3>
        <div className="flex gap-1" role="tablist" aria-label="Preview width">
          <button type="button" role="tab" aria-selected={device === "desktop"} className={`pill py-1 ${device === "desktop" ? "pill-on" : ""}`} onClick={() => setDevice("desktop")}>
            <Monitor className="h-3.5 w-3.5" /> Desktop
          </button>
          <button type="button" role="tab" aria-selected={device === "mobile"} className={`pill py-1 ${device === "mobile" ? "pill-on" : ""}`} onClick={() => setDevice("mobile")}>
            <Smartphone className="h-3.5 w-3.5" /> Phone
          </button>
        </div>
      </div>

      {/* The inbox line: who it's from, the subject and the preview text. */}
      <div className="flex items-start gap-3 border-b border-line/70 bg-app/40 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/20 font-display text-lg font-semibold text-accent">B</span>
        <div className="min-w-0 text-sm">
          <div className="font-semibold">BookRaven</div>
          <div className="truncate">
            <span className="font-medium">{preview?.subject ?? "…"}</span>
            {preview?.preheader && <span className="text-muted"> — {preview.preheader}</span>}
          </div>
        </div>
      </div>

      {preview?.sample && (
        <p className="border-b border-line/70 bg-accent/[0.06] px-4 py-2 text-xs text-muted">
          Shown with sample data because your own account has none for this template. Each reader sees their own.
        </p>
      )}
      {preview?.emptyClassics && (
        <p className="border-b border-line/70 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
          The Public Library has no classics with covers yet, so the row of books is left out.
        </p>
      )}

      <div className="bg-[#e6dac4] p-3 sm:p-4">
        {error && !preview ? (
          <p className="py-20 text-center text-sm text-ink/70">The preview could not be drawn. Check the fields.</p>
        ) : !preview ? (
          <div className="h-[600px] animate-pulse rounded bg-black/5" />
        ) : (
          <iframe
            ref={frame}
            title="Email preview"
            // No scripts run in it; same-origin only lets the page measure its height.
            sandbox="allow-same-origin"
            srcDoc={preview.html}
            onLoad={fit}
            className="mx-auto block rounded-md bg-white shadow-lg transition-[width] duration-300"
            style={{ width: device === "mobile" ? 375 : "100%", maxWidth: "100%", height, border: 0 }}
          />
        )}
      </div>
    </section>
  );
}

function CampaignHistory({ campaigns, templates }: { campaigns: Campaign[] | null; templates: EmailTemplate[] }) {
  if (!campaigns?.length) return null;
  const name = (id: string) => templates.find((t) => t.id === id)?.name ?? id;
  return (
    <section>
      <h3 className="eyebrow mb-3">Sent emails</h3>
      <div className="surface divide-y divide-line/70">
        {campaigns.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{c.subject}</span>
                <StatusBadge status={c.status} />
              </div>
              <div className="text-xs text-muted">
                {name(c.template)} · {SEGMENT_LABELS[c.audience.segment]?.label ?? c.audience.segment}
                {SEGMENT_LABELS[c.audience.segment]?.usesDays ? ` (${c.audience.days} days)` : ""} · {timeAgo(c.createdAt)}
                {c.createdBy ? ` · by ${c.createdBy}` : ""}
              </div>
            </div>
            <div className="w-48 text-xs max-sm:flex-1">
              <div className="mb-1 flex justify-between text-muted">
                <span>
                  {c.sent} of {c.recipients} sent
                </span>
                {c.failed > 0 && <span className="text-rose-300">{c.failed} failed</span>}
              </div>
              <ProgressBar value={c.recipients ? (c.sent + c.failed) / c.recipients : 0} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: Campaign["status"] }) {
  const styles: Record<Campaign["status"], string> = {
    sending: "bg-accent/12 text-accent",
    sent: "bg-emerald-400/12 text-emerald-300",
    interrupted: "bg-rose-500/15 text-rose-300",
  };
  const labels: Record<Campaign["status"], string> = { sending: "Sending", sent: "Sent", interrupted: "Interrupted" };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status]}`}>{labels[status]}</span>;
}

function errorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.body?.error === "mail_disabled") return "This server can't send email: set SMTP_URL first.";
    if (e.body?.error === "campaign_running") return "Another campaign is still being sent.";
    if (e.body?.error === "no_recipients") return "Nobody is in this audience right now.";
  }
  return "That did not work, try again.";
}
