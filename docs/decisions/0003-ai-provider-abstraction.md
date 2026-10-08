# 0003: Provider-agnostic AI layer, Gemma first

**Status:** accepted (Checkpoint C)

- `AiProvider` (`apps/api/src/ai/provider.ts`) is the only AI interface the application depends on:
  `complete({ system, user }) → text`. Implementations: `OllamaProvider` (local Gemma, default model
  `gemma4:e4b`), `GeminiProvider` (hosted Gemma through the Gemini API, default `gemma-4-26b-a4b-it`) and
  `FakeAiProvider` (deterministic, for tests). Only `ai/create-provider.ts` knows the concrete classes.
- Providers return **raw text**. Parsing, validation and evidence checks are not provider concerns, so every provider
  gets the same safety net, and providers that ignore a requested JSON mode or schema still work.
- Failures are classified as `transient` (network, timeout, 5xx, 429) or `permanent` (bad key, unknown model, bad request).
  Only transient failures are retried, with exponential backoff and a hard attempt cap (`AI_MAX_ATTEMPTS`).
  A permanent failure stops the whole run immediately instead of repeating a doomed call for every chunk.
- Provider error messages are written by PrepFlow and never include response bodies, prompts or keys. The Gemini key
  travels in a header, never in a URL.
- No SDKs, LangChain or agent frameworks: two small `fetch` clients are easier to audit than a dependency tree.
