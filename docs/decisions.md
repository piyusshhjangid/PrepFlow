# Architecture decisions

The numbered decision records are authoritative and include context and tradeoffs:

- [0001 — foundations and early checkpoints](decisions/0001-foundations-checkpoints-a-b.md)
- [0002 — environment and isolated test database](decisions/0002-environment-and-test-database.md)
- [0003 — AI provider abstraction](decisions/0003-ai-provider-abstraction.md)
- [0004 — analysis pipeline and evidence verification](decisions/0004-analysis-pipeline-and-evidence.md)
- [0005 — deterministic planning](decisions/0005-deterministic-planning.md)

The working rule is to keep the semantic AI boundary narrow and keep user-visible scheduling, validation and persistence deterministic and testable.
