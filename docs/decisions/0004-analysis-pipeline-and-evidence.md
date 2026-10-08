# 0004: Analysis pipeline, evidence and determinism

**Status:** accepted (Checkpoint C)

```
materials → deterministic chunking → model → tolerant parse → Zod → evidence check → 2nd evidence check
          → deterministic merge → deterministic effort → one DB transaction → planning engine (later)
```

- **The model never controls business logic.** It classifies (difficulty, importance, effort _class_, revision need) and
  quotes. Minutes (20/45/90 × difficulty × importance × revision factor, rounded and clamped), merge decisions, weak-topic
  flags, page numbers and ordering are computed by code. Unknown fields the model invents (pages, hours) are stripped by Zod.
- **No evidence, no topic.** The model returns `{chunkId, quote}`. The application checks the chunk id, rejects short
  quotes (< 20 chars or < 3 words), fake ellipses and over-long quotes, then finds the quote in the chunk after a
  conservative normalization (NFKC, case, quotes/dashes, soft hyphens, whitespace, and hyphenation only when the hyphen is
  between letters with no spaces or at a line end). The stored snippet is the **source text**, and the page(s) come from
  the chunk's source map. Every snippet is verified a second time against the full material before saving.
- **Chunking** is greedy packing to a target size with the best-scored boundary (headings, page starts) chosen near the
  end of the window; hard maximum enforced; no overlap; no crossing materials; ids derived from the material's content hash
  and source offsets, so they are stable across runs and independent of upload order.
- **Prompt injection:** the system prompt states that material is untrusted data; material is wrapped in markers carrying a
  per-call random nonce that is guaranteed absent from the text; hints and names are stripped of control characters and
  angle brackets; the model has no tools, no secrets and no access to configuration; its output is only ever parsed as data.
- **Runs are persisted** (`AnalysisRun`: status, real stage, chunk counters, warnings, safe error code/message). Prompts and
  raw responses are not stored. Idempotency uses a fingerprint of schema/prompt/chunker versions, provider, model,
  material hashes, chunk sizes and weak-topic hints. One active run per exam is enforced in PostgreSQL with an advisory lock.
  Results replace the exam's topics in a single transaction, so a failed re-analysis keeps the previous good result.
- **Async without infrastructure:** the POST returns 202 immediately; the work runs in-process with a concurrency limit;
  the UI polls. Runs left active by a crashed process are failed at startup and by a heartbeat timeout when polled.
  If the process is restarted mid-analysis the run is simply restarted by the user: acceptable for an MVP, and the reason
  a queue is deliberately _not_ introduced yet.
