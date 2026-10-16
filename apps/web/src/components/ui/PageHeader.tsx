import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Fleuron } from "./Ornaments";

type Props = { title: string; icon?: LucideIcon; subtitle?: ReactNode; actions?: ReactNode; className?: string; children?: ReactNode };

/** A page's title set like a chapter opening, with an optional icon before it, a line under it (then `children`) and `actions` on the right. */
export function PageHeader({ title, icon: Icon, subtitle, actions, className = "mb-8", children }: Props) {
  const text = (
    <>
      <h1 className={`${Icon ? "flex items-center gap-3 " : ""}font-display text-[2.15rem] font-semibold leading-[1.05] text-ivory sm:text-[2.5rem]`}>
        {Icon && <Icon className="h-6 w-6 shrink-0 text-accent" strokeWidth={1.6} />}
        {title}
      </h1>
      <Fleuron className="mt-3 w-16 text-gold/50" />
      {subtitle && <p className="mt-2.5 text-sm text-muted">{subtitle}</p>}
      {children}
    </>
  );
  if (!actions) return <header className={className}>{text}</header>;
  return (
    <header className={`${className} flex flex-wrap items-end gap-4`}>
      <div className="mr-auto">{text}</div>
      {actions}
    </header>
  );
}
