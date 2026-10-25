# Sloth branch consolidation

The repository has one supported product: the full-stack PrepFlow application at the repository root. The
`upgrade/gemma-evidence-eval` branch was an independent browser-only implementation with no API or database. Its
history is unrelated to the monorepo history, so merging its root tree would replace and delete the existing API,
Prisma schema, migrations, and frontend.

## Work carried into the full-stack application

- The analysis API now classifies each verified topic quote as `direct`, `nearby`, or `weak`, based on deterministic
  overlap between topic words and the quote or its source paragraph.
- The frontend explains that classification next to the verified quote. A weak link is advisory and remains visible;
  the model's quote must still pass the existing exact-source verification.
- A model `HIGH` importance suggestion is kept only when the material contains an exam-importance cue. Otherwise
  code lowers it to `MEDIUM`; the source sentence is shown beside the evidence and the existing `statedEmphasis`
  priority input is derived from that check.
- The result is stored in the existing JSON evidence field, so no schema migration is needed. The response schema
  keeps the field optional so older stored results remain readable.

## Preserved prototype work

The standalone implementation, source, offline fault and planner evaluations, gold-labelled samples, live Gemma
runner, browser mock, and supporting documentation are retained under
[`experiments/sloth-browser-prototype`](../experiments/sloth-browser-prototype/README.md). That evaluation suite
imports the prototype's own planner and analysis modules. Its results are evidence about that prototype only, not
the full-stack application's model quality.

The two apps remain intentionally distinguishable within one repository: root commands and CI validate the
full-stack application; prototype commands are run from its directory.
