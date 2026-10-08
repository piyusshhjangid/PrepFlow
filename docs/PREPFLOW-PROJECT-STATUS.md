# PREPFLOW — Project Status and Handoff

**Snapshot date:** 7 October 2026  
**Workspace:** `C:\Users\jangi\Downloads\prepflow-checkpoint-d\prepflow`  
**Scope:** Continue the existing PrepFlow project through checkpoints D–H. This report describes the project as it exists in this snapshot; it does not claim deployment or user validation.

## Project overview

PrepFlow turns syllabus or study material into an evidence-backed, prioritized study plan. A student provides exam setup details, study availability and learning material. The API extracts and chunks text, asks a Gemma-compatible provider to identify structured topics, validates and verifies the output, persists the analysis, then uses deterministic application logic to schedule study and spaced revision. The student can review topics, manage daily tasks and track progress.

It is a structured planning product, not a general chat-with-your-PDF interface. AI proposes topic data; application code validates evidence and owns planning, limits, persistence and task transitions.

## Architecture and repository map

- `apps/web`: React, TypeScript, Vite and Tailwind user interface.
- `apps/api`: Express and TypeScript API, Prisma persistence, PDF/text processing, analysis pipeline and deterministic planner.
- `packages/shared`: Shared TypeScript types and Zod validation schemas.
- `docs`: Product and technical documentation, checkpoint reports and demo/submission materials.
- PostgreSQL is the persistence layer. Ollama/Gemma is the local AI option; Gemini-compatible hosted provider configuration is available as an alternative.

Main flow: material intake → PDF/text extraction → chunking → AI topic extraction → tolerant parsing and schema validation → evidence verification and merge → database persistence → priority/dependency/capacity calculation → daily plan and revisions → Today and progress views.

## What is implemented

### Analysis and topic review

- Paste text and text-based PDF material into an exam workspace.
- Run staged analysis with actual server-reported status, source evidence and PDF page attribution.
- Validate structured topic data and verify source quotes before accepting the analysis.
- Review topic estimates, importance and weak-topic status, and delete a topic. API input is strict and operations are exam-scoped.
- Changing reviewed topics requires the student to rebalance the plan before those changes affect scheduled work.

### Planning (Checkpoint D)

- Deterministic, explainable priorities, prerequisite handling, study-day availability, capacity limits and plan fit reporting.
- Study sessions are capped at 60 minutes; longer topics can be split across study days.
- Reports work that cannot fit before the exam rather than silently hiding it.
- Plan versions and rebalance preserve completed task history.
- Planner invariant coverage includes randomized scenarios for capacity, dates, revision order, conservation of study minutes, prerequisites, determinism and regeneration.

### Daily execution and progress (Checkpoint E)

- Today summarizes scheduled/overdue work, time budget and due revisions.
- Tasks support start, complete, undo completion and skip transitions; repeated transitions are handled safely.
- Revision intervals default to +1, +3 and +7 days and are configurable.
- Progress derives from persisted task state and summarizes topic/subject completion and study workload.
- Topic completion state is recalculated from its study tasks when task state changes.

### Security, polish and documentation (Checkpoint F)

- Source review covered validation, CORS, Helmet, rate limits, request/file limits, logging, PDF handling, workspace IDs, AI prompt/data boundaries and Prisma query patterns.
- The fake AI provider is rejected in production mode.
- `.env` is ignored and excluded from the deliverable ZIP; `.env.example` is included.
- Architecture, AI boundaries, security limits, decisions, contribution guidance and conduct documentation are present.
- Manual screen-size, keyboard-only, contrast and external security reviews have not been completed.

### Deployment (Checkpoint G)

- Local production build succeeds, and existing local/CI configuration is documented.
- There is no production host, deployed database, live URL, or deployment credential configured in this workspace. No deployment or live smoke test is claimed.

### User validation and submission preparation (Checkpoint H)

- Demo script, project description, screenshot checklist, submission checklist, real-user test protocol and an unpublished DEV article draft are prepared under `docs/submission/`.
- No student interview or feedback has been fabricated. Real-user feedback, screenshots and post-feedback revisions remain pending.

## Verification performed

| Check                            | Result                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `npm test`                       | PASS — 445 tests: 22 shared, 374 API, 49 web                                  |
| `npm run typecheck`              | PASS                                                                          |
| `npm run lint`                   | PASS                                                                          |
| `npm run format:check`           | PASS                                                                          |
| `npm run build`                  | PASS — two non-fatal Rollup notices relate to comments in installed Zod files |
| PostgreSQL integration tests     | NOT RUN — local PostgreSQL was unavailable                                    |
| AI provider smoke test           | NOT RUN — configured local Ollama service was not running                     |
| Production deployment/smoke test | NOT RUN — no production service/account/credentials configured                |
| Browser/accessibility review     | NOT RUN — manual viewport, keyboard and contrast checks pending               |
| Real-user test                   | NOT RUN — the documented test session has not occurred                        |

## Finalization pass (8 October 2026)

Re-verified in a clean install; fixes made:

- `apps/api/.env.example` was missing from the snapshot (and `apps/web/.env.example` did not exist). Cause: `.gitignore` listed `!.env.example` before `.env.*`, so the later rule re-ignored it. Both files now exist and the ignore order is fixed.
- The web client now supports `VITE_API_BASE_URL` for deployments where the API is on a different origin (default unchanged: same-origin `/api`). Tests added.
- API shutdown now has a 10 s forced-exit timeout, closes idle connections, and logs unhandled rejections and uncaught exceptions without request data.
- Added API tests for workspace isolation, unknown/malformed ids, malformed JSON, oversized bodies, non-PDF uploads, CORS and security headers (12 tests). Web vitest now also discovers `*.test.ts`.
- Documentation corrected: `planning.md` said sessions cap at 120 minutes (the code uses 60); the README said completions could not be undone (they can); roadmap statuses updated. Added `docs/deployment.md` and `docs/troubleshooting.md`.

Not verified in this pass (environment limits): PostgreSQL integration tests and Prisma migrations (Prisma engine downloads were blocked and no PostgreSQL was available), `npm run ai:smoke` (no Ollama or provider key), browser viewport/keyboard/contrast review, deployment, real users. The Prisma client types were generated with engine downloads bypassed, which is sufficient for typecheck and unit tests only.

## What remains

1. Start or provision PostgreSQL, create separate development and test databases, apply migrations, and run the integration suite. Keep the test database separate because tests may clear it.
2. Start Ollama with the configured Gemma model, or configure a hosted provider key locally, then run `npm run ai:smoke` and test representative syllabus/PDF inputs.
3. Configure a production host, managed PostgreSQL, environment secrets and allowed client URL. Deploy migrations and app services; then run the project’s complete 19-step production smoke test.
4. Review desktop, tablet and mobile layouts; test keyboard navigation and focus behavior; measure contrast; address any issues found.
5. Conduct the real-user session using `docs/submission/real-user-test.md`, record consented and de-identified feedback, make appropriate improvements, and capture genuine screenshots.
6. Update checkpoint F/G/H statuses and submission materials from the resulting evidence. The project is not ready to claim deployed or user-validated completion until these steps are done.

## Run locally

Prerequisites: Node.js 20.11+ (22 was used during development), npm 10+, PostgreSQL, and optionally Ollama for local AI.

1. Install dependencies: `npm install`.
2. Copy `apps/api/.env.example` to `apps/api/.env` and set database URLs, client URL and AI provider configuration. Never put real secrets in source control or the shared ZIP.
3. Create separate `prepflow` and `prepflow_test` databases; apply migrations with `npm run db:migrate`.
4. Start API with `npm run dev:api` and web client with `npm run dev:web`; open `http://localhost:5173`.
5. Verify with `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build`. Run `npm run test:integration` only after the safe test database is configured. Run `npm run ai:smoke` only after the selected real provider is available.

## Supporting reports and materials

- `docs/checkpoints/checkpoint-d.md` through `checkpoint-h.md`: checkpoint-specific scope and status.
- `docs/checkpoints/final-report.md`: concise final verification/status report.
- `docs/architecture.md`, `docs/ai.md`, `docs/security.md`, `docs/decisions.md`: technical references.
- `docs/submission/`: demo, project description, user-test protocol, screenshot/submission checklists and unpublished article draft.

## Snapshot limitations

This ZIP is a source snapshot, not a deployed service. It excludes `.git`, `node_modules`, generated build output and local environment files. The repository working tree contains uncommitted changes; the ZIP is the portable copy of those changes through the snapshot date.
