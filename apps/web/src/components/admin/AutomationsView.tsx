import { AlertTriangle, ChevronDown, Clock, Mail, Save, Users } from "lucide-react";
import { useState } from "react";
import { listAutomations, sendTestEmail, updateAutomation, type Automation, type CampaignContent } from "../../lib/campaigns";
import { timeAgo } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { useApi } from "../../lib/useApi";
import { ContentFields, contentInvalid, PreviewPane, useEmailPreview } from "./EmailsTab";

/** Admin → Emails → Automations: the emails that go out on their own, each turned on separately. */
export function AutomationsView() {
  const { data, reload } = useApi(listAutomations, []);
  if (!data) return <div className="h-96 animate-pulse rounded-2xl bg-elevated/50" />;
  const { from, to } = data.hours;
  const brasilia = (h: number) => String((h + 21) % 24).padStart(2, "0");
  return (
    <div className="space-y-5">
      {!data.mailEnabled && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          This server has no SMTP_URL: automations send nothing until it is set.
        </p>
      )}
      <div className="surface flex flex-wrap gap-x-6 gap-y-2 p-4 text-sm text-muted">
        <span className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-accent" /> Checked every hour from {String(from).padStart(2, "0")}:00 to {String(to).padStart(2, "0")}:00 UTC ({brasilia(from)}:00–
          {brasilia(to)}:00 in Brasília)
        </span>
        <span className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-accent" /> At most one promotional email every {data.spacingDays} days per reader
        </span>
        <span>Unsubscribed and blocked accounts never receive them. Each automation starts off.</span>
      </div>
      <div className="space-y-3">
        {data.automations.map((a) => (
          <AutomationCard key={a.id} automation={a} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}

function AutomationCard({ automation: a, onChanged }: { automation: Automation; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = async (body: Parameters<typeof updateAutomation>[1], done?: string) => {
    setBusy(true);
    try {
      await updateAutomation(a.id, body);
      if (done) showToast(done);
      onChanged();
    } catch {
      showToast("That did not work, try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    if (!a.enabled) {
      const who = a.waiting === 1 ? "1 reader fits it now" : `${a.waiting} readers fit it now`;
      if (!window.confirm(`Turn on “${a.name}”? ${who} and will get it at the next pass within the sending hours.`)) return;
    }
    void change({ enabled: !a.enabled }, a.enabled ? `“${a.name}” is off.` : `“${a.name}” is on.`);
  };

  const rate = a.sent30 ? Math.round((a.returned30 / a.sent30) * 100) : null;
  return (
    <section className={`surface overflow-hidden transition ${a.enabled ? "border-accent/40" : ""}`}>
      <div className="flex flex-wrap items-start gap-4 p-5">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl font-semibold">{a.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-xs ${a.enabled ? "bg-emerald-400/12 text-emerald-300" : "bg-white/8 text-muted"}`}>
              {a.enabled ? "On" : "Off"}
            </span>
            {a.customized && <span className="rounded-full bg-accent/12 px-2 py-0.5 text-xs text-accent">Edited text</span>}
          </div>
          <p className="mt-1 text-sm text-muted">{a.trigger.replace("{days}", String(a.days ?? ""))}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {a.waiting} waiting now
            </span>
            <span>{a.sent30} sent in the last 30 days</span>
            {rate !== null && (
              <span>
                {a.returned30} read again within a week ({rate}%)
              </span>
            )}
            {a.lastSentAt && <span>last sent {timeAgo(a.lastSentAt)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {a.days !== null && a.daysChoices.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted">
              After
              <select className="input py-1.5" value={a.days} disabled={busy} onChange={(e) => void change({ days: Number(e.target.value) })}>
                {[...new Set([...a.daysChoices, a.days])]
                  .sort((x, y) => x - y)
                  .map((d) => (
                    <option key={d} value={d}>
                      {d} {d === 1 ? "day" : "days"}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <button type="button" className="btn-outline py-2" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Text & preview <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={a.enabled}
            aria-label={`${a.name}: ${a.enabled ? "on" : "off"}`}
            disabled={busy}
            onClick={toggle}
            className={`relative h-7 w-12 shrink-0 rounded-full border transition ${a.enabled ? "border-accent/60 bg-accent/70" : "border-line bg-elevated"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ivory shadow transition-all ${a.enabled ? "left-6" : "left-0.5"}`} />
          </button>
        </div>
      </div>
      {open && <AutomationEditor key={JSON.stringify(a.content)} automation={a} onSave={(content) => change({ content }, "Text saved.")} busy={busy} />}
    </section>
  );
}

function AutomationEditor({ automation: a, onSave, busy }: { automation: Automation; onSave: (c: CampaignContent | null) => void; busy: boolean }) {
  const [content, setContent] = useState<CampaignContent>(a.content);
  const { preview, error } = useEmailPreview(a.template, content);
  const dirty = JSON.stringify(content) !== JSON.stringify(a.content);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    try {
      await sendTestEmail(a.template, content);
      showToast("Test sent to your email address.");
    } catch {
      showToast("The test could not be sent.", "error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid gap-5 border-t border-line/70 bg-app/30 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="min-w-0 space-y-4">
        <ContentFields title="Text" templateId={a.template} content={content} onChange={setContent} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={!dirty || busy || contentInvalid(content)} onClick={() => onSave(content)}>
            <Save className="h-4 w-4" /> Save text
          </button>
          <button type="button" className="btn-outline" disabled={testing || contentInvalid(content)} onClick={() => void test()}>
            <Mail className="h-4 w-4" /> {testing ? "Sending…" : "Send me a test"}
          </button>
          {a.customized && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => onSave(null)}>
              Restore the template's text
            </button>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <PreviewPane preview={preview} error={error} />
      </div>
    </div>
  );
}
