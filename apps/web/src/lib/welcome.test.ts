import { describe, expect, it } from "vitest";
import { createdAtMs, shouldWelcome, WELCOME_DAYS } from "./welcome";

const now = Date.parse("2026-11-10T12:00:00Z");
const day = 86_400_000;

describe("welcome tour", () => {
  it("greets a new account once", () => {
    expect(shouldWelcome(now - 60_000, false, now)).toBe(true);
    expect(shouldWelcome(now - 60_000, true, now)).toBe(false);
  });

  it("leaves older accounts alone", () => {
    expect(shouldWelcome(now - (WELCOME_DAYS - 1) * day, false, now)).toBe(true);
    expect(shouldWelcome(now - WELCOME_DAYS * day, false, now)).toBe(false);
    expect(shouldWelcome(now - 365 * day, false, now)).toBe(false);
  });

  it("stays quiet when the creation date is unknown (offline Android start)", () => {
    expect(shouldWelcome(null, false, now)).toBe(false);
  });

  it("reads the session's creation date as a Date or a string", () => {
    expect(createdAtMs(new Date(now))).toBe(now);
    expect(createdAtMs("2026-11-10T12:00:00.000Z")).toBe(now);
    expect(createdAtMs(undefined)).toBeNull();
    expect(createdAtMs("not a date")).toBeNull();
  });
});
