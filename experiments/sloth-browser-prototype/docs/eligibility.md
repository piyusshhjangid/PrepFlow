# Eligibility decision and attribution

**Short version.** This checkout has a separate Git history whose first recorded commit is 21 Oct 2026, inside the Week 3 entry period. However, the requested public destination, [piyusshhjangid/PrepFlow](https://github.com/piyusshhjangid/PrepFlow), already contains an older PrepFlow application and its own `main` history. Its published README describes a React + Express + Prisma + PostgreSQL app, while this checkout is a browser-only Vite app. The two projects share the author, problem, and core idea. Week 3's rules require a new project **and repository** started and completed during the window. Publishing this checkout as a branch of the older repository therefore creates a material eligibility risk. The repository link, earliest observed remote commit, and history relationship do not establish eligibility; organizer confirmation is needed.

## The rules (read on 24 Oct 2026 from the official pages)

Sources: <https://dev.to/challenges/hacktoberfest-week3-2026-10-19> and <https://dev.to/page/hacktoberfest-week3-2026-10-19-contest-rules>.

- Week 3 event record: **19 Oct 2026 19:00 UTC through 25 Oct 2026 06:59 UTC**. The same record's `ends_at` is one day earlier than the challenge page's stated submission deadline of 11:59 PM PDT on 25 Oct (26 Oct 06:59 UTC). This discrepancy is unresolved; use the challenge page and official rules for the actual submission deadline.
- "A brand-new project created and completed during the Entry Period" with open-source AI at its core; it must fit the theme **"Slow and Steady"**. "Pull requests to existing projects do not qualify."
- "All submissions and their respective repositories must be started and completed within the challenge window." Commits made after the deadline must be noted in the README or the entry may be disqualified.
- "Open-source code can be reused if your changes are significant and the source is credited." Non-trivial prior work must be credited. AI use is allowed.
- Prize categories: Best Use of Gemma means using Gemma by running it locally, fine-tuning it, or serving it through Google Cloud or another provider.
- A published DEV post using the template and the `hf26challenge` tag, a demo (video or link), a code link, and an explanation of why open innovation matters. Writing quality is weighted most heavily.

## Timeline (from `git log`; commit dates can be set by the committer, so this is a claim, not proof)

| When (UTC)         | Commit                                                                                                          | In the entry period?          |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 2026-10-21 19:35   | `4351b03` Core: dates, evidence verification, priority, planner                                                 | Yes (after the event record's 19 Oct 19:00 UTC start) |
| 2026-10-21 19:38   | `f1ea2e8` AI layer, PDF extraction, export                                                                      | Yes                           |
| 2026-10-22 02:59   | `5617d63` UI                                                                                                    | Yes                           |
| 2026-10-22 03:02   | `141fd3a` Eval harness, bundle URL check                                                                        | Yes                           |
| 2026-10-22 03:04   | `8530132` Documentation                                                                                         | Yes                           |
| 2026-10-24 12:27   | `c5d4c47` Upgrade: evidence-support and importance checks, outline mode, labelled sample data, reasoning panels | Yes                           |
| 2026-10-24 (later) | upgrade commits that follow in `git log` (evaluation suite, documentation)                                      | Yes                           |

History is unedited. No commit was made after the deadline as of this writing; **if you commit after 25 Oct 11:59 PM PDT, list it in the README.**

## Earlier public repository and relationship

The destination named for this work is <https://github.com/piyusshhjangid/PrepFlow>. GitHub showed its default branch is `main`; its README describes a monorepo using React, Express, Prisma, and PostgreSQL, materially different from this checkout. The latest commit returned by the connected GitHub view during this audit was `d8ec9cc` (`updating project`, 8 Oct 2026 07:45:40 UTC). That is an observed commit, **not verified as the repository's first commit**, and the audit did not establish whether other commits were made during 19–25 Oct. Do not infer either fact from this partial view.

The local branch history begins at `4351b03` on 21 Oct 2026 19:35:05 UTC and contains the subsequent commits listed above. Git author/committer dates are editable metadata, not independent proof of when work began. The destination repository's age also means a branch pushed there would not turn it into a repository started during the challenge window.

## What was reused

- **Source provenance:** the local history begins with this checkout's core files. That supports a separate codebase history, but does not independently prove the provenance of every implementation choice or establish contest eligibility.
- **Ideas shared, disclosed:** the model proposes and code verifies; source-evidence quotes checked against the material; capacity-aware scheduling with prerequisites and an explicit "does not fit" report; spaced revision at short fixed intervals.
- **I read PrepFlow's documentation and parts of its implementation** before writing this one, which is why several components have the same job (evidence check, chunker, planner, priority heuristic, export). They were rewritten, not copied, and are structured differently (below). A reader comparing the two will find the same concepts.
- Libraries keep their own licences: React, Vite, Vitest, zod, pdf.js, Testing Library, Prettier, tsx, jsdom.
- Built with an AI coding assistant (Claude). The owner directs and reviews; the DEV post should say so in the owner's words.

## What is different

|              | PrepFlow (before the window)                    | PrepFlow Sloth (this entry)                                                                                                                                                                    |
| ------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape        | Monorepo: React + Express + Prisma + PostgreSQL | One package, no backend, no database, no accounts                                                                                                                                              |
| Data         | Server-side, workspace-UUID access              | Browser `localStorage`, schema-validated on load                                                                                                                                               |
| PDF          | Server-side                                     | In-browser pdf.js, lazy-loaded                                                                                                                                                                 |
| Model path   | Ollama or a hosted Gemini adapter               | Ollama only, through a same-origin proxy; constrained JSON; fixed seed and output cap recorded per run                                                                                         |
| Evidence     | Chunk id + quote match                          | Normaliser with index map; page derived by code; **quote-support level** (does the quote use the topic's words?); **importance check** (the model may say "high" only if the material says so) |
| Failure path | Error and retry                                 | **Outline mode** (rule-based, no AI) as a labelled fallback and as the evaluation baseline; **labelled sample data**                                                                           |
| Planning     | Plan versions, Recover/Rebalance                | Plan is a pure function rebuilt from today; no overdue state                                                                                                                                   |
| Explanations | Priority points                                 | **"Why?" panels** that tag every statement as your material / you / model's guess / calculated / caveat                                                                                        |
| Evaluation   | Fake-provider tests                             | Gold set of 8 materials, baseline, 21 fault-injection scenarios, verifier checked on 1,774 synthetic quotes, planner invariants over 2,000 scenarios, live harness for Gemma                   |

Work done in the window is all of the above; the first three days built the app and the last added the checks, fallback, sample mode, explanations and evaluation.

## Theme fit

"Slow and Steady" asks for something that rewards laziness (tied to International Sloth Day, 20 Oct). The app's pitch is that the lazy path is the correct one: paste the syllabus, get one next step, miss a day and nothing breaks because the plan re-forms from today.

## Remaining risk, stated plainly

1. **Continuation risk.** Same author, same problem, same core idea as a project that predates the window. The rules do not define "different enough". The strongest honest defence is the table above and the unedited history; it is not a guarantee.
2. **The rules require the project to be "completed" in the window.** It is. That is a statement about this repository only.
3. **Repository-window rule:** the named GitHub destination predates this entry period and contains the earlier PrepFlow project. A branch push preserves its `main` history but does not satisfy the rule that the repository itself be started during the window. Ask the organizers whether a separately developed branch with a separate local history can qualify before presenting it as eligible. No confirmation has been obtained, and this document does not claim approval.
