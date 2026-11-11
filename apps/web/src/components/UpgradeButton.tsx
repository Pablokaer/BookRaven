import { Sparkles } from "lucide-react";
import { Link } from "react-router";
import { PLANS_PATH, useUpgradeOffer } from "../lib/upgrade";

/**
 * "Upgrade": a way to the storage plans for accounts on the free storage (lib/upgrade.ts). Next to
 * Upload Book in the top bar, and above the storage meter in the sidebar (`compact`: icon only).
 * Draws nothing for administrators, accounts with a plan, or where plans aren't sold.
 */
export function UpgradeButton({ place, compact = false, onNavigate }: { place: "topbar" | "sidebar"; compact?: boolean; onNavigate?: () => void }) {
  const offer = useUpgradeOffer();
  if (!offer) return null;

  if (place === "topbar") {
    return (
      <Link to={PLANS_PATH} className="btn-outline h-11 border-gold/50 px-3 text-gold hover:border-gold sm:px-4" title="Get more storage" aria-label="Upgrade storage">
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">Upgrade</span>
      </Link>
    );
  }
  return (
    <Link
      to={PLANS_PATH}
      onClick={onNavigate}
      title="Get more storage"
      aria-label="Upgrade storage"
      className={`mb-2 flex items-center justify-center gap-2 rounded-xl border border-gold/40 bg-gold/10 text-sm font-medium text-gold transition hover:border-gold hover:bg-gold/15 ${compact ? "h-9" : "h-10 px-3"}`}
    >
      <Sparkles className="h-4 w-4 shrink-0" />
      {!compact && "Upgrade storage"}
    </Link>
  );
}
