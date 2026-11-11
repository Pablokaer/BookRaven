import { readString, writeString } from "./storage";

/**
 * The welcome tour: a short introduction to what BookRaven does (uploading books, syncing every
 * device, sharing by link), shown once to a new account. "New" is read from when the account was
 * created, so it also works after signing up with Google or confirming the email address on
 * another tab; accounts older than this never see it.
 */
export const WELCOME_DAYS = 7;

const key = (userId: string) => `readsync.welcomeSeen.${userId}`;

/** Whether to show the tour: the account is recent and this device hasn't shown it to them yet. */
export function shouldWelcome(createdAt: number | null, seen: boolean, now = Date.now()): boolean {
  if (seen || !createdAt || Number.isNaN(createdAt)) return false;
  return now - createdAt < WELCOME_DAYS * 86_400_000;
}

export const welcomeSeen = (userId: string) => readString(key(userId)) != null;

/** Remembers that the tour was shown (storage blocked: it may show again next time). */
export const markWelcomeSeen = (userId: string) => writeString(key(userId), "1");

/** Milliseconds since the epoch from the session's createdAt (a Date or an ISO string), or null. */
export function createdAtMs(value: unknown): number | null {
  if (value instanceof Date || typeof value === "string" || typeof value === "number") {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}
