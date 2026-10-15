/**
 * Changes made on this device that still have to reach the server (bookmarks, handwriting;
 * reading progress uses the same response rules).
 *  - A change is stored first, so it survives going offline and closing the app.
 *  - Changes are sent in order; a failure stops the queue until the next attempt, so a later
 *    change never overtakes an earlier one.
 *  - Network errors, 401, 408, 429 and 5xx are tried again after a growing delay (429 waits
 *    as long as the server's Retry-After asks). Other refusals (400, 403, 409, 413…) can never
 *    succeed, so the change is dropped and `onRejected` lets the app show the server's state again.
 */

export type Outcome = "done" | "retry" | "rejected";

/** What a response means for the change that was sent. */
export function settle(status: number): Outcome {
  // 404: the book is gone, so there is nothing left to sync.
  if ((status >= 200 && status < 300) || status === 404) return "done";
  if (status === 401 || status === 408 || status === 429 || status >= 500) return "retry";
  return "rejected";
}

/** Wait before retry number `attempt` (1, 2, …): 2 s doubling up to 5 min, or what the server asked. */
export function retryDelay(attempt: number, retryAfter?: string | null) {
  const asked = retryAfter ? Number(retryAfter) * 1000 : NaN;
  if (Number.isFinite(asked) && asked > 0) return Math.min(asked, 10 * 60_000);
  return Math.min(2000 * 2 ** (Math.max(1, attempt) - 1), 5 * 60_000);
}

/** A stored change: `seq` orders the queue and names the change in storage. */
export type Queued<T> = T & { seq: number };

export type OutboxStore<T> = {
  load(): Promise<Queued<T>[]>;
  add(item: Queued<T>): Promise<void>;
  remove(items: Queued<T>[]): Promise<void>;
};

/** Keeps changes in memory only (tests, or browsers without storage). */
export function memoryStore<T>(): OutboxStore<T> {
  let items: Queued<T>[] = [];
  return {
    load: async () => [...items],
    add: async (item) => void (items = [...items, item]),
    remove: async (gone) => void (items = items.filter((i) => !gone.includes(i))),
  };
}

/**
 * The whole queue as one localStorage value: right for a few small changes (bookmarks).
 * `legacy` turns what an older version stored into queue items, once.
 */
export function localStorageStore<T>(key: string, legacy?: { key: string; convert: (value: unknown) => T[] }): OutboxStore<T> {
  const read = (): Queued<T>[] => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {
      return [];
    }
  };
  const write = (items: Queued<T>[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {
      /* storage full or blocked: the changes stay in memory for this session */
    }
  };
  return {
    load: async () => {
      let items = read();
      if (legacy) {
        try {
          const old = localStorage.getItem(legacy.key);
          if (old) {
            const converted = legacy.convert(JSON.parse(old)).map((c, i) => ({ ...c, seq: i + 1 }) as Queued<T>);
            items = [...converted, ...items];
            write(items);
            localStorage.removeItem(legacy.key);
          }
        } catch {
          /* unreadable: nothing to bring over */
        }
      }
      return items;
    },
    add: async (item) => write([...read(), item]),
    remove: async (gone) => {
      const seqs = new Set(gone.map((i) => i.seq));
      write(read().filter((i) => !seqs.has(i.seq)));
    },
  };
}

/**
 * One Cache Storage entry per change: adding or sending a change costs the same however long
 * the queue is, and there is room for a lot of handwriting.
 */
export function cacheStore<T>(cacheName: string, prefix: string, legacy?: () => Promise<T[]>): OutboxStore<T> {
  if (typeof caches === "undefined") return memoryStore<T>();
  const url = (seq: number) => `${prefix}${seq}`;
  let chain: Promise<unknown> = Promise.resolve();
  /** Storage operations run in call order. */
  const run = <R>(op: (cache: Cache) => Promise<R>) => {
    const next = chain.then(async () => op(await caches.open(cacheName)));
    chain = next.catch(() => {});
    return next;
  };
  return {
    load: () =>
      run(async (cache) => {
        const items: Queued<T>[] = [];
        for (const req of await cache.keys()) {
          if (!new URL(req.url).pathname.startsWith(prefix)) continue;
          const res = await cache.match(req);
          if (res) items.push(await res.json());
        }
        if (legacy) {
          const old = await legacy().catch(() => [] as T[]);
          old.forEach((c, i) => items.push({ ...c, seq: i + 1 } as Queued<T>));
          for (const item of items.filter((i) => i.seq <= old.length)) await cache.put(url(item.seq), new Response(JSON.stringify(item)));
        }
        return items.sort((a, b) => a.seq - b.seq);
      }).catch(() => [] as Queued<T>[]),
    add: (item) => run((cache) => cache.put(url(item.seq), new Response(JSON.stringify(item), { headers: { "Content-Type": "application/json" } }))).catch(() => {}),
    remove: (gone) => run(async (cache) => void (await Promise.all(gone.map((i) => cache.delete(url(i.seq)))))).catch(() => {}),
  };
}

export type Outbox<T> = {
  /** Queues a change and starts sending. Synchronous: `pending()` includes it right away. */
  push(item: T): Queued<T>;
  /** Changes not yet accepted by the server, oldest first. */
  pending(): Queued<T>[];
  /** Sends what is waiting; resolves when the queue is empty or must wait. */
  flush(): Promise<void>;
  /** Resolves once the changes stored by earlier sessions are loaded. */
  ready: Promise<void>;
};

export function createOutbox<T>(options: {
  store: OutboxStore<T>;
  /** Sends `items` in one request. */
  send(items: Queued<T>[]): Promise<Response>;
  /** How many changes from the front of the queue go in one request (default 1). */
  batch?(queue: Queued<T>[]): number;
  /** Changes with the same key replace each other while they wait (the newest wins). */
  key?(item: T): string;
  /** A waiting change being replaced: what to keep of it (default: just the newer one). */
  combine?(older: T, newer: T): T;
  /** The server refused these changes for good (they are already out of the queue). */
  onRejected?(items: Queued<T>[], status: number): void;
}): Outbox<T> {
  let queue: Queued<T>[] = [];
  const sending = new Set<number>();
  let lastSeq = 0;
  // Unique and increasing across sessions (stored changes from earlier sessions sort first).
  const nextSeq = () => (lastSeq = Math.max(lastSeq + 1, Date.now() * 1000));

  /** Removes waiting changes with `item`'s key; returns `item` combined with the newest of them. */
  const replaceSameKey = (item: T): T => {
    if (!options.key) return item;
    const k = options.key(item);
    const stale = queue.filter((q) => !sending.has(q.seq) && options.key!(q) === k);
    if (!stale.length) return item;
    queue = queue.filter((q) => !stale.includes(q));
    void ready.then(() => options.store.remove(stale));
    return options.combine ? options.combine(stale.at(-1)!, item) : item;
  };

  const ready = options.store.load().then((stored) => {
    lastSeq = Math.max(lastSeq, ...stored.map((s) => s.seq));
    // Changes queued before the stored ones were loaded are newer: they win on the same key.
    const newer = new Set(options.key ? queue.map((q) => options.key!(q)) : []);
    const outdated = stored.filter((s) => options.key && newer.has(options.key(s)));
    if (outdated.length) void options.store.remove(outdated);
    queue = [...stored.filter((s) => !outdated.includes(s)), ...queue].sort((a, b) => a.seq - b.seq);
  }).catch(() => {}); // unreadable storage: carry on with this session's changes

  let flushing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  const retryLater = (retryAfter?: string | null) => {
    attempt++;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, retryDelay(attempt, retryAfter));
  };

  async function sendAll() {
    await ready;
    while (queue.length) {
      const n = Math.max(1, Math.min(queue.length, options.batch?.(queue) ?? 1));
      const items = queue.slice(0, n);
      items.forEach((i) => sending.add(i.seq));
      let res: Response | null = null;
      try {
        res = await options.send(items);
      } catch {
        res = null; // offline
      } finally {
        items.forEach((i) => sending.delete(i.seq));
      }
      const outcome = res ? settle(res.status) : "retry";
      if (outcome === "retry") return retryLater(res?.headers.get("Retry-After"));
      attempt = 0;
      queue = queue.filter((q) => !items.includes(q));
      await options.store.remove(items);
      if (outcome === "rejected") options.onRejected?.(items, res!.status);
    }
  }

  function flush(): Promise<void> {
    // .finally runs after `flushing` is set, even when there is nothing to send.
    flushing ??= sendAll().finally(() => {
      flushing = null;
      // A change queued just as the round ended: send it now (unless a retry is already planned).
      if (queue.length && !timer) void flush();
    });
    return flushing;
  }

  return {
    push(change) {
      const item = { ...replaceSameKey(change), seq: nextSeq() } as Queued<T>;
      queue.push(item);
      void ready.then(() => options.store.add(item));
      void flush();
      return item;
    },
    pending: () => queue,
    flush,
    ready,
  };
}
