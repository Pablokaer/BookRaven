/**
 * Object URLs of images shown in several places at once (a cover on the dashboard, in the grid
 * and in the sidebar): each is fetched once while in use. Once no longer shown it is kept for a
 * while, and past `limit` such images the oldest are released (their URLs revoked).
 */
type Entry = { url: Promise<string | null>; users: number };

export class ObjectUrlCache {
  private entries = new Map<string, Entry>();

  constructor(
    private load: (key: string) => Promise<Blob | null>,
    private limit: number,
  ) {}

  /** The object URL for `key` (null when there is no image); `release()` once it is no longer shown. */
  acquire(key: string) {
    const entry = this.entries.get(key) ?? this.create(key);
    this.entries.delete(key); // most recently used last
    this.entries.set(key, entry);
    entry.users++;
    let released = false;
    return {
      url: entry.url,
      release: () => {
        if (released) return;
        released = true;
        entry.users--;
        this.trim();
      },
    };
  }

  private create(key: string) {
    const entry: Entry = { url: Promise.resolve(null), users: 0 };
    entry.url = this.load(key)
      .then((blob) => (blob ? URL.createObjectURL(blob) : null))
      .catch(() => {
        if (this.entries.get(key) === entry) this.entries.delete(key); // try again next time
        return null;
      });
    return entry;
  }

  private trim() {
    let unused = 0;
    for (const e of this.entries.values()) if (!e.users) unused++;
    for (const [key, e] of this.entries) {
      if (unused <= this.limit) return;
      if (e.users) continue;
      this.entries.delete(key);
      unused--;
      void e.url.then((url) => url && URL.revokeObjectURL(url));
    }
  }
}
