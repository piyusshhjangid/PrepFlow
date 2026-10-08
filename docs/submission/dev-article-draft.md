# PrepFlow: helping a friend spend less time planning and more time studying

> **Draft only.** Replace bracketed text with facts the friend confirms. Do not publish until the friend test is complete and they consent to any personal story. No feedback or quotes are supplied yet.

## The problem

My friend, [only with permission: first name or “a friend”], was [describe the actual study-planning difficulty in their own words]. Before PrepFlow, they [describe what they really did manually]. I noticed [specific observation, verified with them].

## What I built

PrepFlow turns a student's notes and syllabus into a prioritized, revision-aware plan. It extracts topics with source evidence, asks the student to review the estimates and importance, then fits study sessions into their exam date and available days. Today shows the next work item; completion updates progress and schedules simple revision sessions.

## How it works

Gemma performs semantic analysis of the study material and proposes topics, classifications and evidence quotes. PrepFlow validates that output and checks quotes against the source. Deterministic code computes estimated effort, priority, prerequisite order, capacity, dates, revisions and progress. When work cannot fit, it reports the remaining workload and what was deferred.

## Why open-weight AI matters here

Ollama gives PrepFlow a local inference option. That can keep notes on the student's configured machine, though local setup and model quality still need to be verified. A hosted provider is also available and sends material to that provider. The student can see which path is configured; neither path should be described as private or working until tested.

## What the friend found

[After a real session, add their answers or a consented short quote: what helped, what confused them, whether the plan matched their habits, whether they would use it before an exam, and what they would change. If the test has not happened, leave this section out.]

## What I learned and what remains

[Add the actual lessons from implementation and the friend test.]

Known limits include no accounts, no OCR for scanned PDFs, an API-process analysis job, a greedy planner, and [deployment/provider status at publication].

## Demo and source

- Live demo: [add only after production smoke test]
- Source: [repository URL]
- Screenshots: [add genuine screenshots after capture]

<!-- Add the event-required challenge tag only after verifying the target event. -->
