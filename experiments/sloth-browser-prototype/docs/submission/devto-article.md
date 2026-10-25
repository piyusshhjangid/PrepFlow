---
title: 'PrepFlow Sloth: Let Gemma Do the Study Planning'
published: false
tags: devchallenge, hf26challenge
---

_This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19)_

> **UNPUBLISHED DRAFT.** This is not ready to publish: no real Gemma evaluation or demo recording exists, and eligibility for publishing this branch in the older PrepFlow repository has not been confirmed with the organizers. The owner must review first-person statements and challenge requirements before publication.

## What I Built

Studying has a tax: before you learn anything, you spend an evening turning a syllabus into a list, guessing what matters, working out how long it will take, and squeezing it between now and the exam. Then one bad day happens and you do it again.

**PrepFlow Sloth** is designed to remove that tax. You give it a syllabus (pasted, or a text PDF), an exam date and how many minutes a day you really have. When Ollama and Gemma are available, the app asks the model to propose topics. Plain code then turns them into a plan that fits your hours, shows you what _doesn't_ fit, schedules revision, and puts one thing at the top of the page: **your next step**, why it matters, how long to spend, and the passage of your own syllabus it came from. A real Gemma run is still unverified.

The lazy part is the re-planning. The plan is rebuilt from today every time anything changes. Miss a day and the work just slides forward. Nothing is ever "overdue", and there is no "rebalance" button to press.

It is for students with an exam, several subjects and limited hours, and for anyone who would rather not paste their notes into a closed service.

## Demo

No demo video has been recorded. Record the app following `docs/demo-script.md` before publishing this entry.

No screenshots have been captured from the real app. Add genuine screenshots only after reviewing them for private study material.

There is no hosted demo, on purpose: the app is local-first, and a hosted page cannot reach your Ollama.

## Code

The requested repository is [piyusshhjangid/PrepFlow](https://github.com/piyusshhjangid/PrepFlow), with this checkout intended for the [`upgrade/gemma-evidence-eval` branch](https://github.com/piyusshhjangid/PrepFlow/tree/upgrade/gemma-evidence-eval). Its existing `main` branch contains an earlier PrepFlow application; this checkout's branch has a separate history. See [the eligibility review](../eligibility.md) before presenting this repository as a challenge entry.

MIT licensed. This checkout's recorded history begins on 21 October 2026. Git dates are editable metadata and are not independent proof of when work began.

## How I Built It

**What changed after the first build.** My first version trusted a quote if it existed anywhere in the syllabus. A reviewer's question made me test that: a model could attach a real but unrelated quote and pass. So the checks got stricter. Each topic now gets a **support level** (does the quote use the topic's own words?), and the model may only call a topic "high priority" if the material itself says so; otherwise the app shows medium and explains why. I also added **outline mode**, a plain rule-based extractor with no AI, so the app still works when Ollama is down, and so I have an honest baseline to compare Gemma against. And a **labelled sample** you can try without any model.

**The model.** The app is designed to call Gemma through a local Ollama runtime (default tag `gemma4:e4b`, with `gemma4:e2b` as a lighter option). A real Gemma evaluation has not been run; model quality, hardware requirements, and analysis time are unknown.

**The one rule that shaped everything:** the model proposes, code decides.

Gemma is good at the fuzzy job, finding the topics in free text. It is not something I want doing arithmetic or deciding what fits on a Tuesday. So the pipeline is split:

```
text or PDF → chunks → Gemma (constrained JSON) → schema check → evidence check
            → priority → capacity-aware scheduler → revision → next step
```

- **Structured output.** Each chunk goes to Ollama with a JSON Schema in `format`, temperature 0. I still treat the reply as untrusted: tolerant JSON extraction, then per-topic zod validation. Bad topics are dropped and counted; unusable output gets exactly one repair attempt (whose prompt contains a reason written by my code, never the model's own words); transient errors are retried a bounded number of times.
- **Evidence you can check.** Every topic must carry a quote copied from your material. The app normalises case, whitespace, curly quotes and line-break hyphenation, then looks for that exact text in your source. If it's there, the stored evidence is _your_ text (not the model's) and the PDF page is derived by code. If it isn't, the topic is **held back** and not planned unless you choose to include it. Near-matches are rejected on purpose: one changed word means "not found".
- **What "evidence-backed" means.** The quote exists in your material. It does not mean the model's summary is right.
- **Deterministic planning.** Minutes come from two coarse labels (effort, difficulty) turned into numbers by code; priority is a visible sum (importance, difficulty, "other topics build on it", your weak spots); the scheduler respects the exam date, daily minutes, session length and prerequisites; reviews land one and three days after you finish a topic. It all lives in pure functions with no model and no network, so I tested it hard: unit tests plus 2,000 seeded random scenarios that check capacity, exam boundaries, prerequisite order and that scheduled + unscheduled minutes always equal required.
- **Honest overflow.** If the work doesn't fit, the banner says what is left out and searches for the daily time that would fit everything. A bug I found while testing was a false overflow: with one sitting per topic per day, a two-hour topic and a two-day deadline "didn't fit" even with four free hours a day. The scheduler now spreads sittings out when that works and only repeats a topic within a day when that's the only way to avoid losing work.
- **Small on purpose.** No backend, database, accounts or API keys. A React app in your browser, pdf.js for PDFs, and Ollama. A Vite proxy at `/ollama` means you don't configure CORS.

The local commit metadata attributes the initial implementation to Claude. This completion audit used OpenAI Codex. The project owner should review and describe their own direction and review work accurately before publishing.

Inspired by my earlier project PrepFlow, which started before this challenge and is not part of this entry. This is a new codebase written during the week with a different shape (no backend or database; browser-only state; rolling re-plan; a new evidence normaliser and scheduler). The shared ideas are listed in `docs/eligibility.md`.

## How I Checked It

The offline suite (`npm run eval:offline`) runs in seconds with no model: eight gold-labelled materials scored against the rule-based baseline (mean recall 57%, precision 75% there; it finds nothing in prose without markers, which is exactly where a model should help), 21 injected failures (truncated JSON, wrong types, fabricated quotes, duplicates, a runtime that dies mid-run), a check that the evidence verifier rejects 1,774 deliberately damaged quotes in 9 ways and accepts the clean ones, and planner invariants over 2,000 random scenarios. It also surfaced one real gap in my code (duplicate topics that differed by a word were not merged), which I fixed.

The Gemma evaluation was not run in this environment. The offline results below measure only the rule-based outline baseline and deterministic safeguards, not Gemma quality.

## Why Does Open Innovation Matter?

A syllabus and a student's weak spots are personal. With an open-weight model running on my own machine, the material goes to a process I control (Ollama) and nowhere else. The app has no analytics, remote fonts or API keys, and a script scans the production bundle to keep it that way.

Open weights also let me choose the model: a text field switches between Gemma sizes, and the design lets a different adapter be written without touching the planner.

The trade-offs are real. A laptop is slower than a hosted API. Small models make mistakes, which is exactly why every topic has to prove itself against the source. And "local" doesn't make the whole system private on its own: anything else that can read your browser storage or network still can.

The offline evaluation and Chromium browser check were recorded in the repository, with the browser check using a mock Ollama server. No real-model network trace was captured.

## My Agent Session

No public agent-session transcript is linked.

## The Lazy Payoff

What it removes: splitting the syllabus, guessing durations, fitting days, remembering revision, and re-planning after a bad day.

No time-saving or real-model latency measurement is available. The intended benefit is avoiding manual topic splitting, time estimation, scheduling, and replanning.

## Prize Categories

**Best Use of Gemma.** The code integrates Gemma through Ollama for topic extraction, but it has not been exercised against a real Gemma model in this audit. This draft does not claim measured model results or verified real-model use.
