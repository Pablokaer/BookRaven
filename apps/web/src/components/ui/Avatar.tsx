import { User } from "lucide-react";
import { initials } from "../../lib/format";

const SIZES = {
  sm: { box: "h-9 w-9 text-xs", icon: "h-4 w-4" },
  md: { box: "h-10 w-10 text-sm", icon: "h-4 w-4" },
  lg: { box: "h-16 w-16 text-xl", icon: "h-6 w-6" },
};

/** A person's initials in the accent circle; a silhouette when there is no name to show. */
export function Avatar({ name, size = "md", className = "" }: { name: string | null | undefined; size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/80 to-primary font-semibold text-app ${s.box} ${className}`}
      aria-hidden="true"
    >
      {name?.trim() ? initials(name) : <User className={s.icon} />}
    </span>
  );
}
