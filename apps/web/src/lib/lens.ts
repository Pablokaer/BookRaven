/**
 * Magnifying glass for comic pages: a round lens following the pointer (or finger)
 * that shows the image under it enlarged. Works inside foliate's page iframes, which
 * are scaled with a CSS transform, and on plain images in the main document.
 */
export function attachLens(root: Document | HTMLElement, opts: { isActive: () => boolean; zoom?: number; sizePx?: number }) {
  // `instanceof Document` is false for an iframe's document (each frame has its own classes).
  const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : (root as HTMLElement).ownerDocument;
  const zoom = opts.zoom ?? 2.5;
  const sizePx = opts.sizePx ?? 190;
  let lens: HTMLDivElement | null = null;

  const hide = () => {
    if (lens) lens.style.display = "none";
  };

  const move = (e: PointerEvent) => {
    const img = (e.target as Element | null)?.closest?.("img");
    if (!opts.isActive() || !img) return hide();
    e.preventDefault();
    // Inside a scaled iframe, convert the on-screen lens size to document pixels.
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    const scale = frame && frame.offsetWidth ? frame.getBoundingClientRect().width / frame.offsetWidth : 1;
    const L = sizePx / scale;
    const r = img.getBoundingClientRect();
    if (!lens) {
      lens = doc.createElement("div");
      Object.assign(lens.style, {
        position: "fixed",
        borderRadius: "50%",
        pointerEvents: "none",
        backgroundRepeat: "no-repeat",
        zIndex: "2147483647",
        boxShadow: "0 10px 40px rgb(0 0 0 / 0.55)",
      });
      doc.body.append(lens);
    }
    Object.assign(lens.style, {
      display: "block",
      width: `${L}px`,
      height: `${L}px`,
      left: `${e.clientX - L / 2}px`,
      top: `${e.clientY - L / 2}px`,
      border: `${3 / scale}px solid rgb(255 255 255 / 0.9)`,
      backgroundImage: `url("${img.currentSrc || img.src}")`,
      backgroundSize: `${r.width * zoom}px ${r.height * zoom}px`,
      backgroundPosition: `${-((e.clientX - r.left) * zoom - L / 2)}px ${-((e.clientY - r.top) * zoom - L / 2)}px`,
    });
  };

  const target = root as unknown as EventTarget;
  const onMove = (e: Event) => move(e as PointerEvent);
  const onEnd = (e: Event) => (e as PointerEvent).pointerType !== "mouse" && hide();
  target.addEventListener("pointermove", onMove, { passive: false });
  target.addEventListener("pointerdown", onMove, { passive: false });
  target.addEventListener("pointerup", onEnd);
  target.addEventListener("pointerleave", hide);
  return () => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerdown", onMove);
    target.removeEventListener("pointerup", onEnd);
    target.removeEventListener("pointerleave", hide);
    lens?.remove();
  };
}
