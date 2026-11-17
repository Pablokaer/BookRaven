import { describe, expect, it } from "vitest";
import { renderLanding, structuredDataJson } from "./prerender";

describe("prerendered landing page", () => {
  it("renders the whole page inside the Suspense boundary the app hydrates, preloads apart", () => {
    const { preloads, page } = renderLanding({ signupOpen: true });
    expect(preloads).toMatch(/^<link rel="preload" as="image"/);
    expect(page.startsWith("<!--$-->")).toBe(true);
    expect(page).not.toContain('rel="preload"');
    expect(page).toContain('id="hero-title"');
    expect(page).toContain('id="shelves-title"');
    expect(page).toContain('href="/signup"');
  });

  it("leaves out sign-up when the server takes none", () => {
    const { page } = renderLanding({ signupOpen: false });
    expect(page).not.toContain('href="/signup"');
    expect(page).toContain("New accounts are by invitation on this server.");
  });

  it("renders the Portuguese page too", () => {
    const { page } = renderLanding({ signupOpen: true, lang: "pt" });
    expect(page).toContain("Cada livro");
    expect(page).toContain('href="/classics/pt"');
    expect(page).not.toContain("Every book");
    expect(JSON.parse(structuredDataJson("https://books.example.com", "pt"))["@graph"][0].url).toBe("https://books.example.com/pt");
  });

  it("writes structured data that can't close its script tag", () => {
    const json = structuredDataJson("https://books.example.com");
    expect(JSON.parse(json)["@graph"][0].url).toBe("https://books.example.com/");
    expect(structuredDataJson("https://x.example.com/</script>")).not.toContain("</script>");
  });
});
