import { describe, expect, it } from "vitest";
import { pinchController, transformSurface } from "./pinchZoom";

/** A 400×800 frame at (0, 0) holding the zoomed element. */
function frame() {
  const parent = document.createElement("div");
  const el = document.createElement("div");
  parent.append(el);
  parent.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
  document.body.append(parent);
  return el;
}

describe("transformSurface", () => {
  it("keeps the content under the fingers in place and stops panning at the edges", () => {
    const el = frame();
    const s = transformSurface(el);
    s.zoomAt(2, { x: 100, y: 200 });
    // Content point (100, 200) stays at (100, 200): 100 - 100·2 = -100.
    expect(el.style.transform).toBe("translate(-100px, -200px) scale(2)");
    s.pan!(500, 500); // can't go past the top-left corner
    expect(el.style.transform).toBe("translate(0px, 0px) scale(2)");
    s.pan!(-5000, -5000); // nor past the bottom-right one: 400·(1-2), 800·(1-2)
    expect(el.style.transform).toBe("translate(-400px, -800px) scale(2)");
    s.reset();
    expect(el.style.transform).toBe("");
    expect(s.scale()).toBe(1);
  });
});

describe("pinchController", () => {
  const touch = (target: EventTarget, type: string, points: [number, number][]) => {
    const touches = points.map(([x, y], i) => ({ identifier: i, clientX: x, clientY: y, target }) as unknown as Touch);
    const ev = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
    Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : touches });
    Object.defineProperty(ev, "changedTouches", { value: touches });
    target.dispatchEvent(ev);
    return ev;
  };

  it("zooms by the change in finger distance, up to 4×, and is busy while zoomed", () => {
    const el = frame();
    const zoom = pinchController(transformSurface(el));
    zoom.attach(el);
    expect(zoom.busy()).toBe(false);
    touch(el, "touchstart", [[150, 400], [250, 400]]);
    const move = touch(el, "touchmove", [[100, 400], [300, 400]]);
    expect(move.defaultPrevented).toBe(true);
    expect(el.style.transform).toContain("scale(2)");
    touch(el, "touchmove", [[0, 400], [1000, 400]]);
    expect(el.style.transform).toContain("scale(4)");
    touch(el, "touchend", [[0, 400]]);
    expect(zoom.busy()).toBe(true);
    zoom.reset();
    expect(el.style.transform).toBe("");
  });

  it("snaps back to the page when barely zoomed, and leaves one-finger swipes alone at page size", () => {
    const el = frame();
    const zoom = pinchController(transformSurface(el));
    zoom.attach(el);
    touch(el, "touchstart", [[150, 400], [250, 400]]);
    touch(el, "touchmove", [[148, 400], [252, 400]]);
    touch(el, "touchend", [[148, 400]]);
    expect(el.style.transform).toBe("");
    touch(el, "touchstart", [[200, 400]]);
    expect(touch(el, "touchmove", [[100, 400]]).defaultPrevented).toBe(false);
  });
});
