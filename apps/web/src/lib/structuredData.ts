/**
 * schema.org description of the site and the app (JSON-LD), for search engines: written into the
 * prerendered landing page when it is built (scripts/prerender.mjs) and added by the landing page
 * itself otherwise. `origin` is the site's address, without a trailing slash.
 */
export function structuredData(origin: string) {
  const url = `${origin}/`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "BookRaven", url },
      {
        "@type": "WebApplication",
        name: "BookRaven",
        url,
        image: `${origin}/og-image.png`,
        applicationCategory: "BookReader",
        operatingSystem: "Web, Android",
        description:
          "A self-hosted reader for ebooks (EPUB, MOBI, AZW3, FB2), PDFs and comics (CBZ, CBR, CB7, CBT), with reading progress, highlights and bookmarks synced across the browser, the Android app and KOReader.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ],
  };
}

/** The structured data as the text of a `<script type="application/ld+json">`, safe inside HTML. */
export const structuredDataJson = (origin: string) => JSON.stringify(structuredData(origin)).replace(/</g, "\\u003c");
