import { describe, expect, it } from "vitest";
import { deviceName, duration } from "./AdminAccountPage";

describe("an account's page in Admin", () => {
  it("names devices from their user agent", () => {
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36")).toEqual({
      label: "Chrome on Windows",
      kind: "computer",
    });
    expect(deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0 Mobile Safari/537.36")).toEqual({
      label: "Android app",
      kind: "phone",
    });
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1").label).toBe(
      "Safari on iPhone",
    );
    expect(deviceName(null).label).toBe("Unknown device");
  });

  it("writes reading time briefly", () => {
    expect(duration(0)).toBe("0 min");
    expect(duration(20)).toBe("under a minute");
    expect(duration(45 * 60)).toBe("45 min");
    expect(duration(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(duration(2 * 3600)).toBe("2 h");
  });
});
