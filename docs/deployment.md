# Deployment guide

**Status: not deployed.** This workspace had no hosting account, managed database or credentials, so no deployment or live
smoke test has been performed or claimed. This guide describes what a deployment needs. Follow it, then run the smoke test below
and record the real results in `docs/checkpoints/checkpoint-g.md`.

## Components

| Component | What                                                                                               | Notes                                                                         |
| --------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Web       | Static files from `npm run build -w @prepflow/web`                                                 | `apps/web/dist`. Needs SPA fallback (every unknown path serves `index.html`). |
| API       | Node 22.22.2+, 24.15.0+, or 26.0.0+ process, `npm run build` then `npm run start -w @prepflow/api` | Single process; analyses run inside it (see limitations).                     |
| Database  | PostgreSQL 14+ (16 tested in CI)                                                                   | Apply migrations with `npm run db:deploy`.                                    |
| AI        | Hosted Gemini API (`AI_PROVIDER=gemini`) or reachable Ollama                                       | `fake` is refused when `NODE_ENV=production`.                                 |

## Environment variables (API)

Set real environment variables on the host; do not ship a `.env` file. Required: `DATABASE_URL`, `CLIENT_URL` (exact public web
origin(s), comma-separated), `NODE_ENV=production`, and for hosted AI `AI_PROVIDER=gemini` + `GEMINI_API_KEY`. Everything else is
listed in `apps/api/.env.example` and the README table. In production the API trusts one proxy hop (`trust proxy = 1`) so rate
limits apply per client IP behind a single load balancer; if you run behind more than one proxy, adjust `app.ts`.

## Web build

Same origin (recommended): serve the web build and proxy `/api` to the API from one host. No web configuration is needed.

Different origins: build the web app with `VITE_API_BASE_URL=https://your-api-host` (no trailing slash, no `/api`), and add the web
origin to the API's `CLIENT_URL`. The value is public (it ends up in the bundle); never put secrets in `VITE_*` variables.

## Steps

1. Provision PostgreSQL; create the database and a least-privilege user.
2. Set API environment variables; run `npm ci && npm run build`.
3. Run `npm run db:deploy` once per release (applies committed migrations; never `db:migrate` in production).
4. Start the API: `npm run start -w @prepflow/api` (runs `node dist/server.js`). It handles SIGTERM with a 10 s
   forced-exit timeout.
5. Publish `apps/web/dist` with SPA fallback; set `VITE_API_BASE_URL` at build time if the API is on another origin.
6. Check `GET /api/health` returns 200 and the database check passes.

## Smoke test (record real results)

Create a workspace → add pasted text → add a text PDF → start analysis and wait for completion → review/edit a topic → generate a
plan → open Today → start, complete, reload (completion persists), undo → skip → miss a day and recover → rebalance → check Progress
→ upload an invalid PDF (clear error) → stop the AI provider and start an analysis (graceful failure) → reload during an analysis.

## Known deployment limitations

No accounts (UUID is the access key); one API process runs analyses (a restart marks active runs failed); no job queue; hosted AI
sends material chunks to the provider; no external penetration test or production configuration review has been done.
