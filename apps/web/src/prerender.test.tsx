import { describe, expect, it } from "vitest";
import { renderLanding } from "./prerender";

describe("prerendered landing page", () => {
  it("renders the whole page inside the Suspense boundary the app hydrates", () => {
    const html = renderLanding().replace(/^(?:<link [^>]*\/>)*/, "");
    expect(html.startsWith("<!--$-->")).toBe(true);
    expect(html).toContain('id="hero-title"');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('id="shelves-title"');
  });
});
