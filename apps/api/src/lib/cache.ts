/**
 * A small in-memory cache whose entries expire; past `max` entries the oldest goes. Fine for the
 * single API process (see events.ts).
 *
 * Forgetting entries bumps `version`. A value read from the database before that (a session being
 * revoked meanwhile, say) must not be stored afterwards: `set` skips it when given the version
 * read before the lookup.
 */
export class TtlCache<V> {
  private entries = new Map<string, { value: V; expires: number }>();
  private current = 0;

  constructor(private readonly max: number) {}

  get version() {
    return this.current;
  }

  get(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.expires > Date.now()) return entry.value;
    if (entry) this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: V, ttlMs: number, version = this.current) {
    if (version !== this.current || ttlMs <= 0) return;
    this.entries.delete(key); // moves it last
    this.entries.set(key, { value, expires: Date.now() + ttlMs });
    if (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!);
  }

  /** Drops every entry `match` picks (e.g. all of one account's). */
  forget(match: (value: V, key: string) => boolean) {
    this.current++;
    for (const [key, entry] of this.entries) if (match(entry.value, key)) this.entries.delete(key);
  }
}
