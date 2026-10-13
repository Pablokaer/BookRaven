# Mico-livrão

Self-hosted reader for ebooks (EPUB, MOBI, AZW3, FB2), PDFs and comics (CBZ, CBR, CB7, CBT) that saves your exact reading position and lets you continue on any device: web browser, Android app, or e-ink readers through KOReader.

The app is called **Mico-livrão**. Internal identifiers (package names, the database, storage and cache keys, the `readsync.local` example domain) still use `readsync`, so existing data and installs keep working.

## Features

- **Accounts:** email + password (change it in the profile, or reset it by email), plus Google sign-in on the web. Sign-ups can be closed with `ALLOW_SIGNUP=false`.
- **Library dashboard:** upload by button or drag-and-drop (title, author and cover are read from the file; duplicates are detected by SHA-256). Collections, tags, favorites, filters by type, sorting, grid or list, a yearly reading goal, and a 2 GB storage limit per account (`UPLOAD_QUOTA_MB`; administrators are unlimited).
- **Ebook reader** (foliate-js): 8 bundled fonts, size, line and letter spacing, margins, page width, one or two pages, themes (including inverted) and contrast; table of contents and full-text search.
- **PDF reader** (pdf.js): streams large files with Range requests, fit page or width, color themes, and a selectable text layer so PDFs get highlights, notes and search too.
- **Comics:** CBZ, CBR (RAR), CB7 (7-Zip) and CBT (TAR), unpacked in the browser (7-Zip compiled to WebAssembly); natural page order, ComicInfo.xml metadata, two-page spreads with the cover alone, automatic detection of double-page scans, manga right-to-left, a vertical-scroll (webtoon) layout and a magnifier.
- **Highlights and notes** in four colors, exported as Markdown; **dictionary** (Wiktionary) and **translation** (Chrome's on-device translator, MyMemory or a self-hosted LibreTranslate) for selected text.
- **Progress sync** (the core feature):
  - The position is an **EPUB CFI** for ebooks (exact even when font size or screen changes), `page:N` for PDFs, and the page for comics.
  - Positions are saved with a 1.5 s delay, kept in a local outbox while offline, and sent immediately when the app goes to the background or the tab closes.
  - The server keeps the **newest** position, judged by when the page was actually reached. A device that comes back online late can't overwrite newer progress.
  - Live updates over **Server-Sent Events**: if you read ahead on another device, the open reader offers to jump there. Reader settings sync too.
- **Sharing:** share a book by link, publish it to the **Public Library** (everyone on the server can read or download it), request books there and vote on requests, and read together in **book clubs** (members see each other's progress and discuss passages).
- **Public-domain collection:** an importer fills the Public Library with hundreds of popular public-domain books in English and Portuguese from Project Gutenberg (see below). The Public Library is organised in **sections by theme** (philosophy, politics, economics, technology, computing, science, history, literature, poetry, religion, children), with a language filter, popularity ranking and a link back to the source.
- **Other apps:** an **OPDS** catalog and a **KOReader** progress-sync server, with per-device app passwords.
- **Offline:** the web app opens without a connection and shows your saved library; books you opened (or saved for offline) can be read.
- **Administration:** accounts (storage limits, blocking, temporary passwords, deletion) and content reports on public books (dismiss, unpublish, block the file or delete it everywhere).

## Stack

| Layer | Tech |
|---|---|
| Web app | React 19, Vite, TypeScript, Tailwind CSS 4, React Router |
| Readers | foliate-js (EPUB/MOBI/AZW3/FB2/CBZ), pdf.js legacy build (works on Android WebViews) |
| Android | Capacitor 8 (same codebase; bearer-token auth) |
| API | Node 22, Fastify 5, Better Auth (email + Google, bearer plugin) |
| Database | PostgreSQL 16 (`pg` + plain SQL migrations) |
| Files | Content-addressed (`books/ab/cd/<sha256>`) on local disk or any S3-compatible bucket (Garage, MinIO, AWS, R2) |
| Tests | Vitest (API integration tests against PostgreSQL, web unit tests), GitHub Actions CI |
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
infra/deploy.sh          update the VPS to a commit and restart (used by the Deploy workflow)
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
   git clone https://github.com/Pablokaer/MicoLivrao.git /opt/mico-livrao
   cd /opt/mico-livrao
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

### Automatic deploys (GitHub Actions → VPS)

Every push to `main` that passes CI is deployed by `.github/workflows/deploy.yml`: it connects to the VPS over SSH and runs `infra/deploy.sh`, which moves the clone in `/opt/mico-livrao` to the tested commit, rebuilds the images with `docker compose up -d --build` and waits for the API to answer (the job fails, with the API log, if it doesn't). `.env`, `data/` and `backups/` are ignored by git and never touched. *Actions → Deploy → Run workflow* deploys the current `main` by hand, and `bash infra/deploy.sh` on the server does the same.

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

The VPS builds the images itself, so it needs about 2 GB of free RAM during a deploy (any Hostinger KVM plan has enough). Deploys run one at a time; a short pause in service while the containers restart is expected.

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

With `STORAGE_DRIVER=s3` the book files live in the bucket, so only the database is dumped; turn on versioning or replication on the bucket.

**Object storage.** Set `STORAGE_DRIVER=s3` and the `S3_*` variables to keep books in an S3-compatible bucket (Garage, MinIO, AWS, R2) instead of `./data`.

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

- The Android app id is `app.readsync`. Builds made before this id was set used a different one, so they install as a separate app: uninstall the old one and sign in again.
- The app loads its interface from inside the APK and talks to your VPS over HTTPS. It stores a bearer token in Capacitor Preferences.
- The API already allows the Capacitor origins (`https://localhost`, `capacitor://localhost`) for CORS.
- **Google sign-in on Android:** Google blocks OAuth inside embedded WebViews, so the app hides the Google button for now and you sign in with email + password. Adding it later means a native Google Sign-In plugin that returns an ID token, which you then pass to `authClient.signIn.social({ provider: "google", idToken: { token } })`.

## Public-domain books

The Public Library can be filled with popular public-domain books from [Project Gutenberg](https://www.gutenberg.org):

```bash
pnpm --filter api import:public-domain                                           # development: 220 English + 220 Portuguese
pnpm --filter api import:public-domain -- --per-language 300 --max-pages 25        # more (and how deep to read each search)
pnpm --filter api import:public-domain -- --skip-topics engineering,computer       # leave out some themed searches
docker compose exec api node dist/scripts/import-public-domain.js --per-language 300   # production
```

- **What gets imported:** books Gutenberg marks as public domain, **and** whose every author and translator died more than 70 full years ago. Gutenberg's own mark covers the USA; "life + 70" is the rule in Brazil, Portugal and most other countries. Works with no known author, or without death dates, are skipped.
- **Where it comes from:** the list (most downloaded first) from [Gutendex](https://gutendex.com), an open API over Gutenberg's catalog; the EPUB files (with images) and covers from Gutenberg's official mirror, one at a time with a pause, as Gutenberg asks of automated downloads.
- **Themes first:** for each language the importer first runs themed searches (philosophy, politics, economics, technology/engineering, computing, science; quotas in `apps/api/src/lib/themes.ts`), then fills up to `--per-language` with the most popular books overall. Every book is classified into the library's sections from its Library of Congress subjects and Gutenberg bookshelves; books people publish get sections from their tags. Portuguese has far fewer public-domain books on Gutenberg (a few hundred in total), and programming books are practically absent from the public domain, so those sections stay small.
- **Big files:** illustrated editions over 60 MB are replaced by the edition without images.
- **Time:** downloads go one at a time with a pause, so a few hundred books take a couple of hours. Stop it any time; the next run continues.
- **Where it goes:** the books belong to a system account, *Mico-livrão Library* (`library@readsync.local`), which has no password and cannot sign in. Each book is public, tagged with Gutenberg's categories, and links to its Gutenberg page. The import is recorded in the `catalog_book` table (source id, authors and translators with their dates, language, subjects, popularity).
- **Running it again** only adds what is missing, so raising `--per-language` later imports the next most popular books. Administrators can still unpublish or block any of them like any other public book.

## Other reading apps (OPDS and KOReader)

Create an **app password** in *Profile → Other apps* for each device; the account password is never accepted by these endpoints.

- **OPDS catalog:** `https://<your server>/opds` (KOReader, Moon+ Reader, Thorium, Calibre…). Username: your email, password: the app password. Browse your library, collections and the Public Library, search, and download.
- **KOReader progress sync:** in KOReader, *Tools → Progress sync → Custom sync server* `https://<your server>/kosync`, then *Login* with your email and the app password, and choose *Binary* document matching. Books are matched by KOReader's partial MD5. PDFs and comics sync page by page in both directions. For ebooks, KOReader positions can't be converted to CFIs: Mico-livrão offers to jump to KOReader's percentage, and KOReader devices keep exact positions among themselves.

## Tests

```bash
createdb -U readsync readsync_test   # once; the tests reset this database on every run
pnpm test                            # API integration tests + web unit tests
```

CI (`.github/workflows/ci.yml`) runs typechecks, both test suites and the build on every push; when it passes on `main`, the Deploy workflow ships that commit to the VPS (see *Automatic deploys*).

## API overview

| Method | Path | Notes |
|---|---|---|
| GET | `/api/config` | public: Google enabled, sign-up open, max upload, password reset / dictionary / translation available |
| * | `/api/auth/*` | Better Auth (sign-up/in/out, Google callback, session, change/reset password) |
| GET | `/api/me` | role and storage use |
| GET/POST | `/api/books` | library; multipart upload `title`, `author`, `cover`, `file` |
| GET/PATCH/DELETE | `/api/books/:id` | PATCH: title, author, collection, tags, favorite, public |
| GET | `/api/books/:id/file`, `/cover` | Range requests, ETag (`?download=1` to save) |
| GET/PUT | `/api/books/:id/progress` | newest wins |
| * | `/api/books/:id/highlights`, `/api/highlights/:id` | highlights and notes |
| * | `/api/folders`, `/api/books/:id/share`, `/api/shares/:token` | collections, share links |
| * | `/api/public/*`, `/api/requests/*` | public library (download, add, report) and book requests |
| * | `/api/clubs/*` | book clubs, invites, messages |
| GET/POST | `/api/dictionary`, `/api/translate` | lookups for selected text |
| * | `/api/app-passwords` | passwords for OPDS / KOReader |
| * | `/api/admin/*` | administrators: stats, accounts, reports, blocked files |
| GET/PUT | `/api/settings` | reader preferences (JSON) |
| GET | `/api/events` | SSE: progress, settings, books, public library, requests, clubs |
| * | `/opds/*`, `/kosync/*` | OPDS catalog and KOReader sync (app-password auth) |

## Known limitations / next steps

- DRM-protected books (bought on Kindle, Kobo, …) can't be opened. Only DRM-free files work.
- The Android app has not been rebuilt and tested with the latest web changes; run `pnpm android:sync` and try downloads (saved to *Documents/Mico-livrão*) on a device.
- **Google sign-in on Android** still needs a native Google Sign-In plugin and an Android OAuth client in Google Cloud (see *Android app* above).
- Comics: CBR support relies on 7-Zip's RAR decoder; password-protected archives can't be opened.
- KOReader can't receive Mico-livrão positions for reflowable ebooks (only PDFs and comics), see above.
- SSE runs in memory, which is fine for one API instance. To run several, send events through Postgres `LISTEN/NOTIFY`.
