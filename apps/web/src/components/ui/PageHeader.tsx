import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type Props = { title: string; icon?: LucideIcon; subtitle?: ReactNode; actions?: ReactNode; className?: string; children?: ReactNode };

/** A page's title, with an optional icon before it, a line under it (then `children`) and `actions` on the right. */
export function PageHeader({ title, icon: Icon, subtitle, actions, className = "mb-8", children }: Props) {
  const text = (
    <>
      <h1 className={`${Icon ? "flex items-center gap-3 " : ""}font-display text-3xl font-bold tracking-tight`}>
        {Icon && <Icon className="h-7 w-7 text-accent" />}
        {title}
      </h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
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
