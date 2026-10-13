# ReadSync

Self-hosted reader for PDF and ebooks (EPUB, MOBI, AZW3, FB2, CBZ) that saves your exact reading position and lets you continue on any device: web browser or Android app.

## Features (MVP)

- **Accounts:** email + password, plus Google sign-in on the web. Sign-ups can be closed with `ALLOW_SIGNUP=false`.
- **Library:** upload by button or drag-and-drop. Title, author and cover are read from the file. Duplicates are detected by SHA-256 hash, and you can search and delete books.
- **PDF reader** (pdf.js):
  - Loads large files in pieces (HTTP Range requests)
  - Fit to whole page or page width
  - Light / sepia / dark / inverted themes, plus a contrast setting
- **Ebook reader** (foliate-js):
  - 8 fonts, bundled so they work offline (Literata, Merriweather, Source Sans, Atkinson Hyperlegible, OpenDyslexic, …)
  - Font size, line spacing, margins, justification
  - 1 or 2 columns
  - Themes, including **Inverted** (white text on a black background), and a contrast setting
  - Table of contents
- **Page turning:** arrow keys / PageUp / PageDown / Space; swipe left or right; tap the left or right third of the page (the middle toggles the menu). Android's back button is handled.
- **Progress sync** (the core feature):
  - The position is an **EPUB CFI** for ebooks (exact even when font size or screen changes) and `page:N` for PDFs.
  - Positions are saved with a 1.5 s delay, kept in a local outbox while offline, and sent immediately when the app goes to the background or the tab closes.
  - The server keeps the **newest** position, judged by when the page was actually reached. A device that comes back online late can't overwrite newer progress.
  - Live updates over **Server-Sent Events**: if you read ahead on another device, the open reader shows *"You reached 56% on Android phone. Jump there?"*. The same check runs when you return to the app.
  - Reader settings also sync across devices.

## Stack

| Layer | Tech |
|---|---|
| Web app | React 19, Vite, TypeScript, Tailwind CSS 4, React Router |
| Readers | foliate-js (EPUB/MOBI/AZW3/FB2/CBZ), pdf.js legacy build (works on Android WebViews) |
| Android | Capacitor 8 (same codebase; bearer-token auth) |
| API | Node 22, Fastify 5, Better Auth (email + Google, bearer plugin) |
| Database | PostgreSQL 16 (`pg` + plain SQL migrations) |
| Files | Local disk, content-addressed (`data/books/ab/cd/<sha256>`), behind a `storage.ts` module that can be swapped for S3/Garage |
| Realtime | SSE (`GET /api/events`) |
| Proxy / TLS | Caddy (automatic HTTPS) |

## Project layout

```
apps/
  api/                Fastify API
    src/auth.ts       Better Auth config + requireUser
    src/routes/       auth, books (upload/file/cover), progress, settings, events (SSE)
    src/lib/          storage, format detection (magic bytes), SSE hub
    src/migrations/   SQL migrations (run automatically on start)
  web/                React app (also the Capacitor Android app)
    src/reader/       EpubReader (foliate-js), PdfReader (pdf.js), settings + TOC panels
    src/lib/          api client, auth, progress sync/outbox, SSE client, settings, fonts
    android/          Capacitor Android project
infra/Caddyfile
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
2. Copy the repo to the server and create `.env`:
   ```bash
   cp .env.example .env
   # set DOMAIN, PUBLIC_URL, POSTGRES_PASSWORD (also inside DATABASE_URL),
   # BETTER_AUTH_SECRET (openssl rand -base64 32), optional Google keys
   ```
3. Start everything:
   ```bash
   docker compose up -d --build
   ```
   Caddy gets the TLS certificate automatically. Database migrations run when the API starts.
4. Create your account. Then set `ALLOW_SIGNUP=false` and run `docker compose up -d` again if you don't want other people signing up.

**Backups.** Everything that matters is in the `pgdata` volume and `./data`. For example:

```bash
docker compose exec -T postgres pg_dump -U readsync readsync | gzip > backup-$(date +%F).sql.gz
restic backup ./data backup-*.sql.gz   # to B2 / R2 / another server
```

### Google sign-in

1. In Google Cloud Console, create an OAuth client of type *Web application*.
2. Authorized redirect URI: `https://books.example.com/api/auth/callback/google`.
3. Put the client ID and secret in `.env` and restart the API.

The Google button only shows up when both values are set.

## Android app

```bash
cd apps/web
cp .env.native.example .env.native     # VITE_API_URL=https://books.example.com
pnpm android:sync                      # builds the web app and copies it into android/
pnpm android:open                      # opens Android Studio → Run / Build APK
```

- The app loads its interface from inside the APK and talks to your VPS over HTTPS. It stores a bearer token in Capacitor Preferences.
- The API already allows the Capacitor origins (`https://localhost`, `capacitor://localhost`) for CORS.
- **Google sign-in on Android:** Google blocks OAuth inside embedded WebViews, so the app hides the Google button for now and you sign in with email + password. Adding it later means a native Google Sign-In plugin that returns an ID token, which you then pass to `authClient.signIn.social({ provider: "google", idToken: { token } })`.

## API overview

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | public: Google enabled, sign-up open, max upload |
| * | `/api/auth/*` | Better Auth (sign-up/in/out, Google callback, session) |
| GET | `/api/books` | library with each book's latest progress |
| POST | `/api/books` | multipart: `title`, `author`, `cover`, `file` |
| GET/PATCH/DELETE | `/api/books/:id` | |
| GET | `/api/books/:id/file` | Range requests, ETag |
| GET | `/api/books/:id/cover` | |
| GET/PUT | `/api/books/:id/progress` | PUT `{locator, percentage, label, deviceId, deviceName, clientUpdatedAt}`; newest wins |
| GET/PUT | `/api/settings` | reader preferences (JSON) |
| GET | `/api/events` | SSE: `progress.updated`, `settings.updated`, `book.*` |

## Known limitations / next steps

- DRM-protected books (bought on Kindle, Kobo, …) can't be opened. Only DRM-free files work.
- EPUB, PDF and the sync flow were tested end-to-end in a browser. MOBI/AZW3/FB2/CBZ rely on foliate-js and were only covered by format-detection checks. Try a few of your own files.
- Offline mode is partial. Opened ebooks are cached in Cache Storage and progress is queued while offline, but the library list and PDFs still need the network. Full offline support is the next step.
- Not built yet: bookmarks, highlights and notes, search inside a book, volume-key page turning on Android, reading stats.
- SSE runs in memory, which is fine for one API instance. To run several, send events through Postgres `LISTEN/NOTIFY`.
