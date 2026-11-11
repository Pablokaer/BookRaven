import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pickFiles = vi.fn();
vi.mock("../lib/libraryStore", () => ({ useLibraryActions: () => ({ pickFiles }) }));

const { WelcomeTour, WELCOME_STEPS } = await import("./WelcomeTour");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
const onClose = vi.fn();

const heading = () => container.ownerDocument.querySelector("h3")?.textContent;
const button = (label: string) =>
  [...container.ownerDocument.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const click = (el: HTMLElement | undefined) => act(() => el!.click());

beforeEach(async () => {
  pickFiles.mockReset();
  onClose.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<WelcomeTour onClose={onClose} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("welcome tour", () => {
  it("introduces uploading, syncing and sharing by link, in that order", () => {
    expect(WELCOME_STEPS.map((s) => s.title)).toEqual(["Bring your books", "Read on every device", "Share with a link"]);
    expect(heading()).toBe("Bring your books");
  });

  it("goes forward and back, and can be skipped from the start", async () => {
    await click(button("Next"));
    expect(heading()).toBe("Read on every device");
    await click(button("Back"));
    expect(heading()).toBe("Bring your books");
    await click(button("Skip"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ends by offering to upload the first book", async () => {
    await click(button("Next"));
    await click(button("Next"));
    expect(heading()).toBe("Share with a link");
    expect(button("Next")).toBeUndefined();
    await click(button("Upload a book"));
    expect(pickFiles).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("jumps to a step from its dot", async () => {
    await click(container.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Share with a link"]')!);
    expect(heading()).toBe("Share with a link");
  });
});
