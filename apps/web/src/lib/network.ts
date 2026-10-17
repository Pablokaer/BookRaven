/** What the browser says about the connection (Chrome and Android WebViews; others say nothing). */
type Connection = { saveData?: boolean; type?: string };
const connection = () => (navigator as Navigator & { connection?: Connection }).connection;

/** The reader asked to use less data (Android's Data Saver, Chrome's Lite mode). */
export const saveData = () => !!connection()?.saveData;

/**
 * On Wi-Fi or a cable, where downloading ahead costs nothing. Browsers that don't say which
 * network they use count as unmetered on computers (a fine pointer) and metered on phones.
 */
export function onUnmeteredNetwork() {
  const c = connection();
  if (!navigator.onLine || c?.saveData) return false;
  if (c?.type) return c.type === "wifi" || c.type === "ethernet";
  return typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;
}
