# Security notes

## Implemented controls

- Helmet security headers, explicit CORS origins, JSON body limits, endpoint rate limits and upload limits.
- PDF uploads are bounded, checked as PDF data, parsed as text and never used as filesystem paths. Original files are not retained; extracted study text is persisted for analysis and evidence.
- Request payloads and route identifiers are validated with Zod. Prisma queries are parameterized; the few advisory-lock calls use Prisma tagged SQL.
- Analysis has chunk, concurrency and retry bounds. Prompts, source text, API keys and raw model output are not written to application logs.
- Model output is untrusted and validated before it becomes domain data. Evidence is checked against the source.
- `.env` files are ignored; `.env.example` contains placeholders. The API owns AI credentials.

## Important limits

The UUID workspace key is the authorization mechanism. Anyone who obtains it can access that workspace; there are no accounts, authentication or ownership checks. Avoid sharing it. Study material text is stored in PostgreSQL. Deleting a material removes its source record, but evidence snippets already stored on topics may still be retained until re-analysis or topic deletion. Local Ollama keeps inference on the configured host; hosted inference sends material chunks to the configured provider. Choose based on the student's privacy needs.

The prompt injection guidance is a defense-in-depth instruction, not a formal security boundary for natural-language models. Stronger boundaries come from giving the model no tools, secrets or write access and validating all output as data. No external penetration test or production configuration review has been completed.

Report security issues privately through the repository owner. No private security contact is configured in this source snapshot.
