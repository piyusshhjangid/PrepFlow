# Architectural decisions

Short records of decisions and their reasons. Newest at the bottom of each section.

## Repository

- **npm workspaces, no Turborepo/Nx.** Three packages don't justify a build orchestrator.
- **`packages/shared` holds Zod schemas and enums.** One definition of the API contract, used by both sides.
  It compiles to `dist` with `tsc`; `npm run dev:api` and `npm run typecheck` rebuild it first.
- **ESM everywhere** (`"type": "module"`, `NodeNext` in Node packages). Relative imports in the API use `.js`
  extensions, which is verbose but is what Node actually resolves.
- **Prisma pinned to 6.19.x.** Prisma 7+ changes client generation and requires driver adapters; that is
  complexity with no benefit for this project during a weekend build. Revisit after the challenge.
- **TypeScript 5.9 and Vitest 3 pinned** for compatibility with the lint and test toolchain.

## Database

- **Anonymous workspace, no auth.** `StudyProfile` is the root and its UUID is the only access key, so a
  workspace link must be treated like a secret. Adding auth later means adding a nullable `userId` to
  `StudyProfile` (non-breaking).
- **No `ProgressEvent` table.** Progress is derived from `completedAt` on `Topic` and `StudyTask`. A second
  source of truth would only drift.
- **No `RevisionTask` table.** Revision tasks are `StudyTask` rows with `type = REVISION`; they have the same
  shape and the same UI.
- **Completion lives on `Topic`,** so regenerating a plan (new `StudyPlan` version, old one archived) never
  loses progress.
- **Minutes, not hours,** for daily budgets and estimates: integers avoid float rounding in the planner.
- **Enums (`EASY/MEDIUM/HARD`, `LOW/MEDIUM/HIGH`) instead of numeric scales** for difficulty and importance.
  They are what the model is asked to return, so they are far less likely to come back out of range.
- **JSON only where data is always read with its parent:** topic `evidence` and plan `summary`. Everything
  filtered or aggregated is relational.
- **"One ACTIVE plan per exam" is enforced in the service layer, in a transaction,** not with a partial unique
  index. Prisma can't express partial indexes in the schema, and an index it doesn't know about shows up as
  drift in later migrations.
- **Duplicate uploads** are prevented by a unique `(examId, contentHash)` on `StudyMaterial`.

- **Local PostgreSQL is the primary development path; Docker is optional.** `DATABASE_URL` is the only coupling.
  The README documents the one-time user/database setup and what the common Prisma errors (P1000/P1010/P1001) mean.
- **Known dev-tooling audit warnings are intentionally not "fixed" with `npm audit fix --force`:** they are in
  the Prisma CLI's config loader and Vitest's mock-redirect feature, neither reachable from the running API, and
  the forced fix would upgrade Prisma and Vitest across major versions.

## Backend

- **Layering:** routes → controllers → services → domain (pure functions) → infrastructure.
- **One error hierarchy** (`AppError` and subclasses) and one error middleware. Error messages on `AppError`
  are user-safe by contract; internal detail is logged server-side only.
- **`createApp(deps)` factory.** The app never opens a port or a database connection by itself, so endpoint
  tests run with fakes.
- **Health returns 503 when the database is down,** so hosting health checks can act on it.

## Ingestion (Checkpoint B)

- **Ingestion is deterministic end to end:** validate, extract, normalize, hash, persist. No AI is involved, and
  the model never sees raw PDFs. AI first touches material after it is persisted.
- **`pdfjs-dist` (PDF.js) for extraction,** page by page, so page boundaries come from the PDF's page tree
  rather than guesses. Pure JavaScript, no native binaries. In v6 resources are released with
  `loadingTask.destroy()` and there is no `isEvalSupported` option (both found by typechecking and testing).
- **Pages are _physical_ PDF pages, always labelled "PDF page n".** Printed page numbers are not read.
- **Pages live in the existing `StudyMaterial.extractedText`, joined by a form feed,** with
  `domain/documents/pages.ts` as the single serializer/parser. Normalization strips form feeds from content, so
  the separator can never appear inside a page. No `MaterialPage` table: pages are always read together.
- **OCR-ready, OCR-free:** extraction is a list of `PdfPageExtractor`s tried in order until one yields usable
  text; "usable" is judged from the text alone (`buildPdfDocument`). Adding OCR later means appending an
  extractor in `container.ts`. Nothing else changes.
- **"No usable text" is judged by fixed thresholds** (`TEXT_QUALITY`): fewer than 50 non-whitespace characters
  overall, or no page with at least 20. The error is `PDF_NO_TEXT` and says "check that the PDF contains
  selectable text"; it never claims the file was scanned, because a blank PDF looks identical.
- **Pages with little or no text are kept and counted** (`lowTextPageCount`), so numbering stays correct and the
  user is warned that content may be missing.
- **Limits are one centralized object** (`DEFAULT_MATERIAL_LIMITS`), overridable through optional environment
  variables, injected into services, and returned by the API so the UI never hard-codes them.
- **Duplicates:** SHA-256 of the normalized, page-serialized text, unique per exam. A duplicate returns the
  existing material (200, `duplicate: true`) instead of an error. At the per-exam material limit even a
  duplicate is refused, because the cheap count check happens before any parsing.
- **Uploads are held in memory (multer memory storage), never written to disk.** There is no temp file to clean
  up and no path to traverse. The size limit is enforced while streaming; the type is checked by content type
  and then by magic bytes (`%PDF-`).
- **Routes are scoped by exam** (`/api/exams/:examId/materials/...`). With no auth, the unguessable exam id is
  the access key, so every material operation goes through it.
- **"Today" is the UTC date** and an exam date may be one day in the past to tolerate time zones behind UTC.
  A per-exam time zone is a later improvement.
- **Repositories sit behind narrow ports,** so business rules are tested with in-memory fakes and the Prisma layer
  stays a thin mapping, covered by an opt-in integration test against real PostgreSQL.
- **No de-hyphenation or header/footer stripping.** See docs/ingestion.md for the consequence.
