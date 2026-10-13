// Fonts are bundled (no external requests) so they also work offline in the Android app.
import atkinson400 from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url";
import atkinson400i from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2?url";
import atkinson700 from "@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url";
import literata400 from "@fontsource/literata/files/literata-latin-400-normal.woff2?url";
import literata400i from "@fontsource/literata/files/literata-latin-400-italic.woff2?url";
import literata700 from "@fontsource/literata/files/literata-latin-700-normal.woff2?url";
import merri400 from "@fontsource/merriweather/files/merriweather-latin-400-normal.woff2?url";
import merri400i from "@fontsource/merriweather/files/merriweather-latin-400-italic.woff2?url";
import merri700 from "@fontsource/merriweather/files/merriweather-latin-700-normal.woff2?url";
import dys400 from "@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2?url";
import dys400i from "@fontsource/opendyslexic/files/opendyslexic-latin-400-italic.woff2?url";
import dys700 from "@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2?url";
import sans400 from "@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2?url";
import sans400i from "@fontsource/source-sans-3/files/source-sans-3-latin-400-italic.woff2?url";
import sans700 from "@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff2?url";

export type FontId =
  | "publisher"
  | "literata"
  | "merriweather"
  | "source-sans"
  | "atkinson"
  | "opendyslexic"
  | "system-serif"
  | "system-sans";

type Face = { url: string; weight: number; style: "normal" | "italic" };

export const FONTS: { id: FontId; label: string; family: string | null; faces?: Face[] }[] = [
  { id: "publisher", label: "Original", family: null },
  {
    id: "literata",
    label: "Literata",
    family: "'RS Literata', Georgia, serif",
    faces: [
      { url: literata400, weight: 400, style: "normal" },
      { url: literata400i, weight: 400, style: "italic" },
      { url: literata700, weight: 700, style: "normal" },
    ],
  },
  {
    id: "merriweather",
    label: "Merriweather",
    family: "'RS Merriweather', Georgia, serif",
    faces: [
      { url: merri400, weight: 400, style: "normal" },
      { url: merri400i, weight: 400, style: "italic" },
      { url: merri700, weight: 700, style: "normal" },
    ],
  },
  {
    id: "source-sans",
    label: "Source Sans",
    family: "'RS Source Sans', system-ui, sans-serif",
    faces: [
      { url: sans400, weight: 400, style: "normal" },
      { url: sans400i, weight: 400, style: "italic" },
      { url: sans700, weight: 700, style: "normal" },
    ],
  },
  {
    id: "atkinson",
    label: "Atkinson Hyperlegible",
    family: "'RS Atkinson', system-ui, sans-serif",
    faces: [
      { url: atkinson400, weight: 400, style: "normal" },
      { url: atkinson400i, weight: 400, style: "italic" },
      { url: atkinson700, weight: 700, style: "normal" },
    ],
  },
  {
    id: "opendyslexic",
    label: "OpenDyslexic",
    family: "'RS OpenDyslexic', sans-serif",
    faces: [
      { url: dys400, weight: 400, style: "normal" },
      { url: dys400i, weight: 400, style: "italic" },
      { url: dys700, weight: 700, style: "normal" },
    ],
  },
  { id: "system-serif", label: "System serif", family: "Georgia, 'Times New Roman', serif" },
  { id: "system-sans", label: "System sans", family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
];

/**
 * @font-face rules for the book iframes. URLs must be absolute because book
 * sections are loaded from blob: URLs.
 */
export function fontFaceCss(id: FontId): string {
  const font = FONTS.find((f) => f.id === id);
  if (!font?.faces || !font.family) return "";
  const name = font.family.split(",")[0]!;
  return font.faces
    .map(
      (f) => `@font-face { font-family: ${name}; src: url("${new URL(f.url, window.location.href).href}") format("woff2");
        font-weight: ${f.weight}; font-style: ${f.style}; font-display: block; }`,
    )
    .join("\n");
}

export function fontFamily(id: FontId): string | null {
  return FONTS.find((f) => f.id === id)?.family ?? null;
}
