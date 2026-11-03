import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  config: { allowSignup: true } as Record<string, unknown>,
  signUp: vi.fn(async (_body: Record<string, unknown>) => ({ data: {}, error: null })),
  signIn: vi.fn(async (_body: Record<string, unknown>) => ({ data: {}, error: null })),
}));

vi.mock("../lib/auth", () => ({
  authClient: { signUp: { email: env.signUp }, signIn: { email: env.signIn } },
}));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  apiJson: async () => env.config,
}));

const { LoginPage } = await import("./LoginPage");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
/** The fake Turnstile: the widgets drawn, and the callbacks of the last one. */
let widgets: { sitekey: string; callback: (token: string) => void }[];

async function open(mode: "signin" | "signup") {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<LoginPage onSignedIn={() => {}} initialMode={mode} />));
  await act(async () => {}); // the config request
}

const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const submitButton = () => container.querySelector<HTMLButtonElement>("form button.btn")!;
const type = (selector: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  env.config = { allowSignup: true };
  env.signUp.mockClear();
  env.signIn.mockClear();
  widgets = [];
  window.turnstile = {
    render: (_el, options) => {
      widgets.push(options as (typeof widgets)[number]);
      return `w${widgets.length}`;
    },
    remove: () => {},
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.turnstile;
});

describe("the not-a-robot check", () => {
  it("is not there when the server has no Turnstile key", async () => {
    await open("signup");
    expect(widgets).toHaveLength(0);
    expect(button("Create account")?.disabled).toBe(false);
  });

  it("waits for Turnstile on sign-up, then sends its token once", async () => {
    env.config = { allowSignup: true, turnstileSiteKey: "site-key" };
    await open("signup");
    expect(widgets.map((w) => w.sitekey)).toEqual(["site-key"]);
    expect(submitButton().disabled).toBe(true);

    await act(async () => widgets[0]!.callback("token-1"));
    expect(button("Create account")?.disabled).toBe(false);

    type('input[type="email"]', "reader@example.com");
    type('input[autocomplete="new-password"]', "password123");
    await act(async () => submitButton().form!.requestSubmit());
    expect(env.signUp).toHaveBeenCalledTimes(1);
    expect(env.signUp.mock.calls[0]![0].fetchOptions).toEqual({ headers: { "x-captcha-response": "token-1" } });
    // A fresh check for a next attempt.
    expect(widgets).toHaveLength(2);
  });

  it("leaves signing in alone", async () => {
    env.config = { allowSignup: true, turnstileSiteKey: "site-key" };
    await open("signin");
    expect(widgets).toHaveLength(0);
    expect(button("Sign in")?.disabled).toBe(false);
  });
});
