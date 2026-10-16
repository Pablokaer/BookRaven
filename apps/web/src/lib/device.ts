import { readString, writeString } from "./storage";

/** A stable random id per browser/app install, plus a human-friendly name. */
const KEY = "readsync.deviceId";

export const deviceId: string = (() => {
  let id = readString(KEY);
  if (!id) {
    id = crypto.randomUUID();
    writeString(KEY, id);
  }
  return id;
})();

export const deviceName: string = (() => {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Linux/i.test(ua)) return "Linux PC";
  return "Browser";
})();
