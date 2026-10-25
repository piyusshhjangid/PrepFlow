# Verification status

Audit updated 25 Oct 2026. The PASS results below are the recorded 24 Oct build-sandbox run; they were **not reproduced in this audit**. On this Windows machine, Node is v22.19.0 (below the locked jsdom dependency's Node 22.22.2 minimum), and `npm ci` did not complete: the normal attempt ended with npm's `Exit handler never called!`; `npm ci --offline` failed with `EPERM` creating `node_modules\@types\aria-query`. Therefore no downstream static checks, tests, build, offline evaluation, or browser check were run during this audit. Item-by-item prior evidence: [submission/evidence-checklist.md](submission/evidence-checklist.md).

The declared project Node engine was raised to `>=22.22.2` to match the locked jsdom dependency. Re-run the checks on a supported Node version after dependencies install.

## Verified (automatically, reproducible)

| Check                                       | Result                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`, `npm run format:check` | PASS                                                                                                                                                                    |
| `npm test`                                  | PASS, 241 tests in 19 files                                                                                                                                             |
| `npm run build`                             | PASS                                                                                                                                                                    |
| `npm run check:external`                    | PASS, "no unexpected external URLs in 6 built files" (static scan)                                                                                                      |
| `npm run eval:offline`                      | exit 0. Baseline (rule-based, no AI) mean recall 57%, precision 75% on 8 gold samples; 21/21 fault scenarios; verifier 1774/1774; planner 2,000 scenarios, 0 violations |
| `npm run check`                             | PASS (runs all of the above)                                                                                                                                            |

## Verified (real Chromium, against a mock)

`npm run check:browser`: 16/16 passed. Output saved in `submission/browser-check-output.txt`. The server was `scripts/mock-ollama.mjs`, a **mock, not a model**. This shows the UI, proxy, privacy behaviour and failure paths work; it shows nothing about Gemma.

## Not verified

| Item                                                                                           | Why not                                                            | What to do                                                                                         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Real Gemma run** (valid-JSON rate, recall, precision, evidence pass, fabricated rate, speed) | The sandbox cannot reach ollama.com or Hugging Face and has no GPU | `ollama pull gemma4:e4b`, `npm run eval:smoke`, then `npm run eval -- --model gemma4:e4b --runs 3` |
| Offline operation with a real model                                                            | Same                                                               | Procedure in `privacy.md`                                                                          |
| Screen-reader behaviour, colour contrast, dark-mode appearance, real phone                     | Not available here                                                 | `submission/recording-checklist.md`                                                                |
| Demo video, published DEV post, public repository link                                         | Need the owner                                                     | `submission/recording-checklist.md`                                                                |
| Eligibility confirmation from the organisers                                                   | Only the owner can ask                                             | `eligibility.md`                                                                                   |

The jsdom tests check structure, roles and flows; the Chromium check adds layout overflow and focus. Neither is an accessibility audit.
