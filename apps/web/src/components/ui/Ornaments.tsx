import type { CSSProperties, ReactNode } from "react";
import arrivalPlate from "../../assets/landing/plate-arrival-360.webp";
import flightPlate from "../../assets/landing/plate-flight-360.webp";
import lampPlate from "../../assets/landing/plate-lamp-360.webp";
import shelvesPlate from "../../assets/landing/plate-shelves-360.webp";
import door1100 from "../../assets/landing/raven-door-1100.webp";
import door640 from "../../assets/landing/raven-door-640.webp";

/*
 * The literary ornaments shared by the front page, the sign-in screens and the app: torn paper
 * edges, a fleuron rule, a quill, and the arched plate of the raven above the chamber door
 * (Gustave Doré, 1884). Styles are in literary.css.
 */

/** Torn paper where one section meets the next: drawn in the lower section's color, over the upper one. */
const EDGE =
  "M0 36 L0 19.6 L9.6 19 L19.2 25.8 L28.8 19.6 L38.4 25.1 L48 22.8 L57.6 18.7 L67.2 23.1 L76.8 17 L86.4 20.9 L96 16.3 L105.6 16.5 L115.2 20.6 L124.8 25.8 L134.4 18.6 L144 20.8 L153.6 26.7 L163.2 31.5 L172.8 28.2 L182.4 26.8 L192 33.8 L201.6 22.8 L211.2 31.4 L220.8 23.6 L230.4 20.2 L240 17.9 L249.6 17.9 L259.2 21.5 L268.8 12.1 L278.4 14.8 L288 14 L297.6 9.8 L307.2 11.3 L316.8 5.6 L326.4 5.8 L336 8.1 L345.6 14.3 L355.2 12.2 L364.8 11.6 L374.4 15.3 L384 14 L393.6 12.2 L403.2 17.4 L412.8 15.6 L422.4 9.4 L432 12.1 L441.6 10.4 L451.2 13.5 L460.8 11.2 L470.4 5.8 L480 14 L489.6 4.8 L499.2 9.4 L508.8 15 L518.4 10 L528 16.1 L537.6 13.1 L547.2 22.5 L556.8 25.6 L566.4 25 L576 29.6 L585.6 23.8 L595.2 28.4 L604.8 27 L614.4 26.2 L624 24 L633.6 27.5 L643.2 27.9 L652.8 21.8 L662.4 23.6 L672 16.5 L681.6 24.2 L691.2 24.1 L700.8 29 L710.4 28 L720 22.8 L729.6 24.9 L739.2 28.8 L748.8 21.6 L758.4 26.5 L768 22.5 L777.6 20.8 L787.2 18.5 L796.8 24.8 L806.4 15.2 L816 14.3 L825.6 13.8 L835.2 17.3 L844.8 6.6 L854.4 9.6 L864 10 L873.6 13.6 L883.2 13.1 L892.8 14.2 L902.4 8.3 L912 10.8 L921.6 11.1 L931.2 18 L940.8 19.4 L950.4 10.4 L960 10.6 L969.6 10.8 L979.2 10.1 L988.8 12.1 L998.4 12.4 L1008 7.7 L1017.6 4.1 L1027.2 8.6 L1036.8 8.1 L1046.4 11 L1056 16.5 L1065.6 15 L1075.2 14.9 L1084.8 18.2 L1094.4 21.1 L1104 16.2 L1113.6 28 L1123.2 28.3 L1132.8 30.6 L1142.4 30.6 L1152 26.2 L1161.6 26.1 L1171.2 22.1 L1180.8 27.3 L1190.4 19.7 L1200 18.7 L1209.6 19.4 L1219.2 18.1 L1228.8 19.8 L1238.4 16.4 L1248 16.1 L1257.6 18.4 L1267.2 18.6 L1276.8 22.4 L1286.4 19.4 L1296 29.8 L1305.6 27.1 L1315.2 21.7 L1324.8 22.4 L1334.4 22.4 L1344 21.2 L1353.6 16.6 L1363.2 22.8 L1372.8 22.2 L1382.4 13.9 L1392 12.1 L1401.6 5.8 L1411.2 4.6 L1420.8 6.6 L1430.4 5.3 L1440 12 L1440 36 Z";

export function Edge({ className = "", mirror = false }: { className?: string; mirror?: boolean }) {
  return (
    <svg
      className={`lit-edge lit-edge-top ${className}`}
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
      viewBox="0 0 1440 36"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={EDGE} fill="currentColor" />
    </svg>
  );
}

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

/** A quill drawn in fine lines: a curved shaft with barbs that taper towards both ends. */
export function Feather({ className = "", style }: { className?: string; style?: CSSProperties }) {
  const barbs: string[] = [];
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = 22 + t * 236;
    const x = 60 + Math.sin(t * 2.2) * 5; // the shaft bends a little
    const w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75);
    const lx = x - 27 * w;
    const rx = x + 23 * w;
    left.push([lx, y - 15 * w]);
    right.push([rx, y - 13 * w]);
    if (i > 0 && i < n) {
      barbs.push(`M${x.toFixed(1)} ${y.toFixed(1)}Q${(x - 12 * w).toFixed(1)} ${(y - 3).toFixed(1)} ${lx.toFixed(1)} ${(y - 15 * w).toFixed(1)}`);
      barbs.push(`M${x.toFixed(1)} ${y.toFixed(1)}Q${(x + 10 * w).toFixed(1)} ${(y - 3).toFixed(1)} ${rx.toFixed(1)} ${(y - 13 * w).toFixed(1)}`);
    }
  }
  const outline = (pts: [number, number][]) => "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
  return (
    <svg className={className} style={style} viewBox="0 0 120 320" fill="none" stroke="currentColor" aria-hidden="true">
      <path d={barbs.join("")} strokeWidth="0.5" opacity="0.7" />
      <path d={outline(left)} strokeWidth="0.9" />
      <path d={outline(right)} strokeWidth="0.9" />
      <path d="M60 14C61 90 66 190 63.5 258C62 280 60 300 57 316" strokeWidth="1.3" strokeLinecap="round" />
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
