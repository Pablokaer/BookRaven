import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

/**
 * Object URLs per path. Covers never change for a given URL, and the same cover is
 * shown in several places at once (dashboard, grid, sidebar), so fetch each only once.
 */
const cache = new Map<string, Promise<string | null>>();

function load(path: string) {
  let p = cache.get(path);
  if (!p) {
    p = apiFetch(path)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => {
        cache.delete(path); // retry next time
        return null;
      });
    cache.set(path, p);
  }
  return p;
}

/** <img> for authenticated URLs (works with cookies on web and bearer tokens in the app). */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void load(path).then((url) => !cancelled && setSrc(url));
    return () => {
      cancelled = true;
    };
  }, [path]);

  return src ? <img src={src} alt={alt} className={className} loading="lazy" decoding="async" /> : null;
}
