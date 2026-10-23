import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** Copies `value`; `copied` is true for 2 s once it is on the clipboard. */
export function useCopy(value: string) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => {});
  return { copied, copy };
}

/**
 * Read-only text with a copy button that says "Copied" for 2 s once it is on the clipboard.
 * `label` names the text: shown above it with `showLabel`, otherwise for screen readers only.
 * The button is an icon, or reads "Copy" with `withText`.
 */
export function CopyField({
  value,
  label,
  showLabel = false,
  withText = false,
  inputClassName = "",
}: {
  value: string;
  label: string;
  showLabel?: boolean;
  withText?: boolean;
  inputClassName?: string;
}) {
  const { copied, copy } = useCopy(value);
  const icon = copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />;
  // "Invite link" → "Copy invite link"; names like "OPDS catalog" keep their capitals.
  const name = /^.[a-z]/.test(label) ? label[0]!.toLowerCase() + label.slice(1) : label;

  const field = (
    <div className={`flex gap-2 ${showLabel ? "mt-1.5" : ""}`}>
      <input readOnly value={value} className={`input min-w-0 flex-1 ${inputClassName}`} aria-label={showLabel ? undefined : label} onFocus={(e) => e.target.select()} />
      {withText ? (
        <button type="button" className="btn" onClick={copy}>
          {icon} {copied ? "Copied" : "Copy"}
        </button>
      ) : (
        <button type="button" className="btn-outline px-3" aria-label={`Copy ${name}`} onClick={copy}>
          {icon}
        </button>
      )}
    </div>
  );
  return showLabel ? (
    <label className="block">
      <span className="eyebrow">{label}</span>
      {field}
    </label>
  ) : (
    field
  );
}
