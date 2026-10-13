/**
 * Layered mountain landscape at dusk, drawn as a small inline SVG so the
 * welcome panel needs no image download. Purely decorative.
 */
export function Landscape({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1200 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b2a2e" />
          <stop offset="0.55" stopColor="#14504f" />
          <stop offset="1" stopColor="#2d7a6d" />
        </linearGradient>
        <radialGradient id="ls-sun" cx="0.78" cy="0.62" r="0.35">
          <stop offset="0" stopColor="#f6d9a0" stopOpacity="0.55" />
          <stop offset="0.4" stopColor="#7fd4c1" stopOpacity="0.18" />
          <stop offset="1" stopColor="#7fd4c1" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ls-lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f8f81" stopOpacity="0.55" />
          <stop offset="1" stopColor="#071315" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="1200" height="400" fill="url(#ls-sky)" />
      <rect width="1200" height="400" fill="url(#ls-sun)" />
      <circle cx="935" cy="230" r="34" fill="#f3e3bd" opacity="0.35" />
      <path d="M0 250 L120 190 L210 225 L330 150 L450 220 L560 170 L690 235 L820 160 L950 215 L1080 175 L1200 220 V400 H0Z" fill="#1f5f5a" opacity="0.75" />
      <path d="M0 285 L90 245 L200 270 L310 215 L420 268 L540 230 L650 280 L780 225 L900 268 L1030 238 L1200 275 V400 H0Z" fill="#164844" />
      <path d="M0 300 H1200 V400 H0Z" fill="url(#ls-lake)" />
      <path d="M0 318 L80 298 L150 312 L240 292 L330 318 L420 302 L520 322 L640 300 L760 320 L880 304 L1000 324 L1100 306 L1200 318 V400 H0Z" fill="#0c2a2b" />
      <g fill="#081c1d">
        <path d="M60 330 l14 -46 l14 46z M95 334 l10 -34 l10 34z M300 336 l12 -40 l12 40z M1010 334 l13 -44 l13 44z M1050 338 l9 -30 l9 30z M1130 332 l15 -50 l15 50z" />
      </g>
      <path d="M0 340 Q300 325 600 345 T1200 338 V400 H0Z" fill="#071315" />
    </svg>
  );
}
