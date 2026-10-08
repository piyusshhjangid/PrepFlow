# Architecture

PrepFlow is a small TypeScript monorepo. The React/Vite application in `apps/web` calls the Express API in `apps/api`; `packages/shared` owns request, response and domain schemas shared by both. The API is layered into routes/controllers, services, domain logic, provider adapters and Prisma repositories.

```text
PDF or pasted notes
  → bounded extraction and normalization
  → chunked AI analysis through AIProvider
  → tolerant JSON extraction, strict Zod validation, evidence checks
  → PostgreSQL topics and evidence
  → deterministic priority, prerequisite graph, capacity and schedule
  → versioned tasks → Today, revisions and derived progress
```

Gemma performs semantic classification and topic discovery. Application code owns input validation, evidence provenance, effort estimates, priority scores, prerequisite-cycle repair, scheduling, capacity, task transitions and persistence. The model never chooses the final schedule.

The database stores anonymous workspaces keyed by UUID, exams, source material text, analysis runs, subjects/topics and versioned plans/tasks. Topic evidence is stored with each topic. Revision sessions are ordinary tasks with a `REVISION` type and revision index. Progress is computed from task state rather than a separate analytics store.

An exam UUID acts as its access key; authentication and user accounts are not implemented. The API is a single process. Analysis runs are persisted and bounded, but a process restart interrupts active work. PostgreSQL is the supported database. See [planning](planning.md), [analysis](analysis.md), and the decision records in [decisions](decisions/).

## Local development

Follow the [README setup](../README.md). `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`, and `npm run format:check` are the repository checks. Database integration checks require a separate disposable `TEST_DATABASE_URL`.

## Deployment

Production deployment has not been configured or verified. A production setup needs a public frontend, an API service, PostgreSQL, exact CORS origins, server-only AI credentials, migrations and a live end-to-end smoke test. Do not treat a successful local build as a deployment.
