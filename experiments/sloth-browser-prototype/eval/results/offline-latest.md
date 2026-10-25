# Offline evaluation results (no model involved)

Gold set `gold-v1`; 8 sample materials. Produced by `npm run eval:offline`. Nothing below measures Gemma: see docs/evaluation.md for what each part does and does not show.

## 1. Rule-based outline baseline vs the gold topics

| Sample | Gold found | Precision | Evidence pass | Fabricated | Weak link | First-try valid | Dup. proposals | High recall | High precision | Order agreement | Capacity viol. | Fits all |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01-structured-syllabus | 7/7 | 100% | 100% | 0% | 0% | n/a | 0% | 100% | 100% | 90% | 0 | 6/9 |
| 02-dense-lecture-notes | 0/6 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0 | 9/9 |
| 03-repeated-overlapping | 3/3 | 75% | 100% | 0% | 0% | n/a | 0% | n/a | n/a | 100% | 0 | 6/9 |
| 04-ambiguous-headings | 0/5 | 0% | 100% | 0% | 0% | n/a | 0% | n/a | n/a | n/a | 0 | 6/9 |
| 05-insufficient-information | 0 (0 returned) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0 | 9/9 |
| 06-many-topics | 22/22 | 100% | 100% | 0% | 0% | n/a | 0% | 100% | 100% | 87% | 0 | 1/9 |
| 07-long-multichunk | 6/6 | 100% | 100% | 0% | 0% | n/a | 0% | 100% | 100% | 100% | 0 | 2/9 |
| 08-contradictory-priorities | 0/7 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0 | 9/9 |

Mean over samples where defined: recall 57%, precision 75%, high-importance recall 100%, high-importance precision 100%, order agreement 94%.

## 2. Fault injection (scripted replies, not a model)

| Scenario | Injected fault | Requirement | Observed | Result |
| --- | --- | --- | --- | --- |
| control | none (valid reply) | all 5 topics verified, no repair | 5 verified / 0 held back, 1 call(s) | PASS |
| fenced-prose | JSON wrapped in prose and a code fence | parsed without a repair call | 5 verified / 0 held back, 1 call(s) | PASS |
| trailing-commas | trailing commas | parsed without a repair call | 5 verified / 0 held back, 1 call(s) | PASS |
| truncated | reply cut off mid-object (output limit) | complete topics are kept and counted as salvaged | 3 verified / 0 held back, 1 call(s) | PASS |
| not-json-then-valid | first reply is not JSON | exactly one repair, then success | 5 verified / 0 held back, 2 call(s) | PASS |
| never-json | every reply is not JSON | bounded: 2 calls, a fixed error, no topics invented | error ANALYSIS_FAILED, 2 call(s) | PASS |
| fabricated-quotes | quotes that are not in the material | every topic held back, none planned | 0 verified / 3 held back, 1 call(s) | PASS |
| altered-word | a real quote with one word changed | held back (approximate matches are never accepted) | 0 verified / 1 held back, 1 call(s) | PASS |
| ellipsis-quote | two passages joined with an ellipsis | held back as not contiguous | 0 verified / 1 held back, 1 call(s) | PASS |
| spliced-quote | halves of two different passages glued together | held back | 0 verified / 1 held back, 1 call(s) | PASS |
| too-short-quote | a quote too short to prove anything | held back | 0 verified / 1 held back, 1 call(s) | PASS |
| duplicates | the same topic proposed three times with different wording | merged into one | 1 verified / 0 held back, 1 call(s) | PASS |
| inflated-importance | every topic marked high importance | only the topic the material weights keeps "high" | 5 verified / 0 held back, 1 call(s) | PASS |
| unrelated-quote | a real quote that does not talk about the topic | kept but flagged as weakly supported | 1 verified / 0 held back, 1 call(s) | PASS |
| injection-obeyed | a model that obeys instructions hidden in the material and invents a topic | the invented quote is held back | 5 verified / 1 held back, 1 call(s) | PASS |
| cyclic-prerequisites | prerequisites that form a cycle | cycle broken so the planner sees a DAG | 2 verified / 0 held back, 1 call(s) | PASS |
| unknown-prerequisite | a prerequisite that is not a topic | dropped and counted | 1 verified / 0 held back, 1 call(s) | PASS |
| one-timeout | one timeout, then a good reply | retried once and succeeded | 5 verified / 0 held back, 2 call(s) | PASS |
| persistent-timeout | the model always times out | bounded retries, then a fixed error and no partial plan | error ANALYSIS_FAILED, 2 call(s) | PASS |
| model-missing | the model is not installed | stops at once with MODEL_NOT_FOUND (no retries) | error MODEL_NOT_FOUND, 1 call(s) | PASS |
| empty-topic-list | valid JSON with no topics | not an error: zero topics, no invented ones | 0 verified / 0 held back, 2 call(s) | PASS |

21/21 scenarios behaved as required.

## 3. Evidence verifier vs synthetic quotes with known verdicts

| Class | Correct verdict | Description | n | Accepted | Agreement |
| --- | --- | --- | ---: | ---: | ---: |
| exact | accept | the sentence unchanged | 198 | 198 | 100% |
| noise | accept | upper case, doubled spaces, curly apostrophes | 198 | 198 | 100% |
| hyphenated | accept | source has a word split across a line break with a hyphen | 193 | 193 | 100% |
| trimmed | accept | first two words dropped (still one contiguous passage) | 195 | 195 | 100% |
| word-changed | reject | one middle word replaced | 198 | 0 | 100% |
| words-swapped | reject | two adjacent words swapped | 198 | 0 | 100% |
| spliced | reject | first half of one sentence + second half of another | 198 | 0 | 100% |
| ellipsis | reject | beginning … end of one sentence | 198 | 0 | 100% |
| appended | reject | a plausible extra clause added | 198 | 0 | 100% |

Overall agreement with the known verdict: 1774/1774 (100.0%).

## 4. Planner invariants over seeded random scenarios

2000 scenarios (1-25 topics, 0-29 days, 15-210 min/day, random prerequisites, weak spots, known topics). Capacity violations: 0. Other rule violations: 0. Overflowing plans: 1243, of which "use N minutes a day" fixes 977 (266 cannot be fixed within 8 h a day).
