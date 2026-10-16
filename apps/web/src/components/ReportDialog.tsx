import { useState } from "react";
import { reportPublicBook, type ReportReason } from "../lib/admin";
import { Modal } from "./ui/Modal";

const OPTIONS: { id: ReportReason; label: string; hint: string }[] = [
  { id: "copyright", label: "Copyright", hint: "Shared without the rights holder’s permission" },
  { id: "illegal", label: "Illegal content", hint: "Breaks the law" },
  { id: "offensive", label: "Offensive", hint: "Hateful or abusive material" },
  { id: "spam", label: "Spam", hint: "Not a real book, junk, or advertising" },
  { id: "other", label: "Other", hint: "Tell the administrators below" },
];

/** Reports a public-library book to the administrators. */
export function ReportDialog({ book, onClose }: { book: { id: string; title: string }; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>("copyright");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const send = async () => {
    setState("sending");
    try {
      await reportPublicBook(book.id, reason, details.trim() || undefined);
      setState("sent");
    } catch {
      setState("error");
    }
  };

  return (
    <Modal
      title={<>Report “{book.title}”</>}
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Done
        </button>
      }
      confirm={state === "sent" ? undefined : { label: "Send report", disabled: state === "sending", onClick: () => void send() }}
    >
      {state === "sent" ? (
        <p className="text-sm text-muted">Thanks. The administrators will review it.</p>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="eyebrow mb-2">Reason</legend>
            {OPTIONS.map((o) => (
              <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${reason === o.id ? "border-accent/50 bg-accent/8" : "border-line hover:border-accent/30"}`}>
                <input type="radio" name="reason" className="mt-1 accent-[var(--color-primary)]" checked={reason === o.id} onChange={() => setReason(o.id)} />
                <span>
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <textarea
            className="input min-h-20 w-full"
            placeholder="Details (optional)"
            aria-label="Details"
            maxLength={2000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          {state === "error" && <p className="text-sm text-rose-300">Could not send the report, try again.</p>}
        </>
      )}
    </Modal>
  );
}
