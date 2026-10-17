import { useEffect, useRef, useState } from "react";
import { apiFetch, isNative, openApiCache } from "../lib/api";
import { ObjectUrlCache } from "../lib/objectUrls";

/** A book's own cover never changes: the Android app keeps it for offline use, as the service worker does on the web. */
const OWN_COVER = /^\/api\/books\/[^/]+\/cover$/;

async function load(path: string) {
  const cache = isNative && OWN_COVER.test(path) ? await openApiCache() : null;
  const kept = await cache?.match(path).catch(() => undefined);
  if (kept) return kept.blob();
  const res = await apiFetch(path);
  if (!res.ok) return null;
  if (cache) void cache.put(path, res.clone()).catch(() => {});
  return res.blob();
}

/**
 * Object URLs per path. Covers never change for a given URL, and the same cover is shown in
 * several places at once (dashboard, grid, sidebar), so each is fetched only once; up to 150
 * covers no longer shown stay ready, older ones are released.
 */
const images = new ObjectUrlCache(load, 150);

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
    const image = images.acquire(path);
    void image.url.then((url) => !cancelled && setSrc(url));
    return () => {
      cancelled = true;
      image.release();
    };
  }, [path, near]);

  if (!src) return <span ref={holder} className={className} aria-hidden="true" />;
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />;
}
