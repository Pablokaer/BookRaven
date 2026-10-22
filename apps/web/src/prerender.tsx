import { StrictMode, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { LandingPage } from "./pages/LandingPage";

export { structuredDataJson } from "./lib/structuredData";

/**
 * The landing page as HTML, written into dist/landing.html at build time (scripts/prerender.mjs),
 * so search engines and first visitors get the page without waiting for the scripts. The tree
 * matches what App renders for a signed-out visitor at "/" (a Suspense boundary around the page),
 * so the browser hydrates it instead of drawing it again.
 *
 * Returns the page and, apart, the preloads React writes ahead of it for the images it renders
 * (the plates above the fold): they belong in <head>, and #root must hold only the page.
 */
export function renderLanding({ signupOpen }: { signupOpen: boolean }) {
  const html = renderToString(
    <StrictMode>
      <StaticRouter location="/">
        <Suspense fallback={null}>
          <LandingPage signupDefault={signupOpen} />
        </Suspense>
      </StaticRouter>
    </StrictMode>,
  );
  const preloads = /^(?:<link\b[^>]*>)*/.exec(html)![0];
  return { preloads, page: html.slice(preloads.length) };
}
