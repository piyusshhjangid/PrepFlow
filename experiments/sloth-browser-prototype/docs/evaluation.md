# Evaluation

**Status.** Everything in "Offline results" below was produced by `npm run eval:offline` in this repository and is reproducible without a model. **No real Gemma evaluation has been run.** The sandbox this upgrade was built in cannot reach ollama.com or Hugging Face, so no model could be installed. The live harness (`npm run eval`) is finished and was exercised end to end against a mock server (which proves the plumbing, not any quality). Its results section below is intentionally empty until someone runs it. Nothing in this file may be read as a Gemma result.

## What is being evaluated, and what is not

| Question                                                                 | Answered by                                                                                  | Needs a model? | Status      |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------- | ----------- |
| Does the pipeline survive and correctly handle bad model output?         | Fault injection (scripted replies)                                                           | No             | Done        |
| Does the evidence verifier accept honest quotes and reject altered ones? | 1,774 synthetic quotes with known verdicts                                                   | No             | Done        |
| Does the scheduler obey its constraints on any input?                    | Invariant checker over 2,000 seeded random scenarios, and over plans built from every sample | No             | Done        |
| How good is a rule-only extractor on the gold set? (the baseline)        | Outline mode scored with the same metrics                                                    | No             | Done        |
| How many gold topics does Gemma find, and how many of its quotes verify? | `npm run eval`                                                                               | **Yes**        | **Pending** |
| Is Gemma better than the baseline, and where?                            | Same table, both arms                                                                        | **Yes**        | **Pending** |

## Method

**Materials.** Eight original texts in `eval/samples/` (MIT, written for this project): a short structured syllabus (01), dense prose with no headings (02), repeated and overlapping sections (03), headings that say nothing ("Basics", "Misc") (04), an outline with no real content (05), a 22-item study guide (06), a 13.8k-character lecture document that forces several chunks (07) and notes whose priority statements contradict each other (08).

**Ground truth.** `eval/gold.json`: reference topics per sample (a name pattern each), which of them the material itself marks as important (`high`), which the material contradicts itself about (`ambiguous`, not scored), and a reference study order. Written by the project author by reading each sample, **before any model was run**. Single annotator, not independently reviewed. The reference order is an opinion; agreement with it is a rough indicator.

**Metrics** (all computed by `eval/metrics.ts`; a metric that is undefined for a sample is reported `n/a`, never as 0 or 100%):

| Metric                         | Definition                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gold found / recall            | Gold topics for which a _verified_ topic's **name** matches the pattern, over all gold topics                                                                |
| Precision                      | Verified topics matching some gold pattern, over verified topics. Valid but unlisted topics count against it, so it is conservative                          |
| Evidence pass rate             | 1 - (candidates whose quote was not found) / candidates, **before** merging duplicates                                                                       |
| Fabricated rate                | Candidates whose quote was not found in the material / candidates                                                                                            |
| Weak link                      | Verified topics whose quote and paragraph never use the topic's words (flagged, still planned)                                                               |
| First-try valid                | Chunks answered with usable JSON without a repair / chunks (model runs only)                                                                                 |
| Dup. proposals                 | Duplicates the model proposed (merged by code) / candidates                                                                                                  |
| High recall / precision        | Of gold topics the material marks high: share the app marks high. Of topics the app marks high: share the material marks high. Contradictory topics excluded |
| Order agreement                | Pairwise agreement of the app's study order with the reference order, over found gold topics, in a roomy scenario (14 days, 120 min/day)                     |
| Capacity violations / fits all | Over a fixed grid of 9 scenarios (3, 7, 14 days x 30, 60, 120 min/day): days over the daily limit; scenarios where everything is scheduled                   |

**Not implemented, on purpose:** end-to-end "learning outcome" metrics (we cannot measure whether a student does better), and quality of the one-line summaries (no objective definition).

## Offline results (no model)

### 1. Rule-based outline baseline vs the gold topics

| Sample                      |     Gold found | Precision | Evidence pass | Fabricated | Weak link | First-try valid | Dup. proposals | High recall | High precision | Order agreement | Capacity viol. | Fits all |
| --------------------------- | -------------: | --------: | ------------: | ---------: | --------: | --------------: | -------------: | ----------: | -------------: | --------------: | -------------: | -------: |
| 01-structured-syllabus      |            7/7 |      100% |          100% |         0% |        0% |             n/a |             0% |        100% |           100% |             90% |              0 |      6/9 |
| 02-dense-lecture-notes      |            0/6 |       n/a |           n/a |        n/a |       n/a |             n/a |            n/a |         n/a |            n/a |             n/a |              0 |      9/9 |
| 03-repeated-overlapping     |            3/3 |       75% |          100% |         0% |        0% |             n/a |             0% |         n/a |            n/a |            100% |              0 |      6/9 |
| 04-ambiguous-headings       |            0/5 |        0% |          100% |         0% |        0% |             n/a |             0% |         n/a |            n/a |             n/a |              0 |      6/9 |
| 05-insufficient-information | 0 (0 returned) |       n/a |           n/a |        n/a |       n/a |             n/a |            n/a |         n/a |            n/a |             n/a |              0 |      9/9 |
| 06-many-topics              |          22/22 |      100% |          100% |         0% |        0% |             n/a |             0% |        100% |           100% |             87% |              0 |      1/9 |
| 07-long-multichunk          |            6/6 |      100% |          100% |         0% |        0% |             n/a |             0% |        100% |           100% |            100% |              0 |      2/9 |
| 08-contradictory-priorities |            0/7 |       n/a |           n/a |        n/a |       n/a |             n/a |            n/a |         n/a |            n/a |             n/a |              0 |      9/9 |

Mean over samples where defined: recall 57%, precision 75%, high-importance recall 100%, high-importance precision 100%, order agreement 94%.

How to read it. The baseline reads only structure the author wrote down. It does very well where there is a clean list (01, 06) and finds nothing where there is only prose (02, 08) or where the headings carry no information (04: it finds five topics, none matching the gold names, because they are called "Basics", "Part 2"). On 07 the only importance hint is a sentence at the end of the document; the app finds it because that sentence names the topics. These are the cases a language model is supposed to help with; whether Gemma does is **not shown here**. Rows with `n/a` in "First-try valid" are non-model runs. The `Fits all` column is about the fixed scenario grid (often tight on purpose), not a quality score.

### 2. Fault injection (scripted replies, not a model)

| Scenario             | Injected fault                                                             | Requirement                                             | Observed                            | Result |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------- | ------ |
| control              | none (valid reply)                                                         | all 5 topics verified, no repair                        | 5 verified / 0 held back, 1 call(s) | PASS   |
| fenced-prose         | JSON wrapped in prose and a code fence                                     | parsed without a repair call                            | 5 verified / 0 held back, 1 call(s) | PASS   |
| trailing-commas      | trailing commas                                                            | parsed without a repair call                            | 5 verified / 0 held back, 1 call(s) | PASS   |
| truncated            | reply cut off mid-object (output limit)                                    | complete topics are kept and counted as salvaged        | 3 verified / 0 held back, 1 call(s) | PASS   |
| not-json-then-valid  | first reply is not JSON                                                    | exactly one repair, then success                        | 5 verified / 0 held back, 2 call(s) | PASS   |
| never-json           | every reply is not JSON                                                    | bounded: 2 calls, a fixed error, no topics invented     | error ANALYSIS_FAILED, 2 call(s)    | PASS   |
| fabricated-quotes    | quotes that are not in the material                                        | every topic held back, none planned                     | 0 verified / 3 held back, 1 call(s) | PASS   |
| altered-word         | a real quote with one word changed                                         | held back (approximate matches are never accepted)      | 0 verified / 1 held back, 1 call(s) | PASS   |
| ellipsis-quote       | two passages joined with an ellipsis                                       | held back as not contiguous                             | 0 verified / 1 held back, 1 call(s) | PASS   |
| spliced-quote        | halves of two different passages glued together                            | held back                                               | 0 verified / 1 held back, 1 call(s) | PASS   |
| too-short-quote      | a quote too short to prove anything                                        | held back                                               | 0 verified / 1 held back, 1 call(s) | PASS   |
| duplicates           | the same topic proposed three times with different wording                 | merged into one                                         | 1 verified / 0 held back, 1 call(s) | PASS   |
| inflated-importance  | every topic marked high importance                                         | only the topic the material weights keeps "high"        | 5 verified / 0 held back, 1 call(s) | PASS   |
| unrelated-quote      | a real quote that does not talk about the topic                            | kept but flagged as weakly supported                    | 1 verified / 0 held back, 1 call(s) | PASS   |
| injection-obeyed     | a model that obeys instructions hidden in the material and invents a topic | the invented quote is held back                         | 5 verified / 1 held back, 1 call(s) | PASS   |
| cyclic-prerequisites | prerequisites that form a cycle                                            | cycle broken so the planner sees a DAG                  | 2 verified / 0 held back, 1 call(s) | PASS   |
| unknown-prerequisite | a prerequisite that is not a topic                                         | dropped and counted                                     | 1 verified / 0 held back, 1 call(s) | PASS   |
| one-timeout          | one timeout, then a good reply                                             | retried once and succeeded                              | 5 verified / 0 held back, 2 call(s) | PASS   |
| persistent-timeout   | the model always times out                                                 | bounded retries, then a fixed error and no partial plan | error ANALYSIS_FAILED, 2 call(s)    | PASS   |
| model-missing        | the model is not installed                                                 | stops at once with MODEL_NOT_FOUND (no retries)         | error MODEL_NOT_FOUND, 1 call(s)    | PASS   |
| empty-topic-list     | valid JSON with no topics                                                  | not an error: zero topics, no invented ones             | 0 verified / 0 held back, 2 call(s) | PASS   |

21/21 scenarios behaved as required.

What this shows: the defences work as designed against these injected faults. What it does not show: how often a real model produces them. The "injection-obeyed" scenario shows an invented topic is held back; it does **not** show prompt injection is solved. A model that copies a malicious sentence that _is_ in the material would produce a verified quote.

### 3. Evidence verifier vs synthetic quotes with known verdicts

| Class         | Correct verdict | Description                                               |   n | Accepted | Agreement |
| ------------- | --------------- | --------------------------------------------------------- | --: | -------: | --------: |
| exact         | accept          | the sentence unchanged                                    | 198 |      198 |      100% |
| noise         | accept          | upper case, doubled spaces, curly apostrophes             | 198 |      198 |      100% |
| hyphenated    | accept          | source has a word split across a line break with a hyphen | 193 |      193 |      100% |
| trimmed       | accept          | first two words dropped (still one contiguous passage)    | 195 |      195 |      100% |
| word-changed  | reject          | one middle word replaced                                  | 198 |        0 |      100% |
| words-swapped | reject          | two adjacent words swapped                                | 198 |        0 |      100% |
| spliced       | reject          | first half of one sentence + second half of another       | 198 |        0 |      100% |
| ellipsis      | reject          | beginning … end of one sentence                           | 198 |        0 |      100% |
| appended      | reject          | a plausible extra clause added                            | 198 |        0 |      100% |

Overall agreement with the known verdict: 1774/1774 (100.0%).

What this shows: the verifier accepts the harmless differences it was designed to accept and rejects the altered quotes. The classes were designed by the same author as the verifier, so this is a regression and sanity test, not independent validation. Real PDF extraction can produce differences not covered here (ligatures, two-column interleaving).

### 4. Planner invariants over seeded random scenarios

2000 scenarios (1-25 topics, 0-29 days, 15-210 min/day, random prerequisites, weak spots, known topics). Capacity violations: 0. Other rule violations: 0. Overflowing plans: 1243, of which "use N minutes a day" fixes 977 (266 cannot be fixed within 8 h a day).

The planner never exceeded daily capacity or broke the other listed rules. That is a property of the scheduler on valid settings; it is not a claim that the plan is _good_ for a student.

## Live results (Gemma): PENDING

Run on a machine with Ollama:

```bash
ollama pull gemma4:e4b
npm ci
npm run eval:smoke                 # one tiny call: is everything wired up?
npm run eval -- --model gemma4:e4b --runs 3
npm run eval -- --model gemma4:e2b --runs 3     # optional comparison
```

Windows PowerShell equivalent (stop at the first failed command):

```powershell
ollama pull gemma4:e4b
if ($LASTEXITCODE -ne 0) { throw 'ollama pull failed' }
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm run eval:smoke
if ($LASTEXITCODE -ne 0) { throw 'Gemma smoke test failed' }
npm run eval -- --model gemma4:e4b --runs 3
if ($LASTEXITCODE -ne 0) { throw 'Gemma evaluation failed' }
```

It records the exact tag, the model digest and size reported by Ollama, the Ollama version, prompt version and hash, seed / context / output cap, machine description, token counts and wall-clock per sample, and writes `eval/results/live-<model>-<time>.json` and `eval/results/live-latest.md`. Each run reports the Gemma pipeline and the baseline side by side. With `--runs N` per-run tables are kept, because model output can vary even with temperature 0 (a fixed seed is sent, but identical output is not guaranteed across hardware or Ollama versions). Failed samples are kept in the tables with their error code.

After a real run, paste the contents of `eval/results/live-latest.md` below and add the GPU by hand. Until then the section remains pending; do not substitute mock output.

No live Gemma output is available. Add the generated `live-latest.md` contents and observations here only after completing a real-model run.

## Limitations of this evaluation

- Eight small, author-written materials and one annotator. Results will not generalise to arbitrary syllabi.
- Topic matching uses name patterns; a correct topic with an unexpected name counts as missed, and a valid extra topic counts against precision.
- The baseline is a deliberately simple rule set, so "Gemma beats the baseline" would be a weak claim by itself. The useful comparison is _where_ each arm fails.
- Offline results contain no measurement of language-model quality.
- The weak-link and importance checks are heuristics with their own false positives: a topic named with synonyms may be flagged although the quote is fine; an importance cue far from a topic name is missed.
