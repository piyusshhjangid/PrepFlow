# 0002: Environment loading and the test database

**Status:** accepted (Checkpoint C)

## Problem

`import 'dotenv/config'` reads `.env` from the _current working directory_. `npm run dev -w @prepflow/api` starts
the API inside `apps/api`, so a `.env` kept in the repository root (a very natural place to put it) was never
found and the API died with `DATABASE_URL: expected string, received undefined`. Separately, the integration
tests were pointed at a `test:test@…/test` URL that did not exist, which surfaced as Prisma
"User was denied access" for every repository test, before any repository logic ran.

## Decision

- `apps/api/src/config/load-env.ts` resolves `.env` files **relative to the source file**, not the cwd, and
  loads `apps/api/.env` first, then the repository-root `.env`. Real environment variables always win
  (that is how production is configured). Seed, `db:check` and the Prisma wrapper use the same loader.
- Validation was not weakened. A missing variable still stops startup, but the message now lists which `.env`
  files were looked for and what to do.
- `DATABASE_URL` is the development/production database. `TEST_DATABASE_URL` is a **separate** database used only
  by `npm run test:integration`. `assertSafeTestDatabase` refuses to run when it is unset, when its name does not
  contain "test", or when it points at the same database as `DATABASE_URL`, so tests can never delete development data.
- Plain `npm test` never touches a database (in-memory repositories); integration tests live in
  `*.integration.test.ts`, run by their own Vitest config, and **fail instead of silently skipping** when
  the test database is not usable.
- Prisma CLI commands go through `scripts/prisma-run.ts` so they see the same environment as the API.
- `npm run db:check` verifies, step by step: env files → URL → connection/credentials → migrations applied →
  schema usable, and prints a specific fix for each failure (wrong password, missing database, unapplied migrations).

## Consequences

Docker stays optional; a normally installed PostgreSQL is the primary path (documented for Windows in the README).
