# Evidence checklist

Everything the submission claims, sorted by how strongly it is backed. The automatic PASS results in section A are the recorded 24 Oct run and were not reproduced in the 25 Oct audit because `npm ci` failed; see [verification status](../verification-status.md).

## A. Verified automatically (re-run to reproduce)

| Claim                                                                                               | Command                | Result on 24 Oct 2026                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| Types, formatting, 241 unit and integration tests, build, no unexpected external URLs, offline eval | `npm run check`        | PASS                                                                        |
| Rule-based baseline on 8 gold samples                                                               | `npm run eval:offline` | recall 57%, precision 75%, high-importance recall 100%, order agreement 94% |
| 21 injected-fault scenarios                                                                         | same                   | 21/21                                                                       |
| Verifier vs 9 mutation classes                                                                      | same                   | 1774/1774                                                                   |
| Planner invariants, 2,000 scenarios                                                                 | same                   | 0 violations                                                                |

## B. Verified manually in this build (output saved)

| Claim                                                                                                                                                                                                                                   | Evidence                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| In real Chromium the app makes only same-origin requests; focus moves to next step; progress survives reload; no horizontal overflow at 1280/768/430/390 px; Start over clears storage; Ollama-down error and outline mode; sample mode | `submission/browser-check-output.txt` (16/16, against a **mock** Ollama) |

## C. Reported but not reproduced here

| Claim                                                               | Source                                             | Status                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Gemma 4 model sizes (about 9.6 GB e4b, 7.2 GB e2b) and 128K context | Third-party guides read during the original build  | Not measured; do not repeat without checking the model card |
| Contest rules and dates                                             | dev.to challenge and rules pages, read 24 Oct 2026 | Re-read before submitting; rules can change                 |

## D. Not yet verified

- A real Gemma run: valid-JSON rate, recall, precision, evidence pass, fabricated, weak-link, duplicate and speed numbers (`npm run eval`)
- Offline operation with a real model; Network tab with real Ollama
- Screen reader, contrast, dark mode by eye, a real phone
- That the PrepFlow overlap is acceptable to the organisers
- Public repository link, demo video, published DEV post
- That the post's claims match what was actually recorded
