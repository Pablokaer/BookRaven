/**
 * Runs `fn` when the browser has a quiet moment, at least `delay` ms from now and at most about
 * `timeout` ms after that (right after `delay` where requestIdleCallback is missing, as in older
 * Safari). Returns a function that cancels it.
 */
export function afterIdle(fn: () => void, { delay = 0, timeout = 2000 }: { delay?: number; timeout?: number } = {}) {
  let handle: number | undefined;
  const timer = setTimeout(() => {
    if (typeof requestIdleCallback === "function") handle = requestIdleCallback(() => fn(), { timeout });
    else fn();
  }, delay);
  return () => {
    clearTimeout(timer);
    if (handle !== undefined) cancelIdleCallback(handle);
  };
}
