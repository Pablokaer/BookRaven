import { BookA, ExternalLink, Languages, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dictionaryTarget,
  LANGUAGES,
  lookupWord,
  translate,
  WORD_LANGUAGES,
  wordLanguageName,
  type Translation,
  type WordLanguage,
  type WordLookup,
} from "../lib/lookup";
import { useSettings } from "../lib/settings";

/** Floating card with the dictionary entry of a selected word, or a translation of the selected text. */
export function LookupCard({
  mode,
  text,
  bookLanguage,
  rect,
  onClose,
}: {
  mode: "dictionary" | "translate";
  text: string;
  bookLanguage: string | null;
  rect: DOMRect;
  onClose: () => void;
}) {
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
    <div className="fixed z-50 max-h-[60vh] animate-pop overflow-y-auto rounded-2xl border border-line bg-card p-4 text-fg shadow-pop" style={style} role="dialog" aria-label={mode === "dictionary" ? "Dictionary" : "Translation"}>
      <div className="mb-2 flex items-center gap-2">
        {mode === "dictionary" ? <BookA className="h-4 w-4 text-accent" /> : <Languages className="h-4 w-4 text-accent" />}
        <span className="eyebrow">{mode === "dictionary" ? "Dictionary" : "Translation"}</span>
        <button className="icon-btn -mr-2 ml-auto h-7 w-7" aria-label="Close" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {mode === "dictionary" ? <WordEntry word={text.trim().split(/\s+/)[0]!} bookLanguage={bookLanguage} /> : <TextTranslation text={text} />}
    </div>
  );
}

const Loading = () => (
  <div className="flex items-center gap-2 py-3 text-sm text-muted">
    <Loader2 className="h-4 w-4 animate-spin" /> Looking it up…
  </div>
);

const selectClass = "rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-fg";

/** The word's language (detected, or picked among the ones it exists in), its translation and definitions. */
function WordEntry({ word, bookLanguage }: { word: string; bookLanguage: string | null }) {
  const { settings, update } = useSettings();
  const to = WORD_LANGUAGES.some(([c]) => c === settings.dictionaryTo) ? settings.dictionaryTo : dictionaryTarget(settings.translateTo);
  const [from, setFrom] = useState<WordLanguage>();
  const [state, setState] = useState<{ loading: boolean; error?: boolean; result?: WordLookup }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: false }));
    lookupWord(word, { to, book: bookLanguage, from })
      .then((result) => !cancelled && setState({ loading: false, result }))
      .catch(() => !cancelled && setState({ loading: false, error: true }));
    return () => {
      cancelled = true;
    };
  }, [word, bookLanguage, to, from]);

  const r = state.loading || state.error ? undefined : state.result;
  return (
    <div className="space-y-3">
      <div>
        <div className="font-display text-xl font-semibold">{r?.word ?? word}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
          <span>{r ? (r.from ? wordLanguageName(r.from) : "Language not recognized") : "…"}</span>
          <span aria-hidden>→</span>
          <select className={selectClass} aria-label="Translate into" value={to} onChange={(e) => update({ dictionaryTo: e.target.value as WordLanguage })}>
            {WORD_LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {state.loading ? (
        <Loading />
      ) : state.error || !r ? (
        <p className="py-2 text-sm text-rose-300">The dictionary is not available right now.</p>
      ) : (
        <>
          {r.sameLanguage ? (
            <p className="text-sm text-muted">
              “{r.word}” is already in {wordLanguageName(to)}. Choose another language to translate into.
            </p>
          ) : r.translation ? (
            <p className="text-base font-medium leading-relaxed">{r.translation}</p>
          ) : r.entries.length ? (
            <p className="text-sm text-muted">No translation available.</p>
          ) : (
            <p className="text-sm text-muted">No entry found for “{r.word}”.</p>
          )}

          {r.alternatives.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span>Also in</span>
              {r.alternatives.map((lang) => (
                <button key={lang} className="rounded-full border border-line px-2 py-0.5 text-fg hover:border-accent hover:text-accent" onClick={() => setFrom(lang)}>
                  {wordLanguageName(lang)}
                </button>
              ))}
            </div>
          )}

          {r.entries.map((e, i) => (
            <div key={i}>
              <div className="text-xs italic text-muted">{e.partOfSpeech}</div>
              <ol className="ml-4 list-decimal space-y-1 text-sm leading-relaxed">
                {e.definitions.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ol>
            </div>
          ))}

          {r.url ? (
            <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
              {r.source} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            r.source && <div className="text-xs text-muted">{r.source}</div>
          )}
        </>
      )}
    </div>
  );
}

function TextTranslation({ text }: { text: string }) {
  const { settings, update } = useSettings();
  const [state, setState] = useState<{ loading: boolean; error?: boolean; tr?: Translation }>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    translate(text.slice(0, 1000), settings.translateTo)
      .then((tr) => !cancelled && setState({ loading: false, tr }))
      .catch(() => !cancelled && setState({ loading: false, error: true }));
    return () => {
      cancelled = true;
    };
  }, [text, settings.translateTo]);

  if (state.loading) return <Loading />;
  if (state.error) return <p className="py-2 text-sm text-rose-300">Translation is not available right now.</p>;
  return (
    <div className="space-y-3">
      {state.tr?.sameLanguage ? (
        <p className="text-sm text-muted">This text is already in that language. Choose another language to translate into:</p>
      ) : (
        <p className="text-sm leading-relaxed">{state.tr?.text}</p>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{state.tr?.source}</span>
        <select className={selectClass} aria-label="Translate into" value={settings.translateTo} onChange={(e) => update({ translateTo: e.target.value })}>
          {LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
