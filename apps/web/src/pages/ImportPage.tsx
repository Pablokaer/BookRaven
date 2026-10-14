import { BookOpen, Check, FileSpreadsheet, FolderOpen, Globe, HandHelping, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError, type PublicBook } from "../lib/api";
import { getBook } from "../lib/books";
import { fileSize } from "../lib/format";
import { matchGoodreads, parseGoodreads, readCalibreFolder, type CalibreBook, type GoodreadsMatch } from "../lib/importers";
import { updateBook } from "../lib/library";
import { useLibrary } from "../lib/libraryStore";
import { markFinished } from "../lib/progress";
import { addPublicBook, listPublicBooks } from "../lib/publicLibrary";
import { createRequest } from "../lib/requests";

function Option({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

const SHELF_LABEL: Record<string, string> = { read: "Read", "currently-reading": "Reading", "to-read": "To read" };

function ShelfBadge({ shelf }: { shelf: string }) {
  return <span className="shrink-0 rounded-full bg-fg/8 px-2 py-0.5 text-xs text-muted">{SHELF_LABEL[shelf] ?? shelf}</span>;
}

/** A titled, scrollable list of matched books. */
function Group({ title, icon, count, children }: { title: string; icon: ReactNode; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <details className="rounded-xl border border-line" open={count <= 30}>
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-medium [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-accent">
        {icon} {title} <span className="font-normal text-muted">{count}</span>
      </summary>
      <ul className="max-h-80 divide-y divide-line/60 overflow-y-auto border-t border-line">{children}</ul>
    </details>
  );
}

function GoodreadsImport() {
  const { books, refreshMe, replaceBook, me } = useLibrary();
  const [matches, setMatches] = useState<GoodreadsMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pub, setPub] = useState<PublicBook[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [finished, setFinished] = useState(true);
  const [shelfTags, setShelfTags] = useState(true);
  const [fiveStars, setFiveStars] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<number>>(new Set());

  useEffect(() => {
    listPublicBooks().then(setPub, () => setPub([]));
  }, []);

  const read = async (file: File) => {
    setError(null);
    setDone(null);
    try {
      const items = parseGoodreads(await file.text());
      if (!items.length) return setError("No books in this file.");
      const m = matchGoodreads(items, books ?? [], pub ?? []);
      setMatches(m);
      setPick(new Set(m.filter((x) => x.pub).map((x) => x.pub!.id)));
    } catch {
      setError("This doesn’t look like a Goodreads export. Use “Export Library” on Goodreads and choose the CSV file it gives you.");
    }
  };

  const own = matches?.filter((m) => m.own) ?? [];
  const available = matches?.filter((m) => m.pub) ?? [];
  const missing = matches?.filter((m) => !m.own && !m.pub) ?? [];

  const run = async () => {
    if (!matches) return;
    setDone(null);
    const todo = [...own.map((m) => ({ m, id: m.own!.id })), ...available.filter((m) => pick.has(m.pub!.id)).map((m) => ({ m, id: null as string | null }))];
    let added = 0;
    let updated = 0;
    let stop: string | null = null;
    for (const [i, t] of todo.entries()) {
      setRunning(`${i + 1} of ${todo.length}: ${t.m.item.title}`);
      try {
        let id = t.id;
        if (!id) {
          const copy = await addPublicBook(t.m.pub!.id);
          replaceBook(copy);
          id = copy.id;
          added++;
        }
        const tags = shelfTags ? t.m.item.shelves : [];
        const favorite = fiveStars && t.m.item.rating === 5;
        if (tags.length || favorite) {
          const current = t.m.own ?? (await getBook(id));
          const merged = [...new Set([...current.tags, ...tags])];
          replaceBook(await updateBook(id, { ...(tags.length ? { tags: merged } : {}), ...(favorite ? { favorite: true } : {}) }));
        }
        if (finished && t.m.item.shelf === "read") {
          await markFinished(id, t.m.item.dateRead ?? new Date());
          replaceBook(await getBook(id));
        }
        updated++;
      } catch (err) {
        if (err instanceof ApiError && err.status === 413) {
          stop = `Your library is full${me?.quotaBytes ? ` (${fileSize(me.quotaBytes)})` : ""}: the import stopped there.`;
          break;
        }
      }
    }
    setRunning(null);
    refreshMe();
    setDone(stop ?? `Done: ${added} ${added === 1 ? "book" : "books"} added from the Public Library, ${updated} updated.`);
  };

  const request = async (i: number, m: GoodreadsMatch) => {
    try {
      await createRequest({ title: m.item.title, author: m.item.author ?? undefined, note: "From my Goodreads shelves" });
      setRequested((s) => new Set(s).add(i));
    } catch {
      window.alert("Could not send the request (at most 10 a minute). Try again in a moment.");
    }
  };

  return (
    <section className="surface space-y-5 p-6" aria-labelledby="goodreads-heading">
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div>
          <h2 id="goodreads-heading" className="font-display text-xl font-semibold">
            Goodreads
          </h2>
          <p className="mt-1 text-sm text-muted">
            On Goodreads, open <span className="text-fg">My Books → Import and export → Export Library</span> and choose the CSV file here. Books are
            matched by title and author: the ones in your library get your shelves and “read” status, the ones in the Public Library can be added,
            and the rest can be requested.
          </p>
        </div>
      </div>

      <label className="btn-outline w-fit cursor-pointer">
        <Upload className="h-4 w-4" /> Choose the Goodreads CSV
        <input type="file" accept=".csv,text/csv" className="sr-only" disabled={pub === null} onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      </label>
      {error && <p className="text-sm text-rose-300">{error}</p>}

      {matches && (
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-semibold">{matches.length} books</span>
            <span className="text-muted">
              {" "}
              · {own.length} in your library · {available.length} in the Public Library · {missing.length} not available
            </span>
          </p>

          <div className="space-y-2">
            <Option checked={finished} onChange={setFinished}>
              Mark books on your <em>read</em> shelf as finished, on the day you read them
            </Option>
            <Option checked={shelfTags} onChange={setShelfTags}>
              Add your other Goodreads shelves as tags
            </Option>
            <Option checked={fiveStars} onChange={setFiveStars}>
              Make 5-star books favorites
            </Option>
          </div>

          <Group title="In your library" icon={<BookOpen />} count={own.length}>
            {own.map((m, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {m.own!.title} <span className="text-muted">· {m.own!.author ?? "Unknown author"}</span>
                </span>
                <ShelfBadge shelf={m.item.shelf} />
              </li>
            ))}
          </Group>

          <Group title="In the Public Library: add to your library" icon={<Globe />} count={available.length}>
            {available.map((m, i) => (
              <li key={i} className="px-4 py-2.5">
                <Option
                  checked={pick.has(m.pub!.id)}
                  onChange={(on) =>
                    setPick((s) => {
                      const next = new Set(s);
                      if (on) next.add(m.pub!.id);
                      else next.delete(m.pub!.id);
                      return next;
                    })
                  }
                >
                  <span className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      {m.pub!.title} <span className="text-muted">· {m.pub!.author ?? "Unknown author"}</span>
                    </span>
                    <ShelfBadge shelf={m.item.shelf} />
                  </span>
                </Option>
              </li>
            ))}
          </Group>

          <Group title="Not available here" icon={<HandHelping />} count={missing.length}>
            {matches.map((m, i) =>
              m.own || m.pub ? null : (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {m.item.title} <span className="text-muted">· {m.item.author ?? "Unknown author"}</span>
                  </span>
                  {requested.has(i) ? (
                    <span className="inline-flex items-center gap-1 text-xs text-accent">
                      <Check className="h-3.5 w-3.5" /> Requested
                    </span>
                  ) : (
                    <button className="btn-ghost py-1 text-xs" onClick={() => void request(i, m)}>
                      Request
                    </button>
                  )}
                </li>
              ),
            )}
          </Group>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn" disabled={!!running || (!own.length && !pick.size)} onClick={() => void run()}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {pick.size ? `Import (${pick.size} to add)` : "Import"}
            </button>
            {running && <span className="truncate text-sm text-muted">{running}</span>}
            {done && <span className="text-sm text-accent">{done}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function CalibreImport() {
  const { upload, addFolder, me, folders } = useLibrary();
  const inputRef = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<CalibreBook[] | null>(null);
  const [reading, setReading] = useState(false);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [withTags, setWithTags] = useState(true);
  const [withSeries, setWithSeries] = useState(true);
  const [collection, setCollection] = useState("calibre");
  const [started, setStarted] = useState(0);

  // React has no prop for folder pickers.
  useEffect(() => inputRef.current?.setAttribute("webkitdirectory", ""), []);

  const choose = async (files: FileList | null) => {
    if (!files?.length) return;
    setReading(true);
    setStarted(0);
    try {
      setFound(await readCalibreFolder(Array.from(files)));
      setSkip(new Set());
    } finally {
      setReading(false);
    }
  };

  const chosen = useMemo(() => found?.filter((_, i) => !skip.has(i)) ?? [], [found, skip]);
  const size = chosen.reduce((n, b) => n + b.file.size, 0);
  const room = me?.quotaBytes == null ? Infinity : me.quotaBytes - me.usedBytes;

  const start = async () => {
    const folder = collection === "none" ? null : collection === "calibre" ? await addFolder("Calibre") : (folders.find((f) => f.id === collection) ?? null);
    upload(
      chosen.map((b) => ({
        file: b.file,
        meta: { title: b.title, author: b.author ?? undefined, description: b.description ?? undefined, cover: b.cover ?? undefined },
        tags: [...(withTags ? b.tags : []), ...(withSeries && b.series ? [b.series] : [])],
      })),
      folder?.id ?? null,
    );
    setStarted(chosen.length);
  };

  return (
    <section className="surface space-y-5 p-6" aria-labelledby="calibre-heading">
      <div className="flex items-start gap-3">
        <FolderOpen className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div>
          <h2 id="calibre-heading" className="font-display text-xl font-semibold">
            Calibre
          </h2>
          <p className="mt-1 text-sm text-muted">
            Choose your Calibre library folder (the one with <span className="text-fg">metadata.db</span>). Each book is uploaded once, in the best
            format for reading here (EPUB first), with its title, author, description, tags, series and cover. Books already in your library are
            skipped. Needs a computer: phones can’t pick folders.
          </p>
        </div>
      </div>

      <label className="btn-outline w-fit cursor-pointer">
        {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} Choose the Calibre library folder
        <input ref={inputRef} type="file" multiple className="sr-only" onChange={(e) => void choose(e.target.files)} />
      </label>

      {found && found.length === 0 && <p className="text-sm text-muted">No books found in that folder.</p>}
      {found && found.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-semibold">
              {chosen.length} of {found.length} books
            </span>
            <span className="text-muted"> · {fileSize(size)}</span>
          </p>
          {size > room && (
            <p className="text-sm text-amber-300">
              That’s more than the space left in your library ({fileSize(Math.max(0, room))}). Uploads stop when it is full; leave some books out.
            </p>
          )}

          <div className="space-y-2">
            <Option checked={withTags} onChange={setWithTags}>
              Add Calibre’s tags
            </Option>
            <Option checked={withSeries} onChange={setWithSeries}>
              Add the series as a tag (e.g. “Discworld #8”)
            </Option>
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Put them in
              <select className="input py-1.5" value={collection} onChange={(e) => setCollection(e.target.value)}>
                <option value="calibre">a collection named “Calibre”</option>
                <option value="none">no collection</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    “{f.name}”
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Group title="Books" icon={<BookOpen />} count={found.length}>
            {found.map((b, i) => (
              <li key={i} className="px-4 py-2.5">
                <Option
                  checked={!skip.has(i)}
                  onChange={(on) =>
                    setSkip((s) => {
                      const next = new Set(s);
                      if (on) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                >
                  <span className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      {b.title} <span className="text-muted">· {b.author ?? "Unknown author"}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {b.file.name.split(".").pop()!.toUpperCase()} · {fileSize(b.file.size)}
                    </span>
                  </span>
                </Option>
              </li>
            ))}
          </Group>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn" disabled={!chosen.length || started > 0} onClick={() => void start()}>
              <Upload className="h-4 w-4" /> Upload {chosen.length} {chosen.length === 1 ? "book" : "books"}
            </button>
            {started > 0 && (
              <span className="text-sm text-muted">
                Uploading {started} books: follow them in the upload panel, or in <Link to="/uploads" className="text-accent hover:underline">Uploads</Link>.
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** "/import" — bring in a library from Goodreads (shelves, read books) or Calibre (the files). */
export function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Import from other apps</h1>
        <p className="mt-1.5 text-sm text-muted">Bring your reading history from Goodreads or your books from Calibre. Everything is read on this device.</p>
      </header>
      <GoodreadsImport />
      <CalibreImport />
    </div>
  );
}
