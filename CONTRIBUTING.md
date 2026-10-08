# Contributing

Thanks for considering a contribution. Keep changes focused on helping a student understand what to study next. Preserve the division between semantic model output and deterministic application rules.

## Development

1. Install Node.js 20.11+ and npm 10+.
2. Follow the database and environment setup in [README](README.md). Integration tests require a separate disposable test database.
3. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` before opening a change.
4. For repository persistence changes, also run `npm run test:integration` only after verifying `TEST_DATABASE_URL` points to a disposable database.

Add tests for changed behavior. Never commit `.env`, credentials, real student notes or generated build output. Do not use real study material in fixtures. Keep model calls out of ordinary unit tests; use the deterministic fake provider, and do not claim real provider support without a successful smoke test.

## Pull requests

Describe the user-visible behavior, relevant tradeoffs, commands run and any known limitations. For UI changes, include genuine screenshots when available. Avoid broad rewrites unrelated to the issue.
