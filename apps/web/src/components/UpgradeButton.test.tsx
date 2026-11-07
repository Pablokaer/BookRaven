import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me } from "../lib/api";

const env = vi.hoisted(() => ({
  billingEnabled: true,
  me: null as Me | null,
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  serverConfig: async () => ({ billingEnabled: env.billingEnabled }),
}));
vi.mock("../lib/libraryStore", () => ({ useLibrary: () => ({ me: env.me }) }));

const { UpgradeButton } = await import("./UpgradeButton");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

async function draw(place: "topbar" | "sidebar") {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <UpgradeButton place={place} />
      </MemoryRouter>,
    ),
  );
  await act(async () => {}); // the server's settings
}
const link = () => container.querySelector<HTMLAnchorElement>("a");

beforeEach(() => {
  env.billingEnabled = true;
  env.me = { isAdmin: false, usedBytes: 0, quotaBytes: 800 * 1024 * 1024, plan: null };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Upgrade button", () => {
  it("leads a free account to the storage plans, in the top bar and the sidebar", async () => {
    await draw("topbar");
    expect(link()?.getAttribute("href")).toBe("/profile#plans");
    expect(link()?.textContent).toContain("Upgrade");
    act(() => root.unmount());
    container.remove();
    await draw("sidebar");
    expect(link()?.textContent).toContain("Upgrade storage");
  });

  it("is not shown with a plan, to administrators, or when the server sells no plans", async () => {
    env.me = { isAdmin: false, usedBytes: 0, quotaBytes: 2 * 1024 ** 3, plan: "shelf" };
    await draw("topbar");
    expect(link()).toBeNull();
    act(() => root.unmount());
    container.remove();

    env.me = { isAdmin: true, usedBytes: 0, quotaBytes: null, plan: null };
    await draw("topbar");
    expect(link()).toBeNull();
    act(() => root.unmount());
    container.remove();

    env.me = { isAdmin: false, usedBytes: 0, quotaBytes: 800 * 1024 * 1024, plan: null };
    env.billingEnabled = false;
    await draw("sidebar");
    expect(link()).toBeNull();
  });
});
