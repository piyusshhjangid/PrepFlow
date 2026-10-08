# Planning (Checkpoint D)

PrepFlow turns the analyzed topics and the student's constraints into a study plan **with deterministic code**. The AI
(Checkpoint C) only classifies topics; it never produces a priority, a time, or a schedule. The planning engine lives in
`apps/api/src/domain/planning` and is pure: no database, clock, network or randomness. See
[decision 0005](decisions/0005-deterministic-planning.md) for why.

## Inputs

| Input                             | Source                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topics                            | Checkpoint C result: difficulty, importance, emphasis, confidence, weak flag, prerequisites, revision weight, **estimated minutes** (computed by code, never by the AI), evidence |
| Exam date                         | exam; the exam day itself is not a study day                                                                                                                                      |
| Planning date (today)             | supplied by the caller (server UTC date, or the browser's date within ±1 day); stored with the plan                                                                               |
| Daily minutes, weekdays, days off | exam settings                                                                                                                                                                     |
| Buffer %                          | exam setting (default 10%, max 30% in the UI/API, 50% in the engine)                                                                                                              |
| Revision reserve %                | exam setting (default 15%)                                                                                                                                                        |
| Revision intervals                | exam setting (default +1, +3, +7 days)                                                                                                                                            |
| Learner confidence                | exam setting 1-5 (optional)                                                                                                                                                       |

Invalid input (negative or absurd minutes, impossible dates, an exam more than 400 days away, more than 600 topics) is rejected
with a safe validation error. A past or same-day exam is _valid_: it simply plans nothing and says so.

## Capacity and fit

For every study day (a chosen weekday, not a day off, from today up to but excluding the exam day):

```
total           = minutes per day
usable          = floor(total x (1 - buffer%) / 5) x 5          # the most that is ever planned
revisionReserve = floor(usable x reserve% / 5) x 5               # kept for revision
studyCapacity   = usable - revisionReserve                       # guaranteed to new learning
```

Totals across days give `totalMinutes`, `bufferMinutes`, `usableMinutes` and `studyCapacityMinutes`. **Required** time is the sum of
the topics' remaining study minutes (Checkpoint C's deterministic estimate, minus work already done). Fit status:

| Status          | Meaning                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| `GOOD`          | everything fits with room to spare                                                    |
| `TIGHT`         | everything fits, but required > 90% of capacity or some revision was squeezed out     |
| `OVER_CAPACITY` | some study minutes were deferred; the plan states the gap and names what was deferred |
| `NO_CAPACITY`   | no usable time before the exam (exam today/past, no study days, ...)                  |

The revision reserve is a floor for revision, not a ceiling: unused reserve flows to study, and revision that does not fit the
reserve may use leftover time. Revision is reserved first only up to the reserve.

## Priority formula

```
score = clamp(0, 100, importance + emphasis + weakness + difficulty + foundation + urgency + evidence + revision)
```

| Component  | Rule                                                                                          | Max |
| ---------- | --------------------------------------------------------------------------------------------- | --- |
| importance | LOW 0 · MEDIUM 10 · HIGH 24                                                                   | 24  |
| emphasis   | material stresses the topic: +8                                                               | 8   |
| weakness   | the student's weak-topic hint matched the topic: +20                                          | 20  |
| difficulty | EASY 0 · MEDIUM 4 · HARD 8, x1.5 / 1.25 / 1 / 0.75 / 0.5 for learner confidence 1-5 (rounded) | 12  |
| foundation | +4 per topic that directly needs this one, +1 per indirect dependent, capped                  | 14  |
| urgency    | (importance + emphasis) x 30% (<= 3 days), 20% (<= 7), 10% (<= 14); otherwise 0               | 10  |
| evidence   | round(confidence x 4), +2 if two or more verified quotes                                      | 6   |
| revision   | round(revision weight x 4)                                                                    | 4   |

Levels for display: `HIGH` >= 45, `MEDIUM` >= 25, otherwise `LOW`. The model's own confidence only nudges the score by at most 6
points through `evidence`; it can never override importance, weakness or ordering. Each component is stored in the plan summary and
the "Why this priority?" list is generated from it (`High importance in your material (+24)`), largest first.

**Tie-breaking** (everywhere ranking is needed): higher score, then more direct dependents, then shallower graph depth, then
document order, then id.

## Prerequisite graph

Edges run prerequisite -> dependent. Before use the graph is sanitized:

1. references to unknown topics and self references are ignored (and counted in a warning);
2. **cycles** are found with Tarjan's strongly-connected-components. In every cycle the edge that points furthest _backwards_
   against document order (a prerequisite listed after its dependent) is removed first; ties break on ids. This repeats until
   the graph is acyclic. Each removal produces a `CYCLE_BROKEN` warning naming the topics and the ignored link;
3. depth, direct and transitive dependent counts, and orphans (no prerequisites and no dependents; planned on priority alone) are
   computed on the repaired DAG.

A prerequisite inherits (almost) the effective priority of its most important dependent, so it is not scheduled behind it.

## Tiers: what is protected

Topics are visited in priority order. Adding a topic also adds every not-yet-included prerequisite; the running total of those
bundles against the study capacity decides the tier:

```
<= 50% of capacity  MUST        protected
<= 80%              SHOULD
<= 100%             IF_TIME     first to go if the plan changes
beyond              DEFER       does not fit
```

A deferred topic does not stop cheaper, lower-priority topics from using what is left. A topic bigger than the entire capacity gets
the part that fits and is reported as deferred for the rest. When everything fits, tiers describe how much capacity each slice
uses. Tiers are stored on each task, so the plan keeps explaining itself.

## Packing the calendar

Days are processed in date order. Each day:

1. due **revision** sessions are placed (earliest due, then higher tier/priority), up to the day's revision reserve;
2. **study** is filled with the best _ready_ topic that fits (ready = every prerequisite is already finished; best = tier, then
   inherited priority, depth, document order, id). A topic gets one sitting per day, at most 60 minutes (`maxSessionMinutes` in
   `domain/planning/config.ts`), never a leftover sliver below 15 minutes; longer topics continue on following days as "part i of n";
3. leftover time takes revision that did not fit the reserve.

A day never exceeds `usable`. Tasks are multiples of 5 minutes. Nothing is ever scheduled on or after the exam day or before today.
It is a greedy heuristic: predictable and explainable, not provably optimal.

## Revision

After a topic's last study sitting, review `k` is due `intervals[k]` days later (default 1, 3, 7), moved forward to the next
study day. Rules:

- never before the day after studying, never after the last study day before the exam;
- the number of reviews depends on the tier: MUST all, SHOULD up to 2, IF_TIME 1, DEFER none;
- intervals that land on the same day collapse into one review;
- **when the exam is too close** for any interval, important topics (MUST, or MEDIUM+ priority) get a single _compressed final
  review_ on the last study day, flagged to the student;
- review length = topic minutes x (35%, 25%, 20% for reviews 1, 2, 3) x (0.5 + revision weight), rounded to 5, at least 10 and
  never longer than the topic's own study time or the day's revision reserve;
- reviews that cannot fit are dropped and reported (`REVISION_SQUEEZED`).

With two days left you therefore get at most one short review, never a "+7 days" review.

## Daily execution and progress

Task status: `PENDING -> IN_PROGRESS -> COMPLETED`, or `SKIPPED`. Completing is idempotent; contradictory changes (completing a
skipped task, skipping a completed one) return 409. Only tasks of the _active_ plan can change. Optional `actualMinutes` is stored.

Progress is arithmetic on tasks: completed/remaining/skipped/overdue minutes and counts, revision completed, topic status
(`NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`, `DEFERRED`), completion % of planned minutes, per-day summaries. Overdue = open and dated
before the planning date.

## Missed tasks: recovery and rebalancing

- **Recover** (`mode: RECOVER`): open tasks dated before today are moved, highest tier/priority first, into spare time on remaining
  study days. Planned time (`usable`) is used first, the daily buffer second (reported as `usedBufferMinutes`). A task is split across days
  if it must be. Whatever still does not fit stays overdue and is reported as `overloadMinutes` ("the plan is now overloaded by 45m"),
  never silently forced into a full day. Nothing else moves. A warning appears if a recovered task now follows a dependent topic.
- **Rebalance** (`mode: REPLAN`): everything finished, skipped or in progress is carried over exactly (date, minutes, status,
  timestamps, actual minutes); the rest is re-planned from today with the _current_ settings. Topics already studied only need
  later revisions; revision numbering continues. `includeSkipped` turns skipped study work back into required work.
- Both create a **new version** and archive the old one (kept as history). Recovery with nothing missed is a 409, not an empty version.

## Determinism and safety guarantees

- Same topics, settings, planning date and history -> identical plan (tested over 150 seeded random scenarios, including shuffled input order).
- Invariants tested: daily load <= usable; tasks only on study days; no task on/after the exam; revision after study and before the exam;
  prerequisites finish before dependents start; scheduled + deferred = required; recovery conserves minutes; completed tasks survive
  rebalancing unchanged.
- Bounds: <= 600 topics, <= 6000 tasks, <= 400 days ahead, minutes per day 1-1440, buffer <= 30% (API), actualMinutes <= 720.
  Planning 500 topics takes well under a second.

## Limitations

- Greedy packing: small gaps are possible; there is no global optimum guarantee.
- Per-day budgets only; no clock times, breaks or time zones (the server's UTC date, or the browser's date within one day).
- Effort estimates and prerequisites are as good as Checkpoint C's output; topics are linked within a subject.
- Skipped study work is not re-planned unless you rebalance with "include skipped".
- Plans archive when material is re-analyzed; there is no migration of old tasks onto new topics (finished history is kept by name).
