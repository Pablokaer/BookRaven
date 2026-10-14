import { BookA, ExternalLink, Languages, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { define, LANGUAGES, translate, type DictionaryResult, type Translation } from "../lib/lookup";
import { useSettings } from "../lib/settings";

/** Floating card with a dictionary definition or a translation of the selected text. */
export function LookupCard({
  mode,
  text,
  bookLanguage,
  rect,
  onClose,
}: {
  mode: "define" | "translate";
  text: string;
  bookLanguage: string | null;
  rect: DOMRect;
  onClose: () => void;
}) {
  const { settings, update } = useSettings();
  const [state, setState] = useState<{ loading: boolean; error?: string; def?: DictionaryResult | null; tr?: Translation }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    const job =
      mode === "define"
        ? define(text.split(/\s+/)[0]!, bookLanguage).then((def) => ({ loading: false, def }))
        : translate(text.slice(0, 1000), bookLanguage, settings.translateTo).then((tr) => ({ loading: false, tr }));
    job
      .then((s) => !cancelled && setState(s))
      .catch(() => !cancelled && setState({ loading: false, error: mode === "define" ? "The dictionary is not available right now." : "Translation is not available right now." }));
    return () => {
      cancelled = true;
    };
  }, [mode, text, bookLanguage, settings.translateTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const width = Math.min(380, window.innerWidth - 16);
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const below = rect.bottom + 12 + 260 < window.innerHeight;
  const style = below ? { left, top: rect.bottom + 12, width } : { left, bottom: window.innerHeight - rect.top + 12, width };

  return (
    <div className="fixed z-50 max-h-[60vh] animate-pop overflow-y-auto rounded-2xl border border-line bg-card p-4 text-fg shadow-pop" style={style} role="dialog" aria-label={mode === "define" ? "Definition" : "Translation"}>
      <div className="mb-2 flex items-center gap-2">
        {mode === "define" ? <BookA className="h-4 w-4 text-accent" /> : <Languages className="h-4 w-4 text-accent" />}
        <span className="eyebrow">{mode === "define" ? "Dictionary" : "Translation"}</span>
        <button className="icon-btn -mr-2 ml-auto h-7 w-7" aria-label="Close" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {state.loading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Looking it up…
        </div>
      ) : state.error ? (
        <p className="py-2 text-sm text-rose-300">{state.error}</p>
      ) : mode === "define" ? (
        state.def ? (
          <div className="space-y-3">
            <div>
              <span className="font-display text-xl font-medium">{state.def.word}</span>
              {state.def.language && <span className="ml-2 text-xs text-muted">{state.def.language}</span>}
            </div>
            {state.def.entries.map((e, i) => (
              <div key={i}>
                <div className="text-xs italic text-muted">{e.partOfSpeech}</div>
                <ol className="ml-4 list-decimal space-y-1 text-sm leading-relaxed">
                  {e.definitions.map((d, j) => (
                    <li key={j}>{d}</li>
                  ))}
                </ol>
              </div>
            ))}
            <a href={state.def.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
              {state.def.source} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <p className="py-2 text-sm text-muted">No definition found for “{text.split(/\s+/)[0]}”.</p>
        )
      ) : (
        <div className="space-y-3">
          {state.tr?.sameLanguage ? (
            <p className="text-sm text-muted">This text is already in that language. Choose another language to translate into:</p>
          ) : (
            <p className="text-sm leading-relaxed">{state.tr?.text}</p>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>{state.tr?.source}</span>
            <select
              className="rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-fg"
              aria-label="Translate into"
              value={settings.translateTo}
              onChange={(e) => update({ translateTo: e.target.value })}
            >
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
