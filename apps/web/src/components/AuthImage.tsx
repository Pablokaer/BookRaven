import { useEffect, useRef, useState } from "react";
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

/**
 * <img> for authenticated URLs (works with cookies on web and bearer tokens in the app).
 * The image is only fetched when it comes near the screen, so long lists stay light.
 */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (near) return;
    const el = holder.current;
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    void load(path).then((url) => !cancelled && setSrc(url));
    return () => {
      cancelled = true;
    };
  }, [path, near]);

  if (!src) return <span ref={holder} className={className} aria-hidden="true" />;
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />;
}
