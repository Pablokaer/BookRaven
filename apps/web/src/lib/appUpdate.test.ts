import { describe, expect, it } from "vitest";
import { planUpdate, type AndroidRelease } from "./appUpdate";

const release: AndroidRelease = {
  versionCode: 40,
  versionName: "1.40",
  nativeVersion: "native-b",
  apk: "/downloads/bookraven-1.40.apk",
  apkSize: 10_000_000,
  bundle: { id: "bundle-2", url: "/downloads/bundles/bundle-2.zip", sha256: "00" },
  publishedAt: "2026-10-14T12:00:00Z",
};

describe("planUpdate", () => {
  it("does nothing when the app already runs the published bundle", () => {
    expect(planUpdate(release, { versionCode: 40, nativeVersion: "native-b", bundleVersion: "bundle-2" })).toBe("none");
  });

  it("takes a newer web bundle as a live update when the native layer is the same", () => {
    expect(planUpdate(release, { versionCode: 35, nativeVersion: "native-b", bundleVersion: "bundle-1" })).toBe("bundle");
  });

  it("asks for a new APK when the native layer changed", () => {
    expect(planUpdate(release, { versionCode: 35, nativeVersion: "native-a", bundleVersion: "bundle-1" })).toBe("apk");
  });

  it("never offers an older APK", () => {
    expect(planUpdate(release, { versionCode: 41, nativeVersion: "native-c", bundleVersion: "bundle-3" })).toBe("none");
  });
});
