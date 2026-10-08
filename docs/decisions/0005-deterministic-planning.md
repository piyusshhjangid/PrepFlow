# 0005: Deterministic planning, versioned plans

**Status:** accepted (Checkpoint D)

```
Exam settings + analyzed topics
   → priority engine → prerequisite graph (cycle repair) → capacity & fit → tiers
   → day-by-day packer (+ spaced revision) → StudyPlan v1 / StudyTask[]
   → Today (start / complete / skip) → progress (arithmetic)
   → recover missed tasks  |  re-plan the unfinished part → StudyPlan v2 …
```

## Decisions

- **AI classifies; code plans.** Checkpoint C already supplies importance, difficulty, emphasis, prerequisites, confidence,
  revision need and evidence. Checkpoint D adds **no AI call**. The model never emits a priority number, a time, a date or an
  explanation of a calculation. Every sentence shown as a reason is a template filled from stored fields.
- **Pure domain, thin shell.** `apps/api/src/domain/planning` has no database, clock, network or randomness. The service loads
  data, calls the pure functions with an explicit `today`, and persists the result. Given the same inputs the output is
  byte-identical (tested, including with shuffled input order).
- **One bounded score.** Eight integer components with fixed maxima (importance 24, weakness 20, foundation 14, difficulty 12,
  urgency 10, emphasis 8, evidence 6, revision 4), clamped to 0-100. The components are stored with the plan, so any priority
  can be explained later even if the formula changes.
- **Fit is stated, not hidden.** Required study time is compared with study capacity (usable time minus the revision reserve).
  Topics are walked in priority order and assigned a tier (`MUST`/`SHOULD`/`IF_TIME`/`DEFER`) by cumulative cost; prerequisites
  are pulled in with their dependent. Deferred topics are reported with the minutes that did not fit.
- **Per-day budgets, not clock times.** A day is a minutes budget; each day's usable time is `minutes - buffer`. The buffer is
  never planned, so slipping a task does not instantly overload the next day. Tasks are never split below 15 minutes and
  never exceed 120 minutes per sitting.
- **Cycles.** Model-suggested prerequisites are untrusted. Unknown and self references are ignored; any loop is broken by
  removing the claim that points furthest _backwards_ against document order (the least-supported claim), deterministically,
  and a warning is shown. The graph that is stored and scheduled is always a DAG.
- **Versions, not mutation.** Every generate/rebalance writes a new `StudyPlan` version and archives the previous one in one
  transaction under a per-exam advisory lock. Finished, skipped and in-progress tasks are _copied_ into the new version
  (with `carriedFromTaskId`), so the active plan is self-contained and the archived one is the untouched audit trail. Task
  updates take the same lock, so a completion can never be lost to a concurrent rebalance.
- **Tasks outlive topics.** Re-analysis replaces topics. `StudyTask.topicId` is `ON DELETE SET NULL` and tasks keep
  `topicName`/`subjectName` snapshots; re-analysis also archives the active plan.
- **Recovery before re-planning.** `RECOVER` moves only missed (open, past-dated) tasks into spare time (planned time first,
  then the buffer), splitting them if needed, and reports `overloadMinutes` rather than overfilling a day. `REPLAN` re-plans all
  unfinished work using current settings and may defer low-priority topics.

## Alternatives rejected

- _Let the model schedule or score:_ non-reproducible, un-testable, and the student could not be told why.
- _Optimal solver (ILP/CP):_ extra dependency and opaque results for a problem where explainability matters more than the last
  few percent of packing.
- _Mutate one plan in place:_ loses the reason a plan changed and makes concurrent edits hard to reason about.
- _Exact clock times:_ false precision for a study plan; a daily budget is what a student actually follows.

## Consequences

- The greedy packer can leave small gaps and is not optimal; it is predictable and explainable instead.
- Plans are only as good as the effort estimates and prerequisite suggestions from Checkpoint C.
- The planner needs the browser's date within one day of the server's UTC date; there is no per-user time zone yet.
