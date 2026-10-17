import type { CSSProperties } from "react";

/*
 * Ornaments drawn only on the front page: the torn paper between its sections and the quill. Kept
 * apart from Ornaments.tsx, which the app's main bundle imports. Styles are in literary.css.
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

/** A quill drawn in fine lines: a curved shaft with barbs that taper towards both ends. Built once. */
const FEATHER = (() => {
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
  return { barbs: barbs.join(""), left: outline(left), right: outline(right) };
})();

export function Feather({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 120 320" fill="none" stroke="currentColor" aria-hidden="true">
      <path d={FEATHER.barbs} strokeWidth="0.5" opacity="0.7" />
      <path d={FEATHER.left} strokeWidth="0.9" />
      <path d={FEATHER.right} strokeWidth="0.9" />
      <path d="M60 14C61 90 66 190 63.5 258C62 280 60 300 57 316" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

