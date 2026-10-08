# AI architecture and limits

PrepFlow exposes one `AiProvider` interface with an Ollama adapter for local inference and a Google Generative Language API adapter for hosted inference. The selected provider and model come from server environment configuration. The fake adapter is for tests and scripted demos; it is not a production model.

Each call asks the model for structured topic data and source quotes. Uploaded text is treated as untrusted content and surrounded with per-call markers; the model receives no tools, secrets or ability to write the database. Output passes tolerant JSON extraction, strict Zod parsing and evidence checks against canonical material text. Invalid chunks receive bounded transient retries and one repair attempt. Topics without source support are discarded. The AI output does not control final minutes, priority scores or dates.

Priority is calculated from importance, material emphasis, student weakness, difficulty adjusted by confidence, prerequisite dependents, exam urgency, evidence confidence and revision need. The deterministic planner applies preferred days, blocked dates, buffers, prerequisite order and capacity, reports deferred work, and schedules revision at configured intervals (default +1, +3, +7 days). These intervals are a simple rule, not a claim of scientifically optimal spaced repetition.

Provider smoke tests are performed with `npm run ai:smoke` against the configured real provider. Automated tests use a fake provider and do not establish real model quality, availability or hosted-model entitlement. At this checkpoint, real Gemma inference is **not verified**. See [analysis details](analysis.md) and [the provider decision](decisions/0003-ai-provider-abstraction.md).
