import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Billing } from "./StoragePlans";

const env = vi.hoisted(() => ({
  billing: null as unknown as Billing,
  posts: [] as { path: string; body: unknown }[],
  refreshMe: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiJson: async (path: string, init?: RequestInit) => {
    if (path === "/api/billing") return env.billing;
    env.posts.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    return { url: "https://checkout.stripe.com/c/pay/test" };
  },
  apiOk: async (path: string, init?: RequestInit) => {
    env.posts.push({ path, body: JSON.parse(String(init?.body)) });
  },
}));
vi.mock("../lib/libraryStore", () => ({ useLibrary: () => ({ refreshMe: env.refreshMe }) }));

const { StoragePlans } = await import("./StoragePlans");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GB = 1024 ** 3;
const PLANS = [
  { id: "shelf", name: "Shelf", bytes: 2 * GB, month: 399, year: 3990 },
  { id: "reader", name: "Reader", bytes: 5 * GB, month: 599, year: 5990 },
  { id: "library", name: "Library", bytes: 10 * GB, month: 799, year: 7990 },
];

let root: Root;
let container: HTMLElement;
const assign = vi.fn();

async function open() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<StoragePlans />));
  await act(async () => {});
}
const buttons = (name: string) => [...container.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name);
const text = () => container.textContent!.replace(/\s+/g, " ");

beforeEach(() => {
  env.billing = { enabled: true, currency: "eur", freeBytes: 800 * 1024 * 1024, quotaBytes: 800 * 1024 * 1024, plans: PLANS, subscription: null };
  env.posts = [];
  assign.mockClear();
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign, search: "", hash: "", pathname: "/profile" } as Location);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("storage plans", () => {
  it("shows nothing when the server sells no plans", async () => {
    env.billing.enabled = false;
    await open();
    expect(container.innerHTML).toBe("");
  });

  it("lists the three plans with monthly and yearly prices, and opens Stripe Checkout", async () => {
    await open();
    expect(text()).toContain("Shelf");
    expect(text()).toMatch(/3[.,]99/);
    expect(text()).toMatch(/5[.,]99/);
    expect(text()).toMatch(/7[.,]99/);

    await act(async () => buttons("Yearly · 2 months free")[0]!.click());
    expect(text()).toMatch(/39[.,]90/);

    await act(async () => buttons("Choose")[1]!.click());
    expect(env.posts).toEqual([{ path: "/api/billing/checkout", body: { plan: "reader", interval: "year" } }]);
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/test");
  });

  it("marks the current plan and switches plans in place", async () => {
    env.billing.subscription = { plan: "shelf", interval: "month", status: "active", active: true, renewsAt: "2026-12-07T00:00:00.000Z", cancelAtPeriodEnd: false };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await open();
    expect(buttons("Your plan")).toHaveLength(1);
    expect(text()).toContain("Your Shelf plan: renews on");
    expect(buttons("Manage billing")).toHaveLength(1);

    await act(async () => buttons("Switch")[1]!.click());
    expect(env.posts).toEqual([{ path: "/api/billing/change", body: { plan: "library", interval: "month" } }]);
    expect(env.refreshMe).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
