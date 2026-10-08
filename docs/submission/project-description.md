# Project description

PrepFlow helps a student turn their syllabus and notes into a realistic study plan. It uses Gemma to identify structured topics and evidence in source material, then deterministic application code calculates importance, fits work into the student's available days, schedules revision and tracks progress. When the workload does not fit, PrepFlow explains what it deferred. Its most useful screen is Today, where the student can see what to study next and how long it should take.

## Technical explanation

React and TypeScript provide the workflow UI. An Express/TypeScript API validates requests, extracts text from bounded PDF uploads, coordinates AI analysis and persists the results through Prisma/PostgreSQL. Ollama supports local inference; a hosted provider adapter is configurable. Zod validation, evidence matching, deterministic priority and scheduling keep model output from controlling the final plan. Plans are versioned and completed work is carried through rebalancing.

## Open innovation explanation

An open-weight Gemma model gives the project a path to local inference through Ollama, model choice and inspectable application rules. In local mode, study material can stay on the student's configured machine; hosted mode sends material to the configured provider and must be described honestly. The application keeps deterministic decisions in code so a student can inspect why a topic is prioritized and how time was allocated. Real local or hosted inference and the privacy setup must be verified on the demo machine before claiming they worked.

## Limitations

- No user accounts; a workspace UUID is the access key.
- Text-based PDFs only; no OCR for scanned pages.
- Local model output quality and hosted model availability depend on configuration and have not been verified in this package run.
- Analysis runs in the API process and may need restarting after a server interruption.
- The planner is a deterministic greedy heuristic, not an optimal solver.
- A real user's results and feedback are pending.
- Production deployment and the public demo URL are pending.
