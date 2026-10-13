# ReadSync

Self-hosted reader (ebooks, PDFs, comics) with cross-device progress sync. pnpm monorepo:
`apps/api` (Fastify + PostgreSQL + Better Auth) and `apps/web` (React + Vite, also the Capacitor Android app).
See README.md for setup, features and the API overview.

## Rules

- **No employer or company references.** Never put the name, domain or email address of the
  developer's employer or any other company (for example the domain of the account owner's email
  address) anywhere in this project: code, identifiers (Android app id, package names), comments,
  docs, test data, commit messages, or accounts created for testing or administration. Use neutral
  names such as `app.readsync`, `example.com` or `readsync.local`.
- Never commit secrets, `.env` files, the `data/` and `backups/` folders, or real user books.
- Run `pnpm typecheck` and `pnpm test` before committing (API tests need the `readsync_test`
  database, see README → Tests).
- New database changes go in a new numbered file in `apps/api/src/migrations/`; never edit an
  existing migration.
