<p align="center">
  <img src="apps/web/src/assets/logo.webp" alt="BookRaven logo" width="160">
</p>

# BookRaven

Self-hosted reader for ebooks (EPUB, MOBI, AZW3, FB2), PDFs and comics (CBZ, CBR, CB7, CBT) that saves your exact reading position and lets you continue on any device: web browser, Android app, or e-ink readers through KOReader.

The app and the repository are called **BookRaven** (formerly Mico-livrão). Some internal identifiers (the database, storage and cache keys, the Android app id `app.readsync`, the `readsync.local` example domain) still use `readsync`, and the server folder is still `/opt/mico-livrao` (Docker Compose names the database volume after it), so existing data and installs keep working.

## Features

- **Landing page:** on the web, a signed-out visitor opening the server's address (`/`) sees a page about BookRaven (`apps/web/src/pages/LandingPage.tsx`, styled in `apps/web/src/literary.css`) with links to `/login` and `/signup`. It is laid out like an illustrated edition: midnight and parchment chapters (the palette and the Cormorant Garamond headings are tokens in `apps/web/src/index.css`), Gustave Doré's engravings for Poe's *The Raven* (1884, public domain, from Wikimedia Commons; toned to the palette as WebP in `apps/web/src/assets/landing/`, two sizes each, lazy-loaded below the fold), and a bookshelf whose spines open the Public Library's sections (`/public?theme=…`, after signing in). The opening screen fades in with CSS as soon as it is drawn (it never waits for the scripts), the later sections fade in as they scroll into view, and the plates drift slightly, except with *reduce motion*; *Create an account* is replaced by a note when `ALLOW_SIGNUP=false`. Signed-in readers go straight to their library (also from `/login` and `/signup`), signing out or an expired session on `/` shows the sign-in form, and any other address opened while signed out (a share link, a book) shows the sign-in form and opens once signed in. The Android app skips the landing page, and it is a file of its own, loaded only once the session check says the visitor is signed out (with the 500 weight of its title font).
- **Search engines (SEO):** only the landing page is meant to be found on Google. It is **prerendered**: after `vite build`, `apps/web/scripts/prerender.mjs` renders `LandingPage` to HTML (`src/prerender.tsx`, React's `renderToString`) and writes `dist/landing.html`, which is `index.html` with the page already in `#root`, its image preloads in `<head>` and its code preloaded. The web image is built with `PUBLIC_URL` and `ALLOW_SIGNUP` from `.env` (build arguments in `docker-compose.yml`): `PUBLIC_URL` adds the canonical link, `og:url`, absolute preview-image addresses and the structured data to the page's `<head>`, and `ALLOW_SIGNUP=false` draws it without the sign-up buttons, as the server will answer (so changing either needs `docker compose up -d --build`; until then the page corrects itself once `/api/config` answers). The service worker never keeps `landing.html` as the app's offline copy. Caddy serves it at `/` to requests without a Better Auth session cookie (`Vary: Cookie`); with one, `/` is the app as usual. Crawlers read the page without running scripts, and visitors see it before the app's code has loaded: the browser hydrates it (`hydrateRoot`) and keeps it on screen while the session is checked. `index.html` has a descriptive title and meta description (also used by link previews), and the landing page carries schema.org structured data (JSON-LD: `WebSite` and `WebApplication`, `apps/web/src/lib/structuredData.ts`; added by the page itself when the build had no `PUBLIC_URL`). Caddy serves `/robots.txt` (crawling allowed everywhere, so Google can render the page and read the headers below) and `/sitemap.xml` (the front page), both built from `PUBLIC_URL`; it sends a `Link: <PUBLIC_URL/>; rel="canonical"` header on `/` and `X-Robots-Tag: noindex, nofollow` on every other address (the sign-in form, the reader, share links, the API), since they all fall back to the same `index.html`. To get indexed sooner, add the site to [Google Search Console](https://search.google.com/search-console) (a *Domain* property verified with a DNS TXT record) and submit `https://<your server>/sitemap.xml`.
- **Look:** the whole web app (and the Android app, which shares it) is styled like an illustrated edition: midnight and raven blues, parchment and a restrained gold, Cormorant Garamond titles over Inter. The palette, fonts and radii are tokens in `apps/web/src/index.css`; the shared textures and ornaments (paper grain, torn edges, the arched plate, fleurons, engraved medallions) are in `apps/web/src/literary.css` and `apps/web/src/components/ui/Ornaments.tsx`. The reader's panels and bars are written with Tailwind's `neutral` and `teal` scales, which `index.css` redraws as parchment-to-midnight and gold. The sign-in screens show the arched plate, empty pages an engraved vignette, and books without a cover get a cloth-bound cover. All the artwork is Gustave Doré's engravings for Poe's *The Raven* (1884, public domain).
- **Accounts:** email + password (change it in the profile, or reset it by email), plus Google sign-in on the web. New accounts get a welcome email; "Forgot password?" emails a one-hour link (both need SMTP, see *Email*). Sign-ups can be closed with `ALLOW_SIGNUP=false`, or gated behind email confirmation with `REQUIRE_EMAIL_VERIFICATION=true` (needs SMTP). The API remembers who is signed in for up to 30 seconds (accepted app passwords for 60), so a reader's many requests don't each ask the database; signing out, revoking sessions, changing or resetting a password, and an administrator blocking an account, setting a temporary password or deleting it still take effect on the very next request. Sign-in, sign-up and password-reset requests are rate-limited (10/min per IP); the reader opens books in a sandbox that cannot run their scripts, and the server sends a strict Content-Security-Policy.
- **Book pages:** clicking a cover opens the book's page: progress (where and on which device you stopped), description (read from the EPUB or PDF metadata on upload, or Gutenberg's summary for imported books), format, size, language, collection and tags, how many other readers have it, its Public Library entry and source, all its highlights (each opens the reader at that passage) and the book clubs reading it. A public book's page shows who shared it, how many readers have it, its sections, and *More by the author* and *You might also like* shelves; *Read* on any card still opens the reader directly.
- **Reading stats** (`/stats`, linked from the dashboard, the reading-goal widget and Profile): time read in the last 7 days, current and best streak, days read this month, books finished this year against your goal, reading time per day for the last 30 days, a 26-week activity heatmap, books finished per month, and the books you read most this month. Time is estimated from position saves on every device (KOReader included): the gap between two page turns counts, pauses over 10 minutes don't. The history starts when this version is installed; books finished before that still count, dated by their last saved position.
- **Import from other apps** (`/import`, linked from *Uploads* and *Profile*; everything is read on the device):
  - **Goodreads:** choose the CSV from *My Books → Import and export → Export Library*. Books are matched by title and author (ignoring series, subtitles, accents and name order). Those already in your library get your Goodreads shelves as tags, 5-star ratings as favorites and, for the *read* shelf, a finished position dated on the day you read them (newer progress is never overwritten). Matches in the Public Library can be added in one go; the rest can be requested.
  - **Calibre:** choose the Calibre library folder (needs a computer: phones can't pick folders). Each book is uploaded once in the best format for reading here (EPUB, then AZW3, MOBI, FB2, comics, PDF) with the title, author, description, tags, series (as a tag) and cover from its `metadata.opf`, into a *Calibre* collection or one you pick. It goes through the normal upload queue, so duplicates are skipped and the storage limit applies.
- **Library dashboard:** upload by button or drag-and-drop (title, author and cover are read from the file; duplicates are detected by SHA-256). Files dropped on a collection's page or on its card in *Collections*, or picked with the collection's *Upload* button, go straight into that collection (a file already in the library is moved there). An upload panel lists every file with its state (waiting, reading details, percentage sent, saving, added, already in the library, failed) and the overall progress, and stays until cleared; uploads go one at a time, continue while browsing the app, and the browser asks before closing the tab while any are left. Collections, tags, favorites, filters by type, sorting, a top-bar search that always looks in both your library (titles, authors, tags, collections) and the Public Library, with the results in two labelled sections (ignores accents and word order), grid or list, a yearly reading goal, and a 2 GB storage limit per account (`UPLOAD_QUOTA_MB`; administrators are unlimited).
- **Books load like streaming video:** readers fetch a book in pieces with HTTP Range requests, only the parts around the page being read, and the next pages download in the background. An EPUB or CBZ downloads its ZIP directory (at the end of the file) and then each chapter or page image when it is shown; a PDF downloads the cross-reference table and each page's objects (pdf.js asks for them); a MOBI/AZW3 the records it reads (MOBI 6 files read all their text when they open, images on demand). FB2 is one XML file and is downloaded whole. Pieces already downloaded (64 KB each) are kept in the browser's Cache Storage, so reopening a book downloads nothing again and pages read before also open offline; once every piece is there they become one saved file. Reads that follow each other fetch further ahead (up to 2 MB per request), like a video player buffering, and a few requests run at once, the page on screen first. *Save for offline reading* downloads only the pieces not yet on the device and joins them into one file. Books up to 30 MB opened on Wi-Fi or a cable (not on mobile data or with Save-Data) finish downloading in the background, behind the reader's own requests. Book downloads skip the browser's HTTP cache, so files aren't stored twice.
- **Ebook reader** (foliate-js): 8 bundled fonts, size, line and letter spacing, margins, page width, one or two pages, themes (including inverted) and contrast; table of contents and full-text search.
- **PDF reader** (pdf.js): reads the file by ranges (see above), loaded only when a PDF is opened, fit page or width, adjustable margins around the page (0–48 px) and *Crop white margins* (shows only each page's content, so the text is larger), color themes, and a selectable text layer so PDFs get highlights, notes and search too. **Zoom** up to 4×: pinch or double-tap on touch screens, Ctrl + scroll (or a trackpad pinch), Ctrl +/−/0 or the − 100% + buttons in the bottom bar on computers; while zoomed, only the visible part of the page is drawn sharp (so zooming costs little memory on phones and never rebuilds the page), and a swipe moves around the page instead of turning it. The next and previous pages are prepared in the background, so turning a page is instant, and pages left behind give their memory back. Search reads a few pages at a time and remembers each page's text, so searching again is immediate, and lists results 200 at a time (*Show more*), so a word found tens of thousands of times doesn't slow the reader.
- **Comics:** CBZ, CBR (RAR), CB7 (7-Zip) and CBT (TAR). RAR and 7z archives are usually "solid" (a page can't be unpacked without the ones before it), so the server makes a **CBZ copy** of every CBR, CB7 and CBT (7-Zip compiled to WebAssembly, in a worker thread, one archive at a time; pages are stored as they are, not recompressed) right after the upload, or on first open for older books, and readers stream that copy page by page like a CBZ. The copy lives next to the book file (`derived/` in the storage), isn't counted towards the storage limit and is deleted with the file; *Download file* still gives the original. Archives the server can't convert (damaged, password-protected, or over twice `MAX_UPLOAD_MB` unpacked) are unpacked in the browser as before. Natural page order, ComicInfo.xml metadata, two-page spreads with the cover alone, automatic detection of double-page scans (from the first 4 KB of each page image, not the whole page), manga right-to-left, a vertical-scroll (webtoon) layout (pages more than ten away from the one being read let go of their images, keeping their size, so long strips stay light), a magnifier, and **pinch-to-zoom** (up to 4×, also in the Android app, whose WebView has no zoom of its own): two fingers zoom where they are, one finger moves the zoomed page, double-tap toggles a close-up; while zoomed, swipes and side taps don't turn the page, and the next page starts whole. On desktop, Ctrl + wheel or a trackpad pinch zooms, double-click toggles and dragging pans.
- **Highlights and notes** in four colors, exported as Markdown (the Android app saves the file in Documents/BookRaven), and **translation** of selected text (Chrome's on-device translator, MyMemory or a self-hosted LibreTranslate). The passage's language is detected (Chrome's on-device language detector when it is sure, otherwise the translation provider), never assumed to be the book's, so a quote in another language is translated too; a passage already in the target language is shown as such.
- **Word dictionary:** select a single word and tap *Dictionary* to see which language it is in, its translation into the language you pick and its definitions (Wiktionary). Works with English, Spanish, Portuguese, French and Italian, in any of those directions. The language is told from the dictionary (the languages Wiktionary has the word in), narrowed by spelling (accented letters such as ñ, ã, œ or ò) and, when the word exists in several, the book's language; *Also in* switches to another of the word's languages (*burro* is butter in Italian, a donkey in Spanish). Words the dictionary doesn't know are still detected by their spelling or the book's language and translated. The target language is a reader setting (`dictionaryTo`), synced like the others; a word already in that language isn't sent for translation. Needs `DICTIONARY_PROVIDER` or `TRANSLATE_PROVIDER` (either is enough: without the dictionary there are no definitions, without translation only the language and definitions are shown).
- **Bookmarks** (every format, like Kindle's): the bookmark button in the reader's top bar (or the **B** key) saves the page you are on, and a red ribbon marks it. Ebook bookmarks keep the spot where the page started, so they stay on the right page when the font size or screen changes. The reader's **Notebook** panel has a *Highlights* and a *Bookmarks* tab: name a bookmark, jump to it, or remove it. The book page lists them too. Bookmarks sync live to your other devices and also work offline: changes wait on the device and are sent when it is back online.
- **Handwriting on PDFs** (pen, tablet stylus, mouse or finger): the pen button in the PDF reader's top bar opens a toolbar with a pen and a highlighter (four colors, three widths each), an eraser that removes whole strokes, undo/redo (also Ctrl+Z / Ctrl+Y) and *Done* (or Escape). The pen is pressure-sensitive with a stylus (S Pen, Apple Pencil in Safari, USI pens…) and its eraser end erases. A pen or mouse draws while fingers keep scrolling, pinch-zooming and turning pages, and a palm resting on the screen while writing is ignored; turn on the hand button to draw with a finger. Strokes are stored as fractions of the page, so they stay in place at any zoom, margin, crop or screen size, and the PDF file is never changed. The Notebook's *Handwriting* tab shows the annotated pages as small pictures. Handwriting syncs live and works offline like bookmarks: devices exchange added and erased strokes, so pages written on two devices keep both sets. Each change raises the page's version, so devices apply live changes in order and reload a page when they missed one. The open book's handwriting (pages loaded, versions, live changes, the offline copy, refused changes, undo/redo) is one module, `apps/web/src/lib/inkSession.ts`; requests, the outbox and the device's copy are in `apps/web/src/lib/ink.ts`.
- **Offline changes** (bookmarks, handwriting, reading progress) are saved on the device first and sent in order. Network errors, 429 and 5xx responses are retried after a growing delay (respecting `Retry-After`); several strokes on the same page go in one request. A change the server refuses for good (a page that is too full, too many bookmarks) is dropped, and the reader says so and shows what the server kept.
- **Progress sync** (the core feature):
  - The position is an **EPUB CFI** for ebooks (exact even when font size or screen changes), `page:N` for PDFs, and the page for comics (`epubcfi(/6/<2·(index+1)>)`, foliate-js's numbering, shared by the paged and the vertical-strip comic readers). Positions from KOReader's ebooks and books imported as read are a percentage, `fraction:0.42`; every reader opens one at that point of the book (a PDF or comic on the page at that percentage, so a book imported as read opens on its last page). PDF highlights are `pdf:<page>:<start>-<end>` (character offsets into the page's text layer) and search results `pdfsearch:<page>:<n>:<query>`. These locators are read and written in one place for both apps, the `@bookraven/locator` workspace package (`packages/locator`).
  - Positions are saved with a 1.5 s delay (pages turned quickly send one request), kept in the same local outbox as the other offline changes, and sent immediately when the app goes to the background, the tab closes or the book is closed.
  - The **newest** position wins, judged by when the page was actually reached. The server keeps it, so a device that comes back online late can't overwrite newer progress; a book opens at this device's unsent position when that is newer than the server's, and a position from another device is offered only when it is newer than what was read here. Saving positions and these decisions live in one module, `apps/web/src/lib/progress.ts`.
  - Live updates over **Server-Sent Events**: if you read ahead on another device, the open reader offers to jump there. Reader settings sync too. A dropped connection is retried with a growing delay (1 s up to 30 s), and at once when the device comes back online or the app back to the screen; once reconnected, the app reloads the library, storage use, settings and the public library, requests and club pages, since events sent meanwhile were missed. After a 401 it waits for one of those signs (or a refreshed session) instead of retrying on a timer. Returning to the tab reloads the library only when the live connection is down or the last reload is over a minute old. Back in the reader, the position is fetched again only if the live connection wasn't up, and recently heard from, the whole time since the book opened. The live events the web app handles, and what each carries, are one typed table in `apps/web/src/lib/events.ts`; the library's books, collections, activity notes and the counters the public library, requests and clubs pages reload on change through one pure reducer, `apps/web/src/lib/libraryState.ts`, fed those events and the app's own edits. Uploads go through `apps/web/src/lib/uploadQueue.ts` (one file at a time, progress shown at most every 100 ms). The public catalog's cache (`apps/web/src/lib/publicLibrary.ts`) listens to the events that make it stale itself.
- **Sharing:** share a book or a whole collection by link (a collection link always shows the collection's current books; accepting adds copies of all of them to a collection of the same name, and accepting again adds only the new ones), publish it to the **Public Library** (everyone on the server can read or download it; opening a book there shows who shared it and when), request books there and vote on requests, and read together in **book clubs** (members see each other's progress and discuss passages).
- **Public-domain collection:** an importer fills the Public Library with hundreds of popular public-domain books in English and Portuguese from Project Gutenberg, Standard Ebooks' carefully produced English editions and Portuguese works from Wikisource (see below). The Public Library is organised in **sections by theme** (philosophy, politics, economics, technology, computing, science, history, literature, poetry, religion, children), with a language filter, popularity ranking and a link back to the source. At the top, **Recommended for you** and **Because you read …** rows suggest public books from the authors and sections of the books you have read, are reading or marked as favorites, in the languages you read; they are worked out in the app from your own library, and books you already have are never suggested.
- **Other apps:** an **OPDS** catalog and a **KOReader** progress-sync server, with per-device app passwords.
- **Android app** without the Play Store: *Download* in the sidebar explains how to install the APK straight from your server. Installed apps update themselves: interface changes arrive as silent live updates, and when the native part changes the app offers the new APK. In the app, *Download* shows the installed (APK) version and, after silent updates, the version actually running ("Installed version 1.70 · updated to 1.82"). The app's build (`vite build --mode native`) leaves out the front page, its images and `og-image.png`, about 1 MB less in the APK and in every live update.
- **What's new:** after an update, a window lists what changed, once (on the web after a deploy, in the Android app after its live update). The notes are in `apps/web/src/lib/whatsNew.ts`: every user-visible change adds one at the top, with a new id; someone who never saw any gets the last two weeks'.
- **Offline:** the web app opens without a connection and shows your saved library (on a connection so slow that the page hasn't answered in 4 s, the service worker opens the saved copy of the app and keeps the network's for next time); books saved for offline (or read to the end) can be read, and so can the pages you already read of other books. The reader opens a book from the library's copy straight away, without waiting for the server. **Signing out** first gives unsent changes (positions, bookmarks, handwriting) up to 3 seconds to reach the server, then removes from the device the downloaded books, the handwriting copies, the offline bookmark lists, the library data kept for offline use, the library list, account and collections kept to draw the first screen (of every account that signed in on the device) and any change still waiting, so the next account on a shared device never sees or sends them. Everything the device keeps for an account goes through one module, `apps/web/src/lib/accountData.ts`: each store of the account's data registers there, and signing out forgets them all, loading the reader's stores first if they were never opened. The **Android app** keeps the same offline copies without a service worker: when the server can't be reached (not when it turns the session down) it opens as the account last signed in, library data (books, collections, book pages, highlights) is network-first with the last good copy, and your covers are kept on the device; signing out removes those too. Which reads keep an offline copy is one list, `apps/web/src/lib/offlineCopies.ts`, used by the app and by the service worker: the build writes it next to `sw.js` as `offline-copies.js`, which the service worker loads with `importScripts`. **Device storage:** the app asks the browser for persistent storage with the first book opened or saved. Above 80% of the storage quota, or when the device is full, the books opened longest ago make room, except those saved for offline and the one being read; books deleted on another device are removed from this one too. *Profile → On this device* shows how much the app stores and clears the downloaded books.
- **Light first load:** the web app first downloads only the app frame and the library views; the other pages, each reader (EPUB/comics, PDF, vertical comic strip) and comic unpacking load when first needed. The headings' font (Cormorant Garamond, Latin 600) is preloaded by `index.html`, and the 500 weight of the front page and sign-in titles is requested as soon as the visitor is known to be signed out; until they arrive the titles use Georgia resized to the font's metrics, so they don't jump when it swaps in. The paper grain is two 160px WebP tiles (about 5 KB each) rather than SVG noise the browser would compute at the screen's resolution, and it and the night sky behind the library are drawn only where they show (not behind the reader), as plain fixed layers without blend modes, filters or a fixed body background. Book cards, the sign-in card and the front page's header don't use backdrop blur, which phones would recompute on every scroll frame. The front page's own ornaments (torn edges, the quill) are in a module of their own, out of the app's main bundle. The pages are fetched in the background a couple of seconds after the app starts, so they open instantly and the service worker keeps them for offline use. On the web the readers (and foliate-js) follow, plus pdf.js and its worker when the library has PDFs (none of it with Save-Data), so a book saved for offline still opens offline after a deploy. React and the router are a file of their own that browsers keep across deploys that change only the app. When a new service worker takes over, it deletes the cached files of old versions: those that neither the server's current `index.html` nor the cached ones (this version's and the previous) lead to, following the files each one imports, so the pages and readers loaded later are kept; if anything fails, nothing is deleted. Library data is network-first with the last good copy kept for offline use (stored in the background, so answers aren't delayed); book covers never change, so a cached cover is used without asking the server. Up to 150 covers no longer on screen stay ready in memory; older ones are released. Covers are scaled to at most 600 px wide when uploaded, when that makes them smaller. The manifest is network-first, so its changes reach installed web apps. The public catalog is downloaded once and shared by the Public Library, search, book and import pages, and fetched again when it changes (a live event, a book added to or removed from your library, publishing or unpublishing) or after 5 minutes. Book cards off screen are not laid out or drawn (CSS `content-visibility`, in browsers that support `overflow-clip-margin`), and library changes (uploads, positions from other devices, favorites) re-render only the cards they affect.
- **Administration:** accounts (storage limits, blocking, temporary passwords, deletion), content reports on public books (dismiss, unpublish, block the file or delete it everywhere), and the number of open book requests (linking to *Public Library → Requests*). Administrators also get an email for each new book request.

## Stack

| Layer | Tech |
|---|---|
| Web app | React 19, Vite, TypeScript, Tailwind CSS 4, React Router |
| Readers | foliate-js (EPUB/MOBI/AZW3/FB2/CBZ), pdf.js legacy build (works on Android WebViews) |
| Android | Capacitor 8 (same codebase; bearer-token auth) |
| API | Node 22, Fastify 5, Better Auth (email + Google, bearer plugin) |
| Database | PostgreSQL 16 (`pg` + plain SQL migrations) |
| Files | Content-addressed (`books/ab/cd/<sha256>`) on local disk or any S3-compatible bucket (Garage, MinIO, AWS, R2) |
| Tests | Vitest (API integration tests against PostgreSQL, web unit tests and component tests in happy-dom, e.g. the sign-in routing in `App.test.tsx`), GitHub Actions CI |
| Realtime | SSE (`GET /api/events`) |
| Proxy / TLS | Caddy (automatic HTTPS) |

## Project layout

```
apps/
  api/                Fastify API
    src/auth.ts       Better Auth config + requireUser
    src/routes/       auth, books (upload/file/cover), progress, settings, events (SSE)
    src/lib/          storage, format detection (magic bytes), SSE hub, CBZ copies of comics
    src/migrations/   SQL migrations (run automatically on start)
    scripts/          Docker image helper (drops unused optional peer dependencies)
  web/                React app (also the Capacitor Android app)
    src/reader/       EpubReader (foliate-js), PdfReader (pdf.js), settings + TOC panels
    src/lib/          api client, auth, progress sync/outbox, SSE client (events.ts: the typed
                      table of live events), settings, fonts; the library's state is a pure
                      reducer (libraryState.ts) and an upload queue (uploadQueue.ts), wired to
                      React by libraryStore.tsx
    android/          Capacitor Android project
    scripts/          Android release helpers (native-version fingerprint, release files),
                      precompress.mjs (.br/.gz copies for Caddy)
infra/Caddyfile
infra/deploy.sh          update the VPS to a commit and restart (used by the Deploy workflow)
infra/ci-ssh.sh          SSH setup for the Deploy workflow: key, an `ssh vps` alias, and waiting until the VPS answers
infra/publish-android.sh publish an Android release into ./downloads (used by the Deploy workflow)
packages/
  locator/            reading positions (locators): parse, build, and the page a position is on;
                      shared by api and web (plain JavaScript typed by index.d.ts, no build step)
docker-compose.yml       production: postgres + api + caddy
docker-compose.dev.yml   development: postgres only
```

## Local development

Requirements: Node 22+, pnpm 10, Docker (for Postgres).

```bash
pnpm install
pnpm db:up          # Postgres on localhost:5432 (user/pass/db: readsync)
pnpm dev            # API on :3000, web on http://localhost:5173 (Vite proxies /api)
```

The API has development defaults for every setting. To change them, create `.env.dev` in the repo root (same keys as `.env.example`).

## Deploy to your VPS

1. Point a DNS record (e.g. `books.example.com`) at the VPS. Open ports 80 and 443.
2. Clone the repo on the server and create `.env`:
   ```bash
   git clone https://github.com/Pablokaer/BookRaven.git /opt/mico-livrao
   cd /opt/mico-livrao
   cp .env.example .env
   # set DOMAIN, PUBLIC_URL, POSTGRES_PASSWORD (also inside DATABASE_URL),
   # BETTER_AUTH_SECRET (openssl rand -base64 32), optional Google keys
   ```
3. Start everything (needs Docker 23 or newer with Compose v2, which build with BuildKit):
   ```bash
   docker compose up -d --build
   ```
   Caddy gets the TLS certificate automatically. Database migrations run when the API starts.
4. Create your account. Then set `ALLOW_SIGNUP=false` and run `docker compose up -d --build` again if you don't want other people signing up (`--build` redraws the prerendered landing page without its sign-up buttons).

### Behind an existing web server

If Apache or nginx already owns ports 80 and 443 on the VPS (other sites), let it terminate TLS and proxy to Caddy on a local port. In `.env`:

```bash
DOMAIN=http://books.example.com     # http:// → Caddy serves plain HTTP and asks for no certificate
PUBLIC_URL=https://books.example.com
HTTP_PORT=127.0.0.1:8090            # any free local ports
HTTPS_PORT=127.0.0.1:8453
TRUSTED_PROXIES=private_ranges      # believe the front server's X-Forwarded-For (real client IPs)
```

Caddy then takes the client's address from the front server's `X-Forwarded-For`: the last address in it that isn't a trusted proxy, so one a client wrote into the header itself is ignored. It passes only that address on, and the API (which trusts only proxies on private addresses, as Caddy is) uses it for rate limits and the audit trail.

Apache example (`a2enmod proxy proxy_http headers rewrite ssl`; get the certificate with `certbot --apache -d books.example.com`):

```apache
<VirtualHost *:443>
    ServerName books.example.com
    ProxyPreserveHost On
    ProxyTimeout 300
    RequestHeader set X-Forwarded-Proto "https"
    # flushpackets: Server-Sent Events (/api/events) must not be buffered
    ProxyPass        / http://127.0.0.1:8090/ flushpackets=on
    ProxyPassReverse / http://127.0.0.1:8090/
    # SSLCertificateFile / SSLCertificateKeyFile from certbot
</VirtualHost>
```

The port 80 virtual host just redirects to HTTPS. With nginx use `proxy_pass http://127.0.0.1:8090;`, `proxy_set_header Host $host;`, `proxy_buffering off;` and `client_max_body_size` at least `MAX_UPLOAD_MB`. Only ports 22, 80 and 443 need to be open.

### Email

BookRaven sends three emails, as HTML with a plain-text alternative (templates in `apps/api/src/lib/emails.ts`):

- **Welcome**, once, when an account is created (email form or Google).
- **Password reset**, from *Forgot password?* on the sign-in screen: a link that works once, for one hour, and signs out the account's other sessions.
- **New book request**, to every address in `ADMIN_EMAILS` (except the person asking) when someone requests a book in the Public Library, with a link to the requests.

All go through any SMTP service set in `.env`, for example [Resend](https://resend.com):

```bash
SMTP_URL=smtps://resend:<api key>@smtp.resend.com:465
MAIL_FROM=BookRaven <no-reply@books.example.com>
```

The `MAIL_FROM` domain must be verified with the provider (add the DKIM and SPF records it gives you to your DNS), or messages are rejected or land in spam. Special characters in the user or password part of `SMTP_URL` must be URL-encoded. The API checks the connection at startup and logs `SMTP ready` or `SMTP_URL does not work` (with the reason). Emails are sent in the background: sign-up and the reset request answer right away, a failed send is logged and never shown to the user (and the reset answer is the same whether or not the address has an account). Without `SMTP_URL`, *Forgot password?* is hidden in production and no email is sent: the API log only notes each one's subject, never its recipient or links. In development every email, links included, is printed to the API log instead.

### Logs

The API writes JSON lines to standard output (`docker compose logs -f api`). `LOG_LEVEL` in `.env` sets how much: `info` by default in production (also when it is empty), `debug` in development; `warn` or `error` keep only problems (and the audit trail below). At `info` you get one line when a request arrives and one when it is answered (status and time), plus failures that don't break the request: emails that could not be sent, dictionary or translation services that answer with an error, files that could not be removed after a book was deleted. Health checks and the readers' range requests for a book's file are frequent, so they are logged at `debug` when they succeed; an error answer still shows at `info`, with the request. Keys in URLs (share and invite links, password-reset and verification links) are written as `[redacted]`, also on paths that match no route: a route's key is redacted when its path parameter is named `:token`. Better Auth's own warnings and errors go to the same log, not its info messages (one of them holds the email typed at sign-up).

Security-relevant events form an audit trail: each line has `"audit": true`, an `event` name and, for requests, the client `ip` (passwords and the email typed at sign-in are never logged). It is written at `info` whatever `LOG_LEVEL` says, except `silent`. An administrator's action that stops halfway (some books may already be deleted) is logged as `…_failed` (warn), with the error. `docker compose logs api | grep '"audit":true'` shows them.

| Event | When |
|---|---|
| `auth.account_created`, `auth.signed_in` | a new account (email or Google), any sign-in (`userId`; the new session a password change gets is not a sign-in) |
| `auth.sign_in_failed`, `auth.blocked_sign_in` (warn) | wrong email or password (a blocked account, an unverified email or a rate limit is not a failed sign-in), a blocked account trying to sign in |
| `auth.password_changed`, `auth.password_reset` (and `…_failed`, warn) | password changed from the profile, or reset with an email link (`userId`; a reset link that doesn't work has no account, only the `ip`) |
| `admin.user_updated`, `admin.password_reset`, `admin.user_deleted` | an administrator changes a quota or blocks, sets a temporary password, deletes an account (`adminId`, `userId`, and the deleted account's `email`) |
| `admin.report_resolved`, `admin.file_unblocked` | a report is settled (`action`, `removedCopies`), a blocked file is allowed again |
| `app_password.created`, `app_password.revoked` | app passwords for OPDS / KOReader |
| `app_password.auth_failed` (warn) | an OPDS reader or KOReader sent a wrong app password (`via`) |
| `app_password.blocked_account` (warn) | the right app password of a blocked account (`via`, `userId`) |

### Automatic deploys (GitHub Actions → VPS)

Every push to `main` that passes CI is deployed by `.github/workflows/deploy.yml`: it connects to the VPS over SSH and runs `infra/deploy.sh`, which moves the clone in `/opt/mico-livrao` to the tested commit, builds the images with `docker compose build`, replaces the containers with `docker compose up -d --remove-orphans` and waits for the API to answer (the job fails, with the API log, if it doesn't). After a successful deploy it trims Docker's build cache, which otherwise grows with every deploy, to at most 8 GB, dropping what was used longest ago (meant to keep the latest builds cached, so the next one is fast). This needs the buildx plugin: `sudo apt install docker-buildx` with Ubuntu's `docker.io`, or `docker-buildx-plugin` with Docker's own packages; without it the cache is not trimmed (the deploy still succeeds and says so) and Docker Compose warns that it builds without Bake. Its `deploy:` lines also log the Docker version, storage driver, buildx builder and its GC policy, free disk space, the build time, and the build-cache size before and after the build and after each prune, to show whether Docker's layer cache survives between deploys (it hasn't so far: every step was rebuilt). Before connecting, each job runs `infra/ci-ssh.sh`: SSH connections time out after 20 s and are retried (3 attempts, up to 4 tries 15 s apart), so a short network hiccup between a GitHub runner and the VPS no longer fails a deploy; only this check is retried, never the deploy itself. Keepalives end a connection that stops answering after 3 minutes instead of holding the job until its timeout. `.env`, `data/`, `backups/` and `downloads/` are ignored by git and never touched. In parallel it builds the Android app and publishes it under `/downloads` (see *Android app*). *Actions → Deploy → Run workflow* deploys the current `main` by hand, and `bash infra/deploy.sh` on the server does the same.

One-time setup (tested on a Hostinger KVM VPS with Ubuntu; the *Ubuntu with Docker* template already has Docker):

1. Do steps 1–3 above, with the clone in `/opt/mico-livrao`. In hPanel's VPS firewall, allow ports 22, 80 and 443.
2. Create a user for deploys that may run Docker and owns the clone:
   ```bash
   adduser --disabled-password --gecos "" deploy
   usermod -aG docker deploy
   chown -R deploy:deploy /opt/mico-livrao
   chown -R 1000:1000 /opt/mico-livrao/data   # the API container writes books as uid 1000
   ```
3. On your computer, create a key used only for deploys and install its public half:
   ```bash
   ssh-keygen -t ed25519 -N "" -C "mico-livrao-deploy" -f mico-deploy
   ssh-copy-id -i mico-deploy.pub deploy@<vps ip>
   ssh-keyscan -p 22 <vps ip>          # output goes into VPS_KNOWN_HOSTS
   ```
4. In GitHub, *Settings → Environments*, create the environment `production` (optionally with required reviewers) and add these secrets:

   | Secret | Value |
   |---|---|
   | `VPS_HOST` | IP or hostname of the VPS |
   | `VPS_USER` | `deploy` |
   | `VPS_SSH_KEY` | contents of the private key `mico-deploy` |
   | `VPS_KNOWN_HOSTS` | output of `ssh-keyscan` (pins the server's host key) |

   Optional variables: `VPS_SSH_PORT` (default `22`) and `VPS_APP_DIR` (default `/opt/mico-livrao`).

The VPS builds the images itself, so it needs about 2 GB of free RAM during a deploy (any Hostinger KVM plan has enough). Deploys run one at a time. How the images are built and served:

- **Builds.** Both images are built at the same time, from the committed `pnpm-lock.yaml` (`--frozen-lockfile`), with the pnpm version from `packageManager` in `package.json`. pnpm's package store is kept in Docker's build cache between deploys, so only new or upgraded packages are downloaded (`docker builder prune` frees that cache). The web image runs only the Vite build (plus the landing page's prerender), and the API image compiles with `tsc --noCheck --isolatedModules` (the same output as `pnpm --filter api build` in about half the time; its tsconfig sets `isolatedModules`, so CI enforces it), since CI has already typechecked the commit. Loading the app at the end of the API build still catches a missing module or export.
- **API image.** It holds `dist/` (compiled code, source maps, migrations) and the production dependencies (the workspace package `packages/locator` among them, copied in by `pnpm deploy`), minus packages only present as optional peer dependencies (better-auth's test and React helpers would otherwise bring vitest, vite and React along; `apps/api/scripts/prune-optional-peers.mjs`). The build then loads the app once, so a missing package fails the build and the running containers stay as they are. Node runs with `--enable-source-maps`, so stack traces point at the TypeScript sources.
- **Restarts.** While the API container restarts, Caddy holds incoming API requests for up to 15 s and passes them on as soon as it answers, instead of returning 502.
- **Static files.** The web image ships a brotli (`.br`) and a gzip (`.gz`) copy of every text file, which Caddy serves to browsers that accept them; API responses are still compressed on the fly. Hashed files under `/assets/` are cached for a year; everything else (`index.html`, `sw.js` and its `offline-copies.js`, `manifest.webmanifest`, icons) is revalidated on each use, so a deploy reaches browsers right away.
- **Logs.** Each container keeps at most 3 log files of 10 MB (`docker compose logs`).

**Backups.** The `backup` service writes a database dump and the book files to `./backups/<date>/` every day (`BACKUP_INTERVAL_HOURS`) and deletes backups older than `BACKUP_KEEP_DAYS`. Copy `./backups` off the server too, for example with `restic backup ./backups` to B2 / R2 / another machine. Take one right now with:

```bash
docker compose run --rm -e BACKUP_ONCE=1 backup
```

Restore:

```bash
docker compose stop api
docker compose exec -T postgres pg_restore -U readsync -d readsync --clean --if-exists < backups/<date>/database.dump
tar -xzf backups/<date>/files.tar.gz -C ./data
docker compose start api
```

The CBZ copies of comics (`data/derived`) aren't backed up: the server makes them again when a comic is opened.

With `STORAGE_DRIVER=s3` the book files live in the bucket, so only the database is dumped; turn on versioning or replication on the bucket.

**Object storage.** Set `STORAGE_DRIVER=s3` and the `S3_*` variables to keep books in an S3-compatible bucket (Garage, MinIO, AWS, R2) instead of `./data`.

### Google sign-in

1. In Google Cloud Console, create an OAuth client of type *Web application*.
2. Authorized redirect URI: `https://books.example.com/api/auth/callback/google`.
3. Put the client ID and secret in `.env` and restart the API.

The Google button only shows up when both values are set.

## Android app

The Android app is the same React app wrapped with Capacitor: the interface ships inside the APK and talks to your server over HTTPS (bearer token in Capacitor Preferences; the API already allows the Capacitor origins `https://localhost` and `capacitor://localhost` for CORS). The app id is `app.readsync`. On launch it shows the raven logo on the navy icon background: the native splash (`res/drawable/splash.xml`, and the launcher icon on Android 12+), then the same logo while the web app checks the session.

### Distribution and updates (no Play Store)

Every deploy also builds the app (`android-build` and `android-publish` jobs in `.github/workflows/deploy.yml`) and puts it in `./downloads` on the server, which Caddy serves at `/downloads`:

| File | What it is |
|---|---|
| `/downloads/bookraven.apk` | the newest signed APK (the *Download* page links to it) |
| `/downloads/bookraven-1.<N>.apk` | the same APK by version (the last 3 are kept) |
| `/downloads/bundles/<commit>.zip` | the web app as a live-update bundle (the last 10 are kept) |
| `/downloads/android.json` | the current release: `versionCode`, `versionName`, `nativeVersion`, APK path and size, bundle id/URL/SHA-256, `inputs` |

- **Install:** *Download APK* in the sidebar (`/download`) shows the version, the download button and step-by-step instructions (allow installing from the browser, Play Protect's *Install anyway*). Android 7 or newer.
- **Build cache:** Gradle's downloads and build cache are kept with `actions/cache`, keyed on the Android Gradle files, the wrapper and `pnpm-lock.yaml`; when the key changes, the newest older cache is restored, so a dependency change no longer means a cold build (GitHub drops entries unused for 7 days). Gradle runs with `--build-cache --parallel`, passed on the command line so that `android/`, and with it the native fingerprint, stays unchanged.
- **Versions:** `versionCode` is the number of commits on `main`, `versionName` is `1.<versionCode>`, and the bundle id is the commit.
- **Only when it changed:** `inputs` in `android.json` is a fingerprint of what the release was built from: `apps/web` and `packages/` (without their tests and Docker-only files), the root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `patches/`, `.github/workflows/deploy.yml`, `infra/publish-android.sh` and the server URL. When a push leaves it unchanged (for example an API-only change), the Android jobs skip building and publishing, and installed apps keep the release they have. *Run workflow* always builds. Gradle's downloads are cached between runs, and a failed Gradle build is tried up to 3 times (downloads from `dl.google.com` sometimes time out).
- **Updates:** the app reads `android.json` when it starts and when it comes back after 15 minutes. `nativeVersion` is a fingerprint of the native layer (`apps/web/scripts/native-version.mjs`: the committed `android/` project, `capacitor.config.ts` and the installed Capacitor plugin versions).
  - Same fingerprint as the installed app: the new web bundle is downloaded in the background ([`@capawesome/capacitor-live-update`](https://capawesome.io/plugins/live-update/), self-hosted, checksum-verified) and used from the next start. If a bundle does not start within 10 s it is rolled back to the APK's own and never retried.
  - Different fingerprint (new plugin, permission, icon, Capacitor version…): the app shows *A new version is available*; *Update* downloads the APK and opens Android's installer (the first time Android asks to allow BookRaven to install apps). *App updates* in the sidebar shows the installed version and checks by hand.
- **Signing key:** installed apps only accept updates signed with the same key. The workflow reads it from the GitHub secrets `ANDROID_KEYSTORE_BASE64` (the keystore, base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`; without them the Android jobs are skipped. Keep a backup of the keystore and its password: losing it means everyone has to uninstall and reinstall. To create one:
  ```bash
  keytool -genkeypair -storetype PKCS12 -keystore bookraven-release.jks -alias bookraven -keyalg RSA -keysize 4096 -validity 36500
  base64 -i bookraven-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
  ```
- **Server URL:** the app is built against the GitHub variable `PUBLIC_URL`, or, if it isn't set, the `PUBLIC_URL` in the server's `.env` (read over SSH).

### Local builds

```bash
cd apps/web
cp .env.native.example .env.native     # VITE_API_URL=https://books.example.com
pnpm android:sync                      # builds the web app and copies it into android/
pnpm android:open                      # opens Android Studio → Run / Build APK
```

Local builds are version 1 and debug-signed, so they don't update an app installed from the server (uninstall it first). After adding or upgrading a Capacitor plugin, run `pnpm android:sync` and commit the regenerated `android/` files: they are part of the native fingerprint.

- **Google sign-in on Android:** Google blocks OAuth inside embedded WebViews, so the app hides the Google button for now and you sign in with email + password. Adding it later means a native Google Sign-In plugin that returns an ID token, which you then pass to `authClient.signIn.social({ provider: "google", idToken: { token } })`.

## Public-domain books

The Public Library can be filled with public-domain books from [Project Gutenberg](https://www.gutenberg.org), [Standard Ebooks](https://standardebooks.org) and the [Portuguese Wikisource](https://pt.wikisource.org). By default the importer runs the three, Gutenberg first:

```bash
pnpm --filter api import:public-domain                                           # development: the themed sections (incl. 400 English classics), then 220+ per language
pnpm --filter api import:public-domain -- --per-language 300 --max-pages 25        # more (and how deep to read each search)
pnpm --filter api import:public-domain -- --skip-topics engineering,computer       # leave out some themed searches
pnpm --filter api import:public-domain -- --sources wikisource --wikisource-limit 500   # only some sources (gutenberg, standardebooks, wikisource), and how many
STANDARD_EBOOKS_EMAIL=you@example.com pnpm --filter api import:public-domain -- --sources standardebooks --se-limit 1000   # Standard Ebooks' whole catalog
docker compose run --rm --no-deps api node dist/scripts/import-public-domain.js --per-language 300   # production (own container: survives deploys)
```

- **What gets imported:** books Gutenberg marks as public domain, **and** whose every author and translator died more than 70 full years ago. Gutenberg's own mark covers the USA; "life + 70" is the rule in Brazil, Portugal and most other countries. Works with no known author, or without death dates, are skipped. Index pages, pieces of novels (chapter ranges, "Part 3."; Gutenberg always has the complete book too) and single volumes of a set ("Vol. 2 (of 3)"; imported one by one, sets would end up incomplete) are skipped. **One edition per work:** Gutenberg often has several editions of a book; an edition is skipped when the library already has a book in the same language with the same authors and title (ignoring case, accents, punctuation and alternative titles such as "; Or, The Whale").
- **Where it comes from:** themed sections are chosen from Gutenberg's own catalog file ([pg_catalog.csv.gz](https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv.gz), the whole catalog, updated daily), filtered locally (topic in the subjects or bookshelves, language, authors' death dates); only those books are then looked up on [Gutendex](https://gutendex.com), an open API over Gutenberg's catalog, 32 at a time, for the copyright status, download counts and files, and imported most downloaded first. This is much faster than paging through searches, where most results don't qualify; if the catalog file can't be downloaded, the importer falls back to Gutendex topic searches. The general "most popular" list comes from Gutendex directly. The EPUB files (with images) and covers come from Gutenberg mirrors (gutenberg.nabasny.com, then gutenberg.pglaf.org; Gutenberg asks robots to use mirrors rather than www.gutenberg.org), one at a time with a pause, as Gutenberg asks of automated downloads.
- **Themes first:** for each language the importer first runs themed searches (philosophy, politics, economics, technology/engineering, computing, science, and for English up to 400 literature books from Gutenberg's *Classics of Literature* shelf, keeping only works written in English: a British, American, Irish, Scottish, Canadian or Australian literature category and no translator; quotas in `apps/api/src/lib/themes.ts`), then fills up to `--per-language` with the most popular books overall. Every book is classified into the library's sections from its Library of Congress subjects and Gutenberg bookshelves; books people publish get sections from their tags. Portuguese has far fewer public-domain books on Gutenberg (a few hundred in total), and programming books are practically absent from the public domain, so those sections stay small.
- **Big files:** illustrated editions over 60 MB are replaced by the edition without images.
- **Time:** downloads go one at a time with a pause, so a few hundred books take a couple of hours. Stop it any time; the next run continues.
- **Where it goes:** the books belong to a system account, *BookRaven Library* (`library@readsync.local`), which has no password and cannot sign in. Each book is public, tagged with its source's categories, and links to its page there (Gutenberg, Standard Ebooks or Wikisource). The import is recorded in the `catalog_book` table (source id, authors and translators with their dates, language, subjects, popularity).
- **Standard Ebooks** (English): its open feed lists only the newest releases; the whole catalog is a benefit of its [Patrons Circle](https://standardebooks.org/donate#patrons-circle): set `STANDARD_EBOOKS_EMAIL` (or `--se-email`) to the member's email. Each EPUB's own package document gives the authors **and translators** (the feed doesn't), and the same life + 70 rule applies: death years come from Gutenberg's catalog, then Wikidata; anyone without a known death year keeps the book out. Up to `--se-limit` books per run (default 200), with the feed's summary as description and its cover.
- **Wikisource** (Portuguese): works and editions with a page on pt.wikisource are found through Wikidata, with their authors, translators, original language and genres; the most linked first. A translation needs every translator known and dead more than 70 years; without a translator the work must be written in Portuguese (Wikidata says so, or its authors wrote in Portuguese). Subpages (chapters) and exports under 40 KB (single poems, hymns, declarations) are skipped. Files come from Wikisource's export service (`ws-export`) as EPUB 3. Up to `--wikisource-limit` per run (default 200), only when `pt` is among `--languages`.
- **One edition per work across sources:** a book already in the library from any source (same language, title without subtitle, authors) is not imported again, so the order of the sources decides which edition you get.
- **Running it again** only adds what is missing, so raising `--per-language` later imports the next most popular books. Administrators can still unpublish or block any of them like any other public book.

## Other reading apps (OPDS and KOReader)

Create an **app password** in *Profile → Other apps* for each device; the account password is never accepted by these endpoints.

- **OPDS catalog:** `https://<your server>/opds` (KOReader, Moon+ Reader, Thorium, Calibre…). Username: your email, password: the app password. Browse your library, collections and the Public Library, search, and download.
- **KOReader progress sync:** in KOReader, *Tools → Progress sync → Custom sync server* `https://<your server>/kosync`, then *Login* with your email and the app password, and choose *Binary* document matching. Books are matched by KOReader's partial MD5. PDFs and comics sync page by page in both directions (a PDF or comic position KOReader sends as a percentage opens on the page at that percentage). For ebooks, KOReader positions can't be converted to CFIs: BookRaven offers to jump to KOReader's percentage, and KOReader devices keep exact positions among themselves.

## Tests

```bash
createdb -U readsync readsync_test   # once; the tests reset this database on every run
pnpm test                            # API integration tests, web unit tests, locator codec
```

CI (`.github/workflows/ci.yml`) builds both apps on every push (the build typechecks them, so there is no separate typecheck step), typechecks and tests the locator package (`packages/locator`, a table of every locator form) and runs both apps' test suites (its Postgres service is checked every second, so the tests start as soon as it is ready); when it passes on `main`, the Deploy workflow ships that commit to the VPS (see *Automatic deploys*).

## API overview

JSON answers to `GET /api/...` carry a weak `ETag` with `Cache-Control: private, no-cache`, so browsers revalidate their copy and a matching `If-None-Match` gets an empty 304 (not Better Auth's routes, the event stream, files or OPDS feeds). `/api/config` may be cached for 5 minutes and complete dictionary answers for a day. The server keeps the public catalog in memory until the public library changes; books added by `pnpm import:public-domain` (a separate process) appear within 5 minutes. Caddy compresses JSON but not the event stream (`/api/events`).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | public: Google enabled, sign-up open, max upload, password reset / dictionary / translation available |
| * | `/api/auth/*` | Better Auth (sign-up/in/out, Google callback, session, change/reset password) |
| GET | `/api/me` | role and storage use |
| GET/POST | `/api/books` | library (without each book's `description`, which only the book's page shows; live events leave it out too); multipart upload `title`, `author`, `description`, `folderId` (optional collection), `cover`, `file` |
| GET/PATCH/DELETE | `/api/books/:id` | GET includes the `description`; PATCH: title, author, collection, tags, favorite, public |
| GET | `/api/books/:id/file`, `/cover` | Range requests, ETag (`?download=1` to save; `?as=cbz` serves a CBR/CB7/CBT as its CBZ copy, 422 if it can't be converted). The file route allows 3000 requests a minute, since readers fetch books in many small ranges; CORS preflights are cached for 2 hours |
| GET | `/api/books/:id/about` | book page: description, other readers (a count), public-library entry, source and subjects |
| GET/PUT | `/api/books/:id/progress` | newest wins |
| GET | `/api/stats` | reading history by hour (last ~400 days) for the stats page |
| * | `/api/books/:id/highlights`, `/api/highlights/:id` | highlights and notes |
| GET | `/api/books/:id/ink` | handwritten PDF pages: `[{ page, version, strokes, updatedAt }]` (pages erased empty stay, with their version); `?pages=3,4,5` only those pages; `?summary=1` every page's `{ page, version, count }` without strokes (the reader opens with this and loads strokes around the page being read) |
| GET | `/api/books/:id/ink/:page` | one page: `{ page, version, strokes, updatedAt }` (version 0 if never written on) |
| POST | `/api/books/:id/ink/:page` | `{ add?: Stroke[], remove?: strokeId[] }` applies a change to a page's handwriting (a stroke is `{ id, tool: pen \| highlighter, color, width, points: [x, y, pressure, …] }`, in page fractions); returns `{ page, version, updatedAt }`, and the `ink.updated` event carries the change and the new version; at most 5000 strokes / 2 MB per page |
| GET, PUT, DELETE | `/api/books/:id/bookmarks` | bookmarked pages; PUT `{ locator, percentage, label?, title? }` adds or updates the bookmark on that page, DELETE `?locator=` removes it (idempotent) |
| * | `/api/folders`, `/api/books/:id/share`, `/api/shares/:token` | collections, share links |
| * | `/api/folders/:id/share`, `/api/collection-shares/:token` | collection share links: create/revoke, preview, `POST …/accept` copies every book |
| * | `/api/public/*`, `/api/requests/*` | public library (`GET /api/public` lists up to 1000 books without descriptions; `GET /api/public/:id` for a book's page, with its description; download, add, report) and book requests |
| * | `/api/clubs/*` | book clubs, invites, messages |
| GET/POST | `/api/dictionary`, `/api/translate` | lookups for selected text |
| GET | `/api/dictionary/word?word=&to=&from=&lang=` | word dictionary: detected language (`from`, `alternatives`), translation into `to` and definitions; `to`/`from` in `en`, `es`, `pt`, `fr`, `it`; `lang` is the book's language (a hint) |
| * | `/api/app-passwords` | passwords for OPDS / KOReader |
| * | `/api/admin/*` | administrators: stats, accounts, reports, blocked files |
| GET/PUT | `/api/settings` | reader preferences (JSON) |
| GET | `/api/events` | SSE: progress, settings, books, public library, requests, clubs |
| * | `/opds/*`, `/kosync/*` | OPDS catalog and KOReader sync (app-password auth) |

## Known limitations / next steps

- DRM-protected books (bought on Kindle, Kobo, …) can't be opened. Only DRM-free files work.
- The Android app's update flow (live updates and APK updates) still needs testing on a real device.
- **Google sign-in on Android** still needs a native Google Sign-In plugin and an Android OAuth client in Google Cloud (see *Android app* above).
- Comics: CBR support relies on 7-Zip's RAR decoder; password-protected archives can't be opened.
- pdf.js checks a PDF's last page when it opens; in PDFs whose page tree is one flat list, with page objects spread through the file (rare, mostly hand-made PDFs), that means reading every page object, so opening downloads more of those files.
- KOReader can't receive BookRaven positions for reflowable ebooks (only PDFs and comics), see above.
- Handwriting stays in BookRaven: it isn't written into the PDF file (downloads and KOReader don't show it). A *Download PDF with annotations* option is planned.
- SSE runs in memory, which is fine for one API instance. To run several, send events through Postgres `LISTEN/NOTIFY`.
