import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReaderHandle, SearchResult } from "./types";

/** Results listed at first, and added by each "Show more": a frequent word can match tens of thousands of times. */
const PAGE_SIZE = 200;
/** The count and list refresh at most this often while searching, so long books stay responsive. */
const REFRESH_MS = 150;

/** Full-text search in the open book. */
export function SearchPanel({ reader, onSelect, onClose }: { reader: ReaderHandle | null; onSelect: (r: SearchResult) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  /** Every match found so far; the list shows the first `shown`. */
  const found = useRef<SearchResult[]>([]);
  const [, setRefreshed] = useState(0);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [running, setRunning] = useState(false);
  const [searched, setSearched] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2 || !reader?.search) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const results: SearchResult[] = [];
    found.current = results;
    setShown(PAGE_SIZE);
    setRefreshed((n) => n + 1);
    setRunning(true);
    setSearched(q);
    let last = 0;
    try {
      await reader.search(
        q,
        (r) => {
          results.push(r);
          const now = performance.now();
          if (now - last > REFRESH_MS) {
            last = now;
            setRefreshed((n) => n + 1);
          }
        },
        ctrl.signal,
      );
    } finally {
      if (!ctrl.signal.aborted) {
        setRefreshed((n) => n + 1);
        setRunning(false);
      }
    }
  };

  const count = found.current.length;
  const list = found.current.slice(0, shown);

  return (
    <div className="panel left-0 w-full max-w-sm" role="dialog" aria-label="Search in book">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Search</h2>
        <button
          className="btn-icon"
          onClick={() => {
            abort.current?.abort();
            reader?.clearSearch?.();
            onClose();
          }}
          aria-label="Close search"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={run} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
        <input
          autoFocus
          type="search"
          className="w-full rounded-lg border border-neutral-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-600 dark:border-neutral-700"
          placeholder="Words or a phrase…"
          aria-label="Search in this book"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      {searched && (
        <p className="flex items-center gap-2 text-xs opacity-60">
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {count.toLocaleString()} result{count === 1 ? "" : "s"} for “{searched}”{running ? "…" : ""}
        </p>
      )}
      <ul className="space-y-1">
        {list.map((r, i) => (
          <li key={`${r.locator}-${i}`}>
            <button className="w-full rounded-md px-3 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => onSelect(r)}>
              {r.label && <span className="mb-0.5 block truncate text-[11px] font-medium uppercase tracking-wide opacity-50">{r.label}</span>}
              <span className="text-sm leading-snug">
                …{r.excerpt.pre}
                <mark className="rounded bg-amber-300/60 px-0.5 text-inherit">{r.excerpt.match}</mark>
                {r.excerpt.post}…
              </span>
            </button>
          </li>
        ))}
      </ul>
      {count > list.length && (
        <button className="w-full rounded-md py-2 text-sm font-medium text-teal-700 hover:bg-neutral-100 dark:text-teal-300 dark:hover:bg-neutral-800" onClick={() => setShown((n) => n + PAGE_SIZE)}>
          Show more ({(count - list.length).toLocaleString()} left)
        </button>
      )}
    </div>
  );
}
