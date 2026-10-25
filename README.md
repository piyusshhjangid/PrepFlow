# PrepFlow

Turn your syllabus and notes into a realistic, prioritized study plan.

> **Status:** local product implementation and submission materials are in progress. Topic review, deterministic
> planning, daily execution, revision and progress are implemented. Production deployment and real-user feedback are
> **not verified**. See [the checkpoint reports](docs/checkpoints/) and [submission package](docs/submission/).

## What it does

Give PrepFlow your syllabus, notes, exam date and daily study time. An open-weight **Gemma** model reads the material
and structures it into subjects and topics, **with a verifiable quote from your material as evidence for every topic**.
Deterministic code (not the model) then validates, merges and estimates effort, scores every topic's priority, and builds an
**explainable day-by-day study plan** with spaced revision. If everything can't fit, PrepFlow says so, protects the
highest-priority topics and shows exactly what it deferred.

```
PDF/text → extraction → chunking → Gemma → tolerant JSON parse → Zod → evidence verification
        → merge + effort estimate → PostgreSQL
        → priority engine → prerequisite graph → capacity / fit → planner → revision → Today → progress
```

PrepFlow is not a chatbot and not "chat with your PDF". The model produces structured analysis; application code owns
validation, persistence, calculations, limits and business rules. Details: [docs/analysis.md](docs/analysis.md) and
[docs/planning.md](docs/planning.md).

## Repository layout

```
apps/api         Express + TypeScript + Prisma backend (AI layer in src/ai)
apps/web         React + TypeScript + Vite + Tailwind frontend
packages/shared  Zod schemas and types shared by both
docs/            Pipeline docs and architecture decisions (docs/decisions/)
```

## Prerequisites

- Node.js 22.22.2+, 24.15.0+, or 26.0.0+ and npm 10+. These minimums match the locked runtime and test dependencies.
- PostgreSQL (developed and tested against 16). A normally installed PostgreSQL is the primary supported path; **Docker is optional**.
- For local AI: [Ollama](https://ollama.com) (see "AI setup"). For hosted AI: a Google AI Studio API key.

## 1. Database setup

### Windows (local PostgreSQL, no Docker)

1. Install PostgreSQL from <https://www.postgresql.org/download/windows/> (the EnterpriseDB installer). Remember the password you
   set for the `postgres` superuser. Keep the default port `5432`.
2. Open **SQL Shell (psql)** from the Start menu (press Enter through host/database/port/user, then enter the `postgres` password), or use
   the Query Tool in pgAdmin, and run:

```sql
CREATE USER prepflow WITH PASSWORD 'prepflow' CREATEDB;
CREATE DATABASE prepflow OWNER prepflow;
CREATE DATABASE prepflow_test OWNER prepflow;
```

`prepflow` is the development database, `prepflow_test` the separate database that integration tests use (they delete data, so they
must never share a database with your real work). `CREATEDB` is needed because `prisma migrate dev` creates a temporary shadow database.

macOS/Linux: the same SQL, run with `psql -U postgres` (or `sudo -u postgres psql`).

### Docker (optional)

```bash
npm run db:up      # PostgreSQL 16 with the prepflow/prepflow credentials, database "prepflow"
npm run db:down
```

Then create the test database once: `docker compose exec db psql -U prepflow -c "CREATE DATABASE prepflow_test;"`.

### Using your own user/database instead

Skip the SQL and put your own URLs in `.env` (below). URL-encode special characters in passwords (`@` → `%40`, `#` → `%23`).

## 2. Configuration

```bash
npm install                                   # also runs `prisma generate` (needs internet the first time)
cp apps/api/.env.example apps/api/.env        # PowerShell: Copy-Item apps/api/.env.example apps/api/.env
```

`.env` is found **regardless of which directory you run npm from**: the API looks for `apps/api/.env`, then a `.env` in the repository
root. Real environment variables always win over files (production). `.env` is git-ignored; never commit it.
If a required variable is missing the API stops at startup and tells you exactly which one and where it looked.

| Variable                                                                         | Required              | Meaning                                                                                     |
| -------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                   | yes                   | Development/production database                                                             |
| `TEST_DATABASE_URL`                                                              | for integration tests | Separate test database; name must contain "test" and differ from `DATABASE_URL`             |
| `CLIENT_URL`                                                                     | yes                   | Allowed browser origin(s) for CORS, comma-separated                                         |
| `PORT`, `NODE_ENV`                                                               | no                    | Default 4000 / development                                                                  |
| `AI_PROVIDER`                                                                    | no                    | `ollama` (default), `gemini`, or `fake` (tests/demos only)                                  |
| `AI_MODEL`                                                                       | no                    | Overrides the provider's model                                                              |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_NUM_CTX`                              | no                    | Local Gemma. Defaults: `http://localhost:11434`, `gemma4:e4b`, `16384`                      |
| `GEMINI_API_KEY`                                                                 | if `gemini`           | Hosted Gemma key. Never commit it                                                           |
| `GEMINI_MODEL`, `GEMINI_BASE_URL`                                                | no                    | Default `gemma-4-26b-a4b-it`                                                                |
| `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_ATTEMPTS`, `AI_RETRY_BASE_DELAY_MS`             | no                    | Per-call timeout (180000), attempts for transient failures (3), backoff (1000)              |
| `AI_CHUNK_TARGET_CHARS`, `AI_CHUNK_MAX_CHARS`, `AI_MAX_CHUNKS`                   | no                    | Defaults: ollama 12000/15000, gemini 20000/25000; at most 40 chunks                         |
| `ANALYSIS_MAX_CONCURRENT`, `ANALYSIS_RATE_LIMIT`, `ANALYSIS_RATE_WINDOW_MINUTES` | no                    | 1 concurrent analysis; 10 starts per IP per 60 min                                          |
| `ANALYSIS_STALE_AFTER_MS`                                                        | no                    | A run with no heartbeat for this long counts as interrupted (900000)                        |
| `MAX_PDF_MB`, `MAX_PDF_PAGES`, `MAX_MATERIAL_CHARS`, `MAX_MATERIALS_PER_EXAM`    | no                    | Material limits (10 MB, 100 pages, 200000 chars, 10 materials)                              |
| `VITE_API_BASE_URL` (web build)                                                  | no                    | API origin when it differs from the web app's; see [docs/deployment.md](docs/deployment.md) |

## 3. Create tables, check, seed, run

```bash
npm run db:migrate         # applies migrations to the development database (prisma migrate dev)
npm run db:check           # verifies env → connection → credentials → migrations → schema, with a fix for each failure
npm run db:seed            # fictional demo data (optional)

npm run dev:api            # terminal 1: API on http://localhost:4000
npm run dev:web            # terminal 2: web app on http://localhost:5173
```

Open <http://localhost:5173>, fill in the setup, add material, then **Analyze my material**.
If the web app shows `ECONNREFUSED` for `/api/...`, the API is not running (start `npm run dev:api` and read its output;
`npm run db:check` diagnoses database problems).

Production-style migration without creating a shadow database: `npm run db:deploy`.

## 4. AI setup

### Local: Ollama + Gemma (default)

```bash
# install Ollama from https://ollama.com, then:
ollama pull gemma4:e4b
# AI_PROVIDER=ollama is the default; Ollama listens on http://localhost:11434
```

Use a smaller/larger model by changing `OLLAMA_MODEL`. Local models can be slow on CPUs: a 12,000-character chunk takes
from seconds (GPU) to minutes (CPU). `AI_REQUEST_TIMEOUT_MS` bounds each call.

### Hosted: Gemma through the Gemini API

```
AI_PROVIDER=gemini
GEMINI_API_KEY=<your key from https://aistudio.google.com/apikey>
GEMINI_MODEL=gemma-4-26b-a4b-it
```

Model availability depends on your account; if the API reports the model as not found, check the exact model id in AI Studio.

### Verify the real provider (opt-in smoke test)

```bash
npm run ai:smoke
```

Runs the configured provider on a tiny built-in text and checks configuration → connectivity → model call → parsing →
schema validation → evidence verification. It exits non-zero with a specific fix if any step fails, and refuses `AI_PROVIDER=fake`.
It is never part of `npm test`.

## 5. Tests

```bash
npm test                   # shared + API + web. No database, no AI, no network needed
npm run typecheck && npm run lint && npm run format:check && npm run build

npm run test:integration   # REAL PostgreSQL, TEST_DATABASE_URL only
```

`npm run test:integration` checks that `TEST_DATABASE_URL` is set and safe, applies the migrations to the test database, and runs
`*.integration.test.ts`. It **fails, not skips**, when the database is unavailable. To apply migrations to the test database alone:
`npm run db:test:setup`; to diagnose it: `npm run db:check:test`. CI runs everything against a PostgreSQL service container.

## Using the analysis

1. Add one or more materials (paste text or upload a text-based PDF). Image-only PDFs are rejected; PDFs with some empty pages are
   accepted and flagged.
2. **Start analysis.** The page shows the server's real stage (loading, splitting, reading section _n_ of _N_, checking quotes,
   merging, saving) and nothing else; there are no timers faking progress.
3. Each topic shows difficulty, importance, estimated time (computed by PrepFlow), the AI's confidence, weak-topic match,
   prerequisites, and an expandable **Evidence** list: the exact source text and its PDF page.
4. Starting again with unchanged material and settings reuses the existing result (no new model calls). Changing material,
   weak topics, provider or model analyzes again; earlier runs are kept as history.

## Using the plan (Checkpoint D)

1. In **Setup** choose your exam date, hours per day, study weekdays, optional specific days off, and the share of each day to
   keep free (the buffer). Weak topics and confidence still feed the priorities.
2. After an analysis, open **Plan** and press _Generate study plan_. The page shows exam countdown, required vs available time,
   the fit status (`GOOD`, `TIGHT`, `OVER CAPACITY`, `NO CAPACITY`), what is protected and what was deferred, every topic's
   priority with a "Why this priority?" breakdown, the daily workload, and warnings (for example a prerequisite loop that
   was repaired).
3. **Today** lists the day's tasks within your capacity. Start, complete or skip tasks; remaining time and progress update from
   the server's numbers. Revision sessions are scheduled after you study a topic and never after the last study day.
4. Missed something? **Plan** offers _Move missed tasks_ (moves only the missed work into spare time and reports any overload) or
   _Rebalance remaining plan_ (re-plans everything unfinished). Finished and skipped tasks are never altered; each rebalance
   creates a new plan version and archives the previous one.
5. **Topic** pages show classification, priority reasons, prerequisites, dependents, the Checkpoint C evidence, and the topic's tasks.
   **Progress** shows completion by topic.

Re-analyzing your material replaces the topics, so the current plan is archived (finished tasks keep their topic names) and you
generate a new one.

## API

```
GET    /api/health
POST   /api/profiles                          create a workspace and exam
GET    /api/exams/:examId                     exam + computed availability
PATCH  /api/exams/:examId                     change hours, date, days, weak topics
GET    /api/exams/:examId/materials           material summaries + effective limits
POST   /api/exams/:examId/materials/text      { text }                        201, or 200 for a duplicate
POST   /api/exams/:examId/materials/pdf       multipart field "file"          201, or 200 for a duplicate
DELETE /api/materials/:materialId             204
POST   /api/exams/:examId/analysis            start (202) / reuse (200, reused) / join running (200, alreadyRunning)
GET    /api/exams/:examId/analysis/latest     latest run (status, stage, chunk counters, safe error)
GET    /api/exams/:examId/analysis/result     current subjects/topics with evidence
GET    /api/analysis-runs/:runId              one run
POST   /api/exams/:examId/plan                { planDate? }                   201 new plan version (409 if progress exists: rebalance instead)
GET    /api/exams/:examId/plan?date=          active plan, progress, fit report, version history
GET    /api/exams/:examId/plan/today?date=    today's tasks, capacity, overdue work, urgent revision
POST   /api/exams/:examId/plan/rebalance      { mode: REPLAN | RECOVER, includeSkipped?, planDate? }
GET    /api/exams/:examId/topics/:topicId     topic detail: evidence, priority breakdown, tasks
POST   /api/study-tasks/:taskId/start         { planDate? }
POST   /api/study-tasks/:taskId/complete      { actualMinutes?, planDate? }
POST   /api/study-tasks/:taskId/skip          { planDate? }
POST   /api/study-tasks/:taskId/uncomplete    { planDate? }
```

`planDate`/`date` is the browser's calendar date; the server accepts it only within one day of its own UTC date.

No accounts yet: the exam's unguessable id is the access key, so treat it like a secret. Errors are always
`{ "error": { "code", "message" } }` with a message that is safe to show.

## Security notes

- Study material is untrusted: it is delimited with a per-call random nonce, the model is told never to follow instructions inside it,
  has no tools or secrets, and its output is only parsed as data (see [docs/decisions/0004](docs/decisions/0004-analysis-pipeline-and-evidence.md)).
- Model output is never trusted: tolerant parsing, then strict Zod validation (unknown fields stripped), then evidence verification;
  topics without verifiable evidence are dropped.
- Secrets live only in environment variables/`.env` (git-ignored). The Gemini key is sent in a header, never logged or returned.
  Logs contain metadata only (run id, exam id, provider, model, stage, counts, error category), never prompts, material text or model output.
- AI cost is bounded: per-IP rate limit on analysis starts, one active analysis per exam, a process-wide concurrency limit,
  a maximum chunk count, bounded retries (transient errors only) and one bounded repair attempt per chunk.
- Existing protections remain: helmet, CORS allow-list, body limits, upload limits, per-IP limits, parameterized queries (Prisma),
  generic errors to the browser in production.

## Known limitations

- Analysis runs inside the API process. If the server restarts mid-analysis the run is marked failed and must be started again; there is no job queue.
- Scanned/image-only PDFs are not supported (no OCR). Password-protected PDFs are rejected.
- Chunks are analyzed sequentially, so large material on a slow local model takes a while. The limit is 40 chunks (≈ 480k characters at the local default).
- Evidence matching is deliberately conservative: a correct quote that the model reformats heavily (reordered words, paraphrase) is rejected and the topic dropped. Expect some drops with small local models.
- Topic names across materials are merged by normalized-name similarity, not meaning; near-synonyms can stay separate.
- Topic review/editing is available on the Analysis page: adjust importance, estimated minutes and weak status, or delete a
  topic. Rebalance an existing plan to apply edits while keeping completed work. Planning works in daily time budgets, not
  clock times.
- The planner is a deterministic greedy heuristic, not an optimal solver (see [docs/planning.md](docs/planning.md) for what that means).
- Prerequisite links are only as good as the model's suggestions; topics are linked within a subject, and loops are repaired by dropping the least-supported claim.
- A completed task can be undone from Today; a skipped task cannot be un-skipped except by rebalancing with "include skipped". "Today" is the server's UTC date unless the browser's date is within one day of it.
- There are no accounts: the workspace/exam UUID is the only access key (see [docs/security.md](docs/security.md)). Share it only with people you trust.
- Real Gemma output quality is verified only via `npm run ai:smoke` and manual use; automated tests use a deterministic fake provider.

## Scripts

| Command                    | What it does                                               |
| -------------------------- | ---------------------------------------------------------- |
| `npm run dev:api`          | Builds `shared`, then starts the API with reload           |
| `npm run dev:web`          | Starts Vite                                                |
| `npm run db:migrate`       | `prisma migrate dev` on the development database           |
| `npm run db:deploy`        | `prisma migrate deploy` (no shadow database)               |
| `npm run db:check`         | Diagnoses environment, connection, credentials, migrations |
| `npm run db:check:test`    | Same for the test database                                 |
| `npm run db:test:setup`    | Applies migrations to the test database                    |
| `npm run db:seed`          | Loads fictional demo data                                  |
| `npm run db:studio`        | Opens Prisma Studio                                        |
| `npm test`                 | Shared, API and web tests (no database)                    |
| `npm run test:integration` | PostgreSQL integration tests on the test database          |
| `npm run ai:smoke`         | Opt-in check of the real AI provider                       |
| `npm run pdf:inspect`      | Shows what PrepFlow extracts from a PDF                    |
| `npm run typecheck`        | Type-checks shared, API and web                            |
| `npm run lint`             | ESLint                                                     |
| `npm run format:check`     | Prettier                                                   |
| `npm run build`            | Production build of all workspaces                         |

## More documentation

[Architecture](docs/architecture.md) · [Planner](docs/planning.md) · [AI](docs/ai.md) · [Security](docs/security.md) · [Deployment](docs/deployment.md) · [Troubleshooting](docs/troubleshooting.md) · [Decisions](docs/decisions.md) · [Verification status](docs/PREPFLOW-PROJECT-STATUS.md)

## Roadmap

A. Repository + database ✓ · B. Study setup + document ingestion ✓ · C. AI provider layer + Gemma analysis ✓ ·
D. Topic review and deterministic planning ✓ · E. Today, task execution, revision and progress ✓ · F. UX/security/test review (code and automated checks done; manual browser, accessibility and external security review pending) ·
G. Production deployment (documented in [docs/deployment.md](docs/deployment.md); not deployed) · H. Real-user feedback (pending) and submission package.

## License

MIT, see [LICENSE](LICENSE).
