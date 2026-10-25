# Architecture

PrepFlow Sloth is a single-package web app. There is no server of our own: the browser runs the app, and the only other process is Ollama.

```
src/core   pure functions, no I/O, no model: dates, evidence, support, outline, topics, priority, planner, explain, export, pdf
src/ai     AiProvider interface, Ollama adapter, prompts, schema, chunking, analysis pipeline
src/demo   labelled sample material + hand-written proposals
src/ui     React components, reducer + persistence, styles
eval/      gold set, metrics, fault injection, verifier mutations, offline + live CLIs
```

## Data flow

1. **Input** (`ui`, `core/pdf`): pasted text, or a text PDF extracted by pdf.js in the browser. Pages are joined with a form feed so a page number can be derived later from a character offset. Size, page, type and "no text layer" checks produce readable errors.
2. **Chunking** (`ai/chunk`): paragraph-boundary chunks of about 6,000 characters, at most 12 chunks (60,000 characters).
3. **Gemma** (`ai/ollama`): one `/api/chat` call per chunk, `temperature: 0`, fixed `seed` (42), `num_predict` cap (3000), `think:false` (retried once without it if the runtime rejects the option), non-streaming, with a JSON Schema in the `format` option. The system prompt tells the model the material is untrusted data between random-nonce markers. The model has no tools, secrets or write access.
4. **Parsing** (`ai/json`, `ai/schema`): tolerant extraction of the first balanced JSON object (fences, prose, trailing commas), then per-topic zod validation. Invalid topics are dropped and counted. If the reply was cut off mid-JSON, complete topic objects are **salvaged** and counted separately. Out-of-range labels fall back to neutral defaults. If nothing usable comes back there is **one** repair attempt, whose prompt contains a code-written reason and never the model's previous text. Transient failures (timeout, 5xx, unreachable) are retried up to a bound with backoff. A missing model, a bad request or a cancel stops immediately.
5. **Evidence** (`core/evidence`): the model's quote is normalised (case, whitespace, curly quotes, line-break hyphenation) and must occur in the normalised source. Quotes that are empty, under 20 characters or 3 words, over 600 characters, or contain an ellipsis are rejected. On success the stored evidence is the **source's own text** and the page is derived by code. Approximate similarity is never accepted. Then two further checks (`core/support`): **support** (does the quote use the topic's own words? direct / nearby / weak; a real but unrelated quote is flagged, not trusted) and **importance** (a model "high" is kept only if the item's own text or a sentence naming the topic signals importance; otherwise it is shown as medium and the original suggestion is kept for the "Why?" panel). Failed topics stay visible as "held back" and are not planned unless the student opts in.
6. **Merging** (`ai/analyze`): duplicates (name similarity ≥ 0.8, or same evidence span and one name contains the other) are merged, preferring the copy with verified evidence. Prerequisite names are resolved to ids, unknown or self references dropped, cycles broken deterministically.
7. **Minutes and priority** (`core/topics`, `core/priority`): minutes = base(effort) × factor(difficulty), rounded to 5 and editable. Priority = importance + difficulty + weak-spot flag + "others build on it", each shown to the student with its points. A prerequisite inherits the score of what depends on it.
8. **Planning** (`core/planner`): rebuilt from today on every change.
   - Study days run from today to the day before the exam.
   - Daily capacity is a hard limit; sessions are capped (default 45 min); pieces under 15 minutes are avoided unless the remainder is smaller.
   - A topic starts only after its active prerequisites are fully studied.
   - Reviews are due +1 and +3 days after the last study session, capped at 40% of a normal day (the last day may use all of it), pulled to the last study day if they would land on or after the exam, merged when two land on one day, and reported when they cannot fit.
   - The plan first tries one sitting per topic per day (spread out); only if that leaves study time unscheduled does it allow repeat sittings on a day, so it never reports a false overflow.
   - Anything that cannot fit is returned as `unscheduled` with minutes, and `suggestAdjustment` searches for the smallest daily time that would fit everything.
9. **Execution** (`ui/store`): completing a task adds studied minutes (or marks a review done). Because the plan is a pure function of topics, settings and progress, there is no "overdue" state and no manual rebalance. A 20-step undo history is kept. Everything persists to `localStorage` through a zod schema; corrupt or tampered data is discarded whole.
10. **Explain** (`core/explain`): every topic and task can say why it is where it is, with each line tagged by source (your material / you / model / code / caveat). Built from the same data the planner used, not written by a model.
11. **Export** (`core/export`): Markdown with topics (with source quotes), daily schedule, revisions and unscheduled work.

## Three ways in, one verifier

| Origin  | Source of proposals                                                  | Label shown                                           |
| ------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| model   | Gemma through Ollama                                                 | model name, digest, prompt version/hash in the export |
| outline | `core/outline`: rules over labelled lines, bullets, headings (no AI) | "Outline mode: no AI"                                 |
| sample  | `demo/sample`: hand-written proposals with deliberate flaws          | "SAMPLE DATA"                                         |

All three go through `finalizeCandidates`, so evidence, support, importance, merging and planning are identical. Outline mode is also the baseline the live Gemma evaluation is compared against.

## Why this split

Gemma is good at the fuzzy part (what are the topics in this text?) and unreliable at arithmetic and constraints. Planning is the opposite: it must be exact, explainable and testable without a model. So the model's output is treated as a proposal that code verifies, and the schedule is a pure function that tests can hammer (including 2,000 seeded random scenarios in the offline evaluation).

## Provider abstraction

`AiProvider` is `{ id, model, generate(request) }`. The app ships one real adapter (Ollama). Changing model is a text field; changing runtime means writing another adapter. A scripted test double exists only under tests and is not imported by the app.

## Decisions and trade-offs

| Decision                | Why                                                  | Cost                                                                                    |
| ----------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| No backend or database  | Smallest thing that works; nothing to leak or deploy | State is per-browser; a hosted demo cannot reach a visitor's Ollama                     |
| Vite `/ollama` proxy    | No CORS setup; browser never talks cross-origin      | Works for dev and `vite preview`; a static host needs its own proxy or `OLLAMA_ORIGINS` |
| Exact quote matching    | A claim of "evidence" must mean something            | Some correct topics are held back when the model paraphrases                            |
| Rebuild plan from today | Missed days are a non-event                          | Past tasks are not kept as a history                                                    |
| Greedy scheduler        | Predictable and explainable                          | Not globally optimal                                                                    |
