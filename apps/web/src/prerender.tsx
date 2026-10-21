import { StrictMode, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { LandingPage } from "./pages/LandingPage";

/**
 * The landing page as HTML, written into dist/landing.html at build time (scripts/prerender.mjs),
 * so search engines and first visitors get the page without waiting for the scripts. The tree
 * matches what App renders for a signed-out visitor at "/" (a Suspense boundary around the page),
 * so the browser hydrates it instead of drawing it again.
 */
export function renderLanding() {
  return renderToString(
    <StrictMode>
      <StaticRouter location="/">
        <Suspense fallback={null}>
          <LandingPage />
        </Suspense>
      </StaticRouter>
    </StrictMode>,
  );
}
