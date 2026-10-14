import { User } from "lucide-react";
import { initials } from "../../lib/format";

const SIZES = { sm: "h-10 w-10 text-sm", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-xl" };

/** A person's initials in the accent circle; a silhouette when there is no name to show. */
export function Avatar({ name, size = "md", className = "" }: { name: string | null | undefined; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/80 to-primary font-semibold text-app ${SIZES[size]} ${className}`}
      aria-hidden="true"
    >
      {name?.trim() ? initials(name) : <User className="h-4 w-4" />}
    </span>
  );
}
