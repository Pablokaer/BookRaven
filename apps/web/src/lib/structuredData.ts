/**
 * schema.org description of the site and the app (JSON-LD), for search engines: written into the
 * prerendered landing page when it is built (scripts/prerender.mjs) and added by the landing page
 * itself otherwise. `origin` is the site's address, without a trailing slash.
 */
export function structuredData(origin: string, lang: "en" | "pt" = "en") {
  const url = lang === "pt" ? `${origin}/pt` : `${origin}/`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "BookRaven", url, inLanguage: lang === "pt" ? "pt-BR" : "en" },
      {
        "@type": "WebApplication",
        name: "BookRaven",
        url,
        image: `${origin}/og-image.png`,
        applicationCategory: "BookReader",
        inLanguage: lang === "pt" ? "pt-BR" : "en",
        operatingSystem: "Web, Android",
        description:
          lang === "pt"
            ? "Um leitor de e-books (EPUB, MOBI, AZW3, FB2), PDFs e quadrinhos (CBZ, CBR, CB7, CBT), com progresso de leitura, destaques e marcadores sincronizados entre o navegador, o app Android e o KOReader, e clássicos em domínio público para ler grátis."
            : "A reader for ebooks (EPUB, MOBI, AZW3, FB2), PDFs and comics (CBZ, CBR, CB7, CBT), with reading progress, highlights and bookmarks synced across the browser, the Android app and KOReader, and public-domain classics to read for free.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ],
  };
}

/** The structured data as the text of a `<script type="application/ld+json">`, safe inside HTML. */
export const structuredDataJson = (origin: string, lang: "en" | "pt" = "en") => JSON.stringify(structuredData(origin, lang)).replace(/</g, "\\u003c");
