import { FONTS, fontFaceCss, type FontId } from "../lib/fonts";
import { THEMES, useSettings, type ThemeId } from "../lib/settings";
import { PanelShell } from "./PanelShell";

// Load the bundled fonts in the app document too, so the font buttons preview them.
const previewStyle = document.createElement("style");
previewStyle.textContent = FONTS.map((f) => fontFaceCss(f.id)).join("\n");
document.head.append(previewStyle);

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      {children}
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
  return (
    <div className="flex items-center gap-3">
      <button className="btn-icon" aria-label="Decrease" onClick={() => onChange(clamp(value - step))}>
        −
      </button>
      <div className="w-16 text-center tabular-nums">{format(value)}</div>
      <button className="btn-icon" aria-label="Increase" onClick={() => onChange(clamp(value + step))}>
        +
      </button>
    </div>
  );
}

/** A row of chips, one per option; the chosen one is on. */
function Choice<T extends string | number | boolean>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className={`grid ${options.length === 3 ? "grid-cols-3" : "grid-cols-2"} gap-2`}>
      {options.map(([option, label]) => (
        <button key={String(option)} onClick={() => onChange(option)} className={`chip ${value === option ? "chip-on" : ""}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>
        {label}
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </span>
      <input type="checkbox" className="h-5 w-5 accent-teal-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

type StepKey = "fontSize" | "lineHeight" | "letterSpacing" | "pageWidth" | "margin" | "marginY";

/** The ebook steppers: label, setting, min, max, step and how the value shows. */
const TEXT_STEPPERS: [string, StepKey, number, number, number, (v: number) => string][] = [
  ["Font size", "fontSize", 60, 250, 10, (v) => `${v}%`],
  ["Line spacing", "lineHeight", 1, 2.4, 0.1, (v) => v.toFixed(1)],
  ["Letter spacing", "letterSpacing", -0.05, 0.3, 0.01, (v) => (v === 0 ? "Book" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`)],
  ["Page width", "pageWidth", 400, 1400, 40, (v) => `${v}px`],
  ["Side margins", "margin", 0, 20, 2, (v) => `${v}%`],
  ["Top & bottom", "marginY", 0, 160, 8, (v) => `${v}px`],
];

export function SettingsPanel({ kind, onClose }: { kind: "text" | "pdf" | "comic"; onClose: () => void }) {
  const { settings: s, update } = useSettings();

  return (
    <PanelShell side="right" label="Reading settings" title="Display" closeLabel="Close settings" closeIcon="✕" onClose={onClose}>
      <Row label="Theme">
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => (
            <button
              key={id}
              onClick={() => update({ theme: id })}
              className={`rounded-lg border-2 px-2 py-3 text-sm font-medium ${
                s.theme === id ? "border-teal-600" : "border-neutral-300 dark:border-neutral-700"
              }`}
              style={{ background: THEMES[id].bg, color: THEMES[id].fg }}
            >
              {THEMES[id].label}
            </button>
          ))}
        </div>
      </Row>

      <Row label={`Contrast · ${s.contrast}%`}>
        <input
          type="range"
          min={60}
          max={160}
          step={5}
          value={s.contrast}
          onChange={(e) => update({ contrast: Number(e.target.value) })}
          className="w-full accent-teal-600"
        />
      </Row>

      {kind === "comic" ? (
        <>
          <Row label="Layout" hint="Vertical scroll shows the pages as one continuous strip, for webtoons and manhwa.">
            <Choice options={[[false, "Pages"], [true, "Vertical scroll"]]} value={s.comicScroll} onChange={(v) => update({ comicScroll: v })} />
          </Row>
          <Row label="Page fit">
            <Choice options={[["page", "Whole page"], ["width", "Page width"]]} value={s.comicFit} onChange={(v) => update({ comicFit: v })} />
          </Row>
          {!s.comicScroll && (
            <>
              <Row label="Pages on screen" hint="Two pages are shown side by side on wide screens, with the cover on its own.">
                <Choice options={[[false, "One page"], [true, "Two pages"]]} value={s.comicSpreads} onChange={(v) => update({ comicSpreads: v })} />
              </Row>
              <Row label="Reading direction" hint="Auto reads right to left when the comic says it is manga.">
                <Choice
                  options={[["auto", "Auto"], ["ltr", "Left → right"], ["rtl", "Manga ←"]]}
                  value={s.comicDirection}
                  onChange={(v) => update({ comicDirection: v })}
                />
              </Row>
            </>
          )}
        </>
      ) : kind === "pdf" ? (
        <>
          <Row label="Page fit" hint="PDFs have a fixed layout, so font and spacing options apply to ebooks only. Pinch, double-tap or Ctrl + scroll to zoom.">
            <Choice options={[["page", "Whole page"], ["width", "Page width"]]} value={s.pdfFit} onChange={(v) => update({ pdfFit: v })} />
          </Row>
          <Row label="Margins" hint="Space between the page and the edges of the screen.">
            <Stepper value={s.pdfMargin} onChange={(v) => update({ pdfMargin: v })} min={0} max={48} step={4} format={(v) => `${v}px`} />
          </Row>
          <Toggle
            label="Crop white margins"
            hint="Shows only the part of each page with content, so the text is larger."
            checked={s.pdfCrop}
            onChange={(v) => update({ pdfCrop: v })}
          />
        </>
      ) : (
        <>
          <Row label="Font">
            <div className="grid grid-cols-2 gap-2">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => update({ font: f.id as FontId })}
                  className={`chip ${s.font === f.id ? "chip-on" : ""}`}
                  style={{ fontFamily: f.family ?? undefined }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </Row>
          <div className="grid grid-cols-2 gap-4">
            {TEXT_STEPPERS.map(([label, key, min, max, step, format]) => (
              <Row key={key} label={label}>
                <Stepper value={s[key]} onChange={(v) => update({ [key]: v })} min={min} max={max} step={step} format={format} />
              </Row>
            ))}
          </div>
          <Row label="Pages on screen" hint="The page is centered; on narrow or portrait screens one page is always shown.">
            <Choice options={[[1, "One page"], [2, "Two pages"]]} value={s.columns} onChange={(v) => update({ columns: v })} />
          </Row>
          <Toggle label="Justify text" checked={s.justify} onChange={(v) => update({ justify: v })} />
          <Toggle label="Use theme colors instead of the book's" checked={s.overrideColors} onChange={(v) => update({ overrideColors: v })} />
        </>
      )}
      <p className="text-xs text-neutral-500">These settings sync to all your devices.</p>
    </PanelShell>
  );
}
