import type { ReactNode } from "react";
import arrivalPlate from "../../assets/landing/plate-arrival-360.webp";
import flightPlate from "../../assets/landing/plate-flight-360.webp";
import lampPlate from "../../assets/landing/plate-lamp-360.webp";
import shelvesPlate from "../../assets/landing/plate-shelves-360.webp";
import door1100 from "../../assets/landing/raven-door-1100.webp";
import door640 from "../../assets/landing/raven-door-640.webp";

/*
 * The literary ornaments shared by the front page, the sign-in screens and the app: a fleuron rule,
 * the arched plate of the raven above the chamber door (Gustave Doré, 1884) and the medallions.
 * Styles are in literary.css. The front page's own (torn edges, the quill) are in
 * LandingOrnaments.tsx, so the app's main bundle doesn't carry them.
 */

/** A fine rule with a lozenge at its centre, as between the sections of an old book. */
export function Fleuron({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 12" fill="none" aria-hidden="true">
      <path d="M0 6H48M72 6H120" stroke="currentColor" strokeWidth="0.75" />
      <path d="M60 1.5 64.5 6 60 10.5 55.5 6Z" fill="currentColor" />
      <circle cx="51" cy="6" r="1" fill="currentColor" />
      <circle cx="69" cy="6" r="1" fill="currentColor" />
    </svg>
  );
}

/** The raven on the bust of Pallas, in a gothic arch with gold rules, fading into the mist at its foot. */
export function ArchedPlate({ sizes, priority = false, className = "" }: { sizes: string; priority?: boolean; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="lit-arch lit-arch-fade overflow-hidden">
        <img
          src={door640}
          srcSet={`${door640} 640w, ${door1100} 1100w`}
          sizes={sizes}
          width={1100}
          height={1544}
          fetchPriority={priority ? "high" : undefined}
          loading={priority ? undefined : "lazy"}
          decoding="async"
          alt="An engraving of a raven perched on a bust above a tall door, its shadow falling across a dim room."
          className="lit-parallax h-full w-full object-cover object-top"
        />
        {/* The lamp's glow around the bust, and a candle's warmth low on the left. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: "radial-gradient(40% 22% at 50% 8%, rgb(245 238 223 / 0.2), transparent 70%)" }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 mix-blend-soft-light"
          style={{ background: "radial-gradient(70% 45% at 18% 82%, rgb(201 164 116 / 0.7), transparent 70%)" }}
        />
      </div>
      <span className="lit-arch-frame" aria-hidden="true" />
    </div>
  );
}

/** Round vignettes cut from the same plates: the raven arriving, books on a table, the reading lamp, the raven at the window. */
export const VIGNETTES = { arrival: arrivalPlate, shelves: shelvesPlate, lamp: lampPlate, flight: flightPlate };
export type Vignette = keyof typeof VIGNETTES;

/** A vignette in a gold ring, with an optional seal (an icon or a numeral) on its edge. */
export function Medallion({ plate, seal, alt = "", className = "h-24 w-24" }: { plate: Vignette; seal?: ReactNode; alt?: string; className?: string }) {
  return (
    <div className={`relative shrink-0 rounded-full bg-navy p-[5px] ring-1 ring-gold/55 ${className}`}>
      <img src={VIGNETTES[plate]} width={360} height={360} loading="lazy" decoding="async" alt={alt} className="h-full w-full rounded-full object-cover" />
      {seal && (
        <span className="absolute -bottom-0.5 -right-0.5 grid h-9 w-9 place-items-center rounded-full bg-midnight text-gold ring-1 ring-gold/50 [&>svg]:h-4 [&>svg]:w-4">
          {seal}
        </span>
      )}
    </div>
  );
}
