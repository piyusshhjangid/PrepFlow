# Checkpoint D — topic review and deterministic planning

## Status

COMPLETE after this snapshot's tests pass. Initial audit: PARTIALLY COMPLETE.

## What was implemented

- Reviewed the existing priority, dependency, capacity and planning engines. Scores remain deterministic and explainable.
- Added topic review controls for estimated minutes, importance/priority and weak status, plus topic deletion.
- Added strict request validation and exam-scoped persistence for review operations.
- Limited a study sitting to 60 minutes; longer topics are split across study days. The planner reports portions that cannot fit before the exam.
- Existing plan versioning and rebalance preserve completed task history.

## Files changed

`apps/api/src/domain/planning/config.ts`, planner tests, analysis service/repository/controller/routes, `packages/shared/src/analysis.ts`, `apps/web/src/pages/AnalysisPage.tsx`, web API endpoints, and HTTP tests.

## Tests executed

`npm test`: 429 passed (22 shared, 362 API, 45 web). `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` passed. Build emitted two non-fatal Rollup notices from the installed Zod package.

## Test results

PASS — npm test: 429 passed (22 shared, 362 API, 45 web); typecheck, lint, format check and production build passed. Prisma integration tests await PostgreSQL.

## Known limitations

After topic edits, the user must rebalance to apply updated priorities and estimates to an existing plan. Planner sessions are daily tasks without clock-time placement; very small remaining fragments can be shorter than 25 minutes.

## Deployment status

Not applicable.

## Remaining issues

See Checkpoints G and H for deployment and real-user verification dependencies.
