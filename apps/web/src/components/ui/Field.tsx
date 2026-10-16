import type { ComponentProps, ReactNode } from "react";

/** A form field with a visible label: placeholders vanish while typing, labels don't. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5 text-left">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/** A required password input with its label. */
export function PasswordField({
  label,
  onValue,
  className = "input h-11 w-full",
  ...props
}: { label: string; onValue: (value: string) => void } & Omit<ComponentProps<"input">, "type" | "onChange">) {
  return (
    <Field label={label}>
      <input className={className} type="password" required onChange={(e) => onValue(e.target.value)} {...props} />
    </Field>
  );
}
