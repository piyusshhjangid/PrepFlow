# AI material analysis (Checkpoint C)

See also the decisions in [docs/decisions/](decisions/). Ingestion is described in [ingestion.md](ingestion.md).

## Flow

1. `POST /api/exams/:id/analysis` validates the exam and materials, computes the **fingerprint**
   (analysis/prompt/chunker versions, provider, model, material hashes, chunk sizes, weak-topic hints) and either
   reuses the current result (200), joins a running analysis (200), or creates a `QUEUED` run (202). Creation is atomic per exam (advisory lock).
2. A background worker in the API process (limited by `ANALYSIS_MAX_CONCURRENT`) moves the run through
   `LOADING → CHUNKING → ANALYZING → VALIDATING → MERGING → PERSISTING → COMPLETED`, updating the row (and a heartbeat) as it goes.
3. **Chunking** (`ai/analysis/chunker.ts`): materials sorted by content hash; pages split into paragraphs; oversized paragraphs split at
   sentence ends; greedy packing to the target size cutting at the best-scored boundary (headings, page starts) in the later half of the window; a tiny tail is merged back;
   hard maximum enforced; no overlap; ids derived from content hash + source offsets.
4. **Model call** per chunk (`ai/analysis/analyze-chunk.ts`). System prompt = trusted instructions; user message = task + material between nonce markers.
5. **Parse** (`parse.ts`): strip fences/prose, find the first balanced JSON object, tolerate trailing commas; then **Zod** per topic. One invalid topic is
   dropped and counted; if nothing usable came back, one **repair** attempt is made, then the chunk fails.
6. **Evidence** (`evidence.ts`): chunk id must match; quote ≥ 20 chars and ≥ 3 words, ≤ 600, no ellipsis; found in the chunk after conservative normalization.
   Pages come from the chunk's segment map. The snippet stored is the source text. Topics with no valid evidence are dropped.
7. **Validating** re-checks every snippet against the full material text. **Merging** (`merge.ts`) groups subjects/topics by normalized name similarity, combines
   attributes deterministically, de-duplicates evidence (max 5), and matches weak-topic hints (a model claim must be corroborated by name overlap).
   **Effort** (`effort.ts`): `minutes = base(effort class) × difficulty × importance × (1 + 0.2 × revisionWeight)`, rounded to 5, clamped to 10–240.
8. **Persisting**: one transaction replaces the exam's subjects/topics and finalizes the run. Statuses: `SUCCEEDED`, `PARTIAL` (some chunk failed), `FAILED`.

## Failure behaviour

| Situation                                 | Result                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Network error / timeout / 5xx / 429       | Retried with backoff up to `AI_MAX_ATTEMPTS`; then that chunk fails (`PARTIAL` or `FAILED`)     |
| Bad API key / unknown model / bad request | Not retried; run fails at once with `AI_AUTH_FAILED`, `AI_MODEL_NOT_FOUND`, `AI_BAD_REQUEST`    |
| Unparseable or invalid output             | One repair attempt, then the chunk fails (`AI_INVALID_OUTPUT`)                                  |
| No topic with verifiable evidence         | `FAILED` / `NO_TOPICS_FOUND`                                                                    |
| Saving fails                              | `FAILED` / `PERSISTENCE_FAILED`; previous result untouched                                      |
| Server stopped mid-run                    | Failed at next startup, or when polled after `ANALYSIS_STALE_AFTER_MS` (`ANALYSIS_INTERRUPTED`) |

Error messages shown to users are fixed, safe strings; details stay in server logs as codes.

## Observability

Structured logs include `analysisRunId`, `examId`, `provider`, `model`, `stage`, `chunkCount`, `topicCount`, `droppedTopics`, `durationMs`, retries/repairs and error category.
They never include prompts, material text, model output or keys.
