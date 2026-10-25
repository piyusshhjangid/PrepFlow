# Changelog

Dates are commit dates from `git log` (self-reported by the committer).

## 2026-10-25: Audit and submission corrections

- Raised the declared Node minimum to 22.22.2 to match the locked jsdom dependency's engine requirement.
- Clarified that the requested GitHub destination contains the older PrepFlow project and that eligibility for a branch in that repository is unresolved.
- Reclassified Best Use of Gemma as a candidate category; corrected the article draft to say that no real Gemma run or demo recording exists.
- Added the current Windows install failure and PowerShell reproduction commands to the verification and evaluation docs.

## 2026-10-24: Gemma evaluation and trust upgrade

- Added evidence **support** levels and a material-based **importance** check; a model "high" without a cue in the material is shown as medium.
- Added **outline mode** (rule-based, no AI), **labelled sample data**, and **"Why?" panels** with source-tagged lines.
- Ollama adapter: fixed seed, output cap, `think:false` with fallback, model digest and token stats, model picker; recorded prompt version and hash.
- Truncated-JSON salvage; duplicate merge by evidence span and name containment (found by the fault suite).
- Evaluation suite: 8 gold-labelled samples, baseline, 21 fault scenarios, verifier mutation test, 2,000-scenario planner invariants, live CLI with smoke mode. Live Gemma results: **pending**.
- Real-Chromium check against a mock Ollama (16 checks); mock server script.
- UI: brand mark, provenance banners, progress card, start-over, storage explanation.
- Rewrote README, architecture, eligibility, category evidence matrix, privacy, evaluation, demo script, verification status, article draft, checklists.
- Behaviour change: two earlier tests now expect a downgraded importance when the material has no cue.

## 2026-10-21 to 2026-10-22: First build

- Core (dates, evidence verification, priority, planner), AI layer, PDF extraction, Markdown export, UI, first eval harness, documentation. 134 tests.
