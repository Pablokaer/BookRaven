import { FONTS, fontFaceCss, type FontId } from "../lib/fonts";
import { THEMES, useSettings, type ThemeId } from "../lib/settings";

// Load the bundled fonts in the app document too, so the font buttons preview them.
const previewStyle = document.createElement("style");
previewStyle.textContent = FONTS.map((f) => fontFaceCss(f.id)).join("\n");
document.head.append(previewStyle);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      {children}
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

export function SettingsPanel({ kind, onClose }: { kind: "text" | "pdf" | "comic"; onClose: () => void }) {
  const { settings: s, update } = useSettings();

  return (
    <div className="panel right-0 w-full max-w-sm" role="dialog" aria-label="Reading settings">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Display</h2>
        <button className="btn-icon" onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

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
          <Row label="Layout">
            <div className="grid grid-cols-2 gap-2">
              {([false, true] as const).map((scroll) => (
                <button key={String(scroll)} onClick={() => update({ comicScroll: scroll })} className={`chip ${s.comicScroll === scroll ? "chip-on" : ""}`}>
                  {scroll ? "Vertical scroll" : "Pages"}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-500">Vertical scroll shows the pages as one continuous strip, for webtoons and manhwa.</p>
          </Row>
          <Row label="Page fit">
            <div className="grid grid-cols-2 gap-2">
              {(["page", "width"] as const).map((fit) => (
                <button key={fit} onClick={() => update({ comicFit: fit })} className={`chip ${s.comicFit === fit ? "chip-on" : ""}`}>
                  {fit === "page" ? "Whole page" : "Page width"}
                </button>
              ))}
            </div>
          </Row>
          {!s.comicScroll && (
            <>
              <Row label="Pages on screen">
                <div className="grid grid-cols-2 gap-2">
                  {([false, true] as const).map((spreads) => (
                    <button
                      key={String(spreads)}
                      onClick={() => update({ comicSpreads: spreads })}
                      className={`chip ${s.comicSpreads === spreads ? "chip-on" : ""}`}
                    >
                      {spreads ? "Two pages" : "One page"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-neutral-500">Two pages are shown side by side on wide screens, with the cover on its own.</p>
              </Row>
              <Row label="Reading direction">
                <div className="grid grid-cols-3 gap-2">
                  {(["auto", "ltr", "rtl"] as const).map((dir) => (
                    <button key={dir} onClick={() => update({ comicDirection: dir })} className={`chip ${s.comicDirection === dir ? "chip-on" : ""}`}>
                      {dir === "auto" ? "Auto" : dir === "ltr" ? "Left → right" : "Manga ←"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-neutral-500">Auto reads right to left when the comic says it is manga.</p>
              </Row>
            </>
          )}
        </>
      ) : kind === "pdf" ? (
        <>
          <Row label="Page fit">
            <div className="grid grid-cols-2 gap-2">
              {(["page", "width"] as const).map((fit) => (
                <button
                  key={fit}
                  onClick={() => update({ pdfFit: fit })}
                  className={`chip ${s.pdfFit === fit ? "chip-on" : ""}`}
                >
                  {fit === "page" ? "Whole page" : "Page width"}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-500">
              PDFs have a fixed layout, so font and spacing options apply to ebooks only. Pinch, double-tap or Ctrl + scroll to zoom.
            </p>
          </Row>
          <Row label="Margins">
            <Stepper value={s.pdfMargin} onChange={(v) => update({ pdfMargin: v })} min={0} max={48} step={4} format={(v) => `${v}px`} />
            <p className="text-xs text-neutral-500">Space between the page and the edges of the screen.</p>
          </Row>
          <label className="flex items-center justify-between gap-4">
            <span>
              Crop white margins
              <span className="block text-xs text-neutral-500">Shows only the part of each page with content, so the text is larger.</span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-teal-600" checked={s.pdfCrop} onChange={(e) => update({ pdfCrop: e.target.checked })} />
          </label>
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
            <Row label="Font size">
              <Stepper
                value={s.fontSize}
                onChange={(v) => update({ fontSize: v })}
                min={60}
                max={250}
                step={10}
                format={(v) => `${v}%`}
              />
            </Row>
            <Row label="Line spacing">
              <Stepper
                value={s.lineHeight}
                onChange={(v) => update({ lineHeight: v })}
                min={1}
                max={2.4}
                step={0.1}
                format={(v) => v.toFixed(1)}
              />
            </Row>
            <Row label="Letter spacing">
              <Stepper
                value={s.letterSpacing}
                onChange={(v) => update({ letterSpacing: v })}
                min={-0.05}
                max={0.3}
                step={0.01}
                format={(v) => (v === 0 ? "Book" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`)}
              />
            </Row>
            <Row label="Page width">
              <Stepper
                value={s.pageWidth}
                onChange={(v) => update({ pageWidth: v })}
                min={400}
                max={1400}
                step={40}
                format={(v) => `${v}px`}
              />
            </Row>
            <Row label="Side margins">
              <Stepper
                value={s.margin}
                onChange={(v) => update({ margin: v })}
                min={0}
                max={20}
                step={2}
                format={(v) => `${v}%`}
              />
            </Row>
            <Row label="Top & bottom">
              <Stepper
                value={s.marginY}
                onChange={(v) => update({ marginY: v })}
                min={0}
                max={160}
                step={8}
                format={(v) => `${v}px`}
              />
            </Row>
          </div>
          <Row label="Pages on screen">
            <div className="grid grid-cols-2 gap-2">
              {([1, 2] as const).map((c) => (
                <button key={c} onClick={() => update({ columns: c })} className={`chip ${s.columns === c ? "chip-on" : ""}`}>
                  {c === 1 ? "One page" : "Two pages"}
                </button>
              ))}
            </div>
            <p className="text-xs text-neutral-500">The page is centered; on narrow or portrait screens one page is always shown.</p>
          </Row>
          <label className="flex items-center justify-between gap-4">
            <span>Justify text</span>
            <input type="checkbox" className="h-5 w-5 accent-teal-600" checked={s.justify} onChange={(e) => update({ justify: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>Use theme colors instead of the book's</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-teal-600"
              checked={s.overrideColors}
              onChange={(e) => update({ overrideColors: e.target.checked })}
            />
          </label>
        </>
      )}
      <p className="text-xs text-neutral-500">These settings sync to all your devices.</p>
    </div>
  );
}
